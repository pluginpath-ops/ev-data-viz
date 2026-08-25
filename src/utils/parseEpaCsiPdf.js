/**
 * Parse an EPA "Certification Summary Information" (CSI) PDF — the manufacturer's
 * lab-submission report — into the curator model (one record per vehicle config).
 *
 * Input is the ordered list of text items extracted from the PDF (see
 * extractPdfText.js, which uses pdf.js in the browser). CSI reports are
 * iText-generated text PDFs laid out as (label)(value) pairs, so parsing is a
 * label-anchored walk over the item stream, segmented Group → Config → Test →
 * Bag/Phase.
 *
 * Output shape matches getEpaTestGroupFull / the importer contract:
 *   { groups: [{ test_group_id, epa_test_family_id, model_year, make,
 *                epa_carline_name, vehicle_config_number, drive, fuel_type,
 *                total_voltage, battery_specific_energy, useable_kwh,
 *                carryover_test_group_id, carryover_model_year,
 *                coefficient_sets: [...], tests: [{ ..., phases: [...] }] }],
 *     warnings: [...] }
 *
 * `model_year` / `epa_test_family_id` are the CERTIFICATION's, from page 1. The
 * `carryover_*` pair is where the emission data vehicles were tested, which on a
 * carryover certification is a different year and a different group — see
 * parseCertHeader and migration 056.
 *
 * Phase type is not stated in the PDF, so it's inferred from phase distance
 * (~10.26 mi → HWY, ~7.45 mi → UDDS, ≫10× neighbors → SS), matching the curator
 * form's auto-suggest. Everything is editable post-import.
 */

import { HWFET_MI, UDDS_MI, CYCLE_DIST_TOL as DIST_TOL } from '../constants/epa';

/** MM/DD/YYYY → YYYY-MM-DD (Postgres date); pass through anything else. */
function toIsoDate(s) {
    const m = String(s ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : (s || null);
}

const parseNum = (s) => {
    if (s == null) return null;
    const t = String(s).trim().replace(/,/g, '');
    if (!t || t === '--' || /^n\/?a$/i.test(t)) return null;
    const n = parseFloat(t);
    return Number.isNaN(n) ? null : n;
};

/** Infer a phase type from its distance + the test's other distances. */
function inferPhaseType(distanceMi, otherDistances, cold) {
    const d = parseNum(distanceMi);
    if (d == null || d <= 0) return null;
    const others = otherDistances.map(parseNum).filter(x => x != null && x > 0);
    if (others.length && d >= 10 * Math.min(...others)) return 'SS';
    if (Math.abs(d - HWFET_MI) <= DIST_TOL) return cold ? 'HWY' : 'HWY';
    if (Math.abs(d - UDDS_MI)  <= DIST_TOL) return cold ? 'Cold-UDDS' : 'UDDS';
    return null;
}

/** Trim verbose legal suffixes from a manufacturer name (Lucid USA, Inc → Lucid). */
function cleanMake(make) {
    if (!make) return null;
    return make
        .replace(/,?\s*\b(USA|Inc|LLC|Ltd|GmbH|AG|Corp|Corporation|Co|Company|Automotive|North America)\b\.?/gi, '')
        .replace(/,\s*$/, '').trim() || make;
}

/** Map a CSI coefficient-category label to our enum. */
function mapCoeffCategory(label) {
    const s = label.toLowerCase();
    if (s.includes('cold')) return 'Cold CO';
    if (s.includes('us06')) return 'US06';
    if (s.includes('city') || s.includes('highway')) return 'City/Highway';
    return null;
}

/**
 * The certification's OWN identity, read from the page-1 header.
 *
 * Must run on the RAW item stream, before stripNoise: page 1 states the test
 * group as a field, every later page repeats it as a footer, and the two are
 * character-identical, so nothing downstream of the strip can tell them apart.
 *
 * Both values are the certification's, NOT the emission data vehicles'. On a
 * carryover certification those differ — VVVXT00.0ZVG / 2027 here against
 * "Original Test Group Name" TVVXT00.0ZVG / "Original Test Vehicle Model Year"
 * 2026 per config — and it is the certification's that identifies the record and
 * joins to the Fuel Economy Guide. See migration 056.
 *
 * "Test Group" appears ~22 times in a 21-page report and all but one are the
 * page-1 field or a footer repeating it — same value either way, so which one is
 * read does not matter. The exception is the "Official Test Numbers" column
 * header, whose value slot holds "Fuel". So take the first occurrence that looks
 * like an ID rather than the first occurrence: an ID has a dot and no spaces,
 * and scanning on means a report whose page 1 did not extract still recovers the
 * value from a footer.
 */
const TEST_GROUP_ID = /^[A-Z0-9]{3,}\.[A-Z0-9]{3,}$/i;
const YEAR = /^(19|20)\d{2}$/;

/**
 * The certification's own model year, skipping the blank items between a label
 * and its value.
 *
 * `valAfter` cannot be used here. This runs on the RAW stream — it has to, so
 * page 1 can be told from the footers that repeat it — and pdf.js emits a
 * separator between a label and its value that `stripNoise` would have removed:
 *
 *     "Model Year"  " "  "2027"  ""  "Test Group Information"
 *
 * So the literal next item is a space, `parseNum` returned null, and EVERY
 * certificate fell back to "Original Test Vehicle Model Year". On a normal
 * certificate the two agree and nothing looked wrong. On a CARRYOVER they do
 * not: the Volvo EX90 certifies for 2027 and carries over 2026 lab work, and it
 * was being stored as 2026 — the precise confusion migration 056 exists to
 * prevent, and enough to make the guide-linking sweep reject its own correct
 * same-year candidate.
 *
 * `certTestGroup` above escaped this only by accident: it scans every
 * occurrence for something shaped like an ID, so blanks are skipped on the way.
 * This does the same thing deliberately — scan forward past empties, and stop
 * at the first non-blank, which must look like a year or this was not the field.
 */
function certYearFrom(items) {
    for (const i of indicesWhere(items, s => s === 'Model Year')) {
        for (let j = i + 1; j < Math.min(i + 5, items.length); j++) {
            const v = String(items[j] ?? '').trim();
            if (!v) continue;
            return YEAR.test(v) ? Number(v) : null;
        }
    }
    return null;
}

/**
 * The certification test group, skipping the same blanks certYearFrom does.
 *
 * The previous version read `items[i + 1]` and a comment claimed it escaped the
 * separator problem "by accident" because it scans every occurrence. It does
 * not. EVERY occurrence has the blank, so every candidate was a space, nothing
 * matched the ID shape, and the result was null on every certificate — Volvo,
 * Mercedes and BMW alike. `epa_test_family_id` therefore fell back to the
 * carryover group on every import, which is both the wrong identity and the
 * loss of a real join: the Fuel Economy Guide carries this exact string as
 * "#1 Smog Rating Test Group".
 *
 * Scanning past empties keeps what the original was actually right about —
 * checking the SHAPE rather than trusting position. The one occurrence that is
 * not a test group is the "Official Test Numbers" column header, whose value
 * slot holds "Fuel", and an ID has a dot and no spaces.
 */
function certGroupFrom(items) {
    for (const i of indicesWhere(items, s => s === 'Test Group')) {
        for (let j = i + 1; j < Math.min(i + 5, items.length); j++) {
            const v = String(items[j] ?? '').trim();
            if (!v) continue;
            if (TEST_GROUP_ID.test(v)) return v;
            break;   // first non-blank was not an ID: wrong occurrence, try the next
        }
    }
    return null;
}

function parseCertHeader(rawItems) {
    const items = rawItems || [];
    return { certTestGroup: certGroupFrom(items), certModelYear: certYearFrom(items) };
}

/**
 * Remove page header/footer noise that interleaves the content stream:
 *   "Date: …", "Certification Summary Information Report", "Page N of M …",
 *   and the running "Test Group"/id + "Evaporative/Refueling Family"/value
 *   footer pair (parseCertHeader has already taken the page-1 field off the
 *   raw stream, which is the only occurrence that is not noise).
 */
function stripNoise(items) {
    const out = [];
    for (let i = 0; i < items.length; i++) {
        const s = (items[i] ?? '').trim();
        if (!s) continue;
        if (/^Page \d+ of \d+/.test(s)) continue;
        if (s === 'Certification Summary Information Report') continue;
        if (/^Date:\s*\d{2}\/\d{2}\/\d{4}/.test(s)) continue;
        // Footer header pairs: drop the label AND its trailing value.
        if (s === 'Test Group' || s === 'Evaporative/Refueling Family') { i++; continue; }
        out.push(s);
    }
    return out;
}

// ── Label-anchored lookups within a [start,end) window ──────────────────────

/** Index of the first item exactly equal to `label` in [start,end). */
const idxOf = (items, label, start = 0, end = items.length) => {
    for (let i = start; i < end; i++) if (items[i] === label) return i;
    return -1;
};

/** The item immediately after the first occurrence of `label` (its value). */
function valAfter(items, label, start = 0, end = items.length) {
    const i = idxOf(items, label, start, end);
    return i >= 0 && i + 1 < end ? items[i + 1] : null;
}

/** All indices in [start,end) where predicate(item) is true. */
function indicesWhere(items, pred, start = 0, end = items.length) {
    const out = [];
    for (let i = start; i < end; i++) if (pred(items[i], i)) out.push(i);
    return out;
}

// ── Models covered by this certificate ──────────────────────────────────────

/**
 * Where a covered-model row stops, and what its other columns look like.
 *
 * The table's remaining columns are a closed vocabulary, so a carline name runs
 * until one of them appears or until the next `NNN - ` marker.
 *
 * Matched by PREFIX, not equality, and that is the whole difficulty: the cells
 * WRAP. EPA emits `296 - EX90 Twin` then `Motor` then `California + CAA` then
 * `Section 177 states` as four separate text items. An exact-match stop list
 * never fires on `California + CAA`, so the name swallows the rest of the row —
 * which is precisely what a first attempt did.
 */
const COVERED_REGION_RE = /^(California|Federal|Section 177)/;
const COVERED_DRIVE_RE  = /^(All Wheel|Part-time|Full-time|2-Wheel|4-Wheel|Rear Wheel|Front Wheel|Drive$)/;
const COVERED_TRANS_RE  = /^(Automatic|Manual|Continuously|Semi-Automatic)/;

/** True when an item begins a column that is not the carline name. */
function endsCoveredName(item) {
    return COVERED_REGION_RE.test(item)
        || COVERED_DRIVE_RE.test(item)
        || COVERED_TRANS_RE.test(item)
        || /^(No|Yes|--)$/.test(item)
        || /^\d+$/.test(item);
}

/**
 * Every configuration a certificate covers.
 *
 * The Emission Data Vehicle Information page names ONE represented vehicle for
 * the whole certificate. This table names them all, with the wheel or tyre
 * variant where the manufacturer writes it — `EX90 Twin Motor (21 inch Wheels)`,
 * `R1T Performance Dual Max (20in)` — and those strings match Fuel Economy
 * Guide carlines closely enough to link on (#250).
 *
 * Bounded to the table. A scan that only looked for `NNN - ` swallowed
 * `Multi-Cycle Test (MCT) Exhaust Test #…` out of a later section on a real
 * file, so it stops at whichever section heading comes next.
 */
export function parseCoveredModels(items) {
    const start = idxOf(items, 'Models Covered by this Certificate');
    if (start < 0) return [];

    let end = items.length;
    for (const marker of ['Engine Description', 'Emission Data Vehicle Information',
                          'Vehicle Emission Control', 'Certification Summary']) {
        const i = idxOf(items, marker, start + 1);
        if (i >= 0 && i < end) end = i;
    }

    /**
     * Read one `N - Name` cell, rejoining the fragments EPA split it across.
     * Returns the value and where reading stopped.
     */
    const readNumbered = (from) => {
        const m = /^(\d{1,4}) - (.*)$/.exec(items[from]);
        if (!m) return null;
        let name = m[2];
        let k = from + 1;
        while (k < end && !endsCoveredName(items[k]) && !/^\d{1,4} - /.test(items[k])) {
            name += ' ' + items[k];
            k += 1;
        }
        return { number: m[1], name: name.replace(/\s+/g, ' ').trim(), next: k };
    };

    const rows = [];
    let i = start;
    while (i < end) {
        const first = readNumbered(i);
        if (!first) { i += 1; continue; }

        // Division and carline have the SAME shape — `1 - Volvo Cars of North
        // America, LLC` and `297 - EX90 Twin Motor (21 inch Wheels)` — and
        // Lucid numbers its carlines in single digits, so neither the format
        // nor the width tells them apart. Position does: the division always
        // immediately precedes the carline. When two numbered cells run
        // together, the first is the division.
        let division = null;
        let carline = first;
        if (first.next < end && /^\d{1,4} - /.test(items[first.next])) {
            const second = readNumbered(first.next);
            if (second) { division = first; carline = second; }
        }

        let i2 = carline.next;
        let region = null;
        while (i2 < end && COVERED_REGION_RE.test(items[i2])) {
            region = region ? `${region} ${items[i2]}` : items[i2];
            i2 += 1;
        }
        let drive = null;
        while (i2 < end && COVERED_DRIVE_RE.test(items[i2])) {
            drive = drive ? `${drive} ${items[i2]}` : items[i2];
            i2 += 1;
        }
        const transmission = (i2 < end && COVERED_TRANS_RE.test(items[i2])) ? items[i2++] : null;
        const gears = (i2 < end && /^\d+$/.test(items[i2])) ? Number(items[i2++]) : null;

        if (carline.name) {
            rows.push({
                carline_number: carline.number,
                carline_name: carline.name,
                division: division?.name ?? null,
                certification_region: region,
                drive_system: drive,
                transmission_type: transmission,
                gears,
            });
        }
        i = Math.max(i2, carline.next);
    }

    return rows;
}

// ── Coefficient table ───────────────────────────────────────────────────────

/**
 * Parse the coefficient table within [start,end). Layout: header labels, then
 * per category one row of 7 numbers (target A/B/C, set A/B/C, HP). Returns
 * coefficient_sets[].
 */
function parseCoefficients(items, start, end, equivTestWeightLbs = null) {
    const head = idxOf(items, 'Target Coefficients', start, end);
    if (head < 0) return [];
    const sets = [];
    for (let i = head; i < end; i++) {
        const cat = mapCoeffCategory(items[i] || '');
        // Only treat as a category row when followed by ≥6 numbers.
        if (!cat) continue;
        const nums = [];
        let j = i + 1;
        while (j < end && nums.length < 7 && parseNum(items[j]) != null) { nums.push(parseNum(items[j])); j++; }
        if (nums.length < 6) continue;
        sets.push({
            category: cat,
            is_primary: cat === 'City/Highway',
            target_a: nums[0], target_b: nums[1], target_c: nums[2],
            set_a: nums[3], set_b: nums[4], set_c: nums[5],
            // Stated once per configuration, on the page above this table, and
            // shared by every category on it — the categories are different
            // coefficient sets for the same vehicle at the same inertia class.
            equiv_test_weight_lbs: equivTestWeightLbs,
        });
        i = j - 1;
    }
    // De-dup categories (first wins), guarantee one primary.
    const seen = new Set();
    const unique = sets.filter(s => (seen.has(s.category) ? false : seen.add(s.category)));
    if (unique.length && !unique.some(s => s.is_primary)) unique[0].is_primary = true;
    return unique;
}

// ── Tests & phases ──────────────────────────────────────────────────────────

const isTestHeader = (s) => /^\d{1,3}\s*-\s*\S/.test(s) && /charge depleting|multi-?cycle|mct|highway|udds|ftp/i.test(s);

function parsePhases(items, start, end, cold) {
    const bagIdx = indicesWhere(items, s => /^Charge Depleting Bag\/Phase #\d+/.test(s), start, end);
    const raw = bagIdx.map((bi, k) => {
        const bEnd = k + 1 < bagIdx.length ? bagIdx[k + 1] : end;
        const m = items[bi].match(/#(\d+)/);
        return {
            phase_index: m ? Number(m[1]) : k + 1,
            distance_mi: parseNum(valAfter(items, 'Actual Distance Driven (miles)', bi, bEnd)),
            dc_energy_kwh: parseNum(valAfter(items, 'Integrated DC KW-HRS', bi, bEnd)),
        };
    });
    const dists = raw.map(p => p.distance_mi);
    return raw.map(p => ({ ...p, phase_type: inferPhaseType(p.distance_mi, dists.filter((_, i) => raw[i] !== p), cold) }));
}

/**
 * The manufacturer's note for the test beginning at `ti`.
 *
 * Searched BACKWARDS, because the field sits above its test rather than inside
 * it — in the Volvo certificate the comment is item 516 and that test's `Test #`
 * is 525. A forward scan from the test header, which is what a first attempt
 * did, finds nothing and silently drops the field.
 *
 * Bounded below by the previous test (or the configuration start) so a
 * certificate with several tests gives each the note that precedes it, rather
 * than every test inheriting the first one. `Test #` is read the same way, for
 * the same reason.
 */
function commentsBefore(items, ti, lowerBound) {
    for (let b = ti - 1; b >= lowerBound; b--) {
        if (items[b] === 'Manufacturer Test Vehicle Comments') {
            const v = items[b + 1];
            // The label is present on every certificate; the value is often the
            // placeholder EPA writes when a manufacturer said nothing.
            return v && v !== '--' ? v : null;
        }
    }
    return null;
}

function parseTests(items, start, end) {
    const testIdx = indicesWhere(items, isTestHeader, start, end);
    return testIdx.map((ti, k) => {
        const tEnd = k + 1 < testIdx.length ? testIdx[k + 1] : end;
        const tStart = k > 0 ? testIdx[k - 1] : start;
        const header = items[ti];
        const procMatch = header.match(/^(\d{1,3})\s*-/);
        const cold = /cold|degree/i.test(header);
        // "Charge Depleting Range Highway" then "(Calculated miles)" then value.
        const hwyLabelIdx = idxOf(items, 'Charge Depleting Range Highway', ti, tEnd);
        const cdRangeHwy = hwyLabelIdx >= 0 ? parseNum(items[hwyLabelIdx + 2]) : null;
        const phases = parsePhases(items, ti, tEnd, cold);
        const phaseDc = phases.reduce((s, p) => s + (p.dc_energy_kwh ?? 0), 0);
        // Total DC has two reporting conventions across OEMs — pick data-driven,
        // not per-manufacturer:
        //   1. Real per-phase Integrated DC KW-HRS → their sum (incl. the SS bag).
        //      Rivian/BMW/Lucid MCT do this (~142 kWh).
        //   2. Per-phase KW-HRS are dummy/zero and the total is in "System End
        //      State of Charge Watt-hours" (Tesla CD-Hwy/UDDS).
        //   3. A single-cycle test carries BOTH, and they are different
        //      quantities. BMW's i7 (TBMXV00.0G7A) reports a real 2.446 kWh
        //      against a 10.25-mile phase — one HWFET — while the SoC field
        //      holds 106.227 kWh, the whole depletion. A single-cycle test
        //      drives ONE cycle and repeats it until the pack is empty, so the
        //      phase is the RATE and the SoC field is the CAPACITY.
        //
        // So: on a multi-cycle test the phases span the depletion and their sum
        // IS the total. On a single-cycle test it never is, however real the
        // per-phase energy looks. Taking the phase sum there stored 2.446 kWh as
        // the pack, which is where the 2-5 kWh batteries came from — and made
        // charging efficiency 2.446/119.873 = 2%, which is one cycle measured
        // against a full recharge.
        //
        // The SoC field is *labelled* Watt-hours but some OEMs report kWh there
        // (Tesla: 78.688) and others Wh — normalise by magnitude (EV packs are
        // ~30–250 kWh, so >400 ⇒ value is Wh).
        const endSoc = parseNum(valAfter(items, 'System End State of Charge Watt-hours', ti, tEnd));
        const endSocKwh = endSoc == null ? null : (endSoc > 400 ? endSoc / 1000 : endSoc);
        const procCode = procMatch ? Number(procMatch[1]) : null;
        const singleCycle = procCode === 84 || procCode === 81;
        const total_dc = (singleCycle && endSocKwh > 0) ? endSocKwh
            : (phaseDc > 0 ? phaseDc : endSocKwh);

        // Single-cycle CD tests (84 = Highway, 81 = UDDS) whose per-phase data is
        // dummy: the whole depletion IS one cycle, so synthesize one phase from
        // the test totals — actual miles driven + total DC. The CD-Highway test
        // runs the HWFET cycle, so the resulting HWY phase is a valid η anchor
        // (e.g. Tesla Model Y: 78.946 kWh / 369 mi = 214 Wh/mi = its HWFE avg).
        let effPhases = phases;
        if (phaseDc <= 0 && (procCode === 84 || procCode === 81) && total_dc > 0) {
            const actualMiles = parseNum(valAfter(items, 'Charge Depleting Range (Actual miles)', ti, tEnd))
                ?? parseNum(valAfter(items, 'Charge Depleting Range (Calculated miles)', ti, tEnd));
            if (actualMiles > 0) {
                effPhases = [{
                    phase_index: 1,
                    phase_type: procCode === 84 ? 'HWY' : 'UDDS',
                    distance_mi: actualMiles,
                    dc_energy_kwh: Math.round(total_dc * 1000) / 1000,
                }];
            }
        }
        // Distance has to describe the same run as the energy above. On a
        // single-cycle test the phase is one cycle, so its distance is not what
        // total_dc was drawn over — the depletion range is. Leaving the phase
        // sum here paired 106 kWh with 10.25 miles.
        const cdActualMi = parseNum(valAfter(items, 'Charge Depleting Range (Actual miles)', ti, tEnd))
            ?? parseNum(valAfter(items, 'Charge Depleting Range (Calculated miles)', ti, tEnd));
        const phaseDist = effPhases.reduce((s, p) => s + (p.distance_mi ?? 0), 0);
        const total_dist2 = (singleCycle && phaseDc > 0 && cdActualMi > 0) ? cdActualMi : phaseDist;

        // The EPA "Test #" + value precede the procedure header (Test # → value
        // → Test Procedure → "NN - …"), so look back a few items for it.
        let test_number = null;
        for (let b = ti - 1; b >= Math.max(0, ti - 6); b--) {
            if (items[b] === 'Test #') { test_number = items[b + 1] || null; break; }
        }
        return {
            test_number,
            procedure_code: procCode,
            originator: 'MFR',
            lab_id: valAfter(items, 'Verify Test Lab ID', ti, tEnd),
            // Unstructured and manufacturer-specific, captured verbatim for a
            // person to read. Often the ONLY statement of which wheel or
            // software variant a test represents: Volvo's says "Tested on 20
            // inch tire, covering 22 inch tire as worst case", which its
            // covered-models table — naming only 21 inch — does not.
            mfr_test_vehicle_comments: commentsBefore(items, ti, tStart),
            test_date: toIsoDate(valAfter(items, 'Test Date', ti, tEnd)),
            source: 'csi_pdf',   // epa_tests.source enum (override field-tag stays 'pdf')
            recharge_voltage: parseNum(valAfter(items, 'Recharge Event Voltage', ti, tEnd)),
            ac_recharge_kwh: parseNum(valAfter(items, 'Recharge Event Energy (kiloWatt-hours)', ti, tEnd)),
            cd_range_combined_calc: parseNum(valAfter(items, 'Charge Depleting Range (Calculated miles)', ti, tEnd)),
            cd_range_hwy_calc: cdRangeHwy,
            bags_phases_conducted: parseNum(valAfter(items, 'Conducted', ti, tEnd)),
            total_dc_energy_kwh: total_dc > 0 ? Math.round(total_dc * 1000) / 1000 : null,
            total_distance_mi: total_dist2 > 0 ? Math.round(total_dist2 * 1000) / 1000 : null,
            phases: effPhases,
        };
    });
}

// ── Top-level ───────────────────────────────────────────────────────────────

/**
 * @param {string[]} rawItems  Ordered text items from the CSI PDF.
 * @returns {{ groups: Array, warnings: string[] }}
 */
export function parseEpaCsiText(rawItems) {
    const { certTestGroup, certModelYear } = parseCertHeader(rawItems);
    const items = stripNoise(rawItems || []);
    const warnings = [];

    // Each config begins at a "Vehicle ID / Configuration" anchor.
    const cfgIdx = indicesWhere(items, s => s === 'Vehicle ID / Configuration');
    if (!cfgIdx.length) {
        return { groups: [], warnings: ['No vehicle configurations found — is this an EPA CSI PDF?'] };
    }

    // Group-level fields live in the preamble before the first config and are
    // shared across configs (battery pack, certifying manufacturer).
    const preEnd = cfgIdx[0];
    const groupManufacturer = cleanMake(valAfter(items, 'Manufacturer', 0, preEnd));
    const groupVoltage = parseNum(valAfter(items, 'Total Voltage of Battery Packs', 0, preEnd));
    const groupSpecificEnergy = parseNum(valAfter(items, 'Battery Specific Energy', 0, preEnd));

    // First pass: read raw vehicle IDs to detect repeats (BMW/Lucid reuse one ID
    // across configs; we must disambiguate the test_group_id with the config #).
    const rawIds = cfgIdx.map(ci => (items[ci + 1] || '').split('/')[0].trim());
    const idCounts = rawIds.reduce((m, id) => (m[id] = (m[id] || 0) + 1, m), {});

    // Read once: the table is certificate-wide, not per configuration.
    const coveredModels = parseCoveredModels(items);

    const groups = cfgIdx.map((ci, k) => {
        const end = k + 1 < cfgIdx.length ? cfgIdx[k + 1] : items.length;
        // "Vehicle ID / Configuration" = "<Vehicle ID> / <EPA config index>".
        // The EPA config index distinguishes records under one reused Vehicle ID
        // (e.g. BMW's 5 tire packages → 0..4), so it drives the unique key.
        const idParts = (items[ci + 1] || '').split('/');
        const vehId = idParts[0].trim();
        const epaConfigIdx = (idParts[1] || '').trim();
        // Manufacturer Vehicle Configuration Number is a SEPARATE field — the
        // manufacturer's "mode" delineator (often 0). Captured on its own; it is
        // not necessarily unique across configs, so it is NOT used for the key.
        const modeNum = valAfter(items, 'Manufacturer Vehicle Configuration Number', ci, end);
        // Unique key: bare Vehicle ID when unique in this PDF, else suffix the EPA config index.
        const test_group_id = vehId
            ? (idCounts[vehId] > 1 ? `${vehId}-${epaConfigIdx || k}` : vehId)
            : null;

        const rawMake = valAfter(items, 'Represented Test Vehicle Make', ci, end);
        const make = (!rawMake || /^\d+$/.test(rawMake)) ? groupManufacturer : cleanMake(rawMake);

        // The dynamometer's inertia setting, and the only mass in the record.
        // Without it the grade term of any road-trip or elevation calculation
        // multiplies by nothing and silently returns zero rather than declining.
        // Curb weight and GVWR are stated alongside it and are NOT substitutes:
        // EPA tests at a rounded inertia class (this BMW is 5635 lb curb, tested
        // at 6000), and it is the tested figure the coefficients belong to.
        const equivTestWeightLbs = parseNum(valAfter(items, 'Equivalent Test Weight (pounds)', ci, end));
        const coefficient_sets = parseCoefficients(items, ci, end, equivTestWeightLbs);
        const tests = parseTests(items, ci, end);

        // CD range is a GROUP-level (Section 6) field, not an epa_tests column.
        // Take it from the preferred test (77 → 84 → first), then drop it off the
        // test rows so the epa_tests insert only has valid columns.
        const pref = tests.find(t => t.procedure_code === 77)
            || tests.find(t => t.procedure_code === 84) || tests[0];
        const cd_range_combined_calc = pref?.cd_range_combined_calc ?? null;
        const cd_range_hwy_calc = pref?.cd_range_hwy_calc ?? null;
        tests.forEach(t => { delete t.cd_range_combined_calc; delete t.cd_range_hwy_calc; });

        // The certification's identity when page 1 gave it, else the carryover
        // source — which is what the two "Original …" fields hold, and which is
        // the same value on a certification that did not carry anything over.
        const carryoverGroup = valAfter(items, 'Original Test Group Name', ci, end);
        const carryoverYear = parseNum(valAfter(items, 'Original Test Vehicle Model Year', ci, end));

        return {
            test_group_id,
            epa_test_family_id: certTestGroup ?? carryoverGroup,
            vehicle_config_number: modeNum ?? null,   // mfr "mode" number, captured separately
            model_year: certModelYear ?? carryoverYear,
            // Kept, not discarded: these say which model year's lab work the
            // results actually are, which the certification year does not.
            carryover_test_group_id: carryoverGroup ?? null,
            carryover_model_year: carryoverYear,
            make,
            epa_carline_name: valAfter(items, 'Represented Test Vehicle Model', ci, end),
            fuel_type: 'Electricity',
            total_voltage: groupVoltage,
            battery_specific_energy: groupSpecificEnergy,
            // "Battery Energy Capacity" in the CSI is amp-hours, not useable kWh,
            // so it's intentionally not mapped — curator sets useable capacity
            // (best proxy: the MCT total DC to depletion).
            useable_kwh: null,
            cd_range_combined_calc,
            cd_range_hwy_calc,
            coefficient_sets,
            tests,
            // Certificate-wide, so every configuration parsed from this PDF
            // carries the same list. That is faithful: the table describes what
            // the CERTIFICATE covers, not what one configuration is.
            covered_models: coveredModels,
        };
    }).filter(g => g.test_group_id);

    if (!groups.length) warnings.push('Configurations found but no Vehicle IDs could be read.');
    if (!coveredModels.length) {
        warnings.push('No "Models Covered by this Certificate" table found — the configurations this certificate covers will not be recorded.');
    }

    if (certTestGroup == null) {
        warnings.push('No test group on page 1 — falling back to each config\'s "Original Test Group Name", which is the carryover source on a carryover certification.');
    }
    if (certModelYear == null) {
        warnings.push('No model year on page 1 — falling back to each config\'s "Original Test Vehicle Model Year", which is the carryover source on a carryover certification.');
    }

    // A carryover is not a problem, but it IS the thing that makes the two model
    // years disagree, and every downstream comparison against a published guide
    // row turns on which one you are holding. Said once, not per config.
    const carried = groups.filter(g => g.carryover_model_year != null
        && g.carryover_model_year !== g.model_year);
    if (carried.length) {
        warnings.push(`Carryover certification: MY${carried[0].model_year} certifies vehicles tested under MY${carried[0].carryover_model_year} (${carried[0].carryover_test_group_id ?? 'unknown group'}). Results are the earlier year's; the record is the later year's.`);
    }

    // Flag configs where no DC energy could be extracted — some PDFs (e.g. Ford)
    // report it only in an external EPA spreadsheet, so η can't be measured until
    // a curator enters Total DC / phase energy by hand.
    for (const g of groups) {
        if (g.tests.length && !g.tests.some(t => t.total_dc_energy_kwh != null)) {
            warnings.push(`${g.test_group_id}: no DC energy in this PDF (often in an external EPA spreadsheet) — enter Total DC / phase energy manually for a measured η.`);
        }
    }
    return { groups, warnings };
}

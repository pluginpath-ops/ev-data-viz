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
 *                coefficient_sets: [...], tests: [{ ..., phases: [...] }] }],
 *     warnings: [...] }
 *
 * Phase type is not stated in the PDF, so it's inferred from phase distance
 * (~10.26 mi → HWY, ~7.45 mi → UDDS, ≫10× neighbors → SS), matching the curator
 * form's auto-suggest. Everything is editable post-import.
 */

const HWFET_MI = 10.26, UDDS_MI = 7.45, DIST_TOL = 0.7;

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
 * Remove page header/footer noise that interleaves the content stream:
 *   "Date: …", "Certification Summary Information Report", "Page N of M …",
 *   and the running "Test Group"/id + "Evaporative/Refueling Family"/value
 *   footer pair (we read those values from config-level labels instead).
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

// ── Coefficient table ───────────────────────────────────────────────────────

/**
 * Parse the coefficient table within [start,end). Layout: header labels, then
 * per category one row of 7 numbers (target A/B/C, set A/B/C, HP). Returns
 * coefficient_sets[].
 */
function parseCoefficients(items, start, end) {
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

function parseTests(items, start, end) {
    const testIdx = indicesWhere(items, isTestHeader, start, end);
    return testIdx.map((ti, k) => {
        const tEnd = k + 1 < testIdx.length ? testIdx[k + 1] : end;
        const header = items[ti];
        const procMatch = header.match(/^(\d{1,3})\s*-/);
        const cold = /cold|degree/i.test(header);
        // "Charge Depleting Range Highway" then "(Calculated miles)" then value.
        const hwyLabelIdx = idxOf(items, 'Charge Depleting Range Highway', ti, tEnd);
        const cdRangeHwy = hwyLabelIdx >= 0 ? parseNum(items[hwyLabelIdx + 2]) : null;
        const phases = parsePhases(items, ti, tEnd, cold);
        const total_dc = phases.reduce((s, p) => s + (p.dc_energy_kwh ?? 0), 0);
        const total_dist = phases.reduce((s, p) => s + (p.distance_mi ?? 0), 0);
        return {
            procedure_code: procMatch ? Number(procMatch[1]) : null,
            originator: 'MFR',
            lab_id: valAfter(items, 'Verify Test Lab ID', ti, tEnd),
            test_date: toIsoDate(valAfter(items, 'Test Date', ti, tEnd)),
            source: 'pdf',
            recharge_voltage: parseNum(valAfter(items, 'Recharge Event Voltage', ti, tEnd)),
            ac_recharge_kwh: parseNum(valAfter(items, 'Recharge Event Energy (kiloWatt-hours)', ti, tEnd)),
            cd_range_combined_calc: parseNum(valAfter(items, 'Charge Depleting Range (Calculated miles)', ti, tEnd)),
            cd_range_hwy_calc: cdRangeHwy,
            bags_phases_conducted: parseNum(valAfter(items, 'Conducted', ti, tEnd)),
            total_dc_energy_kwh: total_dc > 0 ? Math.round(total_dc * 1000) / 1000 : null,
            total_distance_mi: total_dist > 0 ? Math.round(total_dist * 1000) / 1000 : null,
            phases,
        };
    });
}

// ── Top-level ───────────────────────────────────────────────────────────────

/**
 * @param {string[]} rawItems  Ordered text items from the CSI PDF.
 * @returns {{ groups: Array, warnings: string[] }}
 */
export function parseEpaCsiText(rawItems) {
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

        const coefficient_sets = parseCoefficients(items, ci, end);
        const tests = parseTests(items, ci, end);

        // CD range is a GROUP-level (Section 6) field, not an epa_tests column.
        // Take it from the preferred test (77 → 84 → first), then drop it off the
        // test rows so the epa_tests insert only has valid columns.
        const pref = tests.find(t => t.procedure_code === 77)
            || tests.find(t => t.procedure_code === 84) || tests[0];
        const cd_range_combined_calc = pref?.cd_range_combined_calc ?? null;
        const cd_range_hwy_calc = pref?.cd_range_hwy_calc ?? null;
        tests.forEach(t => { delete t.cd_range_combined_calc; delete t.cd_range_hwy_calc; });

        return {
            test_group_id,
            epa_test_family_id: valAfter(items, 'Original Test Group Name', ci, end),
            vehicle_config_number: modeNum ?? null,   // mfr "mode" number, captured separately
            model_year: parseNum(valAfter(items, 'Original Test Vehicle Model Year', ci, end)),
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
        };
    }).filter(g => g.test_group_id);

    if (!groups.length) warnings.push('Configurations found but no Vehicle IDs could be read.');
    return { groups, warnings };
}

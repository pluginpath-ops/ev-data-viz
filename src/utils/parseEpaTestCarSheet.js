/**
 * Parse an EPA Test Car List TSV/CSV **or** an EPA Master Emissions List CSV.
 *
 * The EPA publishes two distinct file formats for BEV test data:
 *
 *  Test Car List (TCL)
 *    – One row per test cycle per vehicle configuration.
 *    – Columns: `Test Category` (MCT/FTP/HWY/…), `RND_ADJ_FE` (kWh/100mi),
 *      `Test Vehicle ID`, `Test Fuel Type Cd`, `Set Coef A`, etc.
 *    – Both coefficients AND per-cycle energy data available.
 *
 *  Master Emissions List (MEL) — the "master" file
 *    – One row per emission type per test per certification region.
 *    – Columns renamed (e.g. `Vehicle ID`, `Test Fuel`, `Set Coefficient A`).
 *    – `Test Category` is gone; cycle derived from `Test Procedure` code.
 *    – `RND_ADJ_FE` is absent — only emissions data, no energy consumption.
 *    – Same test appears multiple times (CA + Federal regions) → deduplicated
 *      by `Test Number`.
 *    – File begins with a UTF-8 BOM.
 *
 * Both formats are detected automatically from the header row.
 * Returns: Array of objects shaped like the epa_test_groups table row.
 */

const MPG_E_CONVERSION = 33.705; // kWh per gallon gasoline equivalent

function numOrNull(str) {
    if (!str || !str.trim()) return null;
    const n = parseFloat(str.trim());
    return isNaN(n) ? null : n;
}

/**
 * Convert kWh/100mi → MPGe (rounded to 1 decimal place).
 *
 * MPGe = (33.705 × 100) / kWh/100mi.
 *
 * Note: the RND_ADJ_FE column's unit varies and is declared in FE_UNIT — see
 * the energy-parsing block below, which normalises RND_ADJ_FE to kWh/100mi
 * before any value reaches this function.
 *
 * Values ≥ 500 kWh/100mi are EPA sentinel placeholders (e.g. 999 = "label
 * not yet finalized") and are treated as null.
 */
function kwh100miToMpge(kwh100mi) {
    if (kwh100mi == null || kwh100mi <= 0 || kwh100mi >= 500) return null;
    return Math.round((MPG_E_CONVERSION * 100 / kwh100mi) * 10) / 10;
}

/**
 * Split one line into fields, respecting RFC 4180 CSV quoting rules.
 * For TSV (sep='\t') no quoting is expected so we just split.
 * For CSV, fields may be wrapped in double-quotes, and "" inside a quoted
 * field represents a literal double-quote.
 */
function splitLine(line, sep) {
    if (sep === '\t') return line.split('\t');

    const fields = [];
    let cur = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"') {
                if (i + 1 < line.length && line[i + 1] === '"') {
                    cur += '"'; // escaped quote
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                cur += ch;
            }
        } else {
            if (ch === '"') {
                inQuotes = true;
            } else if (ch === sep) {
                fields.push(cur);
                cur = '';
            } else {
                cur += ch;
            }
        }
    }
    fields.push(cur);
    return fields;
}

// ── Master Emissions List: Test Procedure code → cycle category ───────────────
// Based on EPA test procedure codes for charge-depleting BEV tests.
const PROC_CODE_TO_CATEGORY = {
    '77': 'MCT',      // Multi-Cycle Test (combined label summary)
    '78': 'MCT',      // MCT variant
    '81': 'FTP',      // Charge-Depleting UDDS (city)
    '82': 'HWY',      // Charge-Depleting HWFET (highway)
    '83': 'US06',     // Charge-Depleting US06
    '84': 'SC03',     // Charge-Depleting SC03
    '85': 'COLD FTP', // Cold-temperature FTP variant
    '86': 'COLD FTP', // Cold-temperature FTP
};

/**
 * Derive a normalised cycle category string from a row.
 *
 * IMPORTANT: the `Test Category` column is NOT reliable for identifying the
 * drive cycle. In the EPA Test Car List it holds the *charge mode*
 * ('CD' = charge-depleting, 'CS' = charge-sustaining) and is identical for
 * every cycle of a BEV. The actual cycle (UDDS, Highway, US06, …) is named
 * only in `Test Procedure Description` (e.g. "Charge Depleting Highway").
 *
 * Resolution order, most-specific first:
 *   1. Test Procedure Description text — present in both TCL and MEL formats
 *   2. Numeric Test Procedure code — last-resort fallback (codes vary by file)
 *   3. Test Category — only when it names a real cycle (i.e. not CD/CS)
 */
function deriveCycleCategory(row, get) {
    // 1. Procedure description — the authoritative cycle name.
    const desc = (get(row, 'Test Procedure Description') || '').toUpperCase();
    if (desc) {
        if (desc.includes('US06'))                              return 'US06';
        if (desc.includes('SC03'))                              return 'SC03';
        if (desc.includes('COLD'))                              return 'COLD FTP';
        if (desc.includes('HWFET') || desc.includes('HIGHWAY')) return 'HWY';
        if (desc.includes('UDDS')  || desc.includes('FTP'))     return 'FTP';
        if (desc.includes('MCT')   || desc.includes('MULTI') || desc.includes('COMBINED')) return 'MCT';
    }

    // 2. Numeric procedure code (codes differ between file formats — weak signal).
    const procCode = get(row, 'Test Procedure') || get(row, 'Test Procedure Cd');
    if (PROC_CODE_TO_CATEGORY[procCode]) return PROC_CODE_TO_CATEGORY[procCode];

    // 3. Explicit category column — but ignore charge-mode flags (CD/CS),
    //    which are not cycles.
    const cat = (get(row, 'Test Category') || '').toUpperCase();
    if (cat && cat !== 'CD' && cat !== 'CS') return cat;

    return '';
}

/**
 * @param {string} text  Raw file text (UTF-8, may include BOM)
 * @param {string} [sourceFileName]  Stored in source_file field
 * @returns {Array<Object>}
 */
export function parseEpaTestCarSheet(text, sourceFileName = null) {
    // Strip UTF-8 BOM (present in Master Emissions List files)
    const cleanText = text.replace(/^﻿/, '');

    // Normalise line endings
    const lines = cleanText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    if (lines.length < 2) return [];

    // Detect separator: prefer tab; fall back to comma (Excel CSV)
    const sep = lines[0].includes('\t') ? '\t' : ',';
    const headers = splitLine(lines[0], sep).map(h => h.trim());

    // Build a lookup from header name → column index
    const colIdx = {};
    headers.forEach((h, i) => { colIdx[h] = i; });

    // ── Format detection ─────────────────────────────────────────────────────
    // TCL has `Test Category` and `RND_ADJ_FE`.
    // MEL has `Test Procedure Description` and `Certification Region`.
    const isMasterList = !('Test Category' in colIdx) && ('Certification Region' in colIdx);

    // ── Column accessor helpers ───────────────────────────────────────────────
    // get()     — single column name → trimmed string
    // getAny()  — tries column names in order, returns first non-empty value
    const get = (row, col) => {
        const i = colIdx[col];
        return i !== undefined ? (row[i] ?? '').trim() : '';
    };
    const getAny = (row, ...cols) => {
        for (const col of cols) {
            const v = get(row, col);
            if (v) return v;
        }
        return '';
    };
    const getNum = (row, col) => numOrNull(get(row, col));
    const getNumAny = (row, ...cols) => numOrNull(getAny(row, ...cols));

    const groups = new Map();

    // MEL: deduplicate rows — the same Test Number appears once per cert region
    // (e.g. once for California, once for Federal). We only want to process
    // each actual test once.
    const seenTestNumbers = new Set();

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;
        const row = splitLine(line, sep);

        // ── Fuel type filter ────────────────────────────────────────────────
        // TCL: "Test Fuel Type Cd" = '62'   MEL: "Test Fuel" = '62'
        const fuelCd = getAny(row, 'Test Fuel Type Cd', 'Test Fuel');
        if (fuelCd !== '62') continue; // 62 = Electricity

        // ── MEL deduplication by Test Number ───────────────────────────────
        if (isMasterList) {
            const testNumber = get(row, 'Test Number');
            if (testNumber) {
                if (seenTestNumbers.has(testNumber)) continue;
                seenTestNumbers.add(testNumber);
            }
        }

        // ── Unique key per vehicle configuration ────────────────────────────
        // TCL: "Test Vehicle ID"      MEL: "Vehicle ID"
        // Fallback: "Actual Tested Testgroup" / "Certified Test Group"
        const testVehicleId = getAny(row, 'Test Vehicle ID', 'Vehicle ID');
        const testFamilyId  = getAny(row, 'Actual Tested Testgroup', 'Certified Test Group');
        const testGroupId   = testVehicleId || testFamilyId;
        if (!testGroupId) continue;

        // ── Initialise group on first encounter ─────────────────────────────
        if (!groups.has(testGroupId)) {
            const make = getAny(row,
                'Represented Test Veh Make',
                'Represented Test Vehicle Make',
                'Vehicle Manufacturer Name',
                'Certificate Manufacturer Name',
            ) || null;

            const model = getAny(row,
                'Represented Test Veh Model',
                'Represented Test Vehicle Model',
            ) || null;

            const transmission = getAny(row,
                'Tested Transmission Type',
                'Transmission Type Description', // prefer description for readability
                'Transmission Type',
            ) || null;

            const drive = getAny(row,
                'Drive System Description',
                'Test Drive Description',
            ) || null;

            const fuelDesc = getAny(row,
                'Test Fuel Type Description',
                'Test Fuel Description',
            ) || 'BEV';

            groups.set(testGroupId, {
                test_group_id:      testGroupId,
                epa_test_family_id: testFamilyId || null,
                model_year: getNum(row, 'Model Year'),
                make,
                epa_carline_name: model,
                transmission,
                drive,
                fuel_type: fuelDesc,

                equiv_test_weight_lbs: getNum(row, 'Equivalent Test Weight (lbs.)'),

                // Coefficients — same across all rows; filled below
                target_a: null, target_b: null, target_c: null,
                set_a:    null, set_b:    null, set_c:    null,

                // Per-cycle kWh/100mi — only available in TCL format
                udds_unadj_kwh_100mi:     null,
                udds_adj_kwh_100mi:       null,
                hwfet_unadj_kwh_100mi:    null,
                hwfet_adj_kwh_100mi:      null,
                us06_unadj_kwh_100mi:     null,
                us06_adj_kwh_100mi:       null,
                sc03_unadj_kwh_100mi:     null,
                sc03_adj_kwh_100mi:       null,
                cold_ftp_unadj_kwh_100mi: null,
                cold_ftp_adj_kwh_100mi:   null,

                // Label values
                label_combined_mpge: null,
                label_city_mpge:     null,
                label_hwy_mpge:      null,
                label_combined_mi:   null,
                label_city_mi:       null,
                label_hwy_mi:        null,

                // Window-sticker label method. Neither EPA file format carries
                // this explicitly; it is inferred from cycle availability after
                // the parse loop (see inferLabelMethod below). label_method_inferred
                // flags that the value was inferred, not admin-confirmed.
                label_method:          null,
                label_method_inferred: false,

                source_file:  sourceFileName,
                ingested_at:  new Date().toISOString(),

                // Raw RND_ADJ_FE values (TCL only; null for MEL).
                // NOT sent to the database — used only by the import UI so the
                // user can detect and flip records where the column is in MPGe.
                // Stripped by applyUnitOverride() before the DB upsert.
                _raw: { combined: null, hwfet: null, udds: null, us06: null, sc03: null, cold_ftp: null },

                // Indicates whether per-cycle energy data is available.
                // False for MEL imports (coefficients only).
                _hasCycleEnergy: false,
            });
        }

        const g = groups.get(testGroupId);

        // ── Road-load coefficients ────────────────────────────────────────────
        // TCL: "Set Coef A (lbf)"          MEL: "Set Coefficient A (lbf)"
        // TCL: "Target Coef A (lbf)"       MEL: "Target Coefficient A (lbf)"
        const ta = getNumAny(row, 'Target Coef A (lbf)', 'Target Coefficient A (lbf)');
        const tb = getNumAny(row, 'Target Coef B (lbf/mph)', 'Target Coefficient B (lbf/mph)');
        const tc = getNumAny(row, 'Target Coef C (lbf/mph**2)', 'Target Coefficient C (lbf/mph**2)');
        const sa = getNumAny(row, 'Set Coef A (lbf)', 'Set Coefficient A (lbf)');
        const sb = getNumAny(row, 'Set Coef B (lbf/mph)', 'Set Coefficient B (lbf/mph)');
        const sc = getNumAny(row, 'Set Coef C (lbf/mph**2)', 'Set Coefficient C (lbf/mph**2)');
        if (g.target_a === null && ta !== null) g.target_a = ta;
        if (g.target_b === null && tb !== null) g.target_b = tb;
        if (g.target_c === null && tc !== null) g.target_c = tc;
        if (g.set_a === null && sa !== null) g.set_a = sa;
        if (g.set_b === null && sb !== null) g.set_b = sb;
        if (g.set_c === null && sc !== null) g.set_c = sc;

        // ── Per-cycle energy consumption (TCL only) ───────────────────────────
        // RND_ADJ_FE units VARY and are declared in the FE_UNIT column:
        //   FE_UNIT = 'MPG'  → the value is MPGe (typical for BEV rows)
        //   otherwise        → already kWh/100mi (legacy / some exports)
        // Normalise everything to kWh/100mi. MEL files lack this column, so
        // energy fields remain null for them.
        const feRaw  = getNum(row, 'RND_ADJ_FE');
        const feUnit = (get(row, 'FE_UNIT') || '').toUpperCase();
        let feKwh100mi = null;
        if (feRaw != null && feRaw > 0) {
            if (feUnit.includes('MPG')) {
                // MPGe → kWh/100mi  (kWh/100mi = 33.705 × 100 / MPGe)
                feKwh100mi = (MPG_E_CONVERSION * 100) / feRaw;
            } else if (feRaw < 500) {
                feKwh100mi = feRaw; // already kWh/100mi
            }
        }
        // Keep the raw value (in its source unit) for the import UI toggle.
        const feKwh = feRaw;

        if (feKwh100mi != null) g._hasCycleEnergy = true;

        // ── Cycle category ───────────────────────────────────────────────────
        // TCL: explicit "Test Category" column (MCT, FTP, HWY, US06, SC03, COLD)
        // MEL: derived from "Test Procedure" code via PROC_CODE_TO_CATEGORY
        const category = deriveCycleCategory(row, get);

        // TCL: "Test Procedure Cd"   MEL: "Test Procedure" (same values)
        const testProcCd = getAny(row, 'Test Procedure Cd', 'Test Procedure');

        const isColdFtp = testProcCd === '86' ||
            category === 'COLD' || category === 'COLD FTP' ||
            category === 'FTP COLD' || category === 'COLD-FTP';

        if (isColdFtp) {
            g._raw.cold_ftp = feKwh;
            if (feKwh100mi != null) g.cold_ftp_adj_kwh_100mi = feKwh100mi;
        } else {
            switch (category) {
                case 'CD':
                case 'MCT':
                    g._raw.combined = feKwh;
                    if (feKwh100mi != null) g.label_combined_mpge = kwh100miToMpge(feKwh100mi);
                    break;
                case 'FTP':
                    g._raw.udds = feKwh;
                    if (feKwh100mi != null) g.udds_adj_kwh_100mi = feKwh100mi;
                    break;
                case 'HWY':
                case 'HWFE':
                    g._raw.hwfet = feKwh;
                    if (feKwh100mi != null) g.hwfet_adj_kwh_100mi = feKwh100mi;
                    break;
                case 'US06':
                    g._raw.us06 = feKwh;
                    if (feKwh100mi != null) g.us06_adj_kwh_100mi = feKwh100mi;
                    break;
                case 'SC03':
                    g._raw.sc03 = feKwh;
                    if (feKwh100mi != null) g.sc03_adj_kwh_100mi = feKwh100mi;
                    break;
                default:
                    break;
            }
        }
    }

    // ── Infer label method from cycle availability ────────────────────────────
    // No EPA source column states the window-sticker method, but the set of
    // cycles that were run is a reliable proxy:
    //   5-cycle  → US06, SC03 and Cold-FTP energy all present
    //   2-cycle  → only the UDDS/combined + HWFET pair present
    // Anything with no cycle energy at all (e.g. Master Emissions List) stays
    // null. All inferred values are flagged so the UI can mark them uncertain.
    for (const g of groups.values()) {
        // Derive a combined MPGe from the city + highway cycles when the file
        // has no explicit combined/MCT summary row (common — many TCL exports
        // list only the individual UDDS and Highway charge-depleting tests).
        // EPA combines in consumption space: 55 % city / 45 % highway.
        if (g.label_combined_mpge == null &&
            g.udds_adj_kwh_100mi != null && g.hwfet_adj_kwh_100mi != null) {
            const combinedKwh100mi = 0.55 * g.udds_adj_kwh_100mi + 0.45 * g.hwfet_adj_kwh_100mi;
            g.label_combined_mpge = kwh100miToMpge(combinedKwh100mi);
        }
        inferLabelMethod(g);
    }

    return Array.from(groups.values());
}

/**
 * Set g.label_method / g.label_method_inferred based on which cycles carry
 * energy data. Mutates the group in place.
 */
function inferLabelMethod(g) {
    const has5cycle =
        g.us06_adj_kwh_100mi     != null &&
        g.sc03_adj_kwh_100mi     != null &&
        g.cold_ftp_adj_kwh_100mi != null;

    const has2cycle =
        g.hwfet_adj_kwh_100mi != null &&
        (g.udds_adj_kwh_100mi != null || g.label_combined_mpge != null);

    if (has5cycle) {
        g.label_method = '5-cycle';
        g.label_method_inferred = true;
    } else if (has2cycle) {
        g.label_method = '2-cycle';
        g.label_method_inferred = true;
    } else {
        g.label_method = null;
        g.label_method_inferred = false;
    }
}

/**
 * Summarise what was parsed (for UI display).
 * @param {Array} groups  Output of parseEpaTestCarSheet
 */
export function summariseEpaGroups(groups) {
    const makes = [...new Set(groups.map(g => g.make).filter(Boolean))].sort();
    const years = groups.map(g => g.model_year).filter(Boolean);
    return {
        total: groups.length,
        makes,
        yearMin: years.length ? Math.min(...years) : null,
        yearMax: years.length ? Math.max(...years) : null,
        withCoeffs: groups.filter(g => g.set_a !== null || g.target_a !== null).length,
        withMpge:   groups.filter(g => g.label_combined_mpge !== null).length,
        withCycleEnergy: groups.filter(g => g._hasCycleEnergy).length,
        withInferredMethod: groups.filter(g => g.label_method_inferred).length,
        isMasterList: groups.length > 0 && !groups[0]._hasCycleEnergy,
    };
}

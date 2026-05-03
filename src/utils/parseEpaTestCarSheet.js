/**
 * Parse an EPA Test Car List TSV (tab-separated) or CSV file.
 *
 * The EPA file has one row per *test run* — a single vehicle configuration
 * (test group) produces multiple rows: MCT/CD (combined label), FTP (city),
 * HWY (highway), US06, SC03, and optionally Cold-FTP. This parser groups
 * those rows back into one record per test group and extracts per-cycle
 * fuel economy values where available.
 *
 * Filter: only rows with Test Fuel Type Cd = 62 (Electricity) are kept.
 *
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
 * Despite being named "FE" (fuel economy), the RND_ADJ_FE column in the EPA
 * Test Car List stores energy *consumption* in kWh/100mi, not MPGe. This
 * function applies the correct formula: MPGe = (33.705 × 100) / kWh/100mi.
 *
 * Values ≥ 500 kWh/100mi are EPA sentinel placeholders (e.g. 999 = "label
 * not yet finalized") and are treated as null.
 */
function kwh100miToMpge(kwh100mi) {
    if (kwh100mi == null || kwh100mi <= 0 || kwh100mi >= 500) return null;
    return Math.round((MPG_E_CONVERSION * 100 / kwh100mi) * 10) / 10;
}

/**
 * @param {string} text  Raw file text (UTF-8)
 * @param {string} [sourceFileName]  Stored in source_file field
 * @returns {Array<Object>}
 */
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

export function parseEpaTestCarSheet(text, sourceFileName = null) {
    // Normalise line endings
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    if (lines.length < 2) return [];

    // Detect separator: prefer tab; fall back to comma (Excel CSV)
    const sep = lines[0].includes('\t') ? '\t' : ',';
    const headers = splitLine(lines[0], sep).map(h => h.trim());

    // Build a lookup from header name → column index
    const colIdx = {};
    headers.forEach((h, i) => { colIdx[h] = i; });

    // Helper: get a cell by column name (returns '' if not found)
    const get = (row, col) => {
        const i = colIdx[col];
        return i !== undefined ? (row[i] ?? '').trim() : '';
    };
    const getNum = (row, col) => numOrNull(get(row, col));

    const groups = new Map();

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;
        const row = splitLine(line, sep);

        // ── Fuel type filter ────────────────────────────────────────────────
        const fuelCd = get(row, 'Test Fuel Type Cd');
        if (fuelCd !== '62') continue; // 62 = Electricity

        // ── Unique key: Test Vehicle ID is specific per configuration (e.g.
        //    R1S247XR20 = 20in wheels, R1S247XR22 = 22in wheels).
        //    "Actual Tested Testgroup" is a test-family ID shared across
        //    multiple configurations — using it would merge the 20in and 22in
        //    variants into one record, discarding the different A/B/C values.
        const testVehicleId  = get(row, 'Test Vehicle ID');
        const testFamilyId   = get(row, 'Actual Tested Testgroup');
        const testGroupId    = testVehicleId || testFamilyId;
        if (!testGroupId) continue;

        // ── Initialise group on first encounter ─────────────────────────────
        if (!groups.has(testGroupId)) {
            groups.set(testGroupId, {
                test_group_id:      testGroupId,      // Test Vehicle ID (preferred)
                epa_test_family_id: testFamilyId || null, // Actual Tested Testgroup
                model_year: getNum(row, 'Model Year'),
                make: get(row, 'Represented Test Veh Make') || get(row, 'Vehicle Manufacturer Name') || null,
                epa_carline_name: get(row, 'Represented Test Veh Model') || null,
                transmission: get(row, 'Tested Transmission Type') || null,
                drive: get(row, 'Drive System Description') || null,
                fuel_type: get(row, 'Test Fuel Type Description') || 'BEV',

                equiv_test_weight_lbs: getNum(row, 'Equivalent Test Weight (lbs.)'),

                // Coefficients — same across all rows; filled below
                target_a: null, target_b: null, target_c: null,
                set_a:    null, set_b:    null, set_c:    null,

                // Per-cycle kWh/100mi (adj = adjusted label values)
                // Note: only RND_ADJ_FE is used; FE Bag columns are NOT MPGe
                // for BEVs — their values can be negative (US06) which proves
                // they are internal test-accounting deltas, not fuel economy.
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

                source_file:  sourceFileName,
                ingested_at:  new Date().toISOString(),

                // Raw RND_ADJ_FE column values before our kWh/100mi interpretation.
                // NOT sent to the database — used only by the import UI so the user
                // can detect and flip records where the column is actually in MPGe.
                // Stripped by applyUnitOverride() before the DB upsert.
                _raw: { combined: null, hwfet: null, udds: null, us06: null, sc03: null, cold_ftp: null },
            });
        }

        const g = groups.get(testGroupId);

        // ── Road-load coefficients (same for all rows; take first non-null) ──
        const ta = getNum(row, 'Target Coef A (lbf)');
        const tb = getNum(row, 'Target Coef B (lbf/mph)');
        const tc = getNum(row, 'Target Coef C (lbf/mph**2)');
        const sa = getNum(row, 'Set Coef A (lbf)');
        const sb = getNum(row, 'Set Coef B (lbf/mph)');
        const sc = getNum(row, 'Set Coef C (lbf/mph**2)');
        if (g.target_a === null && ta !== null) g.target_a = ta;
        if (g.target_b === null && tb !== null) g.target_b = tb;
        if (g.target_c === null && tc !== null) g.target_c = tc;
        if (g.set_a === null && sa !== null) g.set_a = sa;
        if (g.set_b === null && sb !== null) g.set_b = sb;
        if (g.set_c === null && sc !== null) g.set_c = sc;

        // ── Per-cycle energy consumption ──────────────────────────────────────
        // RND_ADJ_FE is kWh/100mi (not MPGe — see kwh100miToMpge comment above).
        // FE Bag 1/2/3 are internal EPA test-accounting corrections (can be
        // negative for US06/SC03) and are not usable as consumption values.
        const category   = get(row, 'Test Category').toUpperCase();
        const testProcCd = get(row, 'Test Procedure Cd');
        const feKwh      = getNum(row, 'RND_ADJ_FE'); // kWh/100mi; null if blank or sentinel

        // Plausibility guard: values ≥ 500 are sentinel placeholders (e.g. 999)
        const feKwh100mi = (feKwh != null && feKwh > 0 && feKwh < 500) ? feKwh : null;

        // Cold-FTP: Test Procedure Cd 86 shares Test Category "CD" with MCT.
        // Detect it by procedure code before falling through to the CD/MCT case.
        const isColdFtp = testProcCd === '86' ||
            category === 'COLD' || category === 'FTP COLD' || category === 'COLD FTP';

        if (isColdFtp) {
            g._raw.cold_ftp = feKwh;  // store raw (pre-sentinel-filter) for unit-flip UI
            if (feKwh100mi != null) g.cold_ftp_adj_kwh_100mi = feKwh100mi;
        } else {
            switch (category) {
                case 'CD':   // charge-depleting combined — MCT summary row
                case 'MCT':
                    g._raw.combined = feKwh;
                    // Convert kWh/100mi → MPGe for the label field
                    if (feKwh100mi != null) g.label_combined_mpge = kwh100miToMpge(feKwh100mi);
                    break;
                case 'FTP':
                    g._raw.udds = feKwh;
                    // Already kWh/100mi — store directly, no conversion needed
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

    return Array.from(groups.values());
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
        withMpge: groups.filter(g => g.label_combined_mpge !== null).length,
    };
}

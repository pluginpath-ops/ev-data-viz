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

/** Convert MPGe → kWh/100mi (rounded to 4 decimal places). */
function mpgeToKwh100mi(mpge) {
    if (!mpge || mpge <= 0) return null;
    return Math.round((MPG_E_CONVERSION * 100 / mpge) * 10000) / 10000;
}

/**
 * @param {string} text  Raw file text (UTF-8)
 * @param {string} [sourceFileName]  Stored in source_file field
 * @returns {Array<Object>}
 */
export function parseEpaTestCarSheet(text, sourceFileName = null) {
    // Normalise line endings
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    if (lines.length < 2) return [];

    // Detect separator
    const sep = lines[0].includes('\t') ? '\t' : ',';
    const headers = lines[0].split(sep).map(h => h.trim());

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
        const row = line.split(sep);

        // ── Fuel type filter ────────────────────────────────────────────────
        const fuelCd = get(row, 'Test Fuel Type Cd');
        if (fuelCd !== '62') continue; // 62 = Electricity

        const testGroupId = get(row, 'Actual Tested Testgroup');
        if (!testGroupId) continue;

        // ── Initialise group on first encounter ─────────────────────────────
        if (!groups.has(testGroupId)) {
            groups.set(testGroupId, {
                test_group_id: testGroupId,
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

        // ── Per-cycle FE (RND_ADJ_FE = cycle-adjusted MPGe) ────────────────
        const category = get(row, 'Test Category').toUpperCase();
        const fe = getNum(row, 'RND_ADJ_FE');
        // Bag 1 = phase 1, Bag 2 = phase 2 (for FTP: Bag1=cold, Bag2=transient, Bag3=hot)
        const bag1 = getNum(row, 'FE Bag 1');
        const bag2 = getNum(row, 'FE Bag 2');
        const bag3 = getNum(row, 'FE Bag 3');

        switch (category) {
            case 'CD':   // charge-depleting combined — MCT summary row
            case 'MCT':
                if (fe != null) g.label_combined_mpge = fe;
                break;
            case 'FTP':
                // FTP = UDDS city cycle; bags = Bag1 cold + Bag2 transient + Bag3 hot
                if (fe  != null) g.udds_adj_kwh_100mi  = mpgeToKwh100mi(fe);
                // Unadjusted: bag values are raw dyno phases; combined unadj ≈ bag average
                // (only assign if we can get a meaningful value — bags are often blank for BEVs)
                if (bag1 != null && bag1 > 1) g.udds_unadj_kwh_100mi = mpgeToKwh100mi(bag1);
                break;
            case 'HWY':
            case 'HWFE':
                if (fe   != null) g.hwfet_adj_kwh_100mi  = mpgeToKwh100mi(fe);
                if (bag1 != null && bag1 > 1) g.hwfet_unadj_kwh_100mi = mpgeToKwh100mi(bag1);
                break;
            case 'US06':
                if (fe   != null) g.us06_adj_kwh_100mi   = mpgeToKwh100mi(fe);
                if (bag1 != null && bag1 > 1) g.us06_unadj_kwh_100mi  = mpgeToKwh100mi(bag1);
                break;
            case 'SC03':
                if (fe   != null) g.sc03_adj_kwh_100mi   = mpgeToKwh100mi(fe);
                break;
            case 'COLD':
            case 'FTP COLD':
            case 'COLD FTP':
                if (fe   != null) g.cold_ftp_adj_kwh_100mi = mpgeToKwh100mi(fe);
                break;
            default:
                break;
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

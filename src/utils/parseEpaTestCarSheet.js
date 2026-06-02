/**
 * Parse an EPA Test Car List (TCL) TSV/CSV **or** an EPA Master Emissions
 * List (MEL) CSV into the **curator model** (see LocalDev/curator-fields-spec.md).
 *
 * The quarterly CSV only carries identity, road-load coefficients/weight, and
 * AC-side label efficiency — it does NOT contain DC-side phase energy, AC
 * recharge, or per-test records. So the importer seeds:
 *   • Section 1 (identity)  → epa_test_groups columns
 *   • Section 2 (road load) → ONE primary 'City/Highway' epa_coefficient_sets row
 *   • Section 6 (label)     → label_combined_mpge (AC-side, from RND_ADJ_FE)
 * Sections 3–5 (tests/phases) are entered later by the curator; η and charger
 * efficiency are read-time derivations, NOT computed here.
 *
 * Returns an array of group objects shaped for the import flow. Each carries a
 * private `_coefficientSet` (written to epa_coefficient_sets by the service)
 * and `_hasCoeffs` / `_hasMpge` summary flags. Every populated field is tagged
 * in `overrides` with `{ source: 'csv' }` so the curator form can flag values
 * that were imported vs. hand-edited.
 *
 *  Two file formats, auto-detected from the header row:
 *   TCL — one row per cycle per config; has `Test Category` + `RND_ADJ_FE`.
 *   MEL — one row per emission/region; has `Certification Region`, no energy.
 */

const MPG_E_CONVERSION = 33.705; // kWh per gallon gasoline equivalent

/** A bare RND_ADJ_FE at/above this is MPGe (not kWh/100mi) when FE_UNIT is silent.
 *  EV consumption is ~15–50 kWh/100mi; MPGe ~65–250; crossover ~58, so 60 splits. */
const MPGE_MAGNITUDE_THRESHOLD = 60;
/** MPGe at/above this is an EPA "no data" placeholder (999, near-999, etc.). */
const MPGE_PLACEHOLDER_MIN = 400;

function numOrNull(str) {
    if (str == null || !String(str).trim()) return null;
    const n = parseFloat(String(str).trim());
    return isNaN(n) ? null : n;
}

/**
 * Normalise a RND_ADJ_FE reading to MPGe, honouring the FE_UNIT column when
 * present and falling back to a magnitude test when it isn't. Rejects EPA
 * placeholder sentinels. Returns MPGe (AC-side) or null.
 */
function normalizeFeToMpge(feRaw, feUnitRaw) {
    if (feRaw == null || feRaw <= 0) return null;
    const unit = (feUnitRaw || '').toUpperCase();
    const saysMpge = unit.includes('MPG');
    const saysKwh  = unit.includes('KWH') || unit.includes('WH');

    let isMpge;
    if      (saysMpge) isMpge = true;
    else if (saysKwh)  isMpge = false;
    else               isMpge = feRaw >= MPGE_MAGNITUDE_THRESHOLD; // magnitude backstop

    if (isMpge) {
        return feRaw >= MPGE_PLACEHOLDER_MIN ? null : feRaw; // value already IS MPGe
    }
    // value is kWh/100mi → convert to MPGe
    return feRaw < 500 ? (MPG_E_CONVERSION * 100) / feRaw : null;
}

/** Build an { field: { source:'csv' } } override map for the non-null fields. */
function csvOverrides(obj, fields) {
    const out = {};
    for (const f of fields) if (obj[f] != null) out[f] = { source: 'csv' };
    return out;
}

/**
 * Split one line into fields, respecting RFC 4180 CSV quoting. TSV (sep='\t')
 * is split directly; CSV honours quoted fields and "" escapes.
 */
function splitLine(line, sep) {
    if (sep === '\t') return line.split('\t');
    const fields = [];
    let cur = '', inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"') {
                if (i + 1 < line.length && line[i + 1] === '"') { cur += '"'; i++; }
                else inQuotes = false;
            } else cur += ch;
        } else {
            if (ch === '"') inQuotes = true;
            else if (ch === sep) { fields.push(cur); cur = ''; }
            else cur += ch;
        }
    }
    fields.push(cur);
    return fields;
}

// ── Master Emissions List: Test Procedure code → cycle category ───────────────
const PROC_CODE_TO_CATEGORY = {
    '77': 'MCT', '78': 'MCT',
    '81': 'FTP', '82': 'HWY', '83': 'US06', '84': 'SC03',
    '85': 'COLD FTP', '86': 'COLD FTP',
};

/** Normalised cycle category from a row: explicit column → proc code → description. */
function deriveCycleCategory(row, get) {
    const cat = get(row, 'Test Category');
    if (cat) return cat.toUpperCase();

    const procCode = get(row, 'Test Procedure');
    if (PROC_CODE_TO_CATEGORY[procCode]) return PROC_CODE_TO_CATEGORY[procCode];

    const desc = (get(row, 'Test Procedure Description') || '').toUpperCase();
    if (desc.includes('UDDS'))                              return 'FTP';
    if (desc.includes('HWFET') || desc.includes('HIGHWAY')) return 'HWY';
    if (desc.includes('US06'))                              return 'US06';
    if (desc.includes('SC03'))                              return 'SC03';
    if (desc.includes('COLD'))                              return 'COLD FTP';
    if (desc.includes('MCT')  || desc.includes('MULTI'))    return 'MCT';
    return '';
}

/**
 * @param {string} text  Raw file text (UTF-8, may include BOM)
 * @param {string} [sourceFileName]  Stored in source_file
 * @returns {Array<Object>}  Group objects (see file header for shape)
 */
export function parseEpaTestCarSheet(text, sourceFileName = null) {
    const cleanText = text.replace(/^﻿/, ''); // strip UTF-8 BOM (MEL files)
    const lines = cleanText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    if (lines.length < 2) return [];

    const sep = lines[0].includes('\t') ? '\t' : ',';
    const headers = splitLine(lines[0], sep).map(h => h.trim());
    const colIdx = {};
    headers.forEach((h, i) => { colIdx[h] = i; });

    // TCL has `Test Category`; MEL has `Certification Region` and no energy.
    const isMasterList = !('Test Category' in colIdx) && ('Certification Region' in colIdx);

    const get = (row, col) => {
        const i = colIdx[col];
        return i !== undefined ? (row[i] ?? '').trim() : '';
    };
    const getAny = (row, ...cols) => {
        for (const col of cols) { const v = get(row, col); if (v) return v; }
        return '';
    };
    const getNum    = (row, col)     => numOrNull(get(row, col));
    const getNumAny = (row, ...cols) => numOrNull(getAny(row, ...cols));

    const groups = new Map();
    const seenTestNumbers = new Set(); // MEL: same Test Number repeats per cert region

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;
        const row = splitLine(line, sep);

        // Electricity only (fuel code 62)
        const fuelCd = getAny(row, 'Test Fuel Type Cd', 'Test Fuel');
        if (fuelCd !== '62') continue;

        if (isMasterList) {
            const testNumber = get(row, 'Test Number');
            if (testNumber) {
                if (seenTestNumbers.has(testNumber)) continue;
                seenTestNumbers.add(testNumber);
            }
        }

        // Unique key per configuration: Test Vehicle ID; fall back to family id.
        const testVehicleId = getAny(row, 'Test Vehicle ID', 'Vehicle ID');
        const testFamilyId  = getAny(row, 'Actual Tested Testgroup', 'Certified Test Group');
        const testGroupId   = testVehicleId || testFamilyId;
        if (!testGroupId) continue;

        if (!groups.has(testGroupId)) {
            // Make: skip mis-filed numeric values (some files put the year here),
            // and trim verbose legal suffixes ("Lucid USA, Inc" → "Lucid").
            let make = null;
            for (const col of [
                'Represented Test Veh Make', 'Represented Test Vehicle Make',
                'Vehicle Manufacturer Name', 'Certificate Manufacturer Name',
            ]) {
                const v = get(row, col);
                if (v && !/^\d+$/.test(v)) { make = v; break; }
            }
            if (make) {
                make = make
                    .replace(/,?\s*\b(USA|Inc|LLC|Ltd|GmbH|AG|Corp|Corporation|Co|Company)\b\.?/gi, '')
                    .replace(/,\s*$/, '').trim() || make;
            }

            const model = getAny(row,
                'Represented Test Veh Model', 'Represented Test Vehicle Model') || null;
            const transmission = getAny(row,
                'Tested Transmission Type', 'Transmission Type Description', 'Transmission Type') || null;
            const drive = getAny(row, 'Drive System Description', 'Test Drive Description') || null;
            const fuelDesc = getAny(row,
                'Test Fuel Type Description', 'Test Fuel Description') || 'BEV';

            groups.set(testGroupId, {
                test_group_id:      testGroupId,
                epa_test_family_id: testFamilyId || null,
                model_year:         getNum(row, 'Model Year'),
                make,
                epa_carline_name:   model,
                transmission,
                drive,
                fuel_type:          fuelDesc,

                // Section 6 (AC-side label) — populated from the combined/MCT row.
                label_combined_mpge: null,

                source_file: sourceFileName,
                ingested_at: new Date().toISOString(),

                // Private: primary coefficient set, written to epa_coefficient_sets.
                _coefficientSet: {
                    category: 'City/Highway',
                    is_primary: true,
                    equiv_test_weight_lbs: getNum(row, 'Equivalent Test Weight (lbs.)'),
                    target_a: null, target_b: null, target_c: null,
                    set_a: null, set_b: null, set_c: null,
                },
            });
        }

        const g = groups.get(testGroupId);
        const cs = g._coefficientSet;

        // Road-load coefficients (same across the config's rows; first non-null wins).
        const ta = getNumAny(row, 'Target Coef A (lbf)', 'Target Coefficient A (lbf)');
        const tb = getNumAny(row, 'Target Coef B (lbf/mph)', 'Target Coefficient B (lbf/mph)');
        const tc = getNumAny(row, 'Target Coef C (lbf/mph**2)', 'Target Coefficient C (lbf/mph**2)');
        const sa = getNumAny(row, 'Set Coef A (lbf)', 'Set Coefficient A (lbf)');
        const sb = getNumAny(row, 'Set Coef B (lbf/mph)', 'Set Coefficient B (lbf/mph)');
        const sc = getNumAny(row, 'Set Coef C (lbf/mph**2)', 'Set Coefficient C (lbf/mph**2)');
        if (cs.target_a === null && ta !== null) cs.target_a = ta;
        if (cs.target_b === null && tb !== null) cs.target_b = tb;
        if (cs.target_c === null && tc !== null) cs.target_c = tc;
        if (cs.set_a === null && sa !== null) cs.set_a = sa;
        if (cs.set_b === null && sb !== null) cs.set_b = sb;
        if (cs.set_c === null && sc !== null) cs.set_c = sc;

        // Combined label MPGe from the MCT/combined row (AC-side, unit-normalised).
        const category = deriveCycleCategory(row, get);
        if (g.label_combined_mpge == null && (category === 'MCT' || category === 'CD')) {
            const mpge = normalizeFeToMpge(getNum(row, 'RND_ADJ_FE'), get(row, 'FE_UNIT'));
            if (mpge != null) g.label_combined_mpge = Math.round(mpge * 10) / 10;
        }
    }

    // Finalise: attach override provenance + summary flags.
    const GROUP_CSV_FIELDS = ['model_year', 'make', 'epa_carline_name',
        'drive', 'transmission', 'fuel_type', 'label_combined_mpge'];
    const COEFF_CSV_FIELDS = ['equiv_test_weight_lbs',
        'target_a', 'target_b', 'target_c', 'set_a', 'set_b', 'set_c'];

    for (const g of groups.values()) {
        const cs = g._coefficientSet;
        g._hasCoeffs = cs.target_a != null || cs.set_a != null;
        g._hasMpge   = g.label_combined_mpge != null;
        g.overrides  = csvOverrides(g, GROUP_CSV_FIELDS);
        cs.overrides = csvOverrides(cs, COEFF_CSV_FIELDS);
    }

    return Array.from(groups.values());
}

/**
 * Summarise what was parsed, for the import preview.
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
        withCoeffs: groups.filter(g => g._hasCoeffs).length,
        withMpge:   groups.filter(g => g._hasMpge).length,
        isMasterList: groups.length > 0 && !groups.some(g => g._hasMpge),
    };
}

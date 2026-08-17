/**
 * Parser for EPA's annual Fuel Economy Guide export (#206).
 *
 * The guide is the published-label side of the EPA picture: what reached the
 * window sticker, as against the certification records which say what a lab
 * measured. It is the source for `label_range_published`, which the A1 audit
 * found set on 7 of 87 linked test groups and which the `computed >= labeled`
 * gate cannot run without.
 *
 * Pure module — text in, rows out. No database, no React, no network.
 *
 * ── Three things about the file that will bite ───────────────────────────────
 *
 * 1. EVERY CONFIGURATION APPEARS TWICE, once with fuel economy in MPGe and once
 *    in kWh/100mi, sharing a `Index (Model Type Index)`. The two are the same
 *    number expressed differently — 76 MPGe is 44 kWh/100mi — so importing both
 *    writes 44 into an MPGe column at an entirely plausible magnitude. Rows are
 *    filtered to the MPGe unit and the kWh figures derived at read time if ever
 *    wanted, because two stored copies of one measurement can disagree.
 *
 * 2. THE FILE COVERS EVERY FUEL. Only `Fuel Usage Desc = Electricity` rows are
 *    kept, matching the issue's BEV-only scope.
 *
 * 3. `Calc Approach Desc` DOES NOT MEAN WHAT IT SAYS. It declares "Electric
 *    Vehicle 2-cycle label" or "5-cycle label", but 57% of the rows declaring
 *    5-cycle carry an adjusted/unadjusted ratio of exactly 0.700000 — which is
 *    the fixed factor, not a measurement. The declared value is preserved
 *    because it is EPA's own statement, and a signature is derived from the
 *    numbers for anything that needs to be relied on. See `adjustmentSignature`.
 *
 * ── What the identifiers do and do not give you ──────────────────────────────
 *
 * `#1 Smog Rating Test Group` is the only test-group-shaped identifier in the
 * file, and it is NOT a usable join key: it matches 1 of our 87 linked groups,
 * and it is not unique per configuration — both 2027 R2 rows share
 * `VRIVT00.0232` while reading 307 and 330 miles. It is carried for the cases
 * where it does match; the natural key is (model year, division, carline).
 */

import Papa from 'papaparse';

/** Columns without which a row cannot be interpreted at all — a hard failure. */
export const REQUIRED_COLUMNS = [
    'Model Year',
    'Division',
    'Carline',
    'Fuel Usage Desc - Conventional Fuel',
    'Fuel Unit Desc - Conventional Fuel',
    'Comb Range as shown on FE Label (miles)',
    // Part of the natural key since carline alone proved not to be unique.
    'Index (Model Type Index)',
];

/**
 * Columns that are read but survivable — their absence warns rather than fails.
 *
 * The warning is the point: a guide missing `City Unadj FE` still imports, but
 * every row silently loses the figure our own derivation is validated against.
 * That is worth saying out loud at import time rather than discovering later
 * as a column of nulls.
 *
 * Note this warns on columns we EXPECT and did not find — not on the ~140
 * columns in the file we never read. Listing those would be noise that trains
 * people to ignore the warnings.
 */
export const OPTIONAL_COLUMNS = [
    '#1 Smog Rating Test Group',
    'Calc Approach Desc',
    'City Range (miles)',
    'Hwy Range (miles)',
    'City FE (Guide) - Conventional Fuel',
    'Hwy FE (Guide) - Conventional Fuel',
    'Comb FE (Guide) - Conventional Fuel',
    'City Unadj FE - Conventional Fuel',
    'Hwy Unadj FE - Conventional Fuel',
    'Comb Unadj FE - Conventional Fuel',
    'City Unrd Adj FE - Conventional Fuel',
    'Hwy Unrd Adj FE - Conventional Fuel',
    'Comb Unrd Adj FE - Conventional Fuel',
    'Total Voltage for Battery Pack(s)',
    'Batt Energy Capacity (Amp-hrs)',
    'Batt Specific Energy (Watt-hr/kg)',
    'Rated Motor Gen Power (kW)',
    '# Drive Motor Gen',
    '240V Charge Time at 240 volts (hours)',
    'Drive Desc',
    'Carline Class Desc',
];

const EV_FUEL   = 'electricity';
const MPGE_UNIT = 'miles per gallon';

const str = (row, key) => {
    const v = row?.[key];
    return v == null ? null : (String(v).trim() || null);
};

const num = (row, key) => {
    const v = str(row, key);
    if (v == null) return null;
    // Thousands separators appear in some exports; a bare "-" appears in others.
    const n = Number(v.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
};

/**
 * Rated motor power, summed across motors.
 *
 * Reported one value per motor in a single cell — "225, 270" for a dual-motor
 * car — so the total is the sum, and a single-motor car parses identically.
 */
export function parseMotorPowerKw(value) {
    const parts = String(value ?? '')
        .split(',')
        .map(p => p.trim())
        // Empties are dropped BEFORE Number(), because Number('') is 0 and 0 is
        // finite — an absent value would otherwise parse as a 0 kW motor and
        // sum to a real-looking total.
        .filter(Boolean)
        .map(Number)
        .filter(Number.isFinite);
    return parts.length ? parts.reduce((a, b) => a + b, 0) : null;
}

/**
 * Which adjustment actually produced this row's label, read from the numbers
 * rather than from `Calc Approach Desc`.
 *
 * Across MY26 and MY27 the ratios fall into three groups, and they mean
 * different things:
 *
 *   'fixed'       exactly 0.700 on both cycles — the flat factor
 *   'per-vehicle' one factor, applied identically to city and highway; median
 *                 0.715, and consistent with a real 5-cycle test result
 *   'per-cycle'   a different factor for each cycle; median 0.687, and NOT
 *                 reproduced by the published derived-5-cycle regression
 *                 (0 of 106 within 2%). What generates it is still unknown.
 *
 * Returns null when the row lacks the figures to tell.
 */
export function adjustmentSignature(cityRatio, hwyRatio) {
    if (!(cityRatio > 0) || !(hwyRatio > 0)) return null;
    const isFixed = Math.abs(cityRatio - 0.7) < 1e-6 && Math.abs(hwyRatio - 0.7) < 1e-6;
    if (isFixed) return 'fixed';
    return Math.abs(cityRatio - hwyRatio) < 1e-4 ? 'per-vehicle' : 'per-cycle';
}

/** One guide row, mapped and derived. */
function mapRow(row) {
    const unadjCity = num(row, 'City Unadj FE - Conventional Fuel');
    const unadjHwy  = num(row, 'Hwy Unadj FE - Conventional Fuel');
    const adjCity   = num(row, 'City Unrd Adj FE - Conventional Fuel');
    const adjHwy    = num(row, 'Hwy Unrd Adj FE - Conventional Fuel');

    const cityRatio = (unadjCity > 0 && adjCity > 0) ? adjCity / unadjCity : null;
    const hwyRatio  = (unadjHwy  > 0 && adjHwy  > 0) ? adjHwy  / unadjHwy  : null;

    const voltage = num(row, 'Total Voltage for Battery Pack(s)');
    const ampHrs  = num(row, 'Batt Energy Capacity (Amp-hrs)');

    return {
        // Natural key
        modelYear: num(row, 'Model Year'),
        division:  str(row, 'Division'),
        carline:   str(row, 'Carline'),

        smogTestGroup:  str(row, '#1 Smog Rating Test Group'),
        modelTypeIndex: str(row, 'Index (Model Type Index)'),

        // Label figures — what the window sticker says
        labelCombRangeMi: num(row, 'Comb Range as shown on FE Label (miles)'),
        labelCityRangeMi: num(row, 'City Range (miles)'),
        labelHwyRangeMi:  num(row, 'Hwy Range (miles)'),
        labelCombMpge:    num(row, 'Comb FE (Guide) - Conventional Fuel'),
        labelCityMpge:    num(row, 'City FE (Guide) - Conventional Fuel'),
        labelHwyMpge:     num(row, 'Hwy FE (Guide) - Conventional Fuel'),

        // Unadjusted — what our own derivation should reproduce
        unadjCityMpge: unadjCity,
        unadjHwyMpge:  unadjHwy,
        unadjCombMpge: num(row, 'Comb Unadj FE - Conventional Fuel'),

        // Adjusted, unrounded — what the factor is derived from
        adjCityMpge: adjCity,
        adjHwyMpge:  adjHwy,
        adjCombMpge: num(row, 'Comb Unrd Adj FE - Conventional Fuel'),

        // The adjustment EPA actually applied to THIS vehicle. Not 0.7: the
        // 2027 R2 is 0.7051 at 20" and 0.7294 at 21".
        labelAdjustmentFactor: cityRatio,
        adjustmentSignature:   adjustmentSignature(cityRatio, hwyRatio),
        calcApproach:          str(row, 'Calc Approach Desc'),

        // Battery. Amp-hours alone left useable_kwh null in the CSI import; with
        // voltage in the same row the nominal pack energy resolves. Nominal, not
        // usable — measured usable runs about 0.94 of this on the packs checked,
        // but four samples is guidance for a curator, not a constant to apply.
        totalVoltageV:        voltage,
        battCapacityAh:       ampHrs,
        nominalPackKwh:       (voltage > 0 && ampHrs > 0) ? (voltage * ampHrs) / 1000 : null,
        battSpecificEnergyWhKg: num(row, 'Batt Specific Energy (Watt-hr/kg)'),

        motorPowerKw: parseMotorPowerKw(str(row, 'Rated Motor Gen Power (kW)')),
        motorCount:   num(row, '# Drive Motor Gen'),
        chargeTime240vH: num(row, '240V Charge Time at 240 volts (hours)'),

        driveDesc:    str(row, 'Drive Desc'),
        carlineClass: str(row, 'Carline Class Desc'),
    };
}

/**
 * Parse a Fuel Economy Guide CSV.
 *
 * @param {string} csvText
 * @returns {{ rows: Array, skipped: { nonEv: number, duplicateUnit: number, unusable: number },
 *             missingColumns: string[], warnings: string[], errors: string[] }}
 *          `missingColumns` is fatal and leaves `rows` empty; `warnings` names
 *          optional columns this file lacks, which import fine but arrive null.
 *          `rows` is empty when required columns are absent — a file whose
 *          headers we do not recognise is reported, never partially imported.
 */
export function parseFeGuide(csvText) {
    const empty = { rows: [], skipped: { nonEv: 0, duplicateUnit: 0, unusable: 0 } };

    const parsed = Papa.parse(String(csvText ?? ''), {
        header: true,
        skipEmptyLines: true,
        // The escape, not a literal BOM: the raw character in source is
        // itself irregular whitespace, which the linter rejects.
        transformHeader: h => h.replace(/^\uFEFF/, '').trim(),
    });

    const headers = parsed.meta?.fields ?? [];
    const missingColumns = REQUIRED_COLUMNS.filter(c => !headers.includes(c));
    if (missingColumns.length) {
        // Hard fail rather than import what is recognisable: a guide missing
        // its range column would import as a list of names with no figures,
        // which looks like a successful import of useless data.
        return { ...empty, missingColumns, warnings: [], errors: [] };
    }

    // Survivable absences, named so the import can say what this file will not
    // carry instead of leaving a column of nulls to be discovered later.
    const warnings = OPTIONAL_COLUMNS
        .filter(c => !headers.includes(c))
        .map(c => `Column not found, values will be empty: "${c}"`);

    const rows = [];
    const skipped = { nonEv: 0, duplicateUnit: 0, unusable: 0 };

    for (const raw of parsed.data) {
        const fuel = (str(raw, 'Fuel Usage Desc - Conventional Fuel') ?? '').toLowerCase();
        if (fuel !== EV_FUEL) { skipped.nonEv++; continue; }

        const unit = (str(raw, 'Fuel Unit Desc - Conventional Fuel') ?? '').toLowerCase();
        if (unit !== MPGE_UNIT) { skipped.duplicateUnit++; continue; }

        const row = mapRow(raw);
        // A row missing any part of the key, or its range, cannot be stored or
        // linked. modelTypeIndex counts: without it two Audi configurations at
        // different ranges collapse into one.
        if (!row.carline || !row.modelYear || !row.modelTypeIndex || row.labelCombRangeMi == null) {
            skipped.unusable++;
            continue;
        }
        rows.push(row);
    }

    return { rows, skipped, missingColumns: [], warnings, errors: parsed.errors?.map(e => e.message) ?? [] };
}

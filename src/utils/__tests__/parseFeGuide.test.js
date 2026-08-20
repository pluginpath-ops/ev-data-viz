import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
    parseFeGuide, parseMotorPowerKw, adjustmentSignature,
    REQUIRED_COLUMNS, OPTIONAL_COLUMNS,
} from '../parseFeGuide';

/**
 * The fixture is real rows lifted from EPA's MY26 and MY27 guides, trimmed to
 * the columns the parser reads. The source files live in LocalDev and are
 * gitignored, so the sample is committed instead — real values, real column
 * names, small enough to read.
 *
 * It deliberately contains: both 2027 R2 configurations AND their kWh/100mi
 * twins (the duplicate-unit trap), a row whose adjustment is exactly 0.700, a
 * row whose factor differs per cycle, and one non-EV row.
 */
const CSV = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'fixtures/feGuideSample.csv'),
    'utf8',
);

const byCarline = (rows, name) => rows.find(r => r.carline === name);
const close = (a, b, tol) => expect(Math.abs(a - b)).toBeLessThan(tol);

describe('parseFeGuide — filtering', () => {
    const { rows, skipped } = parseFeGuide(CSV);

    it('keeps one row per configuration, not two', () => {
        // Every EV config appears twice, once per unit. 76 MPGe and 44
        // kWh/100mi are the same measurement; importing both writes 44 into an
        // MPGe column at an entirely plausible magnitude.
        expect(skipped.duplicateUnit).toBe(2);
        expect(rows.filter(r => r.carline === 'R2 Performance AWD (20in AT)')).toHaveLength(1);
    });

    it('drops non-EV rows', () => {
        expect(skipped.nonEv).toBe(1);
        expect(rows.every(r => r.labelCombRangeMi > 0)).toBe(true);
    });

    it('returns four configurations from the sample', () => {
        expect(rows).toHaveLength(4);
    });
});

describe('parseFeGuide — the R2 20" AT, against the published label', () => {
    const r = byCarline(parseFeGuide(CSV).rows, 'R2 Performance AWD (20in AT)');

    it('reads the label figures', () => {
        expect(r.labelCombRangeMi).toBe(307);
        expect(r.labelCityRangeMi).toBe(338);
        expect(r.labelHwyRangeMi).toBe(276);
        expect(r.labelCombMpge).toBe(99);
    });

    it('reads the unadjusted figures our own derivation has to reproduce', () => {
        // Our methodology model computes 154.214 / 126.243 from the cert record.
        // These are EPA's published values for the same quantity — the agreement
        // is what validates the cold-start weighting and the DC-to-AC correction.
        close(r.unadjCityMpge, 154.2, 0.05);
        close(r.unadjHwyMpge, 126.2, 0.05);
    });

    it('derives the per-vehicle adjustment factor, which is not 0.7', () => {
        close(r.labelAdjustmentFactor, 0.7051, 0.0005);
        expect(r.adjustmentSignature).toBe('per-vehicle');
    });

    it('resolves nominal pack energy from voltage and amp-hours', () => {
        // Amp-hours alone left useable_kwh null in the CSI import; the guide
        // carries voltage in the same row.
        expect(r.totalVoltageV).toBe(353);
        close(r.battCapacityAh, 260.8, 0.01);
        close(r.nominalPackKwh, 92.06, 0.05);
    });

    it('keeps the natural key and the unusable one', () => {
        expect(r.modelYear).toBe(2027);
        expect(r.division).toBe('Rivian');
        // Carried, but not a join key: both R2 configs share it while reading
        // 307 and 330 miles.
        expect(r.smogTestGroup).toBe('VRIVT00.0232');
        expect(byCarline(parseFeGuide(CSV).rows, 'R2 Performance AWD (21in)').smogTestGroup)
            .toBe(r.smogTestGroup);
    });
});

describe('parseFeGuide — the declared method disagrees with the numbers', () => {
    const rows = parseFeGuide(CSV).rows;

    it('records the declared approach verbatim', () => {
        expect(byCarline(rows, 'R2 Performance AWD (20in AT)').calcApproach)
            .toBe('Electric Vehicle 5-cycle label');
    });

    it('derives a signature from the numbers instead of trusting it', () => {
        // 57% of rows declaring "5-cycle label" carry a ratio of exactly 0.700,
        // which is the fixed factor. The declared field cannot be relied on.
        expect(byCarline(rows, 'ZDX AWD').adjustmentSignature).toBe('fixed');
        close(byCarline(rows, 'ZDX AWD').labelAdjustmentFactor, 0.700, 1e-6);

        expect(byCarline(rows, 'Charger Daytona R/T AWD 245/55ZR18').adjustmentSignature)
            .toBe('per-cycle');
    });

    it('separates the two R2 configurations by factor', () => {
        close(byCarline(rows, 'R2 Performance AWD (21in)').labelAdjustmentFactor, 0.7294, 0.0005);
    });
});

describe('parseFeGuide — refusing a file it cannot read', () => {
    it('reports missing required columns and imports nothing', () => {
        // A guide missing its range column would otherwise import as a list of
        // names with no figures, which looks like a successful import.
        const { rows, missingColumns } = parseFeGuide('Model Year,Division\n2027,Rivian\n');
        expect(rows).toEqual([]);
        expect(missingColumns).toContain('Comb Range as shown on FE Label (miles)');
        expect(missingColumns).toContain('Carline');
    });

    it('survives empty input', () => {
        expect(parseFeGuide('').rows).toEqual([]);
        expect(parseFeGuide(null).rows).toEqual([]);
    });

    it('names every column it requires', () => {
        expect(REQUIRED_COLUMNS).toContain('Fuel Unit Desc - Conventional Fuel');
        expect(REQUIRED_COLUMNS.length).toBeGreaterThan(3);
    });
});

describe('parseFeGuide — warning on survivable absences', () => {
    it('says nothing when the file carries every column it reads', () => {
        expect(parseFeGuide(CSV).warnings).toEqual([]);
    });

    it('warns, but still imports, when an optional column is absent', () => {
        // A guide without City Unadj FE imports fine and quietly loses the
        // figure our own derivation is validated against. Worth saying at
        // import time rather than as a column of nulls discovered later.
        const stripped = CSV
            .replace('City Unadj FE - Conventional Fuel', 'Renamed By EPA')
            .replace('Batt Energy Capacity (Amp-hrs)', 'Also Renamed');
        const { rows, warnings, missingColumns } = parseFeGuide(stripped);

        expect(missingColumns).toEqual([]);
        expect(rows).toHaveLength(4);
        expect(warnings).toHaveLength(2);
        expect(warnings.join(' ')).toContain('City Unadj FE');
        expect(warnings.join(' ')).toContain('Batt Energy Capacity');

        // And the dependent derivations degrade to null rather than to a number.
        const r = byCarline(rows, 'R2 Performance AWD (20in AT)');
        expect(r.unadjCityMpge).toBeNull();
        expect(r.labelAdjustmentFactor).toBeNull();
        expect(r.nominalPackKwh).toBeNull();
        expect(r.labelCombRangeMi).toBe(307);   // unaffected
    });

    it('does not warn about the ~140 columns it never reads', () => {
        // Listing those would be noise, and noise trains people to ignore
        // warnings. Only expected-but-absent columns are named.
        expect(OPTIONAL_COLUMNS).not.toContain('Annual Fuel1 Cost - Conventional Fuel');
        expect(OPTIONAL_COLUMNS.every(c => !REQUIRED_COLUMNS.includes(c))).toBe(true);
    });
});

describe('parseFeGuide — the raw source row', () => {
    const r = parseFeGuide(CSV).rows.find(x => x.carline === 'R2 Performance AWD (20in AT)');

    it('keeps the source row, which the staging column exists to hold', () => {
        // The column was documented as the escape hatch and shipped 100% empty:
        // the mapper wrote `r.raw ?? null` and nothing ever set `raw`. It is
        // what survives EPA revising or withdrawing a guide year.
        expect(r.raw).toBeTruthy();
        expect(r.raw['Carline']).toBe('R2 Performance AWD (20in AT)');
        expect(r.raw['Comb Range as shown on FE Label (miles)']).toBe('307');
    });

    it('drops blanks, which answer no question', () => {
        const values = Object.values(r.raw);
        expect(values.every(v => String(v).trim() !== '')).toBe(true);
        // And still carries columns the parser itself does not map.
        expect(Object.keys(r.raw).length).toBeGreaterThan(20);
    });
});

describe('parseFeGuide — the natural key', () => {
    const rows = parseFeGuide(CSV).rows;

    it('keeps the model type index, because carline alone is not unique', () => {
        // Audi lists "Q6 e-tron quattro" three times in MY27 at 325, 301 and
        // 301 miles — wheel and tyre variants it does not name, where BMW writes
        // them out. Keying on (year, division, carline) silently kept the last
        // row of each group: 9 configurations lost across the two guide years,
        // with nothing in the import report to show it.
        expect(rows.every(r => r.modelTypeIndex)).toBe(true);
    });

    it('drops a row that cannot be keyed rather than storing a collision', () => {
        const noIndex = CSV.replace('Index (Model Type Index)', 'Renamed');
        const { rows: r, missingColumns } = parseFeGuide(noIndex);
        // The index is required, so its absence is a hard failure — the file
        // cannot be stored without a key.
        expect(missingColumns).toContain('Index (Model Type Index)');
        expect(r).toEqual([]);
    });

    it('drops a row with no division rather than letting it poison the batch', () => {
        // division is NOT NULL in the table and the upsert sends up to 100 rows
        // per statement, so one blank cell makes Postgres reject every row in
        // the batch. The MY22 guide has exactly one such row — a Lucid entry
        // with no Division — and it cost the other 86 rows their import.
        const noDivision = CSV.replace(/^(2027),Rivian,/m, '$1,,');
        const { rows, skipped } = parseFeGuide(noDivision);

        expect(rows.every(r => r.division)).toBe(true);
        expect(skipped.unusable).toBeGreaterThan(0);
    });

    it('makes every row in the sample uniquely keyed', () => {
        const keys = rows.map(r => `${r.modelYear}|${r.division}|${r.carline}|${r.modelTypeIndex}`);
        expect(new Set(keys).size).toBe(rows.length);
    });
});

describe('parseMotorPowerKw', () => {
    it('sums the per-motor figures in one cell', () => {
        expect(parseMotorPowerKw('225, 270')).toBe(495);
        expect(parseMotorPowerKw('225')).toBe(225);
    });

    it('reads the list when EPA writes it in prose', () => {
        // Real cells. Splitting on commas alone returned null for the first —
        // no comma, so the whole string was one non-numeric token — and
        // silently dropped the last motor of the others, because "and 415"
        // fails Number() and was filtered out as non-finite.
        expect(parseMotorPowerKw('155 and 220')).toBe(375);
        expect(parseMotorPowerKw('190 and 230')).toBe(420);
        expect(parseMotorPowerKw('176, 252, and 415')).toBe(843);
        expect(parseMotorPowerKw('140, 155, 180, 205, 220, and 260')).toBe(1160);
        expect(parseMotorPowerKw('130, 205, 220, and 280')).toBe(835);
    });

    it('returns null when there is nothing numeric', () => {
        expect(parseMotorPowerKw('')).toBeNull();
        expect(parseMotorPowerKw(null)).toBeNull();
        expect(parseMotorPowerKw('n/a')).toBeNull();
        // "and" on its own must not become a zero-kW motor.
        expect(parseMotorPowerKw('and')).toBeNull();
    });
});

describe('adjustmentSignature', () => {
    it('distinguishes the three observed groups', () => {
        expect(adjustmentSignature(0.7, 0.7)).toBe('fixed');
        expect(adjustmentSignature(0.7294, 0.7294)).toBe('per-vehicle');
        expect(adjustmentSignature(0.6873, 0.6890)).toBe('per-cycle');
    });

    it('declines when a ratio is missing', () => {
        expect(adjustmentSignature(null, 0.7)).toBeNull();
        expect(adjustmentSignature(0.7, 0)).toBeNull();
    });
});

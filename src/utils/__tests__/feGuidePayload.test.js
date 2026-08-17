import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseFeGuide } from '../parseFeGuide';
import { feGuidePayload } from '../../services/DataService';

/**
 * The parser is tested on its own; this covers the seam after it — the mapping
 * from parsed row to database column.
 *
 * That seam is worth its own test because it fails quietly. A mistyped key does
 * not throw: Supabase either rejects the whole row with a column error, or the
 * field simply never arrives and the row imports looking healthy with one value
 * missing. Neither is visible from the import summary, which counts rows.
 */
const CSV = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'fixtures/feGuideSample.csv'),
    'utf8',
);

const r2 = parseFeGuide(CSV).rows.find(r => r.carline === 'R2 Performance AWD (20in AT)');

describe('feGuidePayload', () => {
    const row = feGuidePayload(r2, 'MY27 FE Guide.csv');

    it('carries the natural key', () => {
        expect(row.model_year).toBe(2027);
        expect(row.division).toBe('Rivian');
        expect(row.carline).toBe('R2 Performance AWD (20in AT)');
    });

    it('maps the label figures to their columns', () => {
        expect(row.label_comb_range_mi).toBe(307);
        expect(row.label_city_range_mi).toBe(338);
        expect(row.label_hwy_range_mi).toBe(276);
        expect(row.label_comb_mpge).toBe(99);
    });

    it('maps the unadjusted figures, which nothing else carries', () => {
        expect(row.unadj_city_mpge).toBeCloseTo(154.2, 1);
        expect(row.unadj_hwy_mpge).toBeCloseTo(126.2, 1);
    });

    it('maps the derived factor and both method fields', () => {
        expect(row.label_adjustment_factor).toBeCloseTo(0.7051, 4);
        // Declared and derived are stored separately and disagree by design.
        expect(row.calc_approach).toBe('Electric Vehicle 5-cycle label');
        expect(row.adjustment_signature).toBe('per-vehicle');
    });

    it('maps gross pack energy, and nothing named useable', () => {
        // Voltage x amp-hours is GROSS. Usable is a different quantity that
        // stays with the curator, so nothing here may target useable_kwh.
        expect(row.nominal_pack_kwh).toBeCloseTo(92.06, 1);
        expect(row.total_voltage_v).toBe(353);
        expect(Object.keys(row)).not.toContain('useable_kwh');
    });

    it('records provenance', () => {
        expect(row.source_file).toBe('MY27 FE Guide.csv');
        expect(Date.parse(row.imported_at)).not.toBeNaN();
    });

    it('emits only snake_case keys, matching the migration', () => {
        // A camelCase key here is the silent failure: Postgres rejects the
        // insert, or with a permissive client the value never lands.
        const camel = Object.keys(row).filter(k => /[A-Z]/.test(k));
        expect(camel).toEqual([]);
    });

    it('passes nulls through rather than inventing values', () => {
        const sparse = feGuidePayload({ modelYear: 2027, division: 'X', carline: 'Y' });
        expect(sparse.label_comb_range_mi).toBeUndefined();
        expect(sparse.nominal_pack_kwh).toBeUndefined();
        expect(sparse.raw).toBeNull();
        expect(sparse.source_file).toBeNull();
    });
});

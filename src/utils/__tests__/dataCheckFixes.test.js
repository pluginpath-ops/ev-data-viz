import { describe, it, expect } from 'vitest';
import { columnMoves, checkFields, withSpecValues, epaSectionHref, EPA_SECTION_CHECKS } from '../dataCheckFixes';
import { DATA_CHECKS } from '../dataChecks';

const CHECK_KEYS = new Set(DATA_CHECKS.map(c => c.key));

describe('columnMoves', () => {
    it('sorts an unsorted battery into Usable or Gross, or discards it', () => {
        const moves = columnMoves({ check: 'battery-unsorted', evidence: { battery: 82, usable: null, gross: null } });
        expect(moves.map(m => m.label)).toEqual(['82 kWh is Usable', '82 kWh is Gross', 'Discard']);
        expect(moves[0]).toMatchObject({ spec: { category: 'charging', values: { battery_usable_kwh: 82 } }, clear: 'battery' });
        expect(moves[1]).toMatchObject({ spec: { category: 'powertrain', values: { battery_gross_kwh: 82 } }, clear: 'battery' });
        expect(moves[2]).toMatchObject({ spec: null, clear: 'battery' });
    });

    it('names the label a move would overwrite', () => {
        // IONIQ6 Base: battery 63 against Gross 53 and Usable 50.
        const moves = columnMoves({ check: 'battery-unsorted', evidence: { battery: 63, usable: 50, gross: 53 } });
        expect(moves.map(m => m.label)).toEqual(['Replace Usable 50 with 63', 'Replace Gross 53 with 63', 'Discard']);
    });

    it('moves a range with no EPA label into Expected EPA Range, with its basis', () => {
        const moves = columnMoves({ check: 'range-no-label', evidence: { range: 320, linked: 0 } });
        expect(moves.map(m => m.spec?.values)).toEqual([
            { expected_epa_mi: 320, expected_epa_basis: 'Manufacturer' },
            { expected_epa_mi: 320, expected_epa_basis: 'Independent test' },
            undefined,
        ]);
        expect(moves.every(m => m.clear === 'range')).toBe(true);
    });

    it('offers only to discard a typed range that an EPA label already replaces', () => {
        const moves = columnMoves({ check: 'range-vs-label', evidence: { range: 337, labels: [311] } });
        expect(moves).toHaveLength(1);
        expect(moves[0]).toMatchObject({ spec: null, clear: 'range', label: 'Discard 337 mi' });
    });

    it('offers nothing for a check the columns have no part in', () => {
        expect(columnMoves({ check: 'buffer-outside', evidence: { usable: 88, gross: 88 } })).toEqual([]);
        expect(columnMoves(null)).toEqual([]);
    });
});

describe('checkFields', () => {
    it('resolves every field to a schema definition, for every check', () => {
        for (const key of CHECK_KEYS) {
            for (const f of checkFields(key)) expect(f.def, `${key} → ${f.category}.${f.field}`).toBeTruthy();
        }
    });

    it('edits Usable and Gross for a buffer outside its band', () => {
        expect(checkFields('buffer-outside').map(f => f.def.label)).toEqual(['Battery Usable (kWh)', 'Battery Gross (kWh)']);
    });
});

describe('withSpecValues', () => {
    it('replaces only the fields given, in one category', () => {
        const specs = { charging: { battery_usable_kwh: 50, max_dc_kw: 350 }, powertrain: { drive_type: 'AWD' } };
        expect(withSpecValues(specs, 'charging', { battery_usable_kwh: 63 })).toEqual({
            charging: { battery_usable_kwh: 63, max_dc_kw: 350 },
            powertrain: { drive_type: 'AWD' },
        });
        expect(withSpecValues(null, 'range', { expected_epa_mi: 300 })).toEqual({ range: { expected_epa_mi: 300 } });
    });
});

describe('the EPA section', () => {
    it('links only checks that exist', () => {
        for (const key of EPA_SECTION_CHECKS) expect(CHECK_KEYS.has(key), key).toBe(true);
    });

    it('addresses a vehicle the way App.jsx restores it', () => {
        expect(epaSectionHref(52)).toBe('?tab=runs&vid=52&sub=epa');
    });
});

import { describe, it, expect } from 'vitest';
import { VEHICLE_COLUMNS, unitFor, vehicleColumnByKey } from '../vehicleTable';
import { GUIDE_COLUMNS } from '../feGuideBrowse';
import { SPEC_CATEGORIES } from '../vehicleSpecSchema';
import { CANONICAL_UNITS, figureWithUnit, unitAround, cellUnit } from '../tableColumns';

/**
 * A column's unit is stated, correctly cased, or deliberately absent (#446).
 *
 * Every cell now carries its own unit beside the figure, so a column that
 * silently has none is a number with no meaning in a screenshot. "No unit" is a
 * fine answer — a count, a year, a ratio — but it is the column's DECISION
 * (`unitless: true`), not a field somebody forgot.
 *
 * Units in a column's NAME are a red herring: "¼ mile" is seconds and mph,
 * "0–60 (1ft)" is seconds, "0–100 mph" is seconds. The column says its unit;
 * nothing reads it out of the name.
 */

const fieldsOf = () => SPEC_CATEGORIES.flatMap(cat => cat.fields.map(f => ({ ...f, id: `${cat.key}.${f.key}` })));
const isNumeric = (c) => c.numeric || c.type === 'number' || c.type === 'integer';

describe('every numeric column states its unit or says it has none', () => {
    it('in the vehicle table', () => {
        const undecided = VEHICLE_COLUMNS.filter(isNumeric)
            .filter(c => !c.unit && !c.unitGroup && !c.unitless).map(c => c.key);
        expect(undecided).toEqual([]);
    });

    it('in the EPA guide table', () => {
        const undecided = GUIDE_COLUMNS.filter(isNumeric)
            .filter(c => !c.unit && !c.unitless).map(c => c.key);
        // Year is a figure with no unit; so are the ratio, the factor and the motor count.
        expect(undecided).toEqual([]);
    });

    it('in the spec schema the vehicle table reads', () => {
        const undecided = fieldsOf().filter(isNumeric)
            .filter(f => !f.unit && !f.unitGroup && !f.unitless).map(f => f.id);
        expect(undecided).toEqual([]);
    });

    it('and never both', () => {
        for (const c of [...VEHICLE_COLUMNS, ...GUIDE_COLUMNS]) {
            expect(!!(c.unit || c.unitGroup) && !!c.unitless, `${c.key} says it has a unit and none`).toBe(false);
        }
        for (const f of fieldsOf()) {
            expect(!!(f.unit && f.unitGroup), `${f.id} has a unit and a unit group`).toBe(false);
            expect(!!((f.unit || f.unitGroup) && f.unitless), `${f.id} says it has a unit and none`).toBe(false);
        }
    });

    it('only a column of figures has a unit', () => {
        for (const c of VEHICLE_COLUMNS.filter(c => !isNumeric(c))) {
            expect(c.unit ?? null, c.key).toBeNull();
            expect(c.unitGroup ?? null, c.key).toBeNull();
        }
    });
});

describe('units are cased as written', () => {
    const shown = (system) => [
        ...VEHICLE_COLUMNS.map(c => unitFor(c, system)),
        ...GUIDE_COLUMNS.map(c => c.unit ?? null),
    ].filter(Boolean);

    it('every unit either table can show is a canonical one, in both systems', () => {
        for (const system of ['imperial', 'metric']) {
            for (const unit of new Set(shown(system))) {
                expect(CANONICAL_UNITS.has(unit), `"${unit}" (${system}) is not in CANONICAL_UNITS`).toBe(true);
            }
        }
    });

    it('the strings the unit groups produce are the right ones', () => {
        const produced = (group) => [unitFor({ unitGroup: group }, 'imperial'), unitFor({ unitGroup: group }, 'metric')];
        expect({
            distance: produced('distance'), speed: produced('speed'), weight: produced('weight'),
            volume: produced('volume'), dimension: produced('dimension'), torque: produced('torque'),
            power: produced('power'), feet: produced('feet'),
        }).toEqual({
            distance:  ['mi', 'km'],
            speed:     ['mph', 'km/h'],
            weight:    ['lb', 'kg'],       // an abbreviation has no plural: lb, not lbs
            volume:    ['cu ft', 'L'],
            dimension: ['in', 'mm'],
            torque:    ['lb-ft', 'Nm'],
            power:     ['hp', 'kW'],
            feet:      ['ft', 'm'],
        });
    });

    it('every unit group a spec field uses has a unit in both systems', () => {
        for (const f of fieldsOf().filter(f => f.unitGroup)) {
            for (const system of ['imperial', 'metric']) {
                expect(unitFor({ unitGroup: f.unitGroup }, system), `${f.id} uses "${f.unitGroup}" (${system})`).toBeTruthy();
            }
        }
    });

    it('wheel and screen sizes stay in inches for a metric reader, in both tables', () => {
        for (const key of ['wheels.wheel_size_in', 'interior.screen_size_in']) {
            const col = vehicleColumnByKey(key);
            expect(col.unitGroup, key).toBeNull();
            expect(unitFor(col, 'imperial'), key).toBe('in');
            expect(unitFor(col, 'metric'), key).toBe('in');
        }
        // The EPA guide's Wheels column never converts, and says inches.
        expect(GUIDE_COLUMNS.find(c => c.key === 'wheel_size_in').unit).toBe('in');
        // Every other length is converted: only these two are the exception.
        expect(unitFor(vehicleColumnByKey('dimensions.length_in'), 'metric')).toBe('mm');
    });

    it('case that carries meaning survives', () => {
        // kWh is energy, kW is power, and neither is spelled in capitals.
        expect(unitFor(vehicleColumnByKey('charging.battery_usable_kwh'))).toBe('kWh');
        expect(unitFor(vehicleColumnByKey('charging.max_dc_kw'))).toBe('kW');
        expect(unitFor(vehicleColumnByKey('figures.epaEfficiency'), 'metric')).toBe('km/kWh');
        expect(GUIDE_COLUMNS.find(c => c.key === 'label_comb_mpge').unit).toBe('MPGe');
        expect(GUIDE_COLUMNS.find(c => c.key === 'batt_specific_energy_wh_kg').unit).toBe('Wh/kg');
    });

    it('no canonical unit is a case-variant of another', () => {
        const folded = [...CANONICAL_UNITS].map(u => u.toLowerCase());
        // Two units that differ only by case would be one unit spelled twice (kWh, KWH) — or two
        // that only case tells apart, which no reader can. The list has neither.
        expect(new Set(folded).size).toBe(folded.length);
    });
});

describe('a name is not a unit', () => {
    it('"0–100 mph", "¼ mile" and "0–60 (1ft)" are seconds', () => {
        expect(unitFor(vehicleColumnByKey('tested.zero_to_100_sec'))).toBe('s');
        expect(vehicleColumnByKey('tested.zero_to_100_sec').label).toBe('0–100 mph');
        expect(unitFor(vehicleColumnByKey('tested.quarter_mile_sec'))).toBe('s');
        expect(unitFor(vehicleColumnByKey('tested.zero_to_60_rollout_sec'))).toBe('s');
        // ...and the trap speed is the one that is mph.
        expect(unitFor(vehicleColumnByKey('tested.quarter_mile_trap_mph'))).toBe('mph');
        expect(unitFor(vehicleColumnByKey('tested.quarter_mile_trap_mph'), 'metric')).toBe('km/h');
    });

    it('a spec label\'s parenthetical is dropped only when it IS the declared unit', () => {
        // Stripped: it said the unit, and the cells now do.
        expect(vehicleColumnByKey('charging.battery_usable_kwh').label).toBe('Battery Usable');
        expect(vehicleColumnByKey('performance.figure_8_sec')).toMatchObject({ unit: 's', label: 'Figure 8 — published' });
        expect(vehicleColumnByKey('pricing.base_price_usd').fullLabel).toBe('Advertised Base Price');
        // Kept: not a unit.
        expect(vehicleColumnByKey('interior.hud').fullLabel).toBe('Heads-Up Display (HUD)');
        expect(vehicleColumnByKey('charging.v2l').fullLabel).toBe('Vehicle-to-Load (V2L)');
        expect(vehicleColumnByKey('performance.elk_test_mph').fullLabel).toMatch(/\(Moose Test\)/);
    });

    it('no spec column is left naming its own unit in parentheses', () => {
        const spelled = /\((kWh|kW|V|in|sec|s|min|lb-ft|lbs?|hp|cu ft|g|USD|ft|mph|years)\)/i;
        for (const c of VEHICLE_COLUMNS.filter(c => c.spec)) {
            expect(c.label, c.key).not.toMatch(spelled);
        }
    });

    it('a label that spells a unit agrees with the unit the field declares, and the column uses the declared one', () => {
        // The parenthetical in "Battery Usable (kWh)" is for the editor. If it ever says something
        // else than `unit`/`unitGroup`, the schema is contradicting itself — and the column must
        // follow the declaration, not the label.
        const spelling = { sec: 's', years: 'yr', usd: '$' };
        const spelled = /\((kWh|kW|V|in|sec|s|min|lb-ft|lbs?|hp|cu ft|g|USD|ft|mph|years)\)/i;
        let checked = 0;
        for (const f of fieldsOf().filter(f => spelled.test(f.label))) {
            const said = spelled.exec(f.label)[1];
            const column = vehicleColumnByKey(f.id);
            const declared = unitFor(column, 'imperial');
            expect(declared, `${f.id} spells "(${said})" but declares no unit`).toBeTruthy();
            expect(declared.toLowerCase(), `${f.id}: label says "${said}", schema says "${declared}"`)
                .toBe((spelling[said.toLowerCase()] ?? said).toLowerCase());
            checked += 1;
        }
        expect(checked).toBeGreaterThan(10);
    });

    it('a field that declares nothing numeric is unitless, whatever its label says', () => {
        for (const c of VEHICLE_COLUMNS.filter(c => c.spec && c.unitless)) {
            expect(unitFor(c), c.key).toBeNull();
        }
    });
});

describe('the unit as a cell sets it beside its figure', () => {
    it('follows the figure, with a space, in lower-case-kept form', () => {
        expect(figureWithUnit('82', 'kWh')).toBe('82 kWh');
        expect(figureWithUnit('1,200', 'cu ft')).toBe('1,200 cu ft');
        expect(figureWithUnit('2.5', 'mi/kWh')).toBe('2.5 mi/kWh');
    });

    it('closes up to a percent, and money leads with its dollar sign', () => {
        expect(figureWithUnit('93', '%')).toBe('93%');
        expect(figureWithUnit('52,000', '$')).toBe('$52,000');
        expect(figureWithUnit('173', '$/mi')).toBe('$173/mi');
        expect(figureWithUnit('650', '$/kWh')).toBe('$650/kWh');
        expect(figureWithUnit('108', '$/km')).toBe('$108/km');
    });

    it('is ONE rule: the text and the pieces the cell draws agree', () => {
        // TableCell draws before/after from unitAround; the peek and a copied cell use figureWithUnit.
        for (const unit of ['$', '%', 'kW', 'cu ft', '$/mi', '$/kWh', 'mi/kWh', null]) {
            const { before, after } = unitAround(unit);
            expect(figureWithUnit('9', unit), String(unit)).toBe(`${before}9${after}`);
        }
        expect(unitAround('$')).toEqual({ before: '$', after: '' });
        expect(unitAround('%')).toEqual({ before: '', after: '%' });
        expect(unitAround('kW')).toEqual({ before: '', after: ' kW' });
        // A price per unit leads with the dollar sign and follows with the per-unit part.
        expect(unitAround('$/mi')).toEqual({ before: '$', after: '/mi' });
        expect(unitAround('$/kWh')).toEqual({ before: '$', after: '/kWh' });
    });

    it('is nothing where there is nothing to state', () => {
        expect(figureWithUnit('—', null)).toBe('—');
        expect(cellUnit('kWh', null)).toBeNull();
        expect(cellUnit('kWh', '')).toBeNull();
        expect(cellUnit('kWh', 0)).toBe('kWh');
        expect(cellUnit(undefined, 5)).toBeNull();
    });
});

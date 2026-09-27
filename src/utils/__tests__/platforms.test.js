/**
 * Platforms (#318), section 1: holding and showing what a vehicle is built on;
 * section 2 (#352): the platform as the last fallback for a vehicle's specs.
 */
import { describe, it, expect } from 'vitest';
import {
    matchPlatform, electricalSummary, platformGroups, vehiclePlatforms, platformLineText,
    resolveVoltageClass, platformProvides, withPlatforms, chemistrySuggestions,
} from '../platforms';
import { specProvenance, resolveEffectiveSpecs, fallbackSpecs } from '../specHelpers';
import { SPEC_CATEGORIES } from '../vehicleSpecSchema';
import { parseVehicleImportText } from '../parseVehicleImport';
import { buildImportPlan, selectPlanRows } from '../vehicleImportPlan';
import { vehicleFormFrom } from '../vehicleForm';
import { withInheritance } from '../vehicleInheritance';
import { buildVehicleRows, vehicleColumnByKey } from '../vehicleTable';

const P = [
    { id: 1, kind: 'mechanical', name: 'E-GMP', maker_group: 'Hyundai Motor Group', aliases: ['Electric-Global Modular Platform'] },
    { id: 2, kind: 'electrical', name: 'E-GMP 800 V', maker_group: 'Hyundai Motor Group', aliases: ['E-GMP'], voltage_class_v: 800, dc_400v_charging: 'motor-boost' },
    { id: 3, kind: 'mechanical', name: 'Rivian R1', maker_group: 'Rivian', aliases: ['R1'] },
    { id: 4, kind: 'electrical', name: 'Rivian Gen 2', maker_group: 'Rivian', aliases: [], voltage_class_v: 400, dc_400v_charging: 'native' },
    { id: 5, kind: 'electrical', name: 'Ultium 800 V', maker_group: null, aliases: ['Shared'] },
    { id: 6, kind: 'electrical', name: 'Other 800 V', maker_group: null, aliases: ['Shared'] },
];
const byId = new Map(P.map(p => [p.id, p]));

describe('matchPlatform', () => {
    it('finds a platform of the asked kind by name or alias, ignoring case', () => {
        expect(matchPlatform('e-gmp', P, 'mechanical').id).toBe(1);
        expect(matchPlatform('E-GMP', P, 'electrical').id).toBe(2);   // by alias, in its own kind
        expect(matchPlatform(' r1 ', P, 'mechanical').id).toBe(3);
    });

    it('refuses to guess between two platforms sharing an alias, or across kinds', () => {
        expect(matchPlatform('Shared', P, 'electrical')).toBeNull();
        expect(matchPlatform('Rivian Gen 2', P, 'mechanical')).toBeNull();
        expect(matchPlatform('', P, 'mechanical')).toBeNull();
    });
});

describe('describing a platform', () => {
    it('summarises only the charging hardware that is not the default', () => {
        expect(electricalSummary(P[1])).toBe('800 V · motor boost on 400 V');
        expect(electricalSummary(P[3])).toBe('400 V');
        expect(electricalSummary(P[0])).toBeNull();                  // mechanical
    });

    it('says a platform once when the electrical name already names the structure', () => {
        expect(platformLineText({ mechanical: P[0], electrical: P[1] })).toBe('E-GMP 800 V');
        expect(platformLineText({ mechanical: P[2], electrical: P[3] })).toBe('Rivian R1 · Rivian Gen 2');
        expect(platformLineText({ mechanical: P[2], electrical: null })).toBe('Rivian R1');
        expect(platformLineText({ mechanical: null, electrical: null })).toBeNull();
    });

    it('groups a kind by maker for the picker, makerless last', () => {
        const groups = platformGroups(P, 'electrical');
        expect(groups.map(g => g.maker)).toEqual(['Hyundai Motor Group', 'Rivian', 'Other']);
        expect(groups[2].platforms.map(p => p.name)).toEqual(['Other 800 V', 'Ultium 800 V']);
    });
});

describe('a vehicle and its platforms', () => {
    it('reads the resolved links, so a variant shows its source\'s', () => {
        const [, variant] = withInheritance([
            { id: 10, name: 'R1S', tags: [], mechanical_platform_id: 3, electrical_platform_id: 4 },
            { id: 11, name: 'R1S Quad', tags: [], spec_source_vehicle_id: 10 },
        ]);
        expect(vehiclePlatforms(variant, byId)).toEqual({ mechanical: P[2], electrical: P[3] });
        // The form edits its own links, which are none: saving must not copy the source's.
        expect(vehicleFormFrom(variant)).toMatchObject({ mechanical_platform_id: null, electrical_platform_id: null });
    });

    it('fills the vehicle table\'s platform columns, noting an inherited one', () => {
        const fleet = withInheritance([
            { id: 10, name: 'Ioniq 5', tags: [], specs: {}, epa_mappings: [], mechanical_platform_id: 1, electrical_platform_id: 2 },
            { id: 11, name: 'Ioniq 5 N', tags: [], specs: {}, epa_mappings: [], spec_source_vehicle_id: 10 },
        ]);
        const [own, variant] = buildVehicleRows(fleet, { platformsById: byId });
        expect(own.values).toMatchObject({
            'platform.mechanical': 'E-GMP', 'platform.electrical': 'E-GMP 800 V',
            'figures.voltageClass': 800, 'charging.dc_400v_charging': 'Motor boost',
        });
        expect(own.notes['figures.voltageClass']).toBe('from E-GMP 800 V');
        expect(own.notes['charging.dc_400v_charging']).toBe('from E-GMP 800 V');
        expect(own.notes['platform.electrical']).toBeUndefined();
        expect(variant.notes['platform.electrical']).toBe('from Ioniq 5');
        expect(vehicleColumnByKey('figures.voltageClass').bar).toBeFalsy();   // 800 V is not "better"
        expect(buildVehicleRows(fleet)[0].values['platform.mechanical']).toBeNull();
    });
});

describe('voltage class and 400 V charging, per vehicle', () => {
    it('takes the platform\'s class, else works one out from nominal voltage at 475 V', () => {
        expect(resolveVoltageClass(P[1], 380)).toMatchObject({ v: 800, basis: 'platform' });   // the platform wins
        expect(resolveVoltageClass(null, 474)).toEqual({ v: 400, basis: 'nominal', nominalV: 474 });
        expect(resolveVoltageClass(null, 475)).toMatchObject({ v: 800, basis: 'nominal' });
        expect(resolveVoltageClass(null, 924)).toMatchObject({ v: 800 });   // Lucid's "900 V" is 800 V class
        expect(resolveVoltageClass(null, null)).toBeNull();
        expect(resolveVoltageClass(null, '')).toBeNull();
    });

    it('provides the 400 V charging method from the electrical platform, naming it', () => {
        const { specs, from } = platformProvides({ mechanical: P[0], electrical: P[1] });
        expect(specs).toEqual({ charging: { dc_400v_charging: 'Motor boost' } });
        expect(from.get('charging.dc_400v_charging')).toBe(P[1]);
        // A mechanical platform provides nothing; neither does no platform.
        expect(platformProvides({ mechanical: P[0], electrical: null }).specs).toEqual({});
        expect(platformProvides(undefined).specs).toEqual({});
    });

    it('stores what it provides as the spec field\'s own option', () => {
        const field = SPEC_CATEGORIES.find(c => c.key === 'charging').fields.find(f => f.key === 'dc_400v_charging');
        expect(field.options).toContain(platformProvides({ electrical: P[1] }).specs.charging.dc_400v_charging);
        expect(field.options).toContain(platformProvides({ electrical: P[3] }).specs.charging.dc_400v_charging);
    });
});

describe('the platform as the last fallback (#352)', () => {
    const fleet = (...vs) => withPlatforms(withInheritance(vs.map(v => ({ tags: [], specs: {}, ...v }))), byId);

    it('resolves own, then the source vehicle, then the platform', () => {
        const [taycan, withOwn, variant] = fleet(
            { id: 20, name: 'Taycan', electrical_platform_id: 2 },
            { id: 21, name: 'Taycan (no booster)', electrical_platform_id: 2, specs: { charging: { dc_400v_charging: 'Not possible' } } },
            { id: 22, name: 'Taycan 4S', spec_source_vehicle_id: 21 },
        );
        const all = [taycan, withOwn, variant];

        const bare = specProvenance(taycan, all);
        expect(bare.specs.charging.dc_400v_charging).toBe('Motor boost');
        expect(bare.fromPlatform.get('charging.dc_400v_charging')).toBe(P[1]);
        expect(bare.inheritedKeys.size).toBe(0);

        // The vehicle's own value wins, and is not marked as the platform's.
        const own = specProvenance(withOwn, all);
        expect(own.specs.charging.dc_400v_charging).toBe('Not possible');
        expect(own.fromPlatform.size).toBe(0);

        // The source vehicle's value comes before the platform's, marked as inherited.
        const inherited = specProvenance(variant, all);
        expect(inherited.specs.charging.dc_400v_charging).toBe('Not possible');
        expect(inherited.inheritedKeys.has('charging.dc_400v_charging')).toBe(true);
        expect(inherited.fromPlatform.size).toBe(0);
        expect(resolveEffectiveSpecs(variant, all).charging.dc_400v_charging).toBe('Not possible');
    });

    it('takes the platform of the vehicle resolved, never its source\'s', () => {
        // The 2025 R1 kept the structure and changed the electrics: what the
        // old electrical platform provided must not come down the chain.
        const [older, newer] = fleet(
            { id: 30, name: 'R1S 2024', mechanical_platform_id: 3, electrical_platform_id: 2 },
            { id: 31, name: 'R1S 2025', spec_source_vehicle_id: 30, electrical_platform_id: 4 },
        );
        const prov = specProvenance(newer, [older, newer]);
        expect(prov.specs.charging.dc_400v_charging).toBe('Native');
        expect(prov.fromPlatform.get('charging.dc_400v_charging')).toBe(P[3]);
    });

    it('offers what a blank field would show, and whose, for the editor\'s hints', () => {
        const [car] = fleet({ id: 40, name: 'Ioniq 5', electrical_platform_id: 2 });
        const { specs, fromPlatform } = fallbackSpecs(car, [car]);
        expect(specs.charging.dc_400v_charging).toBe('Motor boost');
        expect(fromPlatform.get('charging.dc_400v_charging').name).toBe('E-GMP 800 V');
    });

    it('resolves through the chain alone for a vehicle with no platform rows attached', () => {
        const v = { id: 50, specs: { charging: { max_dc_kw: 250 } } };
        expect(specProvenance(v, [v]).specs.charging.max_dc_kw).toBe(250);
        expect(specProvenance(v, [v]).fromPlatform.size).toBe(0);
    });

    it('offers a platform\'s chemistries as suggestions and never as a value', () => {
        const mache = { id: 7, kind: 'electrical', name: 'GE1', chemistries: ['NMC', 'LFP', 'Unobtainium'] };
        expect(chemistrySuggestions(mache)).toEqual(['NMC', 'LFP']);
        expect(chemistrySuggestions(null)).toEqual([]);
        const [car] = withPlatforms([{ id: 60, specs: {}, electrical_platform_id: 7 }], new Map([[7, mache]]));
        expect(resolveEffectiveSpecs(car, [car]).charging.battery_chemistry).toBeNull();
    });
});

describe('importing platforms', () => {
    const plan = (csv, ctx = {}) => {
        const parsed = parseVehicleImportText(csv, 'v.csv');
        return buildImportPlan(parsed.rows, { vehicles: [], platforms: P, ...ctx });
    };

    it('links existing platforms by name or alias from their own columns', () => {
        const { rows } = plan('name,mechanical_platform,electrical_platform\nIoniq 6,Electric-Global Modular Platform,E-GMP 800 V\n');
        expect(rows[0].platforms).toEqual({ mechanical: { id: 1, name: 'E-GMP' }, electrical: { id: 2, name: 'E-GMP 800 V' } });
        expect(rows[0].action).toBe('create');
    });

    it('creates a platform a kind column names that does not exist yet, and lists it', () => {
        const { rows, summary } = plan('name,electrical_platform\nR2,Rivian Gen 3\n');
        expect(rows[0].platforms.electrical).toEqual({ name: 'Rivian Gen 3', isNew: true });
        expect(summary.newPlatforms).toEqual([{ kind: 'electrical', name: 'Rivian Gen 3' }]);
        // A deselected row takes its new platform with it.
        expect(selectPlanRows({ rows, summary }, new Set()).summary.newPlatforms).toEqual([]);
    });

    it('lets a bare "platform" column link both kinds it matches, and create neither', () => {
        const both = plan('name,platform\nEV6,E-GMP\n').rows[0];
        expect(both.platforms).toEqual({ mechanical: { id: 1, name: 'E-GMP' }, electrical: { id: 2, name: 'E-GMP 800 V' } });
        const unknown = plan('name,platform\nMystery,NoSuchThing\n');
        expect(unknown.rows[0].platforms).toEqual({});
        expect(unknown.summary.newPlatforms).toEqual([]);
        expect(unknown.rows[0].warnings.join(' ')).toMatch(/matches no platform/);
    });

    it('fills blanks only: a vehicle that links its own platform keeps it', () => {
        const existing = { id: 9, name: 'Ioniq 5', own: { mechanical_platform_id: 1, electrical_platform_id: null }, specs: {}, tags: [] };
        const { rows } = plan('name,mechanical_platform,electrical_platform\nIoniq 5,Rivian R1,E-GMP 800 V\n', { vehicles: [existing] });
        expect(rows[0].platforms).toEqual({ electrical: { id: 2, name: 'E-GMP 800 V' } });
        expect(rows[0].action).toBe('update');
    });

    it('ignores platform columns, saying so, before migration 072', () => {
        const { rows } = plan('name,mechanical_platform\nIoniq 6,E-GMP\n', { platformsAvailable: false });
        expect(rows[0].platforms).toEqual({});
        expect(rows[0].warnings.join(' ')).toMatch(/migration 072/);
    });
});

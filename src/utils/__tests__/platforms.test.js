/**
 * Platforms (#318), section 1: holding and showing what a vehicle is built on.
 */
import { describe, it, expect } from 'vitest';
import {
    matchPlatform, electricalSummary, platformGroups, vehiclePlatforms, platformLineText,
} from '../platforms';
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
            'platform.voltage': 800, 'platform.dc400': 'Motor boost',
        });
        expect(own.notes['platform.electrical']).toBeUndefined();
        expect(variant.notes['platform.electrical']).toBe('from Ioniq 5');
        expect(vehicleColumnByKey('platform.voltage').bar).toBeFalsy();   // 800 V is not "better"
        expect(buildVehicleRows(fleet)[0].values['platform.mechanical']).toBeNull();
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

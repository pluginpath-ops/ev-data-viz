import { describe, it, expect } from 'vitest';
import { withInheritance, ownValues, variantLinkPlan, lineageIndex, lineageRole, vehicleStack, lineageTrees } from '../vehicleInheritance';

const tag = (id, name) => ({ id, name });
const v = (id, over = {}) => ({
    id, name: `V${id}`, year: '2026', color: null,
    image_url: null, image_thumb_url: null, image_focal_y: null, tags: [],
    spec_source_vehicle_id: null, ...over,
});
const byId = (fleet) => Object.fromEntries(withInheritance(fleet).map(x => [x.id, x]));

describe('the inheritance chain', () => {
    it('reaches past a source with nothing set, and stops at a missing source or a cycle', () => {
        const out = byId([
            v(1, { color: '#111111' }),
            v(2, { spec_source_vehicle_id: 1 }),
            v(3, { spec_source_vehicle_id: 2 }),
            v(4, { spec_source_vehicle_id: 99 }),
        ]);
        expect(out[3].inheritedFrom.color.id).toBe(1);
        expect(out[4].color).toBeNull();
        expect(out[4].inheritedFrom.color).toBeNull();

        const loop = byId([v(5, { spec_source_vehicle_id: 6 }), v(6, { spec_source_vehicle_id: 5, color: '#666666' })]);
        expect(loop[5].color).toBe('#666666');
        expect(loop[6].color).toBe('#666666');   // its own, never looped back onto
    });
});

describe('withInheritance', () => {
    it('takes color and photo from the nearest source that has one, and says which', () => {
        const out = byId([
            v(1, { color: '#111111', image_url: 'full-1.jpg', image_thumb_url: 'thumb-1.jpg' }),
            v(2, { spec_source_vehicle_id: 1 }),
            v(3, { spec_source_vehicle_id: 2 }),
        ]);
        expect(out[3].color).toBe('#111111');
        expect(out[3].image_thumb_url).toBe('thumb-1.jpg');
        expect(out[3].inheritedFrom.color).toEqual({ id: 1, name: '2026 V1' });
        expect(out[3].inheritedFrom.photo.id).toBe(1);
        expect(out[3].own).toEqual({
            color: null, image_url: null, image_thumb_url: null, image_focal_y: null,
            mechanical_platform_id: null, electrical_platform_id: null, tags: [],
        });
    });

    it('takes each platform from the nearest source with that one set, separately (#318)', () => {
        // The 2025 R1 kept its skateboard and changed its electrics: a variant
        // setting one platform must still inherit the other.
        const out = byId([
            v(1, { mechanical_platform_id: 10, electrical_platform_id: 20 }),
            v(2, { spec_source_vehicle_id: 1, electrical_platform_id: 21 }),
            v(3, { spec_source_vehicle_id: 2 }),
        ]);
        expect(out[2]).toMatchObject({ mechanical_platform_id: 10, electrical_platform_id: 21 });
        expect(out[2].inheritedFrom.mechanical_platform_id).toEqual({ id: 1, name: '2026 V1' });
        expect(out[2].inheritedFrom.electrical_platform_id).toBeNull();
        expect(out[3]).toMatchObject({ mechanical_platform_id: 10, electrical_platform_id: 21 });
        expect(out[3].inheritedFrom.electrical_platform_id.id).toBe(2);
        expect(out[3].own.electrical_platform_id).toBeNull();
    });

    it('keeps a vehicle’s own color and photo, and moves the photo as a pair', () => {
        const out = byId([
            v(1, {
                color: '#111111', image_url: 'full-1.jpg', image_thumb_url: 'thumb-1.jpg',
                image_focal_y: 20,
            }),
            v(2, { spec_source_vehicle_id: 1, color: '#222222', image_url: 'full-2.jpg' }),
        ]);
        expect(out[2].color).toBe('#222222');
        expect(out[2].inheritedFrom.color).toBeNull();
        // Own full image with no thumbnail yet: never paired with the source's thumbnail.
        expect(out[2].image_url).toBe('full-2.jpg');
        expect(out[2].image_thumb_url).toBeNull();
        expect(out[2].inheritedFrom.photo).toBeNull();
        // Nor with the source's focal point, which frames a photo this vehicle
        // is no longer showing: its own picture starts centered.
        expect(out[2].image_focal_y).toBeNull();
    });

    it('carries the focal point with the photo, and follows the source when it is moved', () => {
        const fleet = [
            v(1, { image_url: 'full-1.jpg', image_thumb_url: 'thumb-1.jpg', image_focal_y: 30 }),
            v(2, { spec_source_vehicle_id: 1 }),
        ];
        expect(byId(fleet)[2].image_focal_y).toBe(30);
        expect(byId(fleet)[2].inheritedFrom.photo.id).toBe(1);
        expect(byId(fleet)[2].own.image_focal_y).toBeNull();

        // Repositioned on the source; nothing is written to the variant.
        fleet[0] = { ...fleet[0], image_focal_y: 72 };
        expect(byId(fleet)[2].image_focal_y).toBe(72);
    });

    it('follows the source: a replaced photo reaches every variant with nothing written', () => {
        const fleet = [v(1, { image_url: 'old.jpg' }), v(2, { spec_source_vehicle_id: 1 })];
        expect(byId(fleet)[2].image_url).toBe('old.jpg');
        fleet[0] = { ...fleet[0], image_url: 'new.jpg' };
        expect(byId(fleet)[2].image_url).toBe('new.jpg');
    });

    it('takes the nearest source’s tags when a vehicle has none, and its own set whole when it has one', () => {
        const suv = tag(10, 'SUV'), truck = tag(11, 'Truck');
        const out = byId([
            v(1, { tags: [suv] }),                                  // R1S
            v(2, { spec_source_vehicle_id: 1, tags: [truck] }),     // R1T: a Truck, not also an SUV
            v(3, { spec_source_vehicle_id: 1 }),                    // a variant with no tags of its own
            v(4, { spec_source_vehicle_id: 3 }),                    // and one further down
        ]);
        expect(out[2].tags).toEqual([truck]);
        expect(out[2].inheritedFrom.tags).toEqual({});
        expect(out[3].tags).toEqual([suv]);
        expect(out[4].tags).toEqual([suv]);
        expect(out[4].inheritedFrom.tags).toEqual({ 10: { id: 1, name: '2026 V1' } });
        expect(out[4].own.tags).toEqual([]);
    });

    it('changes nothing for a vehicle that inherits from nobody, beyond recording its own values', () => {
        const plain = v(1, { color: '#333333', tags: [tag(1, 'Sedan')] });
        const [out] = withInheritance([plain]);
        expect(out.color).toBe('#333333');
        expect(out.tags).toEqual(plain.tags);
        expect(out.inheritedFrom).toEqual({
            color: null, photo: null, mechanical_platform_id: null, electrical_platform_id: null, tags: {},
        });
    });
});

describe('ownValues', () => {
    it('reads own values from a resolved vehicle, and the plain fields from a raw one', () => {
        const [, resolved] = withInheritance([v(1, { color: '#111111' }), v(2, { spec_source_vehicle_id: 1 })]);
        expect(ownValues(resolved).color).toBeNull();
        expect(ownValues(v(3, { color: '#444444' })).color).toBe('#444444');
    });
});

describe('variantLinkPlan', () => {
    it('links the source’s own runs at factor 1 and its inherited runs with the source’s factors', () => {
        const source = {
            runs: [
                { id: 101 },
                { id: 'inh-7-202', _inherited: true, _realRunId: 202, _efficiencyFactor: 0.95, _capacityFactor: 1 },
            ],
        };
        expect(variantLinkPlan(source)).toEqual([
            { sourceRunId: 101, efficiencyFactor: null, capacityFactor: null },
            { sourceRunId: 202, efficiencyFactor: 0.95, capacityFactor: null },
        ]);
    });

    it('does not link the source’s composites — the variant builds its own', () => {
        const source = { runs: [{ id: 101 }, { id: 300, synthetic: true, composite: { chargerClassV: null } }] };
        expect(variantLinkPlan(source).map(l => l.sourceRunId)).toEqual([101]);
    });
});

describe('lineage roles', () => {
    const fleet = [
        v(1),
        v(2, { spec_source_vehicle_id: 1 }),
        v(3, { spec_source_vehicle_id: 2 }),
        v(4),
        v(5, { spec_source_vehicle_id: 99 }),
    ];
    const index = lineageIndex(fleet);
    const role = id => lineageRole(fleet.find(x => x.id === id), index);

    it('names origin, has-variants and end, and nothing for a vehicle outside a lineage', () => {
        expect(role(1)).toBe('origin');
        expect(role(2)).toBe('has-variants');
        expect(role(3)).toBe('end');
        expect(role(4)).toBeNull();
    });

    it('treats a missing source as none', () => {
        expect(role(5)).toBeNull();
    });
});

describe('vehicleStack', () => {
    // 1 ← 2 ← 3 ← 4 ← 5, and 6 a second variant of 4
    const fleet = [
        v(1), v(2, { spec_source_vehicle_id: 1 }), v(3, { spec_source_vehicle_id: 2 }),
        v(4, { spec_source_vehicle_id: 3 }), v(5, { spec_source_vehicle_id: 4 }),
        v(6, { spec_source_vehicle_id: 4 }),
    ];
    const index = lineageIndex(fleet);
    const get = id => fleet.find(x => x.id === id);
    const ids = entries => entries.map(e => e.vehicle ? e.vehicle.id : `gap${e.gap}`);

    it('is empty for a vehicle with no source', () => {
        expect(vehicleStack(get(1), index)).toEqual({ rolodex: [], more: 0, members: [] });
    });

    it('shows the nearest two sources, furthest first, and counts the rest', () => {
        const s = vehicleStack(get(5), index);
        expect(ids(s.rolodex)).toEqual([3, 4]);
        expect(s.more).toBe(2);
        expect(s.members.map(m => m.id)).toEqual([1, 2, 3, 4, 5]);
    });

    it('gives each sibling its own stack through the shared source', () => {
        expect(ids(vehicleStack(get(6), index).rolodex)).toEqual([3, 4]);
    });

    it('folds a filtered-out stretch into one gap, and leaves it out of the members', () => {
        const shown = x => ![2, 3].includes(x.id);
        const s = vehicleStack(get(5), index, shown);
        expect(ids(s.rolodex)).toEqual(['gap2', 4]);
        expect(s.more).toBe(1);
        expect(s.members.map(m => m.id)).toEqual([1, 4, 5]);
    });

    it('shows a lone gap past the cap as the gap, not as "+0 more"', () => {
        const s = vehicleStack(get(5), index, x => x.id !== 1 && x.id !== 2);
        expect(ids(s.rolodex)).toEqual(['gap2', 3, 4]);
        expect(s.more).toBe(0);
    });
});

describe('lineageTrees', () => {
    // 1 ← 2 ← 3 ← 4, 3 ← 5; 6 alone; 7 ← 8
    const fleet = [
        v(1), v(2, { spec_source_vehicle_id: 1 }), v(3, { spec_source_vehicle_id: 2 }),
        v(4, { spec_source_vehicle_id: 3 }), v(5, { spec_source_vehicle_id: 3 }),
        v(6), v(7), v(8, { spec_source_vehicle_id: 7 }),
    ];
    const index = lineageIndex(fleet);
    const flat = trees => trees.map(t => t.rows.map(r => r.vehicle ? `${r.depth}:${r.vehicle.id}` : `${r.depth}:gap${r.gap}`));

    it('lists every lineage from its origin down, each vehicle once', () => {
        expect(flat(lineageTrees(fleet, index))).toEqual([
            ['0:1', '1:2', '2:3', '3:4', '3:5'], ['0:6'], ['0:7', '1:8'],
        ]);
    });

    it('keeps a matching variant under a gap for the sources that failed', () => {
        const shown = x => [4, 5, 8].includes(x.id);
        expect(flat(lineageTrees(fleet, index, shown))).toEqual([
            ['0:gap3', '1:4', '1:5'], ['0:gap1', '1:8'],
        ]);
    });

    it('leaves out a branch with nothing that matches', () => {
        const shown = x => [1, 4].includes(x.id);
        expect(flat(lineageTrees(fleet, index, shown))).toEqual([['0:1', '1:gap2', '2:4']]);
    });

    it('orders trees and variants by the display order', () => {
        const first = [8, 5, 4];
        const order = [...first.map(id => fleet.find(x => x.id === id)), ...fleet.filter(x => !first.includes(x.id))];
        expect(flat(lineageTrees(fleet, index, () => true, order))).toEqual([
            ['0:7', '1:8'], ['0:1', '1:2', '2:3', '3:5', '3:4'], ['0:6'],
        ]);
    });
});

describe('lineageTrees with several branches', () => {
    // 1 → 2 → {4, 5}, 1 → 3 → {6, 7 → 8}
    const fleet = [
        v(1), v(2, { spec_source_vehicle_id: 1 }), v(3, { spec_source_vehicle_id: 1 }),
        v(4, { spec_source_vehicle_id: 2 }), v(5, { spec_source_vehicle_id: 2 }),
        v(6, { spec_source_vehicle_id: 3 }), v(7, { spec_source_vehicle_id: 3 }),
        v(8, { spec_source_vehicle_id: 7 }),
    ];
    const index = lineageIndex(fleet);
    const flat = trees => trees.map(t => t.rows.map(r => r.vehicle ? `${r.depth}:${r.vehicle.id}` : `${r.depth}:gap${r.gap}`));

    it('walks every branch to every end variant, each under its own source', () => {
        expect(flat(lineageTrees(fleet, index))).toEqual([
            ['0:1', '1:2', '2:4', '2:5', '1:3', '2:6', '2:7', '3:8'],
        ]);
    });

    it('gives each branch its own gap when a fork is filtered out', () => {
        const shown = x => [4, 5, 8].includes(x.id);
        expect(flat(lineageTrees(fleet, index, shown))).toEqual([
            ['0:gap1', '1:gap1', '2:4', '2:5', '1:gap2', '2:8'],
        ]);
    });

    it('names the vehicles each gap stands for, furthest first', () => {
        const shown = x => [4, 5, 8].includes(x.id);
        const gaps = lineageTrees(fleet, index, shown)[0].rows.filter(r => r.gap);
        expect(gaps.map(g => g.hidden.map(h => h.id))).toEqual([[1], [2], [3, 7]]);
    });
});

describe('lineageTrees connector trails', () => {
    // 1 → 2 → {4, 5}, 1 → 3
    const fleet = [
        v(1), v(2, { spec_source_vehicle_id: 1 }), v(3, { spec_source_vehicle_id: 1 }),
        v(4, { spec_source_vehicle_id: 2 }), v(5, { spec_source_vehicle_id: 2 }),
    ];
    const rows = lineageTrees(fleet, lineageIndex(fleet))[0].rows;
    const at = id => rows.find(r => r.vehicle.id === id);

    it('says which lines carry on past each row', () => {
        expect(at(1).trail).toEqual([]);
        expect(at(2).trail).toEqual([true]);          // 3 follows it
        expect(at(4).trail).toEqual([true, true]);    // 2's line, then 5 follows
        expect(at(5).trail).toEqual([true, false]);   // last under 2
        expect(at(3).trail).toEqual([false]);         // last under 1
    });

    it('marks the rows that have variants below them', () => {
        expect([1, 2, 3, 4, 5].map(id => at(id).hasVariants)).toEqual([true, true, false, false, false]);
    });
});

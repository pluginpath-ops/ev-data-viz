import { describe, it, expect } from 'vitest';
import { withInheritance, ownValues, variantLinkPlan } from '../vehicleInheritance';

const tag = (id, name) => ({ id, name });
const v = (id, over = {}) => ({
    id, name: `V${id}`, year: '2026', color: null, image_url: null, image_thumb_url: null, tags: [],
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
        expect(out[3].own).toEqual({ color: null, image_url: null, image_thumb_url: null, tags: [] });
    });

    it('keeps a vehicle’s own color and photo, and moves the photo as a pair', () => {
        const out = byId([
            v(1, { color: '#111111', image_url: 'full-1.jpg', image_thumb_url: 'thumb-1.jpg' }),
            v(2, { spec_source_vehicle_id: 1, color: '#222222', image_url: 'full-2.jpg' }),
        ]);
        expect(out[2].color).toBe('#222222');
        expect(out[2].inheritedFrom.color).toBeNull();
        // Own full image with no thumbnail yet: never paired with the source's thumbnail.
        expect(out[2].image_url).toBe('full-2.jpg');
        expect(out[2].image_thumb_url).toBeNull();
        expect(out[2].inheritedFrom.photo).toBeNull();
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
        expect(out.inheritedFrom).toEqual({ color: null, photo: null, tags: {} });
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
});

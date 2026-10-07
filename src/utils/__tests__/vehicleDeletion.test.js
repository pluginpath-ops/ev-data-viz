import { describe, it, expect } from 'vitest';
import { passDown, variantsOf, mergeSpecBlobs, deletionImpact, impactLines } from '../vehicleDeletion';
import { resolveEffectiveSpecs } from '../specHelpers';
import { withInheritance } from '../vehicleInheritance';

const veh = (id, over = {}) => ({ id, name: `V${id}`, specs: {}, tags: [], runs: [], spec_links: [], ...over });

// a → b → c, and b → d: b sits in the middle of a chain with a branch.
const chain = () => [
    veh(1, { color: '#111111', tags: [{ id: 10, name: 'SUV' }],
        specs: { powertrain: { motors: 2, drive_type: 'AWD' }, charging: { max_dc_kw: 250 } } }),
    veh(2, { spec_source_vehicle_id: 1, color: '#222222', image_url: 'b.jpg', image_thumb_url: 'bt.jpg', image_focal_y: 40,
        tags: [{ id: 11, name: 'Truck' }],
        specs: { powertrain: { motors: 1, horsepower_hp: 300 }, charging: { max_dc_kw: 300, v2l: false }, pricing: { _custom: { x: 1 } } } }),
    veh(3, { spec_source_vehicle_id: 2, specs: { powertrain: { motors: null, torque_lbft: 400 }, charging: { v2l: true } } }),
    veh(4, { spec_source_vehicle_id: 2, color: '#444444', image_url: 'd.jpg', image_thumb_url: 'dt.jpg', tags: [{ id: 12, name: 'Van' }],
        specs: { powertrain: { horsepower_hp: 350 } } }),
];

describe('passDown keeps what every variant shows', () => {
    it('leaves each variant\'s effective specs exactly as they were', () => {
        const before = chain();
        const after = passDown(before, 2);
        for (const id of [3, 4]) {
            const was = resolveEffectiveSpecs(before.find(v => v.id === id), before);
            const is = resolveEffectiveSpecs(after.find(v => v.id === id), after);
            expect(is).toEqual(was);
        }
    });

    it('leaves each variant\'s color, photo and tags exactly as they were', () => {
        const before = withInheritance(chain());
        const after = withInheritance(passDown(chain(), 2));
        for (const id of [3, 4]) {
            const was = before.find(v => v.id === id);
            const is = after.find(v => v.id === id);
            for (const key of ['color', 'image_url', 'image_thumb_url', 'image_focal_y']) {
                expect(is[key]).toEqual(was[key]);
            }
            expect(is.tags.map(t => t.id)).toEqual(was.tags.map(t => t.id));
        }
    });

    it('still holds with the source a root, or three deep', () => {
        for (const id of [1, 2]) {
            const before = chain();
            const after = passDown(before, id);
            for (const v of after.filter(x => x.id !== id)) {
                expect(resolveEffectiveSpecs(v, after)).toEqual(resolveEffectiveSpecs(before.find(b => b.id === v.id), before));
            }
        }
    });

    it('re-points the variants at the deleted vehicle\'s source', () => {
        const after = passDown(chain(), 2);
        expect(after.map(v => v.id)).toEqual([1, 3, 4]);
        expect(after.find(v => v.id === 3).spec_source_vehicle_id).toBe(1);
        expect(after.find(v => v.id === 4).spec_source_vehicle_id).toBe(1);
    });

    it('makes the variants roots when the deleted vehicle was one', () => {
        const after = passDown(chain(), 1);
        expect(after.find(v => v.id === 2).spec_source_vehicle_id).toBeNull();
    });

    it('never overwrites a value the variant set itself', () => {
        const d = passDown(chain(), 2).find(v => v.id === 4);
        expect(d.color).toBe('#444444');
        expect(d.image_url).toBe('d.jpg');
        expect(d.image_focal_y ?? null).toBeNull();   // not the focal point of b's picture
        expect(d.tags.map(t => t.id)).toEqual([12]);
        expect(d.specs.powertrain.horsepower_hp).toBe(350);
    });

    it('passes the photo, its thumbnail and its focal point down as one', () => {
        const c = passDown(chain(), 2).find(v => v.id === 3);
        expect([c.image_url, c.image_thumb_url, c.image_focal_y]).toEqual(['b.jpg', 'bt.jpg', 40]);
    });

    it('changes nothing about a vehicle that does not inherit from it', () => {
        const before = chain();
        const after = passDown(before, 2);
        expect(after.find(v => v.id === 1)).toBe(before.find(v => v.id === 1));
    });

    it('does nothing for a vehicle that is not there', () => {
        const before = chain();
        expect(passDown(before, 99)).toBe(before);
    });
});

describe('mergeSpecBlobs', () => {
    it('lets false and 0 win, and an empty string or null show what is beneath', () => {
        const m = mergeSpecBlobs({ c: { a: 5, b: true, s: 'x', n: 9 } }, { c: { a: 0, b: false, s: '', n: null } });
        expect(m.c).toMatchObject({ a: 0, b: false, s: 'x', n: 9 });
    });
    it('merges custom fields by key, the upper one winning', () => {
        const m = mergeSpecBlobs({ c: { _custom: { a: 1, b: 2 } } }, { c: { _custom: { b: 3 } } });
        expect(m.c._custom).toEqual({ a: 1, b: 3 });
    });
    it('returns an empty blob for two empty ones', () => {
        expect(mergeSpecBlobs(null, undefined)).toEqual({});
    });
});

describe('tests cannot be passed down', () => {
    const withTests = () => {
        const f = chain();
        f[1].runs = [{ id: 500 }, { id: 501 }];
        f[2].spec_links = [{ source_run_id: 500 }, { source_run_id: 900 }];
        f[2].runs = [{ id: 700 }, { id: 701, _inherited: true, _realRunId: 500 }];
        return f;
    };

    it('drops the links and shown runs that came from the deleted vehicle\'s runs', () => {
        const c = passDown(withTests(), 2).find(v => v.id === 3);
        expect(c.spec_links).toEqual([{ source_run_id: 900 }]);
        expect(c.runs.map(r => r.id)).toEqual([700]);
    });

    it('says how many stop showing, and where', () => {
        const [entry] = deletionImpact(withTests(), [2]);
        expect(entry.shownOn.map(s => [s.vehicle.id, s.count])).toEqual([[3, 1]]);
    });
});

describe('deletionImpact', () => {
    it('names the variants that stay and what they will inherit from', () => {
        const [entry] = deletionImpact(chain(), [2]);
        expect(entry.variants.map(v => v.id)).toEqual([3, 4]);
        expect(entry.newSource.id).toBe(1);
    });

    it('leaves out a variant that is going too', () => {
        const entries = deletionImpact(chain(), [2, 3]);
        expect(entries[0].variants.map(v => v.id)).toEqual([4]);
    });

    it('follows the chain as it is rewritten by an earlier delete', () => {
        // Delete b, then a: by the time a goes, c and d already inherit from it.
        const entries = deletionImpact(chain(), [2, 1]);
        expect(entries[1].variants.map(v => v.id)).toEqual([3, 4]);
        expect(entries[1].newSource).toBeNull();
    });

    it('says nothing about a vehicle nothing depends on', () => {
        expect(deletionImpact(chain(), [3])).toEqual([]);
    });

    it('writes a sentence per consequence', () => {
        const lines = impactLines(deletionImpact(chain(), [2]));
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatch(/V2/);
        expect(lines[0]).toMatch(/inherit from V1 instead/);
    });

    it('variantsOf lists the direct variants only', () => {
        expect(variantsOf(chain(), 1).map(v => v.id)).toEqual([2]);
    });
});

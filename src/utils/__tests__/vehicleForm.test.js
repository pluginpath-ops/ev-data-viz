import { describe, it, expect } from 'vitest';
import { vehicleFormFrom } from '../vehicleForm';
import { withInheritance } from '../vehicleInheritance';

describe('vehicleFormFrom', () => {
    it('reads the manufacturer from the joined object, or from the bare id on a just-inserted row', () => {
        expect(vehicleFormFrom({ name: 'Lightning', manufacturer: { id: 3, name: 'Ford' }, manufacturer_id: 3 }).manufacturer_id).toBe(3);
        // Copy and ＋ Variant open the form on the insert's return, which has no join.
        expect(vehicleFormFrom({ name: 'Lightning (variant)', manufacturer_id: 3 }).manufacturer_id).toBe(3);
        expect(vehicleFormFrom({ name: 'Unbranded' }).manufacturer_id).toBeNull();
    });

    it('seeds the vehicle’s own color, never an inherited one', () => {
        const [, variant] = withInheritance([
            { id: 1, name: 'Lightning', color: '#cccccc', tags: [] },
            { id: 2, name: 'Flash', color: null, tags: [], spec_source_vehicle_id: 1 },
        ]);
        expect(variant.color).toBe('#cccccc');
        expect(vehicleFormFrom(variant).color).toBeNull();
    });
});

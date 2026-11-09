import { describe, it, expect } from 'vitest';
import { vehicleOption, vehicleDetailLabel } from '../specHelpers';

const modelY = {
    id: 'v1', name: 'Model Y LR', year: 2021, make: 'Tesla', model: 'Model Y', trim: 'Long Range AWD',
    platforms: { mechanical: { name: 'Tesla Model 3/Y' }, electrical: { name: 'Tesla 400 V' } },
    tags: [{ name: 'Crossover' }],
};

describe('vehicleOption', () => {
    it('puts name and year in the label and the rest in the detail', () => {
        const o = vehicleOption(modelY);
        expect(o.id).toBe('v1');
        expect(o.label).toBe('Model Y LR · 2021');
        // "Model Y" is already inside the name, so it is not said again.
        expect(o.detail).toBe('Tesla · Long Range AWD · Tesla Model 3/Y · Tesla 400 V');
    });

    it('keeps vehicleDetailLabel exactly what it was: label and detail joined', () => {
        expect(vehicleDetailLabel(modelY))
            .toBe('Model Y LR · 2021 · Tesla · Long Range AWD · Tesla Model 3/Y · Tesla 400 V');
        const o = vehicleOption(modelY);
        expect(`${o.label} · ${o.detail}`).toBe(vehicleDetailLabel(modelY));
    });

    it('drops a part already contained in an earlier one (R1S / R1S)', () => {
        const o = vehicleOption({ id: 2, name: 'R1S', year: 2022, make: 'Rivian', model: 'R1S', trim: 'Dual Max' });
        expect(o.label).toBe('R1S · 2022');
        expect(o.detail).toBe('Rivian · Dual Max');
    });

    it('has a plain name for a label when there is no year', () => {
        const o = vehicleOption({ id: 3, name: 'Air', make: 'Lucid', trim: 'Touring' });
        expect(o.label).toBe('Air');
        expect(o.detail).toBe('Lucid · Touring');
    });

    it('has an empty detail when nothing tells it apart', () => {
        expect(vehicleOption({ id: 4, name: 'Cybertruck', year: 2024 }).detail).toBe('');
    });

    it('prefers the manufacturer record over the free-text make', () => {
        const o = vehicleOption({ id: 5, name: 'Ioniq 5', make: 'hyundai', manufacturer: { name: 'Hyundai' } });
        expect(o.detail).toBe('Hyundai');
    });

    it('searches the label, make, model, platforms and tags', () => {
        const hay = vehicleOption(modelY).search;
        for (const word of ['model y', '2021', 'tesla', 'long range', 'model 3/y', '400 v', 'crossover']) {
            expect(hay, word).toContain(word);
        }
        expect(hay).toBe(hay.toLowerCase());
    });

    it('finds a model that the name leaves out', () => {
        const hay = vehicleOption({ id: 6, name: 'Dual Max', make: 'Rivian', model: 'R1T' }).search;
        expect(hay).toContain('r1t');
    });
});

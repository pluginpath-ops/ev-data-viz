import { describe, it, expect } from 'vitest';
import { vehicleLabel, vehicleSearchText } from '../specHelpers';

describe('vehicleLabel', () => {
    it('joins year, name and trim when each adds something', () => {
        expect(vehicleLabel({ year: 2026, name: 'Model Y', trim: 'Premium AWD' }))
            .toBe('2026 Model Y · Premium AWD');
    });

    describe('a trim the name already contains (#445)', () => {
        it('is not repeated', () => {
            expect(vehicleLabel({ year: 2026, name: 'Model Y Premium AWD', trim: 'Premium AWD' }))
                .toBe('2026 Model Y Premium AWD');
        });

        it('ignores case and punctuation', () => {
            expect(vehicleLabel({ year: 2024, name: 'Ioniq 5 SE Long-Range', trim: 'se long range' }))
                .toBe('2024 Ioniq 5 SE Long-Range');
        });
    });

    describe('a trim that only shares letters with the name', () => {
        it('keeps "L" next to "Long Range"', () => {
            expect(vehicleLabel({ year: 2023, name: 'Model 3 Long Range', trim: 'L' }))
                .toBe('2023 Model 3 Long Range · L');
        });

        it('keeps a trim that is a longer phrase than the name carries', () => {
            expect(vehicleLabel({ year: 2023, name: 'Model Y Long Range', trim: 'Long Range AWD' }))
                .toBe('2023 Model Y Long Range · Long Range AWD');
        });

        it('does not match inside a number', () => {
            expect(vehicleLabel({ name: 'Model 30', trim: '3' })).toBe('Model 30 · 3');
        });
    });

    describe('a year already in the name', () => {
        it('is not prefixed a second time', () => {
            expect(vehicleLabel({ year: 2026, name: '2026 Model Y', trim: 'Premium AWD' }))
                .toBe('2026 Model Y · Premium AWD');
        });

        it('is kept when the name merely contains those digits inside a longer number', () => {
            expect(vehicleLabel({ year: 2026, name: 'Model 20260', trim: null }))
                .toBe('2026 Model 20260');
        });
    });

    describe('missing fields', () => {
        it('returns an empty string for no vehicle', () => {
            expect(vehicleLabel(null)).toBe('');
            expect(vehicleLabel(undefined)).toBe('');
            expect(vehicleLabel({})).toBe('');
        });

        it('leaves out a missing year or trim', () => {
            expect(vehicleLabel({ name: 'Lucid Air' })).toBe('Lucid Air');
            expect(vehicleLabel({ year: null, name: 'Lucid Air', trim: null })).toBe('Lucid Air');
            expect(vehicleLabel({ year: 2022, name: 'Lucid Air', trim: '' })).toBe('2022 Lucid Air');
            expect(vehicleLabel({ name: 'Lucid Air', trim: '  ' })).toBe('Lucid Air');
        });

        it('never prints "undefined" for a missing name', () => {
            expect(vehicleLabel({ year: 2022 })).toBe('2022');
            expect(vehicleLabel({ trim: 'Touring' })).toBe('Touring');
        });

        it('keeps a trim made only of punctuation as written', () => {
            expect(vehicleLabel({ name: 'Bolt', trim: '-' })).toBe('Bolt · -');
        });
    });

    it('feeds vehicleSearchText without the repeat', () => {
        const text = vehicleSearchText({ year: 2026, name: 'Model Y Premium AWD', trim: 'Premium AWD', make: 'Tesla' });
        expect(text).toBe('2026 model y premium awd tesla');
    });
});

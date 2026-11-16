import { describe, it, expect } from 'vitest';
import { parseNumberInput, spinFromPlaceholder, spinnerHit } from '../numberInput';

describe('parseNumberInput — what a number field commits', () => {
    const soc = { min: 0, max: 100, integer: true };

    it('commits a valid number', () => {
        expect(parseNumberInput('20', soc)).toEqual({ ok: true, n: 20 });
        expect(parseNumberInput('12.6', soc)).toEqual({ ok: true, n: 13 });
        expect(parseNumberInput('0.35', { min: 0.3, max: 5 })).toEqual({ ok: true, n: 0.35 });
    });

    it('commits nothing for an emptied box — not 0, not a floor, not the old value', () => {
        // Backspacing "100" to retype "20" used to commit 1 (a clamp's floor)
        // or 0 (Number('')), and the next digits appended to it: 120.
        expect(parseNumberInput('', soc)).toEqual({ ok: false });
        expect(parseNumberInput('  ', { min: 1 })).toEqual({ ok: false });
    });

    it('commits null for an emptied box that means "automatic"', () => {
        expect(parseNumberInput('', { allowEmpty: true })).toEqual({ ok: true, n: null });
    });

    it('commits nothing outside the range — it waits, it does not clamp', () => {
        expect(parseNumberInput('120', soc)).toEqual({ ok: false });
        expect(parseNumberInput('-5', soc)).toEqual({ ok: false });
        // On the way to "20" with a floor of 5, "2" is not committed as 5.
        expect(parseNumberInput('2', { min: 5 })).toEqual({ ok: false });
    });

    it('commits nothing for text that is not a number yet', () => {
        expect(parseNumberInput('-', {})).toEqual({ ok: false });
        expect(parseNumberInput('1e', {})).toEqual({ ok: false });
    });

    it('commits nothing off the step grid when asked to hold to it', () => {
        const miles = { min: 5, max: 400, onStep: 5 };
        expect(parseNumberInput('8', miles)).toEqual({ ok: false });
        expect(parseNumberInput('10', miles)).toEqual({ ok: true, n: 10 });
        const price = { min: 0.05, max: 0.6, onStep: 0.01 };
        expect(parseNumberInput('0.17', price)).toEqual({ ok: true, n: 0.17 });
        expect(parseNumberInput('0.175', price)).toEqual({ ok: false });
    });
});

describe('spinFromPlaceholder — an empty box spins from its placeholder', () => {
    const home = { min: 0, max: 0.6, step: 0.01 };
    it('goes one step up or down from the placeholder', () => {
        expect(spinFromPlaceholder('0.16', 'up', home)).toBe(0.17);
        expect(spinFromPlaceholder('0.16', 'down', home)).toBe(0.15);
        expect(spinFromPlaceholder('25', 'up', { min: 5, max: 60, step: 1 })).toBe(26);
        expect(spinFromPlaceholder('3.2', 'down', { min: 1, max: 8, step: 0.01 })).toBe(3.19);
    });
    it('keeps the placeholder\'s own decimals and shows no float noise', () => {
        expect(spinFromPlaceholder('0.1', 'up', { step: 0.2 })).toBe(0.3);
    });
    it('holds to the limits', () => {
        expect(spinFromPlaceholder('5', 'down', { min: 5, max: 60, step: 1 })).toBe(5);
        expect(spinFromPlaceholder('60', 'up', { min: 5, max: 60, step: 1 })).toBe(60);
    });
    it('defaults the step to 1 and ignores "any"', () => {
        expect(spinFromPlaceholder('10', 'up', { step: 'any' })).toBe(11);
        expect(spinFromPlaceholder('10', 'down', {})).toBe(9);
    });
    it('leaves a placeholder that is not a number to the browser', () => {
        expect(spinFromPlaceholder('Auto', 'up', home)).toBeNull();
        expect(spinFromPlaceholder('', 'up', home)).toBeNull();
        expect(spinFromPlaceholder(undefined, 'up', home)).toBeNull();
    });
});

describe('spinnerHit — which arrow a press hit', () => {
    const rect = { top: 0, bottom: 30, right: 100, height: 30 };
    it('is the right edge, upper half up and lower half down', () => {
        expect(spinnerHit(rect, 95, 5)).toBe('up');
        expect(spinnerHit(rect, 95, 25)).toBe('down');
    });
    it('is null on the text', () => {
        expect(spinnerHit(rect, 40, 5)).toBeNull();
        expect(spinnerHit(rect, 95, 40)).toBeNull();
    });
});

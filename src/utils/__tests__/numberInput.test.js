import { describe, it, expect } from 'vitest';
import { parseNumberInput } from '../numberInput';

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
});

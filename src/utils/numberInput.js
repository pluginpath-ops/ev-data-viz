/**
 * What a number field's text commits, if anything (NumberInput).
 *
 * `{ ok: false }` means "commit nothing": empty when empty is not allowed, not
 * a number yet ("-", "1e"), or outside [min, max]. The field keeps the text
 * and every figure keeps the last valid value. `integer` rounds what is
 * committed rather than rejecting a decimal mid-way. `onStep` (a step size)
 * also commits nothing off that step's grid from `min`: for a setting that is
 * stored on the grid, so the box never shows 8 while the figures use 10.
 *
 * Pure module.
 */
export function parseNumberInput(text, { min, max, integer = false, allowEmpty = false, onStep = null } = {}) {
    const t = String(text ?? '').trim();
    if (t === '') return allowEmpty ? { ok: true, n: null } : { ok: false };
    const n = Number(t);
    if (!Number.isFinite(n)) return { ok: false };
    if (min != null && min !== '' && n < Number(min)) return { ok: false };
    if (max != null && max !== '' && n > Number(max)) return { ok: false };
    if (onStep) {
        const k = (n - Number(min ?? 0)) / onStep;
        if (Math.abs(k - Math.round(k)) > 1e-6) return { ok: false };
    }
    return { ok: true, n: integer ? Math.round(n) : n };
}

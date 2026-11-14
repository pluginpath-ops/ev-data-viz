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

const decimalsOf = (step) => String(step).split('.')[1]?.length ?? 0;

/**
 * Where a spinner click lands from an EMPTY box that shows a number as its
 * placeholder: the placeholder moved one step, up or down, held to [min, max].
 * The browser would start from zero and so from `min`, which for "Electricity
 * at home" is 5¢, not the 16¢ the box suggests. `null` when the placeholder is
 * not a number ("Auto"): the browser's own step stands.
 *
 * @param {'up'|'down'} dir
 */
export function spinFromPlaceholder(placeholder, dir, { min, max, step } = {}) {
    const start = placeholder == null || String(placeholder).trim() === '' ? NaN : Number(placeholder);
    if (!Number.isFinite(start)) return null;
    const s = Number(step) > 0 ? Number(step) : 1;
    let n = start + (dir === 'up' ? s : -s);
    if (min != null && min !== '') n = Math.max(Number(min), n);
    if (max != null && max !== '') n = Math.min(Number(max), n);
    return Number(n.toFixed(Math.max(decimalsOf(s), decimalsOf(start))));
}

/** The width of a number box's spinner, px: where a press counts as a spinner click. */
const SPINNER_PX = 20;

/**
 * Which spinner arrow a press at (x, y) hit in a box with this rectangle, or
 * null when it was on the text. The arrows are native, so the press is all
 * there is to go on: the right edge, upper half up, lower half down.
 */
export function spinnerHit(rect, x, y) {
    if (x < rect.right - SPINNER_PX || x > rect.right || y < rect.top || y > rect.bottom) return null;
    return y < rect.top + rect.height / 2 ? 'up' : 'down';
}

/**
 * WCAG contrast arithmetic, and the alpha compositing it needs to be correct.
 *
 * Written because a dark-mode panel of inputs shipped unreadable three separate
 * times, each found by a person opening that screen and squinting. Nothing in
 * the test suite can see a colour, so the failure mode is invisible until
 * someone reports it — which is exactly the shape of defect worth spending a
 * test on.
 *
 * ── Compositing is not optional ─────────────────────────────────────────────
 *
 * The dark theme tints a status panel with `rgba(245, 158, 11, 0.1)` — a wash
 * over whatever is behind it — because a fixed tint cannot sit correctly on a
 * card, a sunken panel and the page body at once. Measuring text against that
 * declared value treats the amber as opaque and reports 1.49:1 for text that is
 * in fact at 11.85:1. A checker without `composite` does not merely lose
 * precision, it inverts the answer, and the first version of this check did
 * exactly that.
 */

/** Relative luminance per WCAG 2.x, on 0–255 channels. */
function luminance({ r, g, b }) {
    const chan = (v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

/**
 * `rgb()` / `rgba()` / `#rgb` / `#rrggbb` → { r, g, b, a }.
 *
 * Returns null rather than throwing on anything else — `transparent`, a
 * `var()` that did not resolve, a colour space this does not handle. A caller
 * sweeping a stylesheet meets those constantly and a null is a "skip", not a
 * failure.
 */
export function parseColor(input) {
    const s = String(input ?? '').trim().toLowerCase();
    if (!s) return null;

    const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/);
    if (hex) {
        const h = hex[1];
        const short = h.length <= 4;
        const part = (i) => {
            const t = short ? h[i].repeat(2) : h.slice(i * 2, i * 2 + 2);
            return parseInt(t, 16);
        };
        const hasAlpha = h.length === 4 || h.length === 8;
        return { r: part(0), g: part(1), b: part(2), a: hasAlpha ? part(3) / 255 : 1 };
    }

    const fn = s.match(/^rgba?\(([^)]+)\)$/);
    if (fn) {
        // Both the legacy comma form and the modern space/slash form.
        const parts = fn[1].replace(/\//g, ' ').split(/[\s,]+/).filter(Boolean).map(Number);
        if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return null;
        const [r, g, b] = parts;
        const a = parts.length > 3 && !Number.isNaN(parts[3]) ? parts[3] : 1;
        return { r, g, b, a };
    }

    return null;
}

/**
 * `fg` laid over `bg`, both already parsed. The result is opaque.
 *
 * `bg` is assumed opaque; a caller stacking several translucent layers folds
 * them from the bottom up, which is what `compositeStack` does.
 */
export function composite(fg, bg) {
    const a = fg.a ?? 1;
    return {
        r: fg.r * a + bg.r * (1 - a),
        g: fg.g * a + bg.g * (1 - a),
        b: fg.b * a + bg.b * (1 - a),
        a: 1,
    };
}

/**
 * Fold a stack of layers onto an opaque base, outermost layer LAST.
 *
 * Mirrors how a browser paints: the page body, then the card, then the tinted
 * panel on top of it.
 */
export function compositeStack(base, ...layers) {
    return layers.filter(Boolean).reduce((acc, layer) => composite(layer, acc), base);
}

/**
 * WCAG contrast ratio between two opaque colours, 1–21.
 *
 * Translucent input is a caller error rather than something to guess at: there
 * is no correct answer without knowing what is behind it, and quietly assuming
 * white is how a dark theme gets certified as passing.
 */
export function contrastRatio(fg, bg) {
    const a = luminance(fg);
    const b = luminance(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** WCAG AA: 4.5:1 for body text, 3:1 for large text (>=18.66px bold or 24px). */
export const AA_NORMAL = 4.5;
export const AA_LARGE = 3;

/** Ratio of two colour STRINGS, compositing `fg` and `bg` onto `base` first. */
export function ratioOf(fgStr, bgStr, baseStr = 'rgb(255, 255, 255)') {
    const base = parseColor(baseStr);
    const fg = parseColor(fgStr);
    const bg = parseColor(bgStr);
    if (!base || !fg || !bg) return null;
    const solidBg = compositeStack(base, bg);
    // Text can be translucent too, and it composites onto its OWN background
    // rather than onto the page — otherwise faint text reads as passing.
    const solidFg = compositeStack(solidBg, fg);
    return contrastRatio(solidFg, solidBg);
}

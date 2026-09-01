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
 * `oklch(L C H)` / `oklch(L C H / a)` → sRGB 0-255.
 *
 * Not an optional extra. **Tailwind v4 emits every palette colour as oklch**, so
 * `bg-blue-500` computes to `oklch(0.623 0.214 259.815)` and not to an rgb
 * triple. Without this, `parseColor` returned null for it, the surface was
 * skipped as if transparent, and the measurement fell through to the page
 * background — reporting white text on a blue button as 1.05:1 against white.
 *
 * The blind spot landed exactly where it hurt most: the classes still written
 * in raw Tailwind are the ones outside the token system, which are the ones
 * most likely to be wrong and least likely to be checked anywhere else.
 *
 * oklch → oklab → LMS → linear sRGB → gamma-encoded sRGB, per CSS Color 4.
 */
function parseOklch(s) {
    const m = s.match(/^oklch\(([^)]+)\)$/);
    if (!m) return null;
    const parts = m[1].replace(/\//g, ' ').split(/[\s,]+/).filter(Boolean);
    if (parts.length < 3) return null;

    const num = (t, scale = 1) => {
        const v = parseFloat(t);
        return Number.isNaN(v) ? null : (t.includes('%') ? v / 100 * scale : v);
    };
    const L = num(parts[0], 1);
    const C = num(parts[1], 0.4);        // percentage chroma is relative to 0.4
    const H = num(parts[2], 1);
    if (L == null || C == null || H == null) return null;
    const a4 = parts[3] != null ? num(parts[3], 1) : 1;

    const hRad = (H * Math.PI) / 180;
    const a = C * Math.cos(hRad);
    const b = C * Math.sin(hRad);

    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
    const l = l_ ** 3, mm = m_ ** 3, ss = s_ ** 3;

    const lin = [
        +4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * ss,
        -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * ss,
        -0.0041960863 * l - 0.7034186147 * mm + 1.7076147010 * ss,
    ];
    // Linear → sRGB, then clamp: a wide-gamut oklch can land outside sRGB, and
    // a negative channel would make luminance nonsense.
    const enc = lin.map((c) => {
        const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055;
        return Math.min(255, Math.max(0, Math.round(v * 255)));
    });
    return { r: enc[0], g: enc[1], b: enc[2], a: a4 ?? 1 };
}

/**
 * `rgb()` / `rgba()` / `oklch()` / `#rgb` / `#rrggbb` → { r, g, b, a }.
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

    if (s.startsWith('oklch(')) return parseOklch(s);

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

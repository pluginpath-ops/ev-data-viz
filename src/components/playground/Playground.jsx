import { useState, useRef, useEffect, useCallback } from 'react';
import { SECTIONS, OWNED_FAMILIES, hasDarkOverride } from './catalogue';
import { parseColor, compositeStack, contrastRatio, AA_NORMAL, AA_LARGE } from '../../utils/contrast';

/**
 * Every control the site is allowed to draw with, on one page, live.
 *
 * The problem it solves is that divergence is invisible one tab at a time. The
 * Vehicles tag filter and the EPA filter chip do the same job at two sizes in
 * two colour systems, and nobody saw it for months because the two are never on
 * screen together. Here they are three rows apart.
 *
 * ── Live, not a screenshot ─────────────────────────────────────────────────
 *
 * Specimens are real elements — a `button` you can focus, an `input` you can
 * type into — because half of what wants checking is hover, focus and disabled,
 * and a picture of a button has none of those.
 *
 * ── Contrast is measured here, not asserted ────────────────────────────────
 *
 * `contrast.test.js` guards the TOKENS. This measures what the browser actually
 * painted, which catches the other half: a class that resolves to a colour
 * pairing nobody declared. It reads from the live DOM through the same
 * compositing the test uses, so the two agree by construction rather than by
 * two implementations happening to match.
 */

/** The effective background behind an element, folding translucent layers. */
function effectiveBackground(el) {
    const layers = [];
    let node = el;
    while (node && node !== document.documentElement) {
        const c = parseColor(getComputedStyle(node).backgroundColor);
        if (c && c.a > 0) layers.push(c);
        if (c && c.a === 1) break;
        node = node.parentElement;
    }
    const body = parseColor(getComputedStyle(document.body).backgroundColor);
    const base = body && body.a === 1 ? body : { r: 255, g: 255, b: 255, a: 1 };
    // Outermost layer last: the page, then the card, then the tint on top.
    return compositeStack(base, ...layers.reverse());
}

/** Measured contrast of an element's own text against what it sits on. */
function measure(el) {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const bg = effectiveBackground(el);
    const fg = parseColor(cs.color);
    if (!fg) return null;
    const ratio = contrastRatio(compositeStack(bg, fg), bg);
    // Large-text allowance, per WCAG: 18.66px bold, or 24px at any weight.
    const px = parseFloat(cs.fontSize);
    const bold = Number(cs.fontWeight) >= 700;
    const floor = (px >= 24 || (bold && px >= 18.66)) ? AA_LARGE : AA_NORMAL;
    return { ratio, floor, px: Math.round(px), weight: cs.fontWeight };
}

function Specimen({ spec }) {
    const ref = useRef(null);
    const [reading, setReading] = useState(null);

    // `minRatio` lets the catalogue record a DELIBERATE lower bar — text meant
    // to recede, held to the 3:1 large-text floor. Without it those two
    // specimens sit permanently red, and a badge that is always red for a
    // decision someone already made teaches people to stop reading badges.
    const remeasure = useCallback(() => {
        const m = measure(ref.current);
        setReading(m && spec.minRatio ? { ...m, floor: spec.minRatio, relaxed: true } : m);
    }, [spec.minRatio]);

    useEffect(() => {
        // After paint, not during the effect. A measurement taken in the same
        // tick as the mount can read the element before the stylesheet has been
        // applied to it, which returns the browser defaults — and a default of
        // black-on-transparent produced a confident 1.05:1 for a chip that is
        // really at 5.6:1. Two frames, because the first only guarantees layout.
        let raf = requestAnimationFrame(() => { raf = requestAnimationFrame(remeasure); });

        // The theme is switched by an attribute on <html>, and every colour on
        // the page moves with it. Without this the numbers keep describing the
        // theme you were in when the page loaded.
        const obs = new MutationObserver(remeasure);
        obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

        // Webfonts and a late stylesheet both change what is painted after the
        // first frames, and neither touches data-theme.
        window.addEventListener('load', remeasure);
        return () => {
            cancelAnimationFrame(raf);
            obs.disconnect();
            window.removeEventListener('load', remeasure);
        };
    }, [remeasure]);

    const El = spec.as === 'button' ? 'button' : spec.as === 'input' ? 'input'
        : spec.as === 'select' ? 'select' : spec.as === 'textarea' ? 'textarea' : 'span';

    const common = { ref, className: spec.cls };
    const node = spec.as === 'input'
        ? <El {...common} defaultValue="42" placeholder="—" />
        : spec.as === 'textarea'
            ? <El {...common} defaultValue="Multi-line text" rows={2} />
            : spec.as === 'select'
                ? <El {...common}><option>Choose…</option><option>Another</option></El>
                : <El {...common} type={spec.as === 'button' ? 'button' : undefined}>{spec.label}</El>;

    const pass = reading && reading.ratio >= reading.floor;

    return (
        <div className="pg-specimen">
            <div className="pg-specimen-stage">{node}</div>
            <div className="pg-specimen-meta">
                <code className="pg-specimen-cls">{spec.cls}</code>
                {reading && (
                    <span className={`pg-ratio ${pass ? 'is-pass' : 'is-fail'}`}
                        title={`${reading.px}px / weight ${reading.weight} — needs ${reading.floor}:1`
                            + (reading.relaxed ? ' (deliberately quiet, held to the large-text floor)' : '')}>
                        {reading.ratio.toFixed(2)}:1
                    </span>
                )}
                {hasDarkOverride(spec.cls) && (
                    <span className="pg-unscoped" title={
                        'Styled by a [data-theme="dark"] override rather than tokens, so it '
                        + 'cannot follow a themed subtree — in the side-by-side view below it '
                        + 'keeps the document theme. This is the #277 migration backlog.'
                    }>doc-theme only</span>
                )}
                {spec.note && <span className="pg-specimen-note">{spec.note}</span>}
            </div>
        </div>
    );
}

/** The colour tokens, both roles of each, measured against their own surface. */
function TokenGrid() {
    const [tokens, setTokens] = useState([]);

    useEffect(() => {
        const read = () => {
            const cs = getComputedStyle(document.documentElement);
            const val = (n) => cs.getPropertyValue(n).trim();
            const intents = ['primary', 'warning', 'danger', 'success'];
            setTokens(intents.map(intent => ({
                intent,
                solid:   val(`--color-${intent}`),
                surface: val(`--color-${intent}-surface`),
                border:  val(`--color-${intent}-border`),
                text:    val(`--color-${intent}-text`),
            })));
        };
        read();
        const obs = new MutationObserver(read);
        obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
        return () => obs.disconnect();
    }, []);

    return (
        <div className="pg-token-grid">
            {tokens.map(t => (
                <div key={t.intent} className="pg-token-card"
                    style={{ backgroundColor: t.surface, borderColor: t.border, color: t.text }}>
                    <div className="pg-token-name">{t.intent}</div>
                    <div className="pg-token-swatches">
                        <span className="pg-token-swatch" style={{ backgroundColor: t.solid }} title={`--color-${t.intent}: ${t.solid}`} />
                        <span className="pg-token-swatch" style={{ backgroundColor: t.surface, borderColor: t.border }} title={`--color-${t.intent}-surface: ${t.surface}`} />
                    </div>
                    <div className="pg-token-sample">Text on surface</div>
                </div>
            ))}
        </div>
    );
}

/**
 * One section's specimens, optionally rendered once per theme side by side.
 *
 * The palette is re-declared on the wrapper rather than on the document, which
 * is what `:root, [data-theme="light"]` in index.css buys: both themes on
 * screen at once, which is the only way to see that a control changed weight
 * or lost its border between them.
 */
function SpecimenSet({ specimens, split }) {
    const body = (
        <div className="pg-specimens">
            {specimens.map(s => <Specimen key={s.cls + s.label} spec={s} />)}
        </div>
    );
    if (!split) return body;
    return (
        <div className="pg-split">
            {['light', 'dark'].map(theme => (
                <div key={theme} data-theme={theme} className="pg-split-pane">
                    <div className="pg-split-label">{theme}</div>
                    <div className="pg-specimens">
                        {specimens.map(s => <Specimen key={s.cls + s.label} spec={s} />)}
                    </div>
                </div>
            ))}
        </div>
    );
}

export default function Playground() {
    // Local to the page: flipping the whole site's theme to compare would lose
    // the comparison, which is the thing being made.
    const [side, setSide] = useState(false);

    return (
        <div className="pg-root">
            <div className="pg-intro">
                <p className="text-body">
                    Every catalogued control, live and interactive. Hover, focus and type
                    into them — the states are the point. The number beside each is its
                    measured contrast against what it actually sits on, in the theme you
                    are currently in; it turns red below the WCAG AA floor for that size.
                </p>
                <p className="text-hint">
                    A class in an owned family that is missing here fails{' '}
                    <code>playground.test.js</code>. Owned:{' '}
                    {OWNED_FAMILIES.map(f => f.label).join(', ')}.
                </p>
                <button type="button" className="btn btn-sm btn-secondary"
                    onClick={() => setSide(s => !s)}>
                    {side ? 'Single column' : 'Compare both themes'}
                </button>
            </div>

            <section className="pg-section">
                <h3 className="section-title">Status colour tokens</h3>
                <p className="text-hint pg-blurb">
                    The triad each status carries: a solid fill, and a tinted surface with
                    a matching border and readable text. Every card below is drawn from its
                    own tokens.
                </p>
                <TokenGrid />
            </section>

            {SECTIONS.map(section => (
                <section key={section.id} className="pg-section">
                    <h3 className="section-title">{section.title}</h3>
                    {section.blurb && <p className="text-hint pg-blurb">{section.blurb}</p>}
                    <SpecimenSet specimens={section.specimens} split={side} />
                </section>
            ))}
        </div>
    );
}

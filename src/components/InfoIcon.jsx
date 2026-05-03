/**
 * InfoIcon — a small ⓘ glyph with a CSS-only hover tooltip.
 *
 * No JavaScript, no library, no new npm packages. The tooltip is positioned
 * via a sibling element inside a `position: relative` wrapper; visibility is
 * toggled by the `.info-icon:hover .info-icon-tooltip` CSS rule in index.css.
 *
 * Props:
 *   text      {string}  — tooltip text (plain string; no HTML)
 *   position  {'above'|'below'|'right'}  — tooltip placement (default: 'above')
 *   className {string}  — extra classes on the wrapper span
 */
export default function InfoIcon({ text, position = 'above', className = '' }) {
    return (
        <span className={`info-icon ${className}`} aria-label={text} role="img">
            <span className="info-icon-glyph">ⓘ</span>
            <span className={`info-icon-tooltip info-icon-tooltip--${position}`}>
                {text}
            </span>
        </span>
    );
}

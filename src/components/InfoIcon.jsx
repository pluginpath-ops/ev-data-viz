/**
 * InfoIcon — a small ⓘ glyph with a CSS-only hover tooltip.
 *
 * No JavaScript, no library, no new npm packages. The tooltip is positioned
 * via a sibling element inside a `position: relative` wrapper; visibility is
 * toggled by the `.info-icon:hover .info-icon-tooltip` CSS rule in index.css.
 *
 * Props:
 *   text             {string}  — tooltip text (plain string; no HTML). Ignored if `children` is given.
 *   children         {node}    — richer tooltip content (e.g. a reference table), in place of `text`
 *   position         {'above'|'below'|'right'}  — tooltip placement (default: 'above')
 *   className        {string}  — extra classes on the wrapper span
 *   tooltipClassName {string}  — extra classes on the tooltip bubble itself (e.g. a width override)
 */
export default function InfoIcon({ text, children, position = 'above', className = '', tooltipClassName = '' }) {
    return (
        <span className={`info-icon ${className}`} aria-label={typeof text === 'string' ? text : undefined} role="img">
            <span className="info-icon-glyph">ⓘ</span>
            <span className={`info-icon-tooltip info-icon-tooltip--${position} ${tooltipClassName}`}>
                {children ?? text}
            </span>
        </span>
    );
}

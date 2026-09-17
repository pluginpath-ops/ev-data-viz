/**
 * One data cell of a sortable table, shared by the FE Guide table and the
 * vehicle table (#235, #315).
 *
 * Columns have fixed widths, so a long value clips to an ellipsis rather than
 * widening its column. Opening the row to read the rest takes the reader out of
 * the table, so a clipped cell is restated in a peek over the whole cell. The
 * cell only says WHAT it would restate (`data-restate`); the table's one
 * `useCellPeek` decides whether it is clipped and shows it.
 *
 * Words and figures are drawn differently, on purpose. A figure is compared
 * down its column, so it keeps body size on one line. Words are read to
 * identify something, so they step down one size and wrap to two lines — which
 * costs no height, because a figure's value, bar and note already make the row
 * taller than two lines of the smaller size. Past two lines the peek restates.
 *
 * A FLAGGED cell (a community member marked the value as possibly inaccurate)
 * carries a corner mark and always peeks, clipped or not, because the flag is
 * the thing the reader needs to hear. The corner, not inline: a mark beside
 * the value would take width from a fixed column and wrap a line that fits.
 * Flagging and clearing stay in View Specs; the table only shows the state.
 *
 * `onClick` is for a cell that does something other than its row: both tables
 * make the name cell pick the row, and every other cell opens the details.
 *
 * Children, when given, replace the default content (the name cells carry a
 * swatch or badges, and wrap their name with `.guide-cell-name`). Otherwise the
 * cell draws its text, and beneath it the bar and the note when there are any.
 */

/**
 * True when this element or anything inside it overflows its box — sideways
 * for a one-line ellipsis, downward for text clamped at two lines.
 */
export function isClipped(el) {
    if (!el) return false;
    const clipped = (node) => node.scrollWidth > node.clientWidth + 1
        || node.scrollHeight > node.clientHeight + 1;
    return clipped(el) || [...el.querySelectorAll('*')].some(clipped);
}

export const FLAGGED_NOTE = 'Flagged as possibly inaccurate';

export default function TableCell({
    text, note = null, pct = null, numeric = false, flagged = false, restate, className = '', onClick, children,
}) {
    const said = restate ?? (note ? `${text} · ${note}` : text);
    // A flag can sit on a blank (someone thinks a value is missing), and
    // "— · Flagged" reads as a typo rather than as that.
    const full = flagged ? `${text === '\u2014' && !restate ? 'No value' : said} · ${FLAGGED_NOTE}` : said;
    const hasStack = pct != null || note;
    const words = !numeric && !hasStack && !children;
    return (
        <td
            className={`guide-td ${numeric ? 'numeric' : 'wraps'} ${flagged ? 'is-flagged' : ''} ${className}`}
            data-restate={full || undefined}
            data-peek={flagged ? 'always' : undefined}
            onClick={onClick}
        >
            {flagged && <span className="guide-td-flag" aria-label={FLAGGED_NOTE}>{'\u2691'}</span>}
            {children ?? (hasStack ? (
                <span className="guide-cell-stack">
                    <span>{text}</span>
                    {/* The value, then its bar beneath it. */}
                    {pct != null && <span className="guide-spark" style={{ '--bar-fill': `${pct}%` }} aria-hidden="true" />}
                    {/* Where a resolved or tested figure came from. */}
                    {note && <span className="vehicle-table-note">{note}</span>}
                </span>
            ) : words ? <span className="guide-cell-text">{text}</span> : text)}
        </td>
    );
}

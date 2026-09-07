import Popover from './Popover';

/**
 * A ⓘ glyph that explains the thing beside it.
 *
 * The floating behaviour — peek on hover, panel on click, sheet on a narrow
 * screen, placement, dismissal, focus — all belongs to `Popover`. What is left
 * here is the two things that are actually about an info icon: the glyph, and
 * the rule for which tier a call site gets.
 *
 * ── The tier comes from the content, not the call site ──────────────────────
 *
 * `children` means there is structure worth opening — a reference table, a set
 * of defined terms — so the glyph gets a panel and `text` becomes the gloss its
 * peek shows. `text` alone is an explainer: a paragraph, peek only, with
 * nothing in it to interact with.
 *
 * A caller therefore never picks a tier, a placement or a width. Letting them
 * is what produced the thing that opened #284 — eight tooltips in one 320px
 * column with five widths between them.
 *
 * Props:
 *   text     {string}  the gloss. Alone: the whole explainer. With children:
 *                      what the peek shows before the panel is opened
 *   title    {string}  header for the panel. Defaults to "Reference"
 *   children {node}    the panel body — a table, sections, defined terms
 *   className {string} extra classes on the wrapper
 */
export default function InfoIcon({ text, title, children, className = '' }) {
    return (
        <Popover
            className={`info-icon ${className}`.trim()}
            peek={
                <>
                    {text}
                    {children && <span className="popover-more">Click ⓘ for the full panel</span>}
                </>
            }
            // Always titled, so the sheet an explainer becomes on a narrow
            // screen still has a header to dismiss it by.
            title={title || 'Reference'}
            trigger={props => (
                <button
                    {...props}
                    type="button"
                    className="info-icon-glyph"
                    aria-label={title ? `More information: ${title}` : 'More information'}
                >
                    ⓘ
                </button>
            )}
        >
            {children}
        </Popover>
    );
}

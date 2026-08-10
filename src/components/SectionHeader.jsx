/**
 * The heading of a Tests & Data sub-tab, with its actions beside it.
 *
 * Each of the four tabs had grown its own header: two used `section-title`, one
 * used a small uppercase label, and one had no header at all because the page
 * header stood in for it — a page header that also advertised "Add new record"
 * on the EPA tab, where it did nothing useful.
 *
 * Actions here are boxed pills rather than text links. On a long tab a bare
 * coloured word reads as prose until you hover it; a box says it is a control
 * before anyone tries. The originals stay where they are — these sections run
 * long enough that an action is worth having at both ends.
 */
export default function SectionHeader({ title, info, actions, trailing }) {
    return (
        <div className="section-header">
            <h3 className="section-title section-header-title">
                {title}
                {info}
            </h3>
            {actions && <div className="section-header-actions">{actions}</div>}
            {trailing && <div className="section-header-trailing">{trailing}</div>}
        </div>
    );
}

/** A header action. Styled once here so the four tabs cannot drift apart. */
export function SectionAction({ onClick, children, title }) {
    return (
        <button type="button" onClick={onClick} title={title} className="section-action">
            {children}
        </button>
    );
}

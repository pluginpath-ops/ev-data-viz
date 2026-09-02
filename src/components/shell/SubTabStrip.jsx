/**
 * The 38px strip under the main nav — second-level navigation for a section.
 *
 * It is painted in the active tab's own fill, continued downward, and that is
 * the point rather than a decoration: a sub-tab then reads as being INSIDE the
 * section you are standing in, not as a second row of buttons stacked beneath
 * it. Two levels, two signals — blue says which section, orange says which view
 * inside it is live. A section with no sub-tabs renders no strip at all, so the
 * fill simply ends at the tab.
 *
 * Shared because the same strip is drawn in four places today, each by its own
 * copy of the markup: the chart categories here in the nav, and Tests & Data,
 * EPA and Admin inside their own views. Those three still carry their private
 * copies; moving them onto this component is the follow-up that makes the
 * "one fill continued" promise true everywhere rather than only in the nav.
 */
export default function SubTabStrip({ items, activeKey, onSelect, end = null }) {
    if (!items?.length) return null;

    return (
        <div className="subtab-strip">
            <div className="subtab-strip-items">
                {items.map(({ key, label, disabled }) => (
                    <button
                        key={key}
                        type="button"
                        onClick={() => onSelect(key)}
                        disabled={disabled}
                        aria-current={key === activeKey ? 'page' : undefined}
                        className={`btn-subtab ${key === activeKey ? 'active' : ''}`}
                    >
                        {label}
                    </button>
                ))}
            </div>
            {end && <div className="subtab-strip-end">{end}</div>}
        </div>
    );
}

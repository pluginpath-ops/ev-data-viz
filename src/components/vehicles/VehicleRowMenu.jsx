import MenuButton from '../shell/MenuButton';

/**
 * The end of a List row after Tests & Data (#338): everything else done TO a
 * vehicle — Specs, Edit, Copy, Variant, Delete — in one place, so every row has
 * the same actions in the same width and the columns line up.
 *
 * Several actions are a ⋯ menu. ONE action is simply its button: a signed-out
 * reader's only action is Specs, and a menu holding one item hides it behind a
 * click for nothing. None is an empty slot. All three take the same fixed
 * width (.vehicle-row-more), so Tests & Data sits in the same place on every
 * row.
 *
 * The caller builds the items, so the menu and the card's buttons stay one set
 * of handlers. An item is { key, label, onClick, danger?, disabled?, title? }.
 */
export default function VehicleRowMenu({ label, items }) {
    const shown = items.filter(Boolean);
    if (shown.length === 0) return <span className="vehicle-row-more" aria-hidden="true" />;
    if (shown.length === 1) {
        const [item] = shown;
        return (
            <span className="vehicle-row-more">
                <button
                    type="button"
                    className={`btn ${item.danger ? 'btn-danger' : 'btn-secondary'}`}
                    disabled={item.disabled}
                    title={item.title}
                    onClick={(e) => { e.stopPropagation(); item.onClick(e); }}
                >
                    {item.label}
                </button>
            </span>
        );
    }
    return (
        <span className="vehicle-row-more">
            <MenuButton
                label="⋯"
                buttonClass="vehicle-row-menu-btn"
                ariaLabel={`More for ${label}`}
                title="More"
                panelClass="vehicle-row-menu"
            >
                {({ close }) => (
                    <div role="menu" className="vehicle-row-menu-list">
                        {shown.map(item => (
                            <button
                                key={item.key}
                                type="button"
                                role="menuitem"
                                className={`nav-menu-item${item.danger ? ' is-danger' : ''}`}
                                disabled={item.disabled}
                                title={item.title}
                                onClick={(e) => { e.stopPropagation(); close(); item.onClick(e); }}
                            >
                                <span className="nav-menu-item-label">{item.label}</span>
                            </button>
                        ))}
                    </div>
                )}
            </MenuButton>
        </span>
    );
}

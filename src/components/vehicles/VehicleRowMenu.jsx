import MenuButton from '../shell/MenuButton';

/**
 * A list row's ⋯ menu (#338): everything done TO a vehicle besides opening
 * its tests — Specs, Edit, Copy, Variant, Delete — in one place, so every row
 * has the same actions in the same width and the columns line up.
 *
 * The caller builds the items, so the menu and the card's buttons stay one
 * set of handlers. An item is { key, label, onClick, danger?, disabled?,
 * title? }. A menu with nothing in it is not drawn.
 */
export default function VehicleRowMenu({ label, items }) {
    const shown = items.filter(Boolean);
    if (!shown.length) return <span className="vehicle-row-menu-slot" aria-hidden="true" />;
    return (
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
    );
}

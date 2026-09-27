import { useIsCompact } from '../../hooks/useIsCompact';
import NavMenu from './NavMenu';
import AccountMenu from './AccountMenu';
import { modeNeedsSelection } from '../../constants/chartNav';

/**
 * The 50px chrome bar: wordmark, top-level tabs, account block.
 *
 * Extracted from App.jsx, which carried the whole shell inline. What it
 * replaced was two headers and a nav: a ~140px photo hero on the Vehicles tab,
 * a 48px title bar on every other tab, and the nav as a third band beneath
 * whichever of the two was showing. The hero is the design brief's fourth
 * diagnosis — it cost the height of a row of cards and said nothing a returning
 * reader needed — so the identity it carried moved into this bar and the height
 * went back to the content.
 *
 * The bar is full-bleed rather than held to the page column: it is chrome, and
 * chrome runs to the edge of the window. Only the content below it is centred.
 *
 * ── The tabs are DATA now, and below 1000px they are a menu ──────────────────
 *
 * The six tabs were six hand-written buttons, three of them variations on the
 * same gate. They are one array, rendered as a row when it fits and as a menu
 * when it does not — which is the only way both forms can be guaranteed to
 * offer the same six destinations.
 *
 * They did not fit on a phone and never had. At 375px the wordmark takes 139px
 * and the old `Sign In` button 111px, leaving 125px for ~630px of labels: the
 * row scrolled, inside a box with `scrollbar-width: none`, so five of the six
 * tabs were not merely awkward to reach but invisible and unreachable.
 */
export default function AppNav({
    view,
    chartCategories,
    openedVehicle = null,
    openedActive = false,
    onOpenVehicle,
    onCloseVehicle,
    onHome,
    hasSelection,
    isAdmin,
    user,
    userRole,
    units,
    onToggleUnits,
    onNavigate,
    onNavigateChartCategory,
    onSignIn,
    onSignOut,
}) {
    const compact = useIsCompact();

    /**
     * Every top-level destination, once.
     *
     * `chart: true` marks the ones that route through the chart-category
     * navigator rather than the plain one — the single thing that differed
     * between the buttons this replaced.
     */
    const items = [
        // Vehicles & Specs (#338): the cards and list, and — drawn under it —
        // the vehicle table and the spec chart. Specs are front and center by
        // being in the first tab's name, not by a tab of their own.
        { key: 'vehicles', label: 'Vehicles & Specs' },
        // Tests & Data is no longer a tab (#338): it is one vehicle's page,
        // opened from a card, row, chip or tested figure, and shown in the
        // header as the opened vehicle beneath Vehicles & Specs.
        // One top-level tab per chart category (those drawn under another tab
        // are left out by the caller). They plot the vehicle selection, so
        // they wait for one, unless a mode inside can show something without
        // it.
        ...chartCategories.map(({ key, label, modes }) => {
            const gated = !hasSelection && modes.every(modeNeedsSelection);
            return {
                key,
                label,
                chart: true,
                disabled: gated,
                hint: gated ? 'Select a vehicle first' : undefined,
            };
        }),
        // Reference data, not a chart: the guide covers every EV EPA has rated,
        // so it is deliberately NOT gated on a vehicle selection the way the
        // chart categories above are.
        { key: 'epa', label: 'EPA' },
        // Reference (#338): what is true of every EV, selected or not —
        // platforms and explainers. Not gated on a selection, like EPA.
        { key: 'reference', label: 'Reference' },
        ...(isAdmin ? [{ key: 'admin', label: 'Admin' }] : []),
    ];

    // Collapsed, the opened vehicle is a menu item of its own, after its tab.
    const OPENED = 'opened-vehicle';
    const menuItems = openedVehicle
        ? items.flatMap(i => (i.key === 'vehicles' ? [i, { key: OPENED, label: `↳ ${openedVehicle.name}` }] : [i]))
        : items;

    const select = (key) => {
        if (key === OPENED) { onOpenVehicle?.(); return; }
        const item = items.find(i => i.key === key);
        if (!item || item.disabled) return;
        if (item.chart) onNavigateChartCategory(key);
        else onNavigate(key);
    };

    return (
        <div className="app-nav-bar">
            <button
                type="button"
                onClick={() => (onHome ?? onNavigate)('vehicles')}
                className="app-wordmark"
                title="EVBench — home"
            >
                <span className="app-wordmark-mark" aria-hidden="true" />
                <span>EV<span className="app-wordmark-bench">BENCH</span></span>
            </button>

            {compact ? (
                <NavMenu items={menuItems} activeKey={openedActive ? OPENED : view} onSelect={select} level="main" />
            ) : (
                <div className="nav-tab-group">
                    {items.map(({ key, label, disabled, hint }) => {
                        const tab = (
                            <button
                                key={key}
                                type="button"
                                onClick={() => select(key)}
                                disabled={disabled}
                                className={`btn-tab ${view === key ? 'active' : ''}`}
                                title={hint}
                            >
                                {label}
                            </button>
                        );
                        if (key !== 'vehicles') return tab;
                        // The opened vehicle (#338), in the tab's own cell below
                        // its label: visible from every tab, never a chip, and
                        // absolutely placed so opening one moves nothing.
                        return (
                            <div key={key} className="nav-tab-cell">
                                {tab}
                                {openedVehicle && (
                                    <span className="opened-vehicle">
                                        <button
                                            type="button"
                                            className={`opened-vehicle-link ${openedActive ? 'active' : ''}`}
                                            onClick={onOpenVehicle}
                                            aria-current={openedActive ? 'page' : undefined}
                                            title={`Open ${openedVehicle.name}’s tests and data`}
                                        >
                                            ↳ {openedVehicle.name}
                                        </button>
                                        <button
                                            type="button"
                                            className="opened-vehicle-close"
                                            onClick={onCloseVehicle}
                                            aria-label={`Close ${openedVehicle.name}`}
                                            title="Close vehicle"
                                        >
                                            ×
                                        </button>
                                    </span>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            <div className="nav-actions">
                <AccountMenu
                    user={user}
                    userRole={userRole}
                    units={units}
                    onToggleUnits={onToggleUnits}
                    onSignIn={onSignIn}
                    onSignOut={onSignOut}
                />
            </div>
        </div>
    );
}

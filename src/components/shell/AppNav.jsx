import { useIsCompact } from '../../hooks/useIsCompact';
import NavMenu from './NavMenu';
import AccountMenu from './AccountMenu';

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
    activeVehicle,
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
        { key: 'vehicles', label: 'Vehicles' },
        {
            key: 'runs',
            label: 'Tests & Data',
            disabled: !activeVehicle,
            hint: activeVehicle ? activeVehicle.name : 'Select a vehicle first',
        },
        // One top-level tab per chart category. All are driven by the current
        // vehicle selection, so they share the same gate.
        ...chartCategories.map(({ key, label }) => ({
            key,
            label,
            chart: true,
            disabled: !hasSelection,
            hint: hasSelection ? undefined : 'Select a vehicle first',
        })),
        // Reference data, not a chart: the guide covers every EV EPA has rated,
        // so it is deliberately NOT gated on a vehicle selection the way the
        // chart categories above are.
        { key: 'epa', label: 'EPA' },
        ...(isAdmin ? [{ key: 'admin', label: 'Admin' }] : []),
    ];

    const select = (key) => {
        const item = items.find(i => i.key === key);
        if (!item || item.disabled) return;
        if (item.chart) onNavigateChartCategory(key);
        else onNavigate(key);
    };

    return (
        <div className="app-nav-bar">
            <button
                type="button"
                onClick={() => onNavigate('vehicles')}
                className="app-wordmark"
                title="EVBench — home"
            >
                <span className="app-wordmark-mark" aria-hidden="true" />
                <span>EV<span className="app-wordmark-bench">BENCH</span></span>
            </button>

            {compact ? (
                <NavMenu items={items} activeKey={view} onSelect={select} level="main" />
            ) : (
                <div className="nav-tab-group">
                    {items.map(({ key, label, disabled, hint }) => (
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
                    ))}
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

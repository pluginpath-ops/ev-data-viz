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
 */
export default function AppNav({
    view,
    chartCategories,
    activeVehicle,
    hasSelection,
    isAdmin,
    user,
    userRole,
    onNavigate,
    onNavigateChartCategory,
    onSignIn,
    onSignOut,
}) {
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

            <div className="nav-tab-group">
                <button
                    type="button"
                    onClick={() => onNavigate('vehicles')}
                    className={`btn-tab ${view === 'vehicles' ? 'active' : ''}`}
                >
                    Vehicles
                </button>
                <button
                    type="button"
                    onClick={() => activeVehicle && onNavigate('runs')}
                    disabled={!activeVehicle}
                    className={`btn-tab ${view === 'runs' ? 'active' : ''}`}
                    title={activeVehicle ? activeVehicle.name : 'Select a vehicle first'}
                >
                    Tests &amp; Data
                </button>
                {/* One top-level tab per chart category. All are driven by the
                    current vehicle selection, so they share the same gate. */}
                {chartCategories.map(({ key, label }) => (
                    <button
                        key={key}
                        type="button"
                        onClick={() => hasSelection && onNavigateChartCategory(key)}
                        disabled={!hasSelection}
                        className={`btn-tab ${view === key ? 'active' : ''}`}
                    >
                        {label}
                    </button>
                ))}
                {/* Reference data, not a chart: the guide covers every EV EPA has
                    rated, so it is deliberately NOT gated on a vehicle selection
                    the way the chart categories above are. */}
                <button
                    type="button"
                    onClick={() => onNavigate('epa')}
                    className={`btn-tab ${view === 'epa' ? 'active' : ''}`}
                >
                    EPA
                </button>
                {isAdmin && (
                    <button
                        type="button"
                        onClick={() => onNavigate('admin')}
                        className={`btn-tab ${view === 'admin' ? 'active' : ''}`}
                    >
                        Admin
                    </button>
                )}
            </div>

            <div className="nav-actions">
                {user ? (
                    <>
                        <span className="text-meta">{user.email}</span>
                        {userRole && userRole !== 'user' && (
                            <span className="owner-badge">{userRole.toUpperCase()}</span>
                        )}
                        <button type="button" onClick={onSignOut} className="btn btn-secondary">
                            Sign Out
                        </button>
                    </>
                ) : (
                    <button type="button" onClick={onSignIn} className="btn btn-primary">
                        Sign In
                    </button>
                )}
            </div>
        </div>
    );
}

/**
 * Composite specimens — the ones that are only meaningful assembled.
 *
 * A `.guide-facet-panel` on its own is an empty rounded box; the thing worth
 * checking is the option rows inside it, their hover, and the disabled state
 * that says "this filter would leave nothing". Same for a plot frame, a
 * distribution bar, a stat cell.
 *
 * Kept OUT of `catalogue.js` on purpose: that file is imported by
 * `scripts/health.js` in plain node, which cannot parse JSX. The catalogue
 * names a composite by key and this file supplies the markup, so the data and
 * the rendering stay on opposite sides of that line.
 */

export const COMPOSITES = {
    'facet-panel': () => (
        <div className="menu-button" style={{ position: 'static' }}>
            <button type="button" className="guide-facet-btn active">
                Make
                <span className="guide-facet-btn-value">Rivian</span>
                <span className="disclosure-caret guide-facet-caret" aria-hidden="true">▾</span>
            </button>
            <div className="guide-facet-panel" style={{ position: 'static', marginTop: 4 }}>
                <div className="guide-facet-panel-head">
                    <span className="text-nano">1 of 36 · by count</span>
                    <button type="button" className="section-action">clear</button>
                </div>
                <div className="guide-facet-panel-list">
                    <label className="guide-facet-option selected">
                        <input type="checkbox" defaultChecked readOnly />
                        <span className="guide-facet-option-name">Rivian</span>
                        <span className="guide-facet-option-count">171</span>
                    </label>
                    <label className="guide-facet-option">
                        <input type="checkbox" readOnly />
                        <span className="guide-facet-option-name">BMW</span>
                        <span className="guide-facet-option-count">125</span>
                    </label>
                    {/* Disabled, not hidden: a make vanishing reads as a bug,
                        where a greyed one reads as an answer. */}
                    <label className="guide-facet-option">
                        <input type="checkbox" disabled readOnly />
                        <span className="guide-facet-option-name">Lotus</span>
                        <span className="guide-facet-option-count">0</span>
                    </label>
                </div>
                <div className="guide-facet-panel-foot">
                    <span className="text-nano">3 shown</span>
                    <button type="button" className="btn btn-secondary">Done</button>
                </div>
            </div>
        </div>
    ),

    'account-menu': () => (
        <div className="account-menu" style={{ position: 'static' }}>
            <div className="account-panel" style={{ position: 'static' }}>
                <div className="account-identity">
                    <span className="account-email">greg@evbench.io</span>
                    <span className="owner-badge">ADMIN</span>
                </div>
                <div className="account-row">
                    <span className="text-nano">Units</span>
                    <div className="account-segmented">
                        <button type="button" className="active">Imperial</button>
                        <button type="button">Metric</button>
                    </div>
                </div>
                <button type="button" className="btn btn-secondary account-action">Sign out</button>
            </div>
        </div>
    ),

    /* Both nav levels collapse to this below 1000px. The button shows where you
       ARE — "EPA ▾", not "Menu" — so the bar still answers "which section is
       this" after it has given up showing its own items. */
    'nav-menu': () => (
        <div className="nav-menu nav-menu-main" style={{ position: 'static', height: 50 }}>
            <button type="button" className="nav-menu-btn">
                <span className="nav-menu-current">EPA</span>
                <span className="disclosure-caret nav-menu-caret" aria-hidden="true">▾</span>
            </button>
            <div className="nav-menu-panel" style={{ position: 'static', marginTop: 4 }}>
                <button type="button" className="nav-menu-item active">
                    <span className="nav-menu-item-label">EPA</span>
                </button>
                <button type="button" className="nav-menu-item">
                    <span className="nav-menu-item-label">Vehicles</span>
                </button>
                <button type="button" className="nav-menu-item" disabled>
                    <span className="nav-menu-item-label">Tests &amp; Data</span>
                    <span className="nav-menu-item-hint">Select a vehicle first</span>
                </button>
            </div>
        </div>
    ),

    'plot-frame': () => (
        <div className="plot-frame" style={{ width: 300 }}>
            <div className="plot-frame-head">
                <span className="plot-frame-mark" aria-hidden="true" />
                <span className="plot-frame-title">Charge rate</span>
                <span className="plot-frame-subtitle">4 runs · 70 mph · 98°F</span>
            </div>
        </div>
    ),

    'stat-cell': () => (
        <div style={{ display: 'flex', gap: 12 }}>
            <div className="stat-cell">
                <span className="text-nano">Battery</span>
                <span className="stat-cell-value">82<span className="stat-cell-unit">kWh</span></span>
            </div>
            <div className="stat-cell">
                <span className="text-nano">EPA range</span>
                <span className="stat-cell-value stat-cell-empty">—</span>
            </div>
        </div>
    ),

    /* One row of the ranked table: a 1px line for the range, a band for the
       middle half, an orange tick for the median. */
    'distribution-bar': () => (
        <div style={{ width: 260 }}>
            <div className="stats-box-track">
                <div className="stats-box-whisker" style={{ left: '4%', right: '6%' }} />
                <div className="stats-box-iqr" style={{ left: '28%', right: '32%' }} />
                <div className="stats-box-median" style={{ left: '46%' }} />
            </div>
            <div className="stats-box-track is-corpus">
                <div className="stats-box-whisker" style={{ left: '0%', right: '0%' }} />
                <div className="stats-box-iqr" style={{ left: '22%', right: '24%' }} />
                <div className="stats-box-median" style={{ left: '51%' }} />
            </div>
        </div>
    ),

    'sparkline': () => (
        <span className="guide-cell-stack" style={{ width: 90 }}>
            <span>516</span>
            <span className="guide-spark" style={{ '--bar-fill': '78%' }} aria-hidden="true" />
        </span>
    ),

    'histogram': () => (
        <div className="stats-histogram" style={{ width: 260 }}>
            <div className="stats-histogram-head">
                <span className="text-nano">Distribution · 8 bins</span>
                <span className="text-caption">
                    median <span className="stats-histogram-median-value">93.8</span>
                </span>
            </div>
            <div className="stats-histogram-plot">
                <div className="stats-histogram-bars">
                    {[10, 26, 48, 72, 100, 64, 30, 12].map((h, i) => (
                        <div
                            key={i}
                            className={`stats-histogram-bar step-${Math.min(4, Math.ceil(h / 25))}`}
                            style={{ height: `${h}%` }}
                        />
                    ))}
                </div>
                <div className="stats-histogram-median" style={{ left: '54%' }}>
                    <span className="stats-histogram-median-chip">Median</span>
                </div>
            </div>
            <div className="text-caption stats-histogram-axis"><span>50.0</span><span>137.5 MPGe</span></div>
        </div>
    ),

    'run-band': () => (
        <div className="run-bands" style={{ width: 340 }}>
            <div className="run-band">
                <span className="run-band-label">Conditions</span>
                <div className="run-band-cells">
                    <div className="run-cell">
                        <span className="run-cell-label">Temp</span>
                        <span className="run-cell-value">72°F</span>
                    </div>
                    <div className="run-cell is-qualified">
                        <span className="run-cell-label">Speed held</span>
                        <span className="run-cell-value">70 mph est.</span>
                    </div>
                    <div className="run-cell">
                        <span className="run-cell-label">Wind</span>
                        <span className="run-cell-value"><span className="run-cell-missing">—</span></span>
                    </div>
                    <div className="run-cell">
                        <span className="run-cell-label">Columns</span>
                        <span className="run-cell-value">
                            <span className="run-cell-tags">
                                <span className="badge-micro">SoC</span>
                                <span className="badge-micro is-qualified">~Time</span>
                            </span>
                        </span>
                    </div>
                    <div className="run-cell">
                        <span className="run-cell-label">Cross-check</span>
                        <span className="run-cell-value">
                            <button type="button" className="run-cell-action">Compare ↔</button>
                        </span>
                    </div>
                </div>
            </div>
        </div>
    ),
};

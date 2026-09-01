/**
 * Shared Y/X axis min-max scale controls.
 * Used below charts in ChargingView, RangeChartView, RoadTripView, EpaCurvesView.
 *
 * Props:
 *   xMin, xMax, yMin, yMax        – current values (null = auto)
 *   y2Min, y2Max                  – right-axis bounds (null = auto); only used when showY2=true
 *   onChange(key, value)           – called with key 'xMin'|'xMax'|'yMin'|'yMax'|'y2Min'|'y2Max'
 *   showX                          – whether to show X-axis controls (default true).
 *                                    Set false for categorical bar-chart axes.
 *   showY2                         – whether to show Right Y-axis controls (default false).
 *                                    Set true when a secondary Y axis is active.
 *   xAxisLabel                     – label for the X-axis section (default "X-Axis Scale").
 *                                    Pass e.g. "X-Axis Scale (hrs)" to hint at expected units.
 *   yAxisLabel                     – label for the left Y-axis section (default "Left Axis Scale").
 *
 * Card wrapping (design pattern):
 *   By default this component renders itself inside a `card mb-6` container so that
 *   chart views don't need to remember to add one. Pass `card={false}` when the
 *   parent already manages a shared card (e.g. ChargingView bundles axis controls
 *   together with race-mode and line-toggle panels in one card).
 */

export default function AxisScaleControls({
    xMin, xMax, yMin, yMax, y2Min, y2Max,
    onChange,
    showX = true, showY2 = false,
    xAxisLabel = 'X-Axis Scale',
    yAxisLabel = 'Left Axis Scale',
    card = true,
}) {
    const colCount = 1 + (showX ? 1 : 0) + (showY2 ? 1 : 0);
    const gridClass = colCount === 3 ? 'grid-cols-3'
                    : colCount === 2 ? 'grid-cols-2'
                    : 'grid-cols-1 max-w-xs';

    const content = (
        <div className={`grid gap-8 ${gridClass}`}>

            {/* ── Y-Axis Scale ─────────────────────────────────────────────── */}
            <div>
                <div className="flex items-baseline gap-3 mb-2">
                    <p className="text-sm font-medium text-secondary">{yAxisLabel}</p>
                    {(yMin != null || yMax != null) && (
                        <button
                            onClick={() => { onChange('yMin', null); onChange('yMax', null); }}
                            className="text-xs text-meta hover:text-secondary transition-colors"
                        >
                            Reset
                        </button>
                    )}
                </div>
                <div className="axis-scale-group">
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-meta w-7 text-right">Max</span>
                        <input
                            type="number"
                            placeholder="Auto"
                            value={yMax ?? ''}
                            onChange={e => onChange('yMax', e.target.value === '' ? null : Number(e.target.value))}
                            className="axis-input"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-meta w-7 text-right">Min</span>
                        <input
                            type="number"
                            placeholder="Auto"
                            value={yMin ?? ''}
                            onChange={e => onChange('yMin', e.target.value === '' ? null : Number(e.target.value))}
                            className="axis-input"
                        />
                    </div>
                </div>
            </div>

            {/* ── X-Axis Scale — hidden for categorical bar-chart axes ─────── */}
            {showX && (
                <div>
                    <div className="flex items-baseline gap-3 mb-2">
                        <p className="text-sm font-medium text-secondary">{xAxisLabel}</p>
                        {(xMin != null || xMax != null) && (
                            <button
                                onClick={() => { onChange('xMin', null); onChange('xMax', null); }}
                                className="text-xs text-meta hover:text-secondary transition-colors"
                            >
                                Reset
                            </button>
                        )}
                    </div>
                    <div className="axis-scale-group">
                        <div className="inline-row">
                            <span className="text-xs text-meta w-7 text-right">Max</span>
                            <input
                                type="number"
                                placeholder="Auto"
                                value={xMax ?? ''}
                                onChange={e => onChange('xMax', e.target.value === '' ? null : Number(e.target.value))}
                                className="axis-input"
                            />
                        </div>
                        <div className="inline-row">
                            <span className="text-xs text-meta w-7 text-right">Min</span>
                            <input
                                type="number"
                                placeholder="Auto"
                                value={xMin ?? ''}
                                onChange={e => onChange('xMin', e.target.value === '' ? null : Number(e.target.value))}
                                className="axis-input"
                            />
                        </div>
                    </div>
                </div>
            )}

            {/* ── Right Y-Axis Scale — shown when a secondary Y axis is active ─ */}
            {showY2 && (
                <div>
                    <div className="flex items-baseline gap-3 mb-2">
                        <p className="text-sm font-medium text-secondary">Right Axis Scale</p>
                        <button
                            onClick={() => { onChange('y2Min', null); onChange('y2Max', null); }}
                            className="text-xs text-meta hover:text-secondary transition-colors"
                        >
                            Reset
                        </button>
                    </div>
                    <div className="axis-scale-group">
                        <div className="inline-row">
                            <span className="text-xs text-meta w-7 text-right">Max</span>
                            <input
                                type="number"
                                placeholder="Auto"
                                value={y2Max ?? ''}
                                onChange={e => onChange('y2Max', e.target.value === '' ? null : Number(e.target.value))}
                                className="axis-input"
                            />
                        </div>
                        <div className="inline-row">
                            <span className="text-xs text-meta w-7 text-right">Min</span>
                            <input
                                type="number"
                                placeholder="Auto"
                                value={y2Min ?? ''}
                                onChange={e => onChange('y2Min', e.target.value === '' ? null : Number(e.target.value))}
                                className="axis-input"
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );

    return card ? <div className="card mb-6">{content}</div> : content;
}

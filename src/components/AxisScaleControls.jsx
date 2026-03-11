/**
 * Shared Y/X axis min-max scale controls.
 * Used by ChargingView (charging) and RangeChartView (range & efficiency).
 *
 * Props:
 *   xMin, xMax, yMin, yMax        – current values (null = auto)
 *   y2Min, y2Max                  – right-axis bounds (null = auto); only used when showY2=true
 *   onChange(key, value)           – called with key 'xMin'|'xMax'|'yMin'|'yMax'|'y2Min'|'y2Max'
 *   showX                          – whether to show X-axis controls (default true).
 *                                    Set false for categorical bar-chart axes.
 *   showY2                         – whether to show Right Y-axis controls (default false).
 *                                    Set true when a secondary Y axis is active.
 */

const numInputCls =
    'px-2 py-1 border rounded text-sm ' +
    '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

export default function AxisScaleControls({ xMin, xMax, yMin, yMax, y2Min, y2Max, onChange, showX = true, showY2 = false }) {
    const colCount = 1 + (showX ? 1 : 0) + (showY2 ? 1 : 0);
    const gridClass = colCount === 3 ? 'grid-cols-3'
                    : colCount === 2 ? 'grid-cols-2'
                    : 'grid-cols-1 max-w-xs';

    return (
        <div className={`grid gap-8 ${gridClass}`}>

            {/* ── Y-Axis Scale ─────────────────────────────────────────────── */}
            <div>
                <div className="flex items-baseline gap-3 mb-2">
                    <p className="text-sm font-medium text-gray-500">Left Axis Scale</p>
                    {(yMin != null || yMax != null) && (
                        <button
                            onClick={() => { onChange('yMin', null); onChange('yMax', null); }}
                            className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
                        >
                            Reset
                        </button>
                    )}
                </div>
                <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 w-7 text-right">Max</span>
                        <input
                            type="number"
                            placeholder="Auto"
                            value={yMax ?? ''}
                            onChange={e => onChange('yMax', e.target.value === '' ? null : Number(e.target.value))}
                            className={`w-24 ${numInputCls}`}
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 w-7 text-right">Min</span>
                        <input
                            type="number"
                            placeholder="Auto"
                            value={yMin ?? ''}
                            onChange={e => onChange('yMin', e.target.value === '' ? null : Number(e.target.value))}
                            className={`w-24 ${numInputCls}`}
                        />
                    </div>
                </div>
            </div>

            {/* ── X-Axis Scale — hidden for categorical bar-chart axes ─────── */}
            {showX && (
                <div>
                    <div className="flex items-baseline gap-3 mb-2">
                        <p className="text-sm font-medium text-gray-500">X-Axis Scale</p>
                        {(xMin != null || xMax != null) && (
                            <button
                                onClick={() => { onChange('xMin', null); onChange('xMax', null); }}
                                className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
                            >
                                Reset
                            </button>
                        )}
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-400 w-7 text-right">Max</span>
                            <input
                                type="number"
                                placeholder="Auto"
                                value={xMax ?? ''}
                                onChange={e => onChange('xMax', e.target.value === '' ? null : Number(e.target.value))}
                                className={`w-24 ${numInputCls}`}
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-400 w-7 text-right">Min</span>
                            <input
                                type="number"
                                placeholder="Auto"
                                value={xMin ?? ''}
                                onChange={e => onChange('xMin', e.target.value === '' ? null : Number(e.target.value))}
                                className={`w-24 ${numInputCls}`}
                            />
                        </div>
                    </div>
                </div>
            )}

            {/* ── Right Y-Axis Scale — shown when a secondary Y axis is active ─ */}
            {showY2 && (
                <div>
                    <div className="flex items-baseline gap-3 mb-2">
                        <p className="text-sm font-medium text-gray-500">Right Axis Scale</p>
                        <button
                            onClick={() => { onChange('y2Min', null); onChange('y2Max', null); }}
                            className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
                        >
                            Reset
                        </button>
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-400 w-7 text-right">Max</span>
                            <input
                                type="number"
                                placeholder="Auto"
                                value={y2Max ?? ''}
                                onChange={e => onChange('y2Max', e.target.value === '' ? null : Number(e.target.value))}
                                className={`w-24 ${numInputCls}`}
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-400 w-7 text-right">Min</span>
                            <input
                                type="number"
                                placeholder="Auto"
                                value={y2Min ?? ''}
                                onChange={e => onChange('y2Min', e.target.value === '' ? null : Number(e.target.value))}
                                className={`w-24 ${numInputCls}`}
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

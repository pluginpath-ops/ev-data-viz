/**
 * Shared Y/X axis min-max scale controls.
 * Used by ChargingView (charging) and RangeChartView (range & efficiency).
 *
 * Props:
 *   xMin, xMax, yMin, yMax  – current values (null = auto)
 *   onChange(key, value)    – called with key 'xMin'|'xMax'|'yMin'|'yMax'
 *   showX                   – whether to show X-axis controls (default true).
 *                             Set false for categorical bar-chart axes.
 */

const numInputCls =
    'px-2 py-1 border rounded text-sm ' +
    '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

export default function AxisScaleControls({ xMin, xMax, yMin, yMax, onChange, showX = true }) {
    return (
        <div className={`grid gap-8 ${showX ? 'grid-cols-2' : 'grid-cols-1 max-w-xs'}`}>

            {/* ── Y-Axis Scale ─────────────────────────────────────────────── */}
            <div>
                <div className="flex items-baseline gap-3 mb-2">
                    <p className="text-sm font-medium text-gray-500">Y-Axis Scale</p>
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
        </div>
    );
}

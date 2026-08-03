/**
 * Run picker for the acceleration curve.
 *
 * Deliberately its own component rather than a reuse of RunSelector. That one
 * is shaped around charging/range runs hanging off `vehicle.runs`, and is being
 * reworked to support pairing a charging test with a range test — coupling to
 * it would mean this chart breaks when that lands, for no shared behaviour
 * beyond a checkbox list.
 *
 * It borrows RunSelector's semantic classes (.run-selector-header, .runs-list,
 * .vehicle-run-group, .run-items) so the two read as the same control, and
 * groups by DRIVE MODE inside each vehicle, which is the axis that matters
 * here: a session is the same launch repeated, and picking runs means picking
 * which modes and which attempts within them.
 */
import { useState } from 'react';

export default function PerformanceRunSelector({
    vehicles,          // [{ id, name, runs: [{ id, name, driveMode, zeroTo60, color }] }]
    selectedRunIds,     // array of ids, or null meaning "everything"
    onChange,           // (nextIds: array) => void
    colorMap = {},      // resolved colour per run id, for the swatch
    onUpdateColor,       // (runId, hex|null) => void; omit to hide the pickers
}) {
    const [expanded, setExpanded] = useState(false);
    const [collapsed, setCollapsed] = useState({});

    const allIds = vehicles.flatMap(v => v.runs.map(r => r.id));
    const effective = selectedRunIds === null ? allIds : selectedRunIds;
    const isSelected = (id) => effective.some(x => String(x) === String(id));

    const toggle = (id) => {
        const next = isSelected(id)
            ? effective.filter(x => String(x) !== String(id))
            : [...effective, id];
        onChange(next);
    };

    const setMany = (ids, on) => {
        const keep = effective.filter(x => !ids.some(i => String(i) === String(x)));
        onChange(on ? [...keep, ...ids] : keep);
    };

    return (
        <div>
            <button onClick={() => setExpanded(e => !e)} className="run-selector-header">
                <span style={{ display: 'inline-block', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>▼</span>
                Select Runs to Plot
                <span className="text-sm font-normal text-muted">({effective.length} of {allIds.length})</span>
            </button>

            {expanded && (
                <div className="mt-3">
                    <div className="flex gap-2 mb-2">
                        <button onClick={() => onChange(allIds)} className="btn btn-secondary text-xs py-0.5 px-2">
                            Select all
                        </button>
                        <button onClick={() => onChange([])} className="btn btn-secondary text-xs py-0.5 px-2">
                            Clear all
                        </button>
                    </div>

                    <div className="runs-list">
                        {vehicles.map(vehicle => {
                            const open = !collapsed[vehicle.id];
                            // Group by drive mode — the useful unit when a session is
                            // the same launch repeated several times.
                            const byMode = new Map();
                            for (const r of vehicle.runs) {
                                const k = r.driveMode || 'Unspecified';
                                if (!byMode.has(k)) byMode.set(k, []);
                                byMode.get(k).push(r);
                            }

                            return (
                                <div key={vehicle.id} className="vehicle-run-group" style={{ borderColor: 'var(--color-primary)' }}>
                                    <div className="flex items-center gap-2 mb-2">
                                        <button
                                            onClick={() => setCollapsed(p => ({ ...p, [vehicle.id]: !p[vehicle.id] }))}
                                            className="flex items-center gap-1.5 text-left group"
                                        >
                                            <span
                                                style={{ display: 'inline-block', transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}
                                                className="text-faint group-hover:text-secondary"
                                            >▼</span>
                                            <h4 className="text-sm font-semibold text-secondary">{vehicle.name}</h4>
                                        </button>
                                    </div>

                                    {open && [...byMode.entries()].map(([mode, runs]) => {
                                        const ids = runs.map(r => r.id);
                                        const allOn = ids.every(isSelected);
                                        return (
                                            <div key={mode} className="mb-2">
                                                <button
                                                    onClick={() => setMany(ids, !allOn)}
                                                    className="text-[11px] text-muted hover:text-secondary mb-1 flex items-center gap-1"
                                                    title={allOn ? 'Deselect this mode' : 'Select this mode'}
                                                >
                                                    <span className="text-faint">{allOn ? '☑' : '☐'}</span>
                                                    {mode}
                                                    <span className="text-faint">({runs.length})</span>
                                                </button>
                                                <div className="run-items">
                                                    {runs.map(run => (
                                                        <label
                                                            key={run.id}
                                                            className="flex items-center gap-2 text-xs cursor-pointer py-0.5 pl-4"
                                                        >
                                                            <input
                                                                type="checkbox"
                                                                checked={isSelected(run.id)}
                                                                onChange={() => toggle(run.id)}
                                                            />
                                                            {onUpdateColor && (
                                                                <input
                                                                    type="color"
                                                                    value={colorMap[run.id] || run.color || '#3b82f6'}
                                                                    onChange={e => onUpdateColor(run.id, e.target.value)}
                                                                    onClick={e => e.stopPropagation()}
                                                                    className="w-7 h-5 border-0 rounded cursor-pointer shrink-0"
                                                                    title="Set this run's colour"
                                                                />
                                                            )}
                                                            <span className="text-secondary">{run.name}</span>
                                                            {run.zeroTo60 != null && (
                                                                <span className="font-mono text-faint">
                                                                    {Number(run.zeroTo60).toFixed(3)} s
                                                                </span>
                                                            )}
                                                            {onUpdateColor && run.color && (
                                                                <button
                                                                    type="button"
                                                                    onClick={e => { e.preventDefault(); onUpdateColor(run.id, null); }}
                                                                    className="text-[10px] text-faint hover:text-secondary"
                                                                    title="Clear — back to the auto palette"
                                                                >
                                                                    reset
                                                                </button>
                                                            )}
                                                        </label>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}

import { useState } from 'react';

/**
 * Shared collapsible run selector used by ChargingView, RangeChartView,
 * ChargeCompareView, and RoadTripView.
 *
 * Props:
 *   vehicles        — array of vehicle objects with .runs, in display order
 *   selectedRunIds  — array of selected run IDs
 *   onToggleRun     — (runId) => void
 *   onUpdateRunColor — (vehicleId, runId, color) => void, or null to hide color inputs
 *   runFilter       — (run) => boolean — which runs to show per vehicle
 *   emptyMessage    — string shown when no runs pass the filter for a vehicle
 *   renderRunMeta   — optional (run) => ReactNode — extra badges after name/date
 */
export default function RunSelector({
    vehicles,
    selectedRunIds,
    onToggleRun,
    onUpdateRunColor = null,
    runFilter,
    emptyMessage = 'No runs',
    renderRunMeta = null,
}) {
    const [expanded, setExpanded] = useState(false);

    const isSelected = (run) => selectedRunIds.some(id => String(id) === String(run.id));

    const selectedCount = vehicles.reduce((n, v) =>
        n + (v.runs || []).filter(runFilter).filter(isSelected).length, 0);

    return (
        <div>
            <button
                onClick={() => setExpanded(prev => !prev)}
                className="run-selector-header"
            >
                <span style={{ display: 'inline-block', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>&#9660;</span>
                Select Vehicle Tests to Display
                <span className="text-sm font-normal text-gray-500">({selectedCount} selected)</span>
                {expanded && (
                    <span className="text-xs font-normal text-gray-400 ml-2">· Drag the pills above to reorder</span>
                )}
            </button>

            {expanded && (
                <div className="mt-3">
                    <div className="runs-list">
                        {vehicles.map(vehicle => {
                            const filteredRuns = (vehicle.runs || []).filter(runFilter);

                            return (
                                <div key={vehicle.id} className="vehicle-run-group" style={{ borderColor: 'var(--color-primary)' }}>
                                    <div className="flex items-center gap-2 mb-2">
                                        <h4 className="text-sm font-semibold text-gray-700">{vehicle.name}</h4>
                                    </div>

                                    {filteredRuns.length === 0 ? (
                                        <p className="text-sm text-gray-400 italic">{emptyMessage}</p>
                                    ) : (
                                        <div className="run-items">
                                            {filteredRuns.map(run => (
                                                <RunRow
                                                    key={run.id}
                                                    run={run}
                                                    vehicle={vehicle}
                                                    isChecked={isSelected(run)}
                                                    onToggle={() => onToggleRun(run.id)}
                                                    onUpdateRunColor={onUpdateRunColor}
                                                    renderRunMeta={renderRunMeta}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}

function RunRow({ run, vehicle, isChecked, onToggle, onUpdateRunColor, renderRunMeta }) {
    return (
        <label className={`flex items-center gap-2 cursor-pointer ${!isChecked ? 'opacity-60 hover:opacity-100' : ''}`}>
            <input
                type="checkbox"
                checked={isChecked}
                onChange={onToggle}
                className="w-4 h-4 shrink-0"
            />
            {onUpdateRunColor && (
                <>
                    <input
                        type="color"
                        value={run.color || '#3b82f6'}
                        onChange={e => { e.stopPropagation(); onUpdateRunColor(vehicle.id, run.id, e.target.value); }}
                        onClick={e => e.stopPropagation()}
                        className="w-8 h-6 border-0 rounded cursor-pointer shrink-0"
                        title="Change color"
                    />
                    <input
                        type="text"
                        value={run.color || '#3b82f6'}
                        onChange={e => { e.stopPropagation(); onUpdateRunColor(vehicle.id, run.id, e.target.value); }}
                        onBlur={e => { if (!/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) onUpdateRunColor(vehicle.id, run.id, run.color || '#3b82f6'); }}
                        onClick={e => e.stopPropagation()}
                        className="hidden w-20 px-2 py-0.5 border rounded text-xs font-mono shrink-0"
                        placeholder="#3b82f6"
                        maxLength={7}
                    />
                </>
            )}
            <span className="run-label">
                <span>
                    {run.name}
                    {run.url && (
                        <a href={run.url} target="_blank" rel="noopener noreferrer"
                            title="Range test source"
                            onClick={e => e.stopPropagation()}
                            className="text-blue-400 hover:text-blue-600 transition-colors ml-0.5">↗</a>
                    )}
                    {run.charging_url && (
                        <a href={run.charging_url} target="_blank" rel="noopener noreferrer"
                            title="Charging test source"
                            onClick={e => e.stopPropagation()}
                            className="text-blue-400 hover:text-blue-600 transition-colors ml-0.5">↗</a>
                    )}
                    <span className="text-sm text-gray-500"> ({run.date})</span>
                </span>
                {renderRunMeta?.(run)}
            </span>
        </label>
    );
}

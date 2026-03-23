import { useState } from 'react';

/**
 * Shared collapsible run selector used by ChargingView, RangeChartView, and ChargeCompareView.
 *
 * Props:
 *   vehicles        — array of vehicle objects with .runs
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
    const [expandedVehicles, setExpandedVehicles] = useState({});

    const toggleVehicle = (vehicleId) =>
        setExpandedVehicles(prev => ({ ...prev, [vehicleId]: !prev[vehicleId] }));

    const selectedCount = vehicles.reduce((n, v) => {
        const filtered = (v.runs || []).filter(runFilter);
        return n + filtered.filter(r => selectedRunIds.some(id => String(id) === String(r.id))).length;
    }, 0);

    return (
        <div>
            <button
                onClick={() => setExpanded(prev => !prev)}
                className="run-selector-header"
            >
                <span style={{ display: 'inline-block', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>&#9660;</span>
                Select Vehicle Tests to Display
                <span className="text-sm font-normal text-gray-500">({selectedCount} selected)</span>
            </button>

            {expanded && (
                <div className="mt-3">
                    <div className="runs-list">
                        {vehicles.map(vehicle => {
                            const filteredRuns  = (vehicle.runs || []).filter(runFilter);
                            const activeRuns    = filteredRuns.filter(r =>  selectedRunIds.some(id => String(id) === String(r.id)));
                            const inactiveRuns  = filteredRuns.filter(r => !selectedRunIds.some(id => String(id) === String(r.id)));
                            const isVehicleExpanded = expandedVehicles[vehicle.id];

                            return (
                                <div key={vehicle.id} className="vehicle-run-group" style={{ borderColor: 'var(--color-primary)' }}>
                                    <div className="flex items-center gap-2 mb-2">
                                        <h4 className="text-sm font-semibold text-gray-700">{vehicle.name}</h4>
                                        {inactiveRuns.length > 0 && (
                                            <button
                                                onClick={() => toggleVehicle(vehicle.id)}
                                                className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
                                            >
                                                <span style={{ display: 'inline-block', transform: isVehicleExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>&#9660;</span>
                                                <span>{isVehicleExpanded ? 'Hide' : 'Show all'} ({filteredRuns.length})</span>
                                            </button>
                                        )}
                                    </div>

                                    {filteredRuns.length === 0 ? (
                                        <p className="text-sm text-gray-400 italic">{emptyMessage}</p>
                                    ) : (
                                        <div className="run-items">
                                            {activeRuns.map(run => (
                                                <RunRow
                                                    key={run.id}
                                                    run={run}
                                                    vehicle={vehicle}
                                                    isChecked={true}
                                                    dimmed={false}
                                                    onToggle={() => onToggleRun(run.id)}
                                                    onUpdateRunColor={onUpdateRunColor}
                                                    renderRunMeta={renderRunMeta}
                                                />
                                            ))}
                                            {isVehicleExpanded && inactiveRuns.map(run => (
                                                <RunRow
                                                    key={run.id}
                                                    run={run}
                                                    vehicle={vehicle}
                                                    isChecked={false}
                                                    dimmed={true}
                                                    onToggle={() => onToggleRun(run.id)}
                                                    onUpdateRunColor={onUpdateRunColor}
                                                    renderRunMeta={renderRunMeta}
                                                />
                                            ))}
                                            {activeRuns.length === 0 && !isVehicleExpanded && (
                                                <p className="text-xs text-gray-400 italic">No runs selected — click Show all to re-add</p>
                                            )}
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

function RunRow({ run, vehicle, isChecked, dimmed, onToggle, onUpdateRunColor, renderRunMeta }) {
    return (
        <label className={`flex items-center gap-2 cursor-pointer ${dimmed ? 'opacity-60 hover:opacity-100' : ''}`}>
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

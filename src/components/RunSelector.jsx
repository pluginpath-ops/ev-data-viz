import { useState, useRef, useEffect } from 'react';
import { pairKey, partnersFor } from '../utils/pairings';

/**
 * Shared collapsible run selector used by ChargingView, RangeChartView,
 * ChargeCompareView, and RoadTripView.
 *
 * Props:
 *   vehicles        — array of vehicle objects with .runs, in display order
 *   selectedRunIds  — array of selected run IDs (pair keys in pair mode)
 *   onToggleRun     — (runId | pairKey) => void
 *   onUpdateRunColor — (vehicleId, runId, color) => void, or null to hide color inputs
 *   runFilter       — (run, vehicle) => boolean — which runs to show per vehicle
 *   emptyMessage    — string shown when no runs pass the filter for a vehicle
 *   renderRunMeta   — optional (run) => ReactNode — extra badges after name/date
 *
 * ── Pair mode (opt-in) ───────────────────────────────────────────────────────
 *
 * Set `pairMode` and each row gains an inline `<partnerLabel> … ▾` control
 * naming the test it is paired with, plus a ＋ that duplicates the row with the
 * primary test pre-filled. The 1:1 case looks almost exactly like the flat list;
 * the UI only grows when asked.
 *
 * Rows are keyed by PAIR, not by run — one test against three partners is three
 * series, so a run id can no longer identify a selection.
 *
 * The component is deliberately orientation-agnostic: Charge Compare enumerates
 * range tests and picks charging curves, because a charging curve is a property
 * of the car while a range test is a property of the day. Another view could
 * enumerate the other way without touching this file.
 *
 *   pairMode        — enable the above
 *   pairings        — { [primaryRunId]: [partnerRunId, ...] } (utils/pairings.js)
 *   primaryLabel    — prefix before the row's own name, e.g. "Range:"
 *   partnerLabel    — prefix before the dropdown,      e.g. "Charging:"
 *   partnerRunsFor  — (vehicle) => runs offered as partners
 *   extraPrimaryRunsFor — (vehicle) => synthetic primary rows (e.g. EPA range)
 *   singlePartner   — one partner per row, selection still keyed by run id
 *   partnerIdFor    — (run) => partnerRunId | null, single-partner mode only
 *   resolvePartner  — (primaryRun, vehicle) => { sourceRun, note } for the
 *                     automatic choice shown when nothing is pinned
 *   onSetPartner    — (primaryRunId, oldPartnerId, newPartnerId) => void
 *   onAddPartner    — (primaryRunId, partnerId) => void
 *   onRemovePartner — (primaryRunId, partnerId) => void
 */
export default function RunSelector({
    vehicles,
    selectedRunIds,
    onToggleRun,
    onUpdateRunColor = null,
    runFilter,
    emptyMessage = 'No runs',
    renderRunMeta = null,
    colorMap = {},
    // Pair mode
    pairMode = false,
    pairings = {},
    primaryLabel = null,
    partnerLabel = 'Paired with:',
    // One partner per row, selection still keyed by run id. For views whose
    // subject is the primary run (the charging chart plots one curve per run,
    // Road Trip simulates one trip per run) — they cannot render a run twice, so
    // they get the same row shape without the ＋ that would imply they could.
    singlePartner = false,
    // (run) => partnerRunId | null — single-partner mode only
    partnerIdFor = null,
    partnerRunsFor = null,
    // Rows that are not runs — e.g. the vehicle's EPA rated range, which is a
    // legitimate range basis with no test behind it.
    extraPrimaryRunsFor = null,
    resolvePartner = null,
    onSetPartner = null,
    onAddPartner = null,
    onRemovePartner = null,
}) {
    const [expanded, setExpanded] = useState(false);
    // Default all vehicles to expanded; track explicit collapses
    const [collapsedVehicles, setCollapsedVehicles] = useState({});
    const isVehicleExpanded = (vehicleId) => !collapsedVehicles[vehicleId];
    const toggleVehicle = (vehicleId) =>
        setCollapsedVehicles(prev => ({ ...prev, [vehicleId]: !prev[vehicleId] }));

    const isSelected = (run) => selectedRunIds.some(id => String(id) === String(run.id));

    /**
     * The partner rows for one charging run: whatever the user pinned, or a
     * single row for the automatic choice. `null` means "resolved automatically"
     * and still gets a row, so every charging test is visible and selectable
     * whether or not anyone has paired it.
     */
    const partnerRowsFor = (run) => {
        // Single-partner views ask the parent which partner this row holds: the
        // map is keyed by the other side, and knowing that would make this
        // component orientation-aware again.
        if (singlePartner) return [partnerIdFor ? (partnerIdFor(run) ?? null) : null];
        const pinned = partnersFor(pairings, run.id);
        return pinned.length ? pinned : [null];
    };

    /**
     * Every primary row for a vehicle, synthetic ones included. Used for both
     * rendering and the header count — computing them separately is how the
     * count silently drifted from what was on screen.
     */
    const primaryRunsFor = (vehicle) => {
        const own = (vehicle.runs || []).filter(r => runFilter(r, vehicle));
        return pairMode && extraPrimaryRunsFor
            ? [...own, ...(extraPrimaryRunsFor(vehicle) || [])]
            : own;
    };

    const selectedCount = pairMode
        ? vehicles.reduce((n, v) => n + primaryRunsFor(v).reduce(
            (m, run) => m + (singlePartner
                ? (selectedRunIds.some(id => String(id) === String(run.id)) ? 1 : 0)
                : partnerRowsFor(run).filter(
                    partnerId => selectedRunIds.some(id => String(id) === pairKey(run.id, partnerId))
                  ).length), 0), 0)
        : vehicles.reduce((n, v) =>
            n + (v.runs || []).filter(r => runFilter(r, v)).filter(isSelected).length, 0);

    return (
        <div>
            <button
                onClick={() => setExpanded(prev => !prev)}
                className="run-selector-header"
            >
                <span style={{ display: 'inline-block', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>&#9660;</span>
                Select Vehicle Tests to Display
                <span className="text-sm font-normal text-muted">({selectedCount} selected)</span>
                {expanded && (
                    <span className="text-xs font-normal text-faint ml-2">· Drag the pills above to reorder</span>
                )}
            </button>

            {expanded && (
                <div className="mt-3">
                    <div className="runs-list">
                        {vehicles.map(vehicle => {
                            const filteredRuns = primaryRunsFor(vehicle);

                            return (
                                <div key={vehicle.id} className="vehicle-run-group" style={{ borderColor: 'var(--color-primary)' }}>
                                    <div className="flex items-center gap-2 mb-2">
                                        <button
                                            onClick={() => toggleVehicle(vehicle.id)}
                                            className="flex items-center gap-1.5 text-left group"
                                            title={isVehicleExpanded(vehicle.id) ? 'Collapse' : 'Expand'}
                                        >
                                            <span style={{ display: 'inline-block', transform: isVehicleExpanded(vehicle.id) ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }} className="text-faint group-hover:text-secondary">&#9660;</span>
                                            <h4 className="text-sm font-semibold text-secondary">{vehicle.name}</h4>
                                        </button>
                                    </div>

                                    {isVehicleExpanded(vehicle.id) && (
                                        filteredRuns.length === 0 ? (
                                            <p className="text-sm text-faint italic">{emptyMessage}</p>
                                        ) : (
                                            <div className="run-items">
                                                {filteredRuns.map(run => pairMode ? (
                                                    <PairRows
                                                        key={run.id}
                                                        run={run}
                                                        vehicle={vehicle}
                                                        partnerIds={partnerRowsFor(run)}
                                                        partnerRuns={partnerRunsFor?.(vehicle) ?? []}
                                                        resolvePartner={resolvePartner}
                                                        primaryLabel={primaryLabel}
                                                        partnerLabel={partnerLabel}
                                                        singlePartner={singlePartner}
                                                        selectedRunIds={selectedRunIds}
                                                        onToggleRun={onToggleRun}
                                                        onSetPartner={onSetPartner}
                                                        onAddPartner={onAddPartner}
                                                        onRemovePartner={onRemovePartner}
                                                        onUpdateRunColor={onUpdateRunColor}
                                                        renderRunMeta={renderRunMeta}
                                                        colorMap={colorMap}
                                                    />
                                                ) : (
                                                    <RunRow
                                                        key={run.id}
                                                        run={run}
                                                        vehicle={vehicle}
                                                        isChecked={isSelected(run)}
                                                        onToggle={() => onToggleRun(run.id)}
                                                        onUpdateRunColor={onUpdateRunColor}
                                                        renderRunMeta={renderRunMeta}
                                                        colorMap={colorMap}
                                                    />
                                                ))}
                                            </div>
                                        )
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

/**
 * One charging test and its range partner(s) — a row per pair.
 *
 * The first row carries the checkbox, colour and charging-test name; additional
 * partners are continuation rows showing only their own dropdown, so a single
 * curve compared across three conditions reads as one block rather than three
 * unrelated entries.
 */
function PairRows({
    run, vehicle, partnerIds, partnerRuns, resolvePartner,
    primaryLabel, partnerLabel, singlePartner,
    selectedRunIds, onToggleRun, onSetPartner, onAddPartner, onRemovePartner,
    onUpdateRunColor, renderRunMeta, colorMap,
}) {
    // What the resolver would pick with nothing pinned — shown as the dropdown's
    // placeholder so an unpaired row still says where its miles come from.
    const auto = resolvePartner?.(run, vehicle) ?? null;
    const autoLabel = auto?.sourceRun?.name
        ?? (auto?.source === 'recorded' ? 'recorded range column' : 'none available');

    // Partners not already used by this row — the discovery badge.
    //
    // An unpinned row is still *showing* the auto-resolved partner, so that one
    // counts as used. Without this the badge over-counts ("+2" when only one
    // other test exists) and ＋ can pick the partner already on screen, which
    // dedupes to a no-op and looks like a dead button.
    const used = new Set(partnerIds.filter(Boolean).map(String));
    if (!partnerIds.some(Boolean) && auto?.sourceRun) used.add(String(auto.sourceRun.id));
    const unused = partnerRuns.filter(r => !used.has(String(r.id)));

    const rowKey = (partnerId) => singlePartner ? String(run.id) : pairKey(run.id, partnerId);
    const isSelected = (partnerId) =>
        selectedRunIds.some(id => String(id) === rowKey(partnerId));

    return (
        <div className="pair-group">
            {partnerIds.map((partnerId, idx) => (
                <label
                    key={partnerId ?? 'auto'}
                    className={`pair-row ${idx > 0 ? 'pair-row-child' : ''} ${isSelected(partnerId) ? '' : 'opacity-60 hover:opacity-100'}`}
                >
                    <input
                        type="checkbox"
                        checked={isSelected(partnerId)}
                        onChange={() => onToggleRun(singlePartner ? run.id : rowKey(partnerId))}
                        className="w-4 h-4 shrink-0"
                    />

                    {/* Charging test identity — only on the first row of the group.
                        No date or speed here: speed belongs to the range test, and
                        this side of the row is about the charging curve. */}
                    {idx === 0 ? (
                        <span className="pair-charging-label">
                            {onUpdateRunColor && (
                                <span
                                    className="w-3 h-5 rounded-sm shrink-0 border border-black/10"
                                    style={{ backgroundColor: colorMap[run.id] || run.color || '#3b82f6' }}
                                />
                            )}
                            {primaryLabel && <span className="text-label shrink-0">{primaryLabel}</span>}
                            <span className="truncate">{run.name}</span>
                            {renderRunMeta?.(run)}
                        </span>
                    ) : (
                        <span className="pair-charging-label text-faint">↳</span>
                    )}

                    {/* The range basis for this pair */}
                    <span className="pair-range-control" onClick={e => e.preventDefault()}>
                        <span className="text-label shrink-0">{partnerLabel}</span>
                        <select
                            className="form-input text-sm py-0.5"
                            value={partnerId ?? ''}
                            onChange={e => {
                                const next = e.target.value;
                                if (!next) onRemovePartner?.(run.id, partnerId);
                                else onSetPartner?.(run.id, partnerId, next);
                            }}
                        >
                            <option value="">Auto — {autoLabel}</option>
                            {partnerRuns.map(r => (
                                <option key={r.id} value={r.id}>{r.name}</option>
                            ))}
                        </select>

                        {/* Discovery: how many other range tests could go here */}
                        {!singlePartner && idx === 0 && unused.length > 0 && (
                            <span
                                className="pair-more-badge"
                                title={`${unused.length} more option(s): ${unused.map(r => r.name).join(', ')}`}
                            >
                                +{unused.length}
                            </span>
                        )}

                        {singlePartner ? null : idx === 0 ? (
                            <button
                                type="button"
                                onClick={() => {
                                    // Duplicate this row with the charging test pre-filled —
                                    // the point of the design is never re-picking it.
                                    const next = unused[0];
                                    if (!next) return;
                                    if (!partnerId && auto?.sourceRun) onAddPartner?.(run.id, auto.sourceRun.id);
                                    onAddPartner?.(run.id, next.id);
                                }}
                                disabled={unused.length === 0}
                                className="pair-add-btn"
                                title={unused.length ? 'Compare this test against another pairing' : 'No other options available'}
                            >
                                ＋
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={() => onRemovePartner?.(run.id, partnerId)}
                                className="pair-remove-btn"
                                title="Remove this pairing"
                            >
                                ×
                            </button>
                        )}
                    </span>
                </label>
            ))}
        </div>
    );
}

function RunRow({ run, vehicle, isChecked, onToggle, onUpdateRunColor, renderRunMeta, colorMap = {} }) {
    // Local in-flight color so rapid picker drags don't fire a DB write on every
    // pixel.  We only commit to the parent after a short debounce or on blur.
    const storedColor  = run.color || '#3b82f6';
    const [localColor, setLocalColor] = useState(storedColor);
    const commitTimer  = useRef(null);

    // Sync if run.color changes from outside (e.g. another run update propagates)
    useEffect(() => { setLocalColor(run.color || '#3b82f6'); }, [run.color]);

    const handleColorChange = (e) => {
        e.stopPropagation();
        const val = e.target.value;
        setLocalColor(val);
        clearTimeout(commitTimer.current);
        commitTimer.current = setTimeout(() => onUpdateRunColor(vehicle.id, run.id, val), 400);
    };

    const handleColorCommit = () => {
        clearTimeout(commitTimer.current);
        if (/^#[0-9A-Fa-f]{6}$/.test(localColor)) {
            onUpdateRunColor(vehicle.id, run.id, localColor);
        }
    };

    // Resolved chart display color (Okabe-Ito in auto mode, stored color otherwise)
    const resolvedColor = colorMap[run.id] || localColor;

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
                    {/* Swatch: shows the resolved chart color (may differ from stored in auto mode) */}
                    <span
                        className="w-3 h-5 rounded-sm shrink-0 border border-black/10"
                        style={{ backgroundColor: resolvedColor }}
                        title={resolvedColor !== localColor
                            ? `Chart color: ${resolvedColor} (stored: ${localColor})`
                            : `Color: ${resolvedColor}`}
                    />
                    {/* Picker: edits the stored preference color, debounced */}
                    <input
                        type="color"
                        value={localColor}
                        onChange={handleColorChange}
                        onBlur={handleColorCommit}
                        onClick={e => e.stopPropagation()}
                        className="w-8 h-6 border-0 rounded cursor-pointer shrink-0"
                        title="Set color preference (influences auto-color hue family when Auto Color is on)"
                    />
                    <input
                        type="text"
                        value={localColor}
                        onChange={e => { e.stopPropagation(); setLocalColor(e.target.value); }}
                        onBlur={e => {
                            e.stopPropagation();
                            if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) {
                                onUpdateRunColor(vehicle.id, run.id, e.target.value);
                            } else {
                                setLocalColor(run.color || '#3b82f6');
                            }
                        }}
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
                    <span className="text-sm text-muted"> ({run.date})</span>
                </span>
                {renderRunMeta?.(run)}
            </span>
        </label>
    );
}

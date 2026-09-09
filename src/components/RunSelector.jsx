import { useState, useRef } from 'react';
import { pairKey, partnersFor } from '../utils/pairings';
import RunSourceLinks from './RunSourceLinks';
import SeriesColorPicker from './SeriesColorPicker';
import { DEFAULT_RUN_COLOR } from '../utils/colorUtils';

/**
 * The color a row is drawn in: an Okabe-Ito slot in auto mode, a session
 * override where one was set, the stored preference otherwise.
 *
 * A function rather than the expression written twice, because the second
 * reader of it is the group's accent border — and an accent that claims to be
 * a row's color while computing it differently is the bug this file just had.
 */
function plottedColorOf(run, colorMap, vehicle) {
    // The vehicle's curated color is the fallback, not a neutral, because
    // `colorMap` only covers runs that are actually PLOTTED. An unticked row
    // used to preview its own stored color; a run owns none since #308, so
    // without this every unselected row previewed the same default blue and the
    // rail stopped telling you which car a row belonged to before you ticked it.
    return colorMap[run.id] || vehicle?.color || DEFAULT_RUN_COLOR;
}

/**
 * Shared collapsible run selector used by ChargingView, RangeChartView,
 * ChargeCompareView, and RoadTripView.
 *
 * Props:
 *   vehicles        — array of vehicle objects with .runs, in display order
 *   selectedRunIds  — array of selected run IDs (pair keys in pair mode)
 *   onToggleRun     — (runId | pairKey) => void
 *   onUpdateRunColor — (vehicleId, runId, color) => void, or null to hide color inputs
 *   onUpdateRunColors — (map) => void, a whole derived set at once. Supplying
 *                     it WITH colorSeries is what puts the scope control in the
 *                     color panel; without both, a pick is one series
 *   colorSeries     — [{id, vehicleId, stored}] for everything plotted, from
 *                     colorUtils.seriesRowsFor. What "this vehicle" and "all
 *                     tests" are allowed to touch
 *   runFilter       — (run, vehicle) => boolean — which runs to show per vehicle
 *   emptyMessage    — string shown when no runs pass the filter for a vehicle
 *   renderRunBadges — optional (run) => ReactNode — IDENTITY markers, on the
 *                     name's own row. "DEF" is the one: it says which run is
 *                     privileged, which is part of naming it.
 *   renderRunMeta   — optional (run) => ReactNode — CONDITIONS, on their own
 *                     row beneath. Speed, temperature, wind, distance: what the
 *                     run measured, not what it is called. They were on the
 *                     name's row, which worked until a row also had to carry a
 *                     pairing control and the name lost.
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
    onUpdateRunColors = null,
    colorSeries = null,
    runFilter,
    emptyMessage = 'No runs',
    chartPalette = null,
    onChartPaletteChange = null,
    renderRunBadges = null,
    renderRunMeta = null,
    colorMap = {},
    // Rendered to the right of the header — the chart-session toggles.
    headerActions = null,
    // Pair mode
    pairMode = false,
    pairings = {},
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
    const headerRef = useRef(null);
    const [expanded, setExpanded] = useState(false);
    // Default all vehicles to expanded; track explicit collapses
    const [collapsedVehicles, setCollapsedVehicles] = useState({});
    const isVehicleExpanded = (vehicleId) => !collapsedVehicles[vehicleId];
    const toggleVehicle = (vehicleId) =>
        setCollapsedVehicles(prev => ({ ...prev, [vehicleId]: !prev[vehicleId] }));

    const isSelected = (run) => selectedRunIds.some(id => String(id) === String(run.id));

    /**
     * Is any row of this run on the chart? Pair mode plots a run once per
     * partner, so it asks about the PAIR keys — the same keys the bulk helper
     * computes, because a group's edge and its "none" link have to agree about
     * what "active" means.
     */
    const isRunActive = (run) => {
        if (!pairMode || singlePartner) return isSelected(run);
        return partnerRowsFor(run).some(partnerId =>
            selectedRunIds.some(id => String(id) === pairKey(run.id, partnerId)));
    };

    /**
     * The color a vehicle's group edge carries: the tests of its that are
     * ACTUALLY on the chart, and nothing at all when none of them are.
     *
     * `.vehicle-run-group` was written for "the vehicle's series color — the
     * only thing in the selector that is also on the plot", and for as long as
     * this component has existed it passed the brand blue instead, so the edge
     * said the same thing about every car. On EPA Curves, which did supply a
     * color, it was worse than uniform: it kept the palette's first answer
     * after the rows had been recolored by hand, naming a color that was on
     * no line.
     *
     * Anchoring it to the active rows is what keeps the promise. It reads their
     * plotted colors through the same function the swatches do, so the two
     * cannot come apart again, and an edge over a group with nothing selected
     * has no series to name — so it goes, rather than falling back to a color
     * that would be a claim about a plot the vehicle is not on.
     *
     * Several active tests fade across all of them rather than taking the
     * first: a vehicle contributing four lines in four colors is not
     * represented by any one of them, and the edge is the only place the group
     * as a whole can be said. Returned as a `background` value — one color or
     * a gradient — which is why the strip is painted rather than a border.
     */
    const accentFor = (vehicle, runs) => {
        // Nothing plots a synthetic row, so it has no color to speak for.
        const active = runs
            .filter(run => !run._synthetic && isRunActive(run))
            .map(run => plottedColorOf(run, colorMap, vehicle));
        if (!active.length) return null;
        return active.length === 1 ? active[0] : `linear-gradient(180deg, ${active.join(', ')})`;
    };

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

    /**
     * Select or clear every row for one vehicle. Emits the same toggle the rows
     * do, so the parent's selection model — run ids or pair keys — stays the
     * only thing that knows which is which.
     */
    const setVehicleSelection = (vehicle, wanted) => {
        for (const run of primaryRunsFor(vehicle)) {
            for (const partnerId of partnerRowsFor(run)) {
                const key = pairMode && !singlePartner ? pairKey(run.id, partnerId) : run.id;
                const isOn = selectedRunIds.some(id => String(id) === String(key));
                if (isOn !== wanted) onToggleRun(key);
            }
        }
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

    // The denominator. "5 selected" says nothing about whether that is most of
    // what there is or a fraction of it — "5 / 12" answers both at once, and
    // the second number is the one that tells you there is more to look at.
    const availableCount = pairMode
        ? vehicles.reduce((n, v) => n + primaryRunsFor(v).reduce(
            (m, run) => m + (singlePartner ? 1 : partnerRowsFor(run).length), 0), 0)
        : vehicles.reduce((n, v) =>
            n + (v.runs || []).filter(r => runFilter(r, v)).length, 0);

    return (
        <div>
            {/* Chart-session toggles live here rather than in each chart's own
                controls card: they act on what this selector chooses, and every
                chart had drifted into putting them somewhere different. */}
            <div className="run-selector-bar">
            <button
                ref={headerRef}
                onClick={() => {
                    const next = !expanded;
                    setExpanded(next);
                    // Nudge the header into view on OPEN. A disclosure whose
                    // content appears below the fold looks like a control that
                    // did nothing — you click, the page does not move, and the
                    // thing you asked for is off-screen. `nearest` so an already
                    // visible header does not jump.
                    if (next) {
                        requestAnimationFrame(() =>
                            headerRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
                    }
                }}
                className="run-selector-header"
            >
                <span style={{ display: 'inline-block', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>&#9660;</span>
                <span className="text-control">Select vehicles &amp; tests</span>
                <span className="run-selector-count">{selectedCount} / {availableCount}</span>
                {expanded && (
                    <span className="text-xs font-normal text-meta ml-2">· Drag the pills above to reorder</span>
                )}
            </button>
                {headerActions && <div className="run-selector-actions">{headerActions}</div>}
            </div>

            {expanded && (
                <div className="mt-3">
                    <div className="runs-list">
                        {vehicles.map(vehicle => {
                            const filteredRuns = primaryRunsFor(vehicle);

                            return (
                                <div
                                    key={vehicle.id}
                                    className="vehicle-run-group"
                                    style={{ '--group-accent': accentFor(vehicle, filteredRuns) ?? 'transparent' }}
                                >
                                    {/* mb-1.5, not mb-2: this margin is a third of
                                        the distance between the accent strip's top
                                        and the first row it is describing. */}
                                    <div className="flex items-center gap-2 mb-1.5">
                                        <button
                                            onClick={() => toggleVehicle(vehicle.id)}
                                            className="flex items-center gap-1.5 text-left group"
                                            title={isVehicleExpanded(vehicle.id) ? 'Collapse' : 'Expand'}
                                        >
                                            <span style={{ display: 'inline-block', transform: isVehicleExpanded(vehicle.id) ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }} className="text-meta group-hover:text-secondary">&#9660;</span>
                                            <h4 className="text-sm font-semibold text-secondary">{vehicle.name}</h4>
                                        </button>
                                        {/* Bulk helpers — a vehicle can contribute a dozen rows,
                                            and ticking them one at a time is the common complaint. */}
                                        <button
                                            type="button"
                                            onClick={() => setVehicleSelection(vehicle, true)}
                                            className="run-bulk-link"
                                        >
                                            all
                                        </button>
                                        <span className="text-meta text-xs select-none">/</span>
                                        <button
                                            type="button"
                                            onClick={() => setVehicleSelection(vehicle, false)}
                                            className="run-bulk-link"
                                        >
                                            none
                                        </button>
                                    </div>

                                    {isVehicleExpanded(vehicle.id) && (
                                        filteredRuns.length === 0 ? (
                                            <p className="text-sm text-meta italic">{emptyMessage}</p>
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
                                                        partnerLabel={partnerLabel}
                                                        singlePartner={singlePartner}
                                                        selectedRunIds={selectedRunIds}
                                                        onToggleRun={onToggleRun}
                                                        onSetPartner={onSetPartner}
                                                        onAddPartner={onAddPartner}
                                                        onRemovePartner={onRemovePartner}
                                                        onUpdateRunColor={onUpdateRunColor}
                                                        onUpdateRunColors={onUpdateRunColors}
                                                        colorSeries={colorSeries}
                                                        renderRunBadges={renderRunBadges}
                                                        renderRunMeta={renderRunMeta}
                                                        colorMap={colorMap}
                                                        chartPalette={chartPalette}
                                                        onChartPaletteChange={onChartPaletteChange}
                                                    />
                                                ) : (
                                                    <RunRow
                                                        key={run.id}
                                                        run={run}
                                                        vehicle={vehicle}
                                                        isChecked={isSelected(run)}
                                                        onToggle={() => onToggleRun(run.id)}
                                                        onUpdateRunColor={onUpdateRunColor}
                                                        onUpdateRunColors={onUpdateRunColors}
                                                        colorSeries={colorSeries}
                                                        renderRunBadges={renderRunBadges}
                                                        renderRunMeta={renderRunMeta}
                                                        colorMap={colorMap}
                                                        chartPalette={chartPalette}
                                                        onChartPaletteChange={onChartPaletteChange}
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
 * The first row carries the checkbox, color and charging-test name; additional
 * partners are continuation rows showing only their own dropdown, so a single
 * curve compared across three conditions reads as one block rather than three
 * unrelated entries.
 */
function PairRows({
    run, vehicle, partnerIds, partnerRuns, resolvePartner,
    partnerLabel, singlePartner,
    selectedRunIds, onToggleRun, onSetPartner, onAddPartner, onRemovePartner,
    onUpdateRunColor, onUpdateRunColors, colorSeries, renderRunBadges, renderRunMeta, colorMap,
    chartPalette, onChartPaletteChange,
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

    // The run behind a partner row: what was pinned, or whatever the resolver
    // chose when nothing is. A pair row names two tests from two sources — a
    // run holds at most one url since migration 046 — so crediting the partner
    // means finding its row and asking it, not reading a field off this one.
    const partnerRunFor = (partnerId) => partnerId
        ? (partnerRuns.find(r => String(r.id) === String(partnerId)) ?? null)
        : (auto?.sourceRun ?? null);

    const rowKey = (partnerId) => singlePartner ? String(run.id) : pairKey(run.id, partnerId);
    const isSelected = (partnerId) =>
        selectedRunIds.some(id => String(id) === rowKey(partnerId));

    return (
        <div className="pair-group">
            {partnerIds.map((partnerId, idx) => (
                <label
                    key={partnerId ?? 'auto'}
                    className={`pair-row ${idx > 0 ? 'is-child' : ''} ${isSelected(partnerId) ? '' : 'opacity-60 hover:opacity-100'}`}
                >
                    {/* The branch glyph leads on an added pairing, so the eye
                        finds the indent before it finds the control. */}
                    {idx > 0 && <span className="pair-branch" aria-hidden="true">↳</span>}
                    <input
                        type="checkbox"
                        checked={isSelected(partnerId)}
                        onChange={() => onToggleRun(singlePartner ? run.id : rowKey(partnerId))}
                    />
                    {/* An added pairing is its own plotted series, so it carries
                        its own swatch. It plots the same charging run against a
                        different partner, which is exactly what the swatch and
                        the dropdown beside it say together. */}
                    {idx > 0 && (
                        <RunColorControl
                            run={run}
                            vehicle={vehicle}
                            vehicleId={vehicle.id}
                            vehicleName={vehicle.name}
                            onUpdateRunColor={onUpdateRunColor}
                            onUpdateRunColors={onUpdateRunColors}
                            colorSeries={colorSeries}
                            colorMap={colorMap}
                            chartPalette={chartPalette}
                            onChartPaletteChange={onChartPaletteChange}
                        />
                    )}

                    {/* Charging test identity — only on the first row of the group.
                        No date or speed here: speed belongs to the range test, and
                        this side of the row is about the charging curve. */}
                    {idx === 0 ? (
                        <span className="pair-charging-label">
                            <RunColorControl
                                run={run}
                                vehicle={vehicle}
                                vehicleId={vehicle.id}
                                vehicleName={vehicle.name}
                                onUpdateRunColor={onUpdateRunColor}
                                onUpdateRunColors={onUpdateRunColors}
                                colorSeries={colorSeries}
                                colorMap={colorMap}
                                chartPalette={chartPalette}
                                onChartPaletteChange={onChartPaletteChange}
                            />
                            <span className="truncate" title={run.name}>{run.name}</span>
                            {/* Identity markers only. Conditions moved to their
                                own row: a paired row already spends a line on
                                the pairing, so name + chips + control on one
                                line meant the name lost every time. */}
                            {renderRunBadges?.(run)}
                            {/* Right-aligned: it is the one item on this line
                                that leaves the page, so it sits at the edge
                                rather than trailing whatever length the name
                                happened to be. */}
                            <RunSourceLinks run={run} className="shrink-0 ml-auto" />
                        </span>
                    ) : null}

                    {/* Row two: what this run measured. */}
                    {idx === 0 && renderRunMeta && (
                        <span className="run-row-meta">{renderRunMeta(run)}</span>
                    )}

                    {/* The range basis for this pair */}
                    <span className="pair-range-control" onClick={e => e.preventDefault()}>
                        {idx === 0 && <span className="text-label shrink-0">{partnerLabel}</span>}
                        <select
                            className="form-input"
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

                        {/* The partner's own source. An <option> cannot hold a
                            link, so without this the range test on every pair
                            row went uncredited (#205).

                            Relies on RunSourceLinks stopping propagation: this
                            span preventDefaults the click to keep the dropdown
                            from toggling the row, and a preventDefault anywhere
                            on the path would cancel the link's navigation. */}
                        <RunSourceLinks run={partnerRunFor(partnerId)} />

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

/**
 * The color control for one run, in a chart sidebar.
 *
 * Extracted from RunRow so pair rows get the same control: they had a swatch
 * that merely looked like a button, which left no way to change a color once
 * the pair charts stopped using the flat list.
 *
 * Everything this used to do itself now belongs to SeriesColorPicker, and one
 * piece of it went away entirely: the 400ms commit debounce and its blur
 * fallback existed only because `<input type="color">` fires on every pixel of
 * a drag. A panel that commits on Apply fires once.
 *
 * What is left is the part that is genuinely about this screen — that a write
 * here is a SESSION override and reaches no database, and that "Auto" means
 * handing the run back to the palette rather than clearing a stored value.
 */
function RunColorControl({ run, vehicle, vehicleId, vehicleName, onUpdateRunColor, onUpdateRunColors, colorSeries, colorMap = {}, chartPalette, onChartPaletteChange }) {
    if (!onUpdateRunColor) return null;
    // Synthetic rows (the EPA range option) have no run behind them to color.
    if (run._synthetic) return null;

    const plotted = plottedColorOf(run, colorMap, vehicle);

    return (
        <SeriesColorPicker
            value={plotted}
            // No stored preference to differ from: a run does not own a
            // color since #308, and what a chart sidebar writes has always
            // been a session override. The vehicle's curated color is the
            // durable one, and it is edited on the vehicle form.
            stored={null}
            label={run.name}
            vehicleName={vehicleName}
            onChange={hex => onUpdateRunColor(vehicleId, run.id, hex)}
            onReset={() => onUpdateRunColor(vehicleId, run.id, null)}
            seriesId={run.id}
            vehicleId={vehicleId}
            series={colorSeries}
            onApplyMany={onUpdateRunColors}
            chartPalette={chartPalette}
            onChartPaletteChange={onChartPaletteChange}
            isAuto={colorSeries?.find(s => String(s.id) === String(run.id))?.auto}
        />
    );
}

/**
 * Two lines, the same shape as a paired row: what this run IS, then what it
 * measured. It was one line — checkbox, color, name, source link, date, and
 * however many metric badges the view wanted — which wrapped into a ragged
 * block the moment it met a 320px rail.
 *
 * The date is gone. It disambiguated runs back when they were "Charging test"
 * and "Charging test"; the names carry that now, and in a rail it was spending
 * a third of the identity line on a fact nobody was comparing.
 */
function RunRow({ run, vehicle, isChecked, onToggle, onUpdateRunColor, onUpdateRunColors, colorSeries, renderRunBadges, renderRunMeta, colorMap = {}, chartPalette, onChartPaletteChange }) {
    const meta = renderRunMeta?.(run);
    return (
        <label className={`pair-row ${isChecked ? '' : 'opacity-60 hover:opacity-100'}`}>
            <input
                type="checkbox"
                checked={isChecked}
                onChange={onToggle}
            />
            <span className="pair-charging-label">
                <RunColorControl
                    run={run}
                    vehicle={vehicle}
                    vehicleId={vehicle.id}
                    vehicleName={vehicle.name}
                    onUpdateRunColor={onUpdateRunColor}
                    onUpdateRunColors={onUpdateRunColors}
                    colorSeries={colorSeries}
                    colorMap={colorMap}
                    chartPalette={chartPalette}
                    onChartPaletteChange={onChartPaletteChange}
                />
                <span className="truncate" title={run.name}>{run.name}</span>
                {renderRunBadges?.(run)}
                <RunSourceLinks run={run} className="shrink-0 ml-auto" />
            </span>
            {meta && <span className="run-row-meta">{meta}</span>}
        </label>
    );
}

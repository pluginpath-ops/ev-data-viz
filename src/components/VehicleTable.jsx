/**
 * The vehicle table (#315): every vehicle a row, anything worth comparing a
 * column, over the whole fleet. Replaces Compare Specs.
 *
 * ── Selecting here IS selecting ─────────────────────────────────────────────
 *
 * The checkbox adds a vehicle to the app's selection — the same
 * `selectedVehicles` the chips render and every chart reads. There is no second,
 * local notion of chosen. The band at the top holds the selected vehicles, in
 * chip order, kept through filters and sorting; deselecting one drops it from
 * every chart, which is intended. Sorting by a header reorders the selection to
 * match (#457), so the chips and the charts follow the table. (The band borrows the FE Guide's pinned band,
 * but it is a selection, not a pin — see docs/vocabulary.md, Tables.)
 *
 * ── State ───────────────────────────────────────────────────────────────────
 *
 * Columns, sort and filters live in the URL under `vt_` parameters, merged into
 * the query the chart URL writer owns — which carries them over rather than
 * dropping them. A row opens the vehicle's specs, where community members vouch
 * for or flag individual values.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { useAsyncResource } from '../hooks/useAsyncResource';
import VehicleTableGrid from './vehicles/VehicleTableGrid';
import FeatureChartButton from './home/FeatureChartButton';
import ColumnPicker from './tables/ColumnPicker';
import PresetPicker from './tables/PresetPicker';
import { sessionFor } from '../utils/testSessions';
import { DEFAULT_CORRECTION_TARGET, DEFAULT_READER_MODE } from '../utils/correctionSettings';
import VehicleTableAssumptions from './VehicleTableAssumptions';
import useColumnDrag from '../hooks/useColumnDrag';
import TableCell from './tables/TableCell';
import { useCellPeek } from '../hooks/useCellPeek';
import TestPeek from './TestPeek';
import { cellUnit, figureWithUnit } from '../utils/tableColumns';
import VehicleFilterBar from './vehicles/VehicleFilterBar';
import { useFilteredVehicles } from '../hooks/useFilteredVehicles';
import { decodeVehicleFilters } from '../utils/vehicleFilters';
import ViewSpecsModal from './ViewSpecsModal';
import VehicleCardPopover from './vehicles/VehicleCardPopover';
import { groupPerformanceByVehicle } from '../utils/dataChecks';
import { reorderSelectionBySort } from '../utils/sortSelection';
import {
    VEHICLE_COLUMNS, DEFAULT_VEHICLE_COLUMNS, VEHICLE_TABLE_PARAM_PREFIX,
    vehicleColumnByKey, unitFor, needsPerformance, buildVehicleRows, formatVehicleCell,
    sortVehicleRows, firstSortDir,
    vehicleBarMaxima, encodeVehicleTableParams, decodeVehicleTableParams,
    vehicleTableStartSearch, vehicleTableMemory, PRESETS, vehiclePresetByKey, presetMatching,
    labelledColumn, needsAssumptions, assumptionsFor,
} from '../utils/vehicleTable';

/*
 * Columns and sort are kept across visits; the reasoning is at
 * vehicleTableStartSearch. Storage can be missing or refuse a write (a private
 * window, blocked site data), and the table must still work, so every touch is
 * guarded and a failure just means no memory. Filters are not the table's to
 * remember since #338: they are Vehicles & Specs', held by App.
 */
const VIEW_KEY = 'evbench.vehicleTable.view';

function readMemory() {
    try { return { view: window.localStorage.getItem(VIEW_KEY) ?? '' }; } catch { return { view: '' }; }
}

function writeMemory({ view }) {
    try { if (view) window.localStorage.setItem(VIEW_KEY, view); else window.localStorage.removeItem(VIEW_KEY); } catch { /* no memory, no harm */ }
}

/**
 * Props:
 *   onOpenTest  {(TestReference) => void}  open a test in Tests & Data
 *               without a reload; absent in the pop-out window
 *   onViewRuns  {(vehicle, subtab?) => void}  open a vehicle's Tests & Data,
 *               from its card; absent in the pop-out window
 */
export default function VehicleTable({
    onOpenTest = null, onViewRuns = null, filters: sharedFilters = null, onFiltersChange = null,
    correctionTarget: sharedTarget = null, onCorrectionTargetChange = null,
    // The reader's correction mode, set on the charts' Correct control. Read
    // only here: 'none' shows the reported test's figures as measured.
    correctionMode = DEFAULT_READER_MODE,
}) {
    const {
        vehicles, selectedVehicles, toggleVehicleSelection, setVehicleSelection, units, platformsById,
        getPerformanceSummaries, getPerformanceSessions, performanceCounts, testSessions,
    } = useAppContext();

    const [initial] = useState(() => decodeVehicleTableParams(
        vehicleTableStartSearch(window.location.search, readMemory()),
    ));
    const [columns, setColumns] = useState(initial.columns);
    const [sortKey, setSortKey] = useState(initial.sortKey);
    const [sortDir, setSortDir] = useState(initial.sortDir);
    // Vehicles & Specs' filters, shared with Cards and List (#338). The pop-out
    // window has no App to share them with, so it keeps its own, from its URL.
    const [localFilters, setLocalFilters] = useState(() => decodeVehicleFilters(window.location.search));
    const filters = sharedFilters ?? localFilters;
    const setFilters = onFiltersChange ?? setLocalFilters;
    const [assumptions, setAssumptions] = useState(initial.assumptions);
    // The site-wide correction target (correctionSettings.js), App's. The
    // pop-out window shows the one it was handed and keeps any change local.
    const [localTarget, setLocalTarget] = useState(sharedTarget ?? DEFAULT_CORRECTION_TARGET);
    const correctionTarget = onCorrectionTargetChange ? (sharedTarget ?? DEFAULT_CORRECTION_TARGET) : localTarget;
    const setCorrectionTarget = onCorrectionTargetChange ?? setLocalTarget;
    // The preset the columns last WERE, kept so a changed set can say what it
    // was changed from. Which preset is showing is never stored: it is read
    // off the columns (presetMatching).
    const [origin, setOrigin] = useState(initial.modifiedFrom ?? presetMatching(initial.columns)?.key ?? null);
    const shownPreset = presetMatching(columns);
    const modifiedFrom = shownPreset ? null : origin;
    const [viewing, setViewing] = useState(null);

    // The table's own parameters, merged into whatever else the query holds.
    // replaceState: a filter change is not a place the back button should stop.
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        for (const key of [...params.keys()]) {
            if (key.startsWith(VEHICLE_TABLE_PARAM_PREFIX)) params.delete(key);
        }
        for (const [key, value] of encodeVehicleTableParams({ columns, sortKey, sortDir, modifiedFrom, assumptions })) {
            params.append(key, value);
        }
        window.history.replaceState(window.history.state, '', `?${params.toString()}`);
        writeMemory(vehicleTableMemory({ columns, sortKey, sortDir, modifiedFrom, assumptions }));
    }, [columns, sortKey, sortDir, modifiedFrom, assumptions]);

    // Tested results are fetched only while a tested column is shown or sorted
    // by: sessions carry every run and split, which is the heaviest read here.
    const wantsPerformance = needsPerformance([...columns, sortKey]);
    const idsKey = vehicles.map(v => v.id).join(',');
    const loadPerformance = useCallback(async () => {
        if (!wantsPerformance || !idsKey) return null;
        const ids = vehicles.map(v => v.id);
        const [summaries, sessions] = await Promise.all([getPerformanceSummaries(ids), getPerformanceSessions(ids)]);
        return groupPerformanceByVehicle(summaries ?? [], sessions ?? []);
        // Keyed on the ids, not the fleet array: every save hands back a new
        // array, and refetching every run after each edit elsewhere is waste.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [wantsPerformance, idsKey]);
    const { data: performance, loading: performanceLoading } = useAsyncResource(loadPerformance, [loadPerformance]);

    // A range test's session supplies the conditions it omits, which the
    // composite range corrects for.
    const rows     = useMemo(
        () => buildVehicleRows(vehicles, {
            performance, assumptions, units, platformsById, correctionTarget, correctionMode,
            sessionOf: r => sessionFor(testSessions, r),
        }),
        [vehicles, performance, assumptions, units, platformsById, testSessions, correctionTarget, correctionMode],
    );
    // A tested cell peeks with its test — which one, why, and its conditions —
    // rather than restating its own text. One peek for every clipped cell in
    // the table, rather than one per cell.
    const rowsById = useMemo(() => new Map(rows.map(r => [String(r.id), r])), [rows]);
    const renderPeek = useCallback((cell) => {
        const key = cell.dataset.test;
        const row = key ? rowsById.get(cell.closest('tr')?.dataset.rowId) : null;
        const test = row?.tests?.[key];
        const col = vehicleColumnByKey(key);
        if (!test || !col) return null;
        const unit = cellUnit(unitFor(col, units), row.values[key]);
        const figure = `${labelledColumn(col, assumptions, units, correctionTarget, correctionMode).label}: ${figureWithUnit(formatVehicleCell(row, col, units), unit)}`;
        return <TestPeek test={test} figure={figure} />;
    }, [rowsById, assumptions, units, correctionTarget, correctionMode]);
    const { tableProps: peekProps, panel: cellPeek } = useCellPeek({ renderPeek });
    const { ctx: filterCtx, filtered: filteredVehicles } = useFilteredVehicles(vehicles, filters, performanceCounts);
    const shownIds = useMemo(() => new Set(filteredVehicles.map(v => v.id)), [filteredVehicles]);
    const filtered = useMemo(() => rows.filter(r => shownIds.has(r.id)), [rows, shownIds]);
    const sorted   = useMemo(() => sortVehicleRows(filtered, sortKey, sortDir), [filtered, sortKey, sortDir]);
    /** Every column change goes through here, so the preset it leaves is remembered. */
    const changeColumns = (next) => {
        if (shownPreset) setOrigin(shownPreset.key);
        setColumns(next);
    };
    /** A preset brings its columns and its sort; filters are the reader's and stay. */
    const pickPreset = (key) => {
        const preset = vehiclePresetByKey(key);
        if (!preset) return;
        setOrigin(preset.key);
        setColumns(preset.columns);
        setSortKey(preset.sortKey);
        setSortDir(preset.sortDir);
    };
    // Headers drag the same list the column picker does.
    const { dragProps, dragClass } = useColumnDrag({ visible: columns, fixedKey: 'name', onChange: changeColumns });
    // Named from the assumptions where a name carries one ("Time to add 150 mi").
    const label    = useCallback((col) => labelledColumn(col, assumptions, units, correctionTarget, correctionMode), [assumptions, units, correctionTarget, correctionMode]);
    const cols     = useMemo(() => columns.map(vehicleColumnByKey).filter(Boolean).map(label), [columns, label]);
    const pickable = useMemo(() => VEHICLE_COLUMNS.map(label), [label]);
    const maxima   = useMemo(() => vehicleBarMaxima(filtered, cols), [filtered, cols]);

    const byId = useMemo(() => new Map(rows.map(r => [r.id, r])), [rows]);
    const selectedRows = selectedVehicles.map(id => byId.get(id)).filter(Boolean);
    const bodyRows = sorted.filter(r => !selectedVehicles.includes(r.id));

    const sortBy = (key) => {
        const dir = key === sortKey ? (sortDir === 'asc' ? 'desc' : 'asc') : firstSortDir(vehicleColumnByKey(key));
        if (key !== sortKey) setSortKey(key);
        setSortDir(dir);
        // The selection follows the sort (#457): chips and charts take the
        // table's order. Over every row, not the filtered ones — the band keeps
        // a selected vehicle through filters. Held back while a tested column's
        // results are still loading, when every cell would read blank.
        if (needsPerformance([key]) && !performance) return;
        const next = reorderSelectionBySort(selectedVehicles, rows, key, dir);
        if (next !== selectedVehicles) setVehicleSelection(next);
    };
    const rowProps = { cols, units, maxima, onToggle: toggleVehicleSelection, onOpen: setViewing, onOpenTest, onViewRuns, performanceCounts };

    return (
        <div className="vehicle-table">
            <div className="guide-filter-strip">
                <PresetPicker
                    presets={PRESETS}
                    activeKey={shownPreset?.key}
                    modifiedKey={modifiedFrom}
                    onPick={pickPreset}
                />
            </div>
            {/* Vehicles & Specs' filter bar, the same above Cards and List (#338).
                The table's own controls ride in its row. */}
            <VehicleFilterBar
                vehicles={vehicles}
                filters={filters}
                onChange={setFilters}
                ctx={filterCtx}
                shownCount={sorted.length}
            >
                {needsAssumptions(columns) && (
                    <VehicleTableAssumptions
                        assumptions={assumptions} needed={assumptionsFor(columns)} units={units} onChange={setAssumptions}
                        correctionTarget={correctionTarget} onCorrectionTargetChange={setCorrectionTarget}
                    />
                )}
                {/* The table has no chart toolbar, so its Save as featured comparison is here. */}
                <FeatureChartButton className="btn btn-secondary" />
                <ColumnPicker
                    columns={pickable}
                    visible={columns}
                    defaults={DEFAULT_VEHICLE_COLUMNS}
                    fixedKey="name"
                    unitOf={col => unitFor(col, units)}
                    onChange={changeColumns}
                />
                {wantsPerformance && performanceLoading && <span className="text-meta">loading tested results…</span>}
            </VehicleFilterBar>

            <VehicleTableGrid
                cols={cols}
                sort={{ key: sortKey, dir: sortDir, onSort: sortBy }}
                drag={{ dragProps, dragClass }}
                selectedRows={selectedRows}
                bodyRows={bodyRows}
                rowProps={rowProps}
                peekProps={peekProps}
                peek={cellPeek}
                emptyText={rows.length ? 'No vehicles match these filters.' : 'No vehicles yet.'}
            />

            {viewing && <ViewSpecsModal vehicle={viewing} onClose={() => setViewing(null)} />}
        </div>
    );
}

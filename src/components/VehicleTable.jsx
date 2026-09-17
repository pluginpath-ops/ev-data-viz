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
 * every chart, which is intended. (The band borrows the FE Guide's pinned band,
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
import SortHeader from './tables/SortHeader';
import ColumnPicker from './tables/ColumnPicker';
import GuideFacetMenu from './epa/guide/GuideFacetMenu';
import ViewSpecsModal from './ViewSpecsModal';
import { vehicleColor } from '../utils/specHelpers';
import { groupPerformanceByVehicle } from '../utils/dataChecks';
import {
    VEHICLE_COLUMNS, DEFAULT_VEHICLE_COLUMNS, EMPTY_VEHICLE_FILTERS, VEHICLE_TABLE_PARAM_PREFIX,
    vehicleColumnByKey, unitFor, needsPerformance, buildVehicleRows, formatVehicleCell,
    filterVehicleRows, sortVehicleRows, firstSortDir, vehicleFacets, facetValues,
    vehicleBarMaxima, vehicleBarPercent, encodeVehicleTableParams, decodeVehicleTableParams,
} from '../utils/vehicleTable';

const FACETS = [
    { key: 'makes',  label: 'Make' },
    { key: 'years',  label: 'Year' },
    { key: 'drives', label: 'Drive' },
    { key: 'tags',   label: 'Tag' },
];

/** One vehicle. Rendered by the selected band and the body from the same component. */
function VehicleTableRow({ row, cols, units, maxima, selected, onToggle, onOpen }) {
    return (
        <tr className={`guide-row${selected ? ' selected' : ''}`} onClick={() => onOpen(row.vehicle)}>
            <td className="guide-td guide-td-select sticky-select" onClick={e => e.stopPropagation()}>
                <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => onToggle(row.id)}
                    aria-label={selected ? `Remove ${row.values.name} from the selection` : `Add ${row.values.name} to the selection`}
                />
            </td>
            {cols.map(col => {
                const text = formatVehicleCell(row, col, units);
                if (col.key === 'name') {
                    return (
                        <td key={col.key} className="guide-td sticky-name">
                            <span className="vehicle-table-name">
                                {/* The vehicle's series color, so a row ties to the
                                    same vehicle on every chart. */}
                                <span className="series-swatch" style={{ backgroundColor: vehicleColor(row.vehicle, row.index) }} aria-hidden="true" />
                                <span className="truncate" title={text}>{text}</span>
                            </span>
                        </td>
                    );
                }
                const note = row.notes[col.key];
                const pct = vehicleBarPercent(row, col, maxima);
                return (
                    <td key={col.key} className={`guide-td ${col.numeric ? 'numeric' : ''}`} title={note ? `${text} · ${note}` : undefined}>
                        {pct == null && !note ? text : (
                            <span className="guide-cell-stack">
                                <span>{text}</span>
                                {pct != null && <span className="guide-spark" style={{ '--bar-fill': `${pct}%` }} aria-hidden="true" />}
                                {/* Where a resolved or tested figure came from. */}
                                {note && <span className="vehicle-table-note">{note}</span>}
                            </span>
                        )}
                    </td>
                );
            })}
        </tr>
    );
}

export default function VehicleTable() {
    const {
        vehicles, selectedVehicles, toggleVehicleSelection, units,
        getPerformanceSummaries, getPerformanceSessions,
    } = useAppContext();

    const [initial] = useState(() => decodeVehicleTableParams(window.location.search));
    const [columns, setColumns] = useState(initial.columns);
    const [sortKey, setSortKey] = useState(initial.sortKey);
    const [sortDir, setSortDir] = useState(initial.sortDir);
    const [filters, setFilters] = useState(initial.filters);
    const [viewing, setViewing] = useState(null);

    // The table's own parameters, merged into whatever else the query holds.
    // replaceState: a filter change is not a place the back button should stop.
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        for (const key of [...params.keys()]) {
            if (key.startsWith(VEHICLE_TABLE_PARAM_PREFIX)) params.delete(key);
        }
        for (const [key, value] of encodeVehicleTableParams({ columns, sortKey, sortDir, filters })) {
            params.append(key, value);
        }
        window.history.replaceState(window.history.state, '', `?${params.toString()}`);
    }, [columns, sortKey, sortDir, filters]);

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

    const rows     = useMemo(() => buildVehicleRows(vehicles, { performance }), [vehicles, performance]);
    const facets   = useMemo(() => vehicleFacets(rows), [rows]);
    const filtered = useMemo(() => filterVehicleRows(rows, filters), [rows, filters]);
    const sorted   = useMemo(() => sortVehicleRows(filtered, sortKey, sortDir), [filtered, sortKey, sortDir]);
    const cols     = useMemo(() => columns.map(vehicleColumnByKey).filter(Boolean), [columns]);
    const maxima   = useMemo(() => vehicleBarMaxima(filtered, cols), [filtered, cols]);

    /**
     * Counts per facet value, each with that facet's own selection removed, so
     * a number says what clicking would LEAVE — the guide's rule.
     */
    const counts = useMemo(() => {
        const out = {};
        for (const f of FACETS) {
            const tally = new Map();
            for (const row of filterVehicleRows(rows, { ...filters, [f.key]: [] })) {
                for (const v of facetValues(row, f.key)) tally.set(v, (tally.get(v) ?? 0) + 1);
            }
            out[f.key] = tally;
        }
        return out;
    }, [rows, filters]);

    const byId = useMemo(() => new Map(rows.map(r => [r.id, r])), [rows]);
    const selectedRows = selectedVehicles.map(id => byId.get(id)).filter(Boolean);
    const bodyRows = sorted.filter(r => !selectedVehicles.includes(r.id));
    const span = cols.length + 1;

    const sortBy = (key) => {
        if (key === sortKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
        else {
            setSortKey(key);
            setSortDir(firstSortDir(vehicleColumnByKey(key)));
        }
    };
    const toggleFacet = (key) => (value) => setFilters(prev => ({
        ...prev,
        [key]: prev[key].includes(value) ? prev[key].filter(v => v !== value) : [...prev[key], value],
    }));
    const filtering = filters.search.trim() || FACETS.some(f => filters[f.key].length);
    const rowProps = { cols, units, maxima, onToggle: toggleVehicleSelection, onOpen: setViewing };

    return (
        <div className="vehicle-table">
            <div className="guide-filter-strip">
                <div className="guide-filter-row">
                    <input
                        type="search"
                        value={filters.search}
                        onChange={e => setFilters(prev => ({ ...prev, search: e.target.value }))}
                        placeholder="Search vehicles…"
                        aria-label="Search vehicles"
                        className="form-input guide-search-input"
                    />
                    {FACETS.map(f => (
                        <GuideFacetMenu
                            key={f.key}
                            label={f.label}
                            values={facets[f.key]}
                            selected={filters[f.key]}
                            countFor={v => counts[f.key].get(v) ?? 0}
                            onToggle={toggleFacet(f.key)}
                            onClear={() => setFilters(prev => ({ ...prev, [f.key]: [] }))}
                        />
                    ))}
                    <ColumnPicker
                        columns={VEHICLE_COLUMNS}
                        visible={columns}
                        defaults={DEFAULT_VEHICLE_COLUMNS}
                        fixedKey="name"
                        unitOf={col => unitFor(col, units)}
                        onChange={setColumns}
                    />
                    <div className="guide-filter-tally">
                        {wantsPerformance && performanceLoading && <span className="text-meta">loading tested results…</span>}
                        <span className="text-data">{sorted.length.toLocaleString()}</span>
                        <span className="guide-filter-tally-total">of {rows.length.toLocaleString()}</span>
                        {filtering && (
                            <button type="button" className="guide-filter-reset" onClick={() => setFilters(EMPTY_VEHICLE_FILTERS)}>
                                Reset
                            </button>
                        )}
                    </div>
                </div>
            </div>

            <div className="guide-table-container">
                <table className="guide-table">
                    <thead>
                        <tr>
                            <th className="guide-th guide-th-select sticky-select" />
                            {cols.map(col => (
                                <SortHeader key={col.key} col={col} sortKey={sortKey} sortDir={sortDir} onSort={sortBy} unit={unitFor(col, units)} />
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {selectedRows.length > 0 && (
                            <>
                                <tr className="vehicle-table-band">
                                    <td colSpan={span}>
                                        <div className="guide-band-content">
                                            <span className="text-nano">Selected · {selectedRows.length}</span>
                                            <span className="text-note">on every chart, and kept here through filters and sorting</span>
                                        </div>
                                    </td>
                                </tr>
                                {selectedRows.map(row => (
                                    <VehicleTableRow key={`selected-${row.id}`} row={row} selected {...rowProps} />
                                ))}
                                <tr className="vehicle-table-band-spacer"><td colSpan={span} /></tr>
                            </>
                        )}
                        {bodyRows.map(row => (
                            <VehicleTableRow key={row.id} row={row} selected={false} {...rowProps} />
                        ))}
                    </tbody>
                </table>
                {bodyRows.length === 0 && selectedRows.length === 0 && (
                    <div className="empty-state">
                        {rows.length ? 'No vehicles match these filters.' : 'No vehicles yet.'}
                    </div>
                )}
            </div>

            {viewing && <ViewSpecsModal vehicle={viewing} onClose={() => setViewing(null)} />}
        </div>
    );
}

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useAppContext } from '../../../context/AppContext';
import { useAsyncResource } from '../../../hooks/useAsyncResource';
import {
    decorateRow, buildFacets, filterRows, sortRows, buildBrandIndex,
    EMPTY_FILTERS, DEFAULT_COLUMNS, ROW_BUDGET,
    encodeGuideParams, decodeGuideParams, computeBarMaxima,
} from '../../../utils/feGuideBrowse';
import GuideFilterBar from './GuideFilterBar';
import GuideColumnPicker from './GuideColumnPicker';
import GuideTable from './GuideTable';
import GuideComparePanel from './GuideComparePanel';
import GuideDetailModal from './GuideDetailModal';
import LoadingSpinner from '../../LoadingSpinner';

/**
 * The public Fuel Economy Guide browser — phase 1 of #234, issue #235.
 *
 * EPA's published label data for every EV configuration it has rated has been
 * staged in `epa_fe_guide` since #206 and reachable only by an admin importing
 * it or a curator linking one row to a test group. This is the whole corpus,
 * browsable, filterable and comparable, with no curation required.
 *
 * ── Why the corpus loads in one go ──────────────────────────────────────────
 *
 * `getFeGuideRows` pages until exhausted, which is what keeps this honest — a
 * plain select would silently stop at PostgREST's 1000-row cap and show 1,000
 * of 1,175 with nothing to say so. Once loaded, filtering and sorting are local,
 * so every interaction is instant and costs no round trip. See the header of
 * `feGuideBrowse` for why this is not the aggregate case migration 054 fixed.
 */
const PAGE_SIZE = 50;

export default function EpaGuideView() {
    const { getFeGuideRows, getFeGuideVehicleLinks, getBrandAliases } = useAppContext();

    const loadRows    = useCallback(() => getFeGuideRows(), [getFeGuideRows]);
    const loadLinks   = useCallback(() => getFeGuideVehicleLinks(), [getFeGuideVehicleLinks]);
    const loadAliases = useCallback(() => getBrandAliases(), [getBrandAliases]);

    const { data: rawRows, loading, error } = useAsyncResource(loadRows, []);
    // The link map is a bonus, not a dependency: if it fails the browser still
    // works and simply shows no "tested" badges.
    const { data: links } = useAsyncResource(loadLinks, []);
    const vehicleLinks = links ?? {};

    // Also non-fatal. Migration 057 may not be applied, in which case every
    // division falls back to EPA's own spelling — an un-merged Make facet, not
    // a broken page.
    const { data: aliases } = useAsyncResource(loadAliases, []);
    const brandIndex = useMemo(() => buildBrandIndex(aliases ?? []), [aliases]);

    // Read the URL once, at mount. A filtered view is the shareable artefact
    // here, so a pasted link has to arrive already filtered.
    const [initial] = useState(() => decodeGuideParams(window.location.search));

    const [filters, setFilters]   = useState(initial.filters);
    const [sortKey, setSortKey]   = useState(initial.sortKey);
    const [sortDir, setSortDir]   = useState(initial.sortDir);
    const [columns, setColumns]   = useState(DEFAULT_COLUMNS);
    const [page, setPage]         = useState(initial.page);
    const [selectedIds, setSelectedIds] = useState(initial.selectedIds);
    const [openRow, setOpenRow]   = useState(null);
    const [showAllCompare, setShowAllCompare] = useState(false);

    // Keep the URL current with what is on screen. replaceState, not push: a
    // filter click is a refinement, and pushing would make Back walk through
    // every keystroke of the search box instead of leaving the tab.
    useEffect(() => {
        const p = encodeGuideParams({ filters, sortKey, sortDir, page, selectedIds });
        p.set('tab', 'epa');
        window.history.replaceState({ view: 'epa' }, '', `?${p.toString()}`);
    }, [filters, sortKey, sortDir, page, selectedIds]);

    // NOT `.map(decorateRow)` — Array.map passes the index as the second
    // argument, which would arrive as the brand index and resolve nothing.
    const rows   = useMemo(
        () => (rawRows ?? []).map(r => decorateRow(r, brandIndex)),
        [rawRows, brandIndex],
    );
    const facets = useMemo(() => buildFacets(rows), [rows]);

    const filtered = useMemo(() => filterRows(rows, filters), [rows, filters]);
    const sorted   = useMemo(() => sortRows(filtered, sortKey, sortDir), [filtered, sortKey, sortDir]);
    const pageRows = useMemo(
        () => sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
        [sorted, page],
    );
    // Scaled against everything the filter matches, not just this page, so
    // paging does not rescale the bars underneath the reader.
    const barMaxima = useMemo(() => computeBarMaxima(filtered), [filtered]);

    const compareRows = useMemo(
        () => selectedIds.map(id => rows.find(r => r.id === id)).filter(Boolean),
        [selectedIds, rows],
    );

    // Any change to what is being shown returns to the first page. Staying on
    // page 7 of a result set that now has two pages shows an empty table and
    // reads as "no results".
    const updateFilters = (patch) => { setFilters(f => ({ ...f, ...patch })); setPage(0); };
    const resetFilters  = () => { setFilters(EMPTY_FILTERS); setPage(0); };

    const handleSort = (key) => {
        if (key === sortKey) {
            setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortKey(key);
            // Numbers are almost always most interesting at the top, text at A.
            setSortDir(key === 'brand' || key === 'carline' || key === 'division' ? 'asc' : 'desc');
        }
        setPage(0);
    };

    const toggleSelect = (id) =>
        setSelectedIds(ids => (ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]));

    if (loading) return <LoadingSpinner />;

    if (error) {
        return (
            <div className="empty-state">
                The Fuel Economy Guide could not be loaded.
                <div className="text-caption text-muted mt-1">{String(error.message ?? error)}</div>
            </div>
        );
    }

    // Two different empty states. "Nothing imported" is an admin task and
    // "nothing matches" is a filter the reader set, and telling them apart is
    // the difference between a broken page and an answered question.
    if (rows.length === 0) {
        return (
            <div className="empty-state">
                No Fuel Economy Guide data has been imported yet.
                <div className="text-caption text-muted mt-1">
                    An admin can load a guide year from Admin → Fuel Economy Guide.
                </div>
            </div>
        );
    }

    const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));

    return (
        <div className="guide-view">
            <div className="section-header">
                <div>
                    <div className="section-title">EPA Fuel Economy Guide</div>
                    <div className="text-caption text-secondary">
                        EPA’s published label figures — {rows.length.toLocaleString()} configurations
                        across {facets.years.length} model years. Showing {sorted.length.toLocaleString()}.
                    </div>
                </div>

            </div>

            {rows.length > ROW_BUDGET && (
                <div className="guide-warning">
                    This view loads the whole corpus into the browser and it has grown past
                    {' '}{ROW_BUDGET.toLocaleString()} rows. Filtering should move to the server (#236).
                </div>
            )}

            <GuideFilterBar
                rows={rows}
                facets={facets}
                filters={filters}
                onChange={updateFilters}
                onReset={resetFilters}
                filterFn={filterRows}
                columnPicker={<GuideColumnPicker visible={columns} onChange={setColumns} />}
            />

            <GuideComparePanel
                rows={compareRows}
                showAll={showAllCompare}
                onToggleShowAll={() => setShowAllCompare(s => !s)}
                onClear={() => setSelectedIds([])}
                onRemove={toggleSelect}
            />

            <GuideTable
                rows={pageRows}
                visibleColumns={columns}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={handleSort}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
                onOpenRow={setOpenRow}
                vehicleLinks={vehicleLinks}
                barMaxima={barMaxima}
            />

            {sorted.length > PAGE_SIZE && (
                <div className="guide-pager">
                    <button className="btn btn-secondary" disabled={page === 0}
                        onClick={() => setPage(p => p - 1)}>Previous</button>
                    <span className="text-caption text-secondary">
                        Page {page + 1} of {totalPages}
                    </span>
                    <button className="btn btn-secondary" disabled={page >= totalPages - 1}
                        onClick={() => setPage(p => p + 1)}>Next</button>
                </div>
            )}

            {openRow && (
                <GuideDetailModal
                    row={openRow}
                    vehicles={vehicleLinks[openRow.id]?.vehicles ?? []}
                    onClose={() => setOpenRow(null)}
                />
            )}
        </div>
    );
}

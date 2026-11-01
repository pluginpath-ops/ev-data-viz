import { useState, useMemo, useEffect } from 'react';
import { useAppContext } from '../../context/AppContext';
import TestedViaSummary from './TestedViaSummary';
import GuideRowMatchList from './GuideRowMatchList';

/**
 * The vehicle's EPA Label: the Fuel Economy Guide rows that are this car, and
 * what stands behind each (migration 095, EPA identity layer 3).
 *
 * The link a curator makes here is the one a curator can judge — carline,
 * wheels, year. The test vehicles come with it through the row's Tested via:
 * an exact or near match links its one test vehicle, a blend links every
 * member and the nearest stands for the vehicle, an untested row links none.
 *
 * Under each row, every test vehicle of its certification, badged by how it
 * matches the row (GuideRowMatchList) — the configurations hang off the label,
 * not the other way round (owner, 2026-11-01: "the Guide row should have a
 * list of certifications that might match, with badges to show how well").
 *
 * Candidates are ranked as the test vehicle's Guide picker ranks them (make,
 * then carline similarity, the vehicle's year first). Tested via is worked
 * out for the few on screen only: each needs its certification's pool.
 */

const SHOWN = 6;

const rowTitle = (g) => [g.model_year, g.division, g.carline].filter(Boolean).join(' ');
const rowFigures = (g) => [
    g.label_comb_range_mi != null && `${g.label_comb_range_mi} mi`,
    g.label_comb_mpge != null && `${g.label_comb_mpge} MPGe`,
    g.drive_desc,
].filter(Boolean).join(' · ');

function GuideRowLine({ guide, via, action, children }) {
    return (
        <li className="py-2">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 text-xs">
                    <div className="font-medium">{rowTitle(guide)}</div>
                    <div className="text-meta">
                        {rowFigures(guide)}
                        {guide.smog_test_group && <> · Test Group <span className="font-mono">{guide.smog_test_group}</span></>}
                    </div>
                    <div className="mt-0.5"><TestedViaSummary via={via} /></div>
                </div>
                {action}
            </div>
            {children}
        </li>
    );
}

/** A candidate's test vehicles, folded: each one needs reading, and the list is long. */
function CandidateMatches({ row, others }) {
    const [open, setOpen] = useState(false);
    if (!row?.pool?.length) return null;
    return (
        <>
            <button type="button" className="fe-picker-link-btn mt-1" onClick={() => setOpen(o => !o)}>
                {open ? '▾' : '▸'} {row.pool.length} test vehicle{row.pool.length === 1 ? '' : 's'} in its certification
            </button>
            {open && <GuideRowMatchList row={row} others={others} />}
        </>
    );
}

function CandidatePicker({ vehicle, linkedIds, onLinked }) {
    const { getVehicleGuideCandidates, getGuideRowsTestedVia, linkVehicleGuideRow } = useAppContext();
    const [open, setOpen] = useState(false);
    const [candidates, setCandidates] = useState(null);
    const [query, setQuery] = useState('');
    const [vias, setVias] = useState({});
    const [busy, setBusy] = useState(null);
    const [error, setError] = useState(null);

    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        return (candidates ?? [])
            .filter(c => !linkedIds.has(c.row.id))
            .filter(c => !q || `${c.row.model_year} ${c.row.carline}`.toLowerCase().includes(q))
            .slice(0, SHOWN);
    }, [candidates, query, linkedIds]);

    // Tested via for what is on screen, once per row.
    const missing = shown.filter(c => !(c.row.id in vias)).map(c => c.row);
    const missingKey = missing.map(r => r.id).join(',');
    useEffect(() => {
        if (!open || !missingKey) return;
        let cancelled = false;
        getGuideRowsTestedVia(missing)
            .then(j => { if (!cancelled) setVias(v => ({ ...v, ...j })); })
            .catch(e => { if (!cancelled) setError(e.message); });
        return () => { cancelled = true; };
        // `missing` is keyed by missingKey; getGuideRowsTestedVia is recreated
        // on every provider render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, missingKey]);

    // The other candidates of the same certification, as far as they are
    // loaded — what "other label" is judged against for a candidate.
    const siblingsOf = (row) => (candidates ?? [])
        .filter(o => o.row.id !== row.id && o.row.smog_test_group === row.smog_test_group && vias[o.row.id])
        .map(o => ({ rowId: o.row.id, guide: o.row, via: vias[o.row.id].via }));

    const start = async () => {
        setOpen(true);
        if (candidates) return;
        try { setCandidates(await getVehicleGuideCandidates(vehicle)); }
        catch (e) { setError(e.message); }
    };

    const link = async (row) => {
        setBusy(row.id);
        try {
            const via = vias[row.id]?.via ?? (await getGuideRowsTestedVia([row]))[row.id]?.via;
            await linkVehicleGuideRow(vehicle.id, row, via);
            onLinked?.();
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy(null);
        }
    };

    if (!open) {
        return (
            <button type="button" className="fe-picker-link-btn mt-2" onClick={start}>
                + Link an EPA Label
            </button>
        );
    }
    return (
        <div className="mt-2">
            <div className="flex items-center gap-2">
                <input
                    type="text"
                    className="form-input w-full"
                    placeholder="Filter by year or carline…"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                />
                <button type="button" className="btn btn-secondary text-xs py-0.5 px-2" onClick={() => setOpen(false)}>Close</button>
            </div>
            {error && <p className="epa-label-error">{error}</p>}
            {candidates === null && !error && <p className="text-xs text-meta mt-1">Loading Guide rows…</p>}
            {candidates !== null && shown.length === 0 && (
                <p className="text-xs text-meta mt-1">No Guide rows for {vehicle.make || 'this make'} match.</p>
            )}
            <ul className="epa-label-rows">
                {shown.map(c => (
                    <GuideRowLine
                        key={c.row.id}
                        guide={c.row}
                        via={vias[c.row.id]?.via}
                        action={(
                            <button
                                type="button"
                                className="btn btn-secondary text-xs py-0.5 px-2 shrink-0 disabled:opacity-40"
                                disabled={busy != null}
                                onClick={() => link(c.row)}
                            >
                                {busy === c.row.id ? '…' : 'Link'}
                            </button>
                        )}
                    >
                        <CandidateMatches
                            row={vias[c.row.id] && { guide: c.row, ...vias[c.row.id] }}
                            others={siblingsOf(c.row)}
                        />
                    </GuideRowLine>
                ))}
            </ul>
        </div>
    );
}

export default function VehicleEpaLabel({ vehicle, guideRows, canEdit, onLinkTestVehicle, onUnlinkMapping }) {
    const { unlinkVehicleGuideRow } = useAppContext();
    const { data, loading, error, reload } = guideRows;
    const rows = data ? data.rows : null;
    const others = data?.others ?? [];
    const mappings = useMemo(() => new Map((vehicle?.epa_mappings ?? [])
        .filter(m => m.epaTestVehicle)
        .map(m => [m.epaTestVehicle.test_vehicle_id, m])), [vehicle?.epa_mappings]);
    const [busy, setBusy] = useState(null);
    const linkedIds = useMemo(() => new Set((rows ?? []).map(r => r.rowId)), [rows]);

    // Migration 095 not applied: nothing to show, and nothing a curator can do.
    if (!loading && !error && data === null) return null;

    const unlink = async (rowId) => {
        if (!window.confirm('Unlink this EPA Label? The configurations it linked go with it; ones linked by hand stay.')) return;
        setBusy(rowId);
        try { await unlinkVehicleGuideRow(vehicle.id, rowId); reload(); }
        finally { setBusy(null); }
    };

    return (
        <div className="card p-3 mt-3 mb-3">
            <div className="text-micro">EPA Label</div>
            {loading && !rows && <p className="text-xs text-meta mt-1">Loading…</p>}
            {error && <p className="epa-label-error">{error.message}</p>}
            {rows?.length === 0 && (
                <p className="text-xs text-secondary mt-1">
                    No Guide row linked. Link the vehicle's EPA Label and its tested configurations come with it.
                </p>
            )}
            {rows?.length > 0 && (
                <ul className="epa-label-rows">
                    {rows.map(r => (
                        <GuideRowLine
                            key={r.rowId}
                            guide={r.guide}
                            via={r.via}
                            action={canEdit && (
                                <button
                                    type="button"
                                    className="btn btn-secondary text-xs py-0.5 px-2 shrink-0 disabled:opacity-40"
                                    disabled={busy != null}
                                    onClick={() => unlink(r.rowId)}
                                    title="Unlink this Guide row, and the configurations it linked"
                                >
                                    {busy === r.rowId ? '…' : 'Unlink label'}
                                </button>
                            )}
                        >
                            <GuideRowMatchList
                                row={r}
                                others={others}
                                mappings={mappings}
                                canEdit={canEdit}
                                onLink={onLinkTestVehicle}
                                onUnlink={onUnlinkMapping}
                            />
                        </GuideRowLine>
                    ))}
                </ul>
            )}
            {canEdit && <CandidatePicker vehicle={vehicle} linkedIds={linkedIds} onLinked={reload} />}
        </div>
    );
}

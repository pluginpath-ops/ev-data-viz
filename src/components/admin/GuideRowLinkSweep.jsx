import { useState, useMemo, useCallback } from 'react';
import { useAppContext } from '../../context/AppContext';
import { useAsyncResource } from '../../hooks/useAsyncResource';
import { buildGuideRowSweep, bulkLinks, applyDecisions } from '../../utils/guideRowSweep';
import { formatShare } from '../../utils/guideRowMatches';
import TestedViaSummary from '../epa/TestedViaSummary';
import GuideMatchBadge from '../epa/GuideMatchBadge';
import GuideModelTypeDesc from '../epa/GuideModelTypeDesc';

/**
 * Link the Fuel Economy Guide to the certification records, one Guide row at
 * a time (#238, flipped 2026-11-02 — see utils/guideRowSweep.js for why).
 *
 * Nothing is written until Submit. Each tick queues a decision; Submit sends
 * the links through the batch path (one app refresh, not one per link) and
 * the skips after them, then updates the list in place. The old sweep linked
 * on every click and reloaded the whole list, which froze for seconds and
 * threw away the curator's place.
 */

const STATUS = [
    { key: 'ready',     label: 'Ready',           why: 'Tested via names a test vehicle that is not linked yet' },
    { key: 'judgement', label: 'Needs judgement', why: 'Test vehicles await a decision, but Tested via names none of them' },
    { key: 'done',      label: 'Done',            why: 'Every test vehicle of its certification is decided' },
];
const PAGE = 40;
const SKIP_NOTE = 'Link sweep: no Guide row of its certification stands for this test vehicle';

/** A badge's color, read for linking: green where Tested via names it, amber where it might. */
function intentOf(m) {
    if (['exact', 'near', 'blend'].includes(m.match)) return 'is-good';
    return ['possible', 'alternative'].includes(m.match) ? 'is-warning' : '';
}

function GuideRowFacts({ row }) {
    const kwh = (v) => (v == null ? null : Number(v).toFixed(2));
    return (
        <div className="text-meta">
            {row.label_comb_range_mi != null && `${row.label_comb_range_mi} mi`}
            {row.label_comb_mpge != null && ` · ${row.label_comb_mpge} MPGe`}
            {row.unadj_city_kwh_100mi != null && ` · ${kwh(row.unadj_city_kwh_100mi)} / ${kwh(row.unadj_hwy_kwh_100mi)} kWh/100mi unadjusted`}
            {row.drive_desc && ` · ${row.drive_desc}`}
        </div>
    );
}

/** One test vehicle under a row: how it matches, and what can be decided for it. */
function SweepMatch({ match: m, rowId, titleOf, queued, onToggle }) {
    const mine = queued?.rowId === rowId && !queued.skip;
    const skipping = queued?.skip;
    const elsewhere = queued && !queued.skip && queued.rowId !== rowId;
    return (
        <li className="guide-match-row">
            <span className="guide-match-fit">
                <GuideMatchBadge match={m.match} intent={intentOf(m)} />
                {m.nearest && <span className="badge-micro is-good" title="The blend member nearest the row">nearest</span>}
            </span>
            <span className="min-w-0">
                <span className="font-mono">{m.test_vehicle_id}</span>
                {m.carline && <span className="text-meta"> · {m.carline}</span>}
                {m.match === 'other-label' && titleOf(m.otherRowId) && (
                    <span className="text-meta block truncate">behind {titleOf(m.otherRowId)}</span>
                )}
                {m.behindNoLabel && <span className="text-meta block">marked behind no EPA Label</span>}
                {m.alsoNamedBy?.length > 0 && m.state === 'awaiting' && (
                    <span className="text-meta block truncate"
                        title="Their figures are identical, and a test vehicle links one row per certification: link it to the row that is the car tested; the vehicle’s EPA Label can still link both">
                        also named by {m.alsoNamedBy.map(o => titleOf(o.rowId)).join(', ')} — pick one
                    </span>
                )}
            </span>
            <span className="guide-match-delta" title="Its unadjusted kWh/100mi against the row’s">
                {m.delta ? `city ${formatShare(m.delta.city)} · hwy ${formatShare(m.delta.hwy)}` : '—'}
            </span>
            <span className="guide-match-action">
                {m.state === 'here' && <span className="badge-micro is-accent">linked</span>}
                {m.state === 'elsewhere' && (
                    <span className="text-meta" title={titleOf(m.membership.fe_guide_row_id) ?? ''}>linked to another row</span>
                )}
                {m.state === 'skipped' && <span className="text-meta">skipped</span>}
                {m.state === 'none' && (
                    <span className="text-meta"
                        title="Tested for another year’s certification, which carries this row’s test group over. This row’s Tested via reads it all the same; its link goes on a row of that year">
                        {m.homeYears?.length ? `MY${m.homeYears.join('/')} — link it there` : 'other year'}
                    </span>
                )}
                {m.state === 'awaiting' && (
                    <>
                        {elsewhere && <span className="text-meta">queued for {titleOf(queued.rowId) ?? 'another row'}</span>}
                        <label className="sweep-queue-toggle" title="Queue a link from this test vehicle to this row">
                            <input type="checkbox" checked={mine} disabled={m.match === 'no-lab-data'}
                                onChange={() => onToggle(m, mine ? null : { rowId })} />
                            link
                        </label>
                        <label className="sweep-queue-toggle" title="Queue a skip: no Guide row of its certification stands for this test vehicle">
                            <input type="checkbox" checked={!!skipping}
                                onChange={() => onToggle(m, skipping ? null : { skip: true })} />
                            skip
                        </label>
                    </>
                )}
            </span>
        </li>
    );
}

function SweepGuideRow({ item, titleOf, queue, onToggle, onQueueNamed }) {
    const { row, via } = item;
    // A test vehicle another row has already claimed is noise here, unless it
    // reproduces this row exactly — then it is the choice to see.
    const matches = item.matches.filter(m => m.state !== 'elsewhere' || m.match === 'exact');
    const named = matches.filter(m => m.state === 'awaiting' && ['exact', 'near', 'blend'].includes(m.match));
    const allQueued = named.length > 0 && named.every(m => queue.get(m.membership.membershipId)?.rowId === row.id);
    return (
        <div className={`sweep-row ${item.status === 'done' ? 'is-done' : ''}`}>
            <div className="sweep-row-main">
                <div className="min-w-0">
                    <div className="sweep-test-vehicle-name">{row.carline}</div>
                    <GuideModelTypeDesc guide={row} />
                    <div className="text-meta">MY{row.model_year} {row.division} · {row.smog_test_group}</div>
                    <GuideRowFacts row={row} />
                </div>
                <div className="min-w-0 text-xs"><TestedViaSummary via={via} /></div>
                <div className="sweep-actions">
                    {named.length > 0 && (
                        <button type="button" className="btn btn-secondary"
                            onClick={() => onQueueNamed(named, allQueued ? null : row.id)}>
                            {allQueued ? 'Unqueue' : `Queue ${named.length} named`}
                        </button>
                    )}
                </div>
            </div>
            {matches.length > 0 ? (
                <ul className="guide-match-list" aria-label="Test vehicles in its certification">
                    {matches.map(m => (
                        <SweepMatch key={m.test_vehicle_id} match={m} rowId={row.id} titleOf={titleOf}
                            queued={m.membership ? queue.get(m.membership.membershipId) : null} onToggle={onToggle} />
                    ))}
                </ul>
            ) : (
                <div className="text-note">No test vehicle of its certification is imported.</div>
            )}
        </div>
    );
}

export default function GuideRowLinkSweep() {
    const { getGuideRowSweep, getFeLinkProgress, linkFeGuideRows, setFeLinkSkipped } = useAppContext();

    const loadSweep = useCallback(() => getGuideRowSweep(), [getGuideRowSweep]);
    const loadProgress = useCallback(() => getFeLinkProgress(), [getFeLinkProgress]);
    const { data, loading, error } = useAsyncResource(loadSweep, []);
    const { data: progress, reload: reloadProgress } = useAsyncResource(loadProgress, []);

    // Decisions already written this visit, laid over what was loaded — the
    // list updates in place instead of reloading.
    const [written, setWritten] = useState([]);
    const [queue, setQueue] = useState(() => new Map());
    const [status, setStatus] = useState('ready');
    const [make, setMake] = useState('');
    const [year, setYear] = useState('');
    const [hideLinked, setHideLinked] = useState(false);
    const [shown, setShown] = useState(PAGE);
    const [showOrphans, setShowOrphans] = useState(false);
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState(null);
    // Each row's status as it stood when the list was last filtered. A row
    // finished by a submit stays where it is, marked done, rather than
    // leaving the list and moving everything under the cursor; changing a
    // filter re-reads the live status.
    const [frozen, setFrozen] = useState(null);

    const members = useMemo(() => applyDecisions(data?.members ?? [], written), [data, written]);
    const { items, orphans } = useMemo(() => buildGuideRowSweep(data?.rows ?? [], members), [data, members]);

    const rowById = useMemo(() => new Map((data?.rows ?? []).map(r => [r.id, r])), [data]);
    const titleOf = useCallback((id) => {
        const r = rowById.get(id);
        return r ? `${r.model_year} ${r.carline}` : null;
    }, [rowById]);

    const makes = useMemo(() => [...new Set(items.map(i => i.row.division).filter(Boolean))].sort(), [items]);
    const years = useMemo(() => [...new Set(items.map(i => i.row.model_year))].sort((a, b) => b - a), [items]);
    const filtered = useMemo(() => items
        .filter(i => (!make || i.row.division === make) && (!year || String(i.row.model_year) === year))
        .sort((a, b) => b.row.model_year - a.row.model_year
            || String(a.row.division).localeCompare(String(b.row.division))
            || String(a.row.carline).localeCompare(String(b.row.carline))), [items, make, year]);
    const counts = useMemo(() => Object.fromEntries(STATUS.map(s => [s.key, filtered.filter(i => i.status === s.key).length])), [filtered]);
    const hasLink = (i) => i.matches.some(m => m.state === 'here');
    const visible = filtered.filter(i => {
        const was = frozen?.get(i.row.id);
        return (was?.status ?? i.status) === status && !(hideLinked && (was?.linked ?? hasLink(i)));
    });
    const refilter = (fn) => (e) => { fn(e); setFrozen(null); setShown(PAGE); };
    // Bulk queuing reaches only the rows on screen, a page at a time: a
    // curator looks over what a button is about to queue before Submit, and
    // "Show more" is how the next page joins it.
    const page = visible.slice(0, shown);
    const sure = bulkLinks(page, 'sure');
    const named = bulkLinks(page, 'named');

    /** Queue, replace or clear one membership's decision. */
    const toggle = (m, decision) => setQueue(q => {
        const next = new Map(q);
        const id = m.membership.membershipId;
        if (decision) next.set(id, { membershipId: id, testVehicleId: m.test_vehicle_id, ...decision });
        else next.delete(id);
        return next;
    });
    const queueMany = (entries) => setQueue(q => {
        const next = new Map(q);
        for (const e of entries) next.set(e.membershipId, e);
        return next;
    });
    const queueNamed = (named, rowId) => setQueue(q => {
        const next = new Map(q);
        for (const m of named) {
            const id = m.membership.membershipId;
            if (rowId == null) next.delete(id);
            else next.set(id, { membershipId: id, testVehicleId: m.test_vehicle_id, rowId });
        }
        return next;
    });

    const submit = async () => {
        const entries = [...queue.values()];
        const links = entries.filter(e => !e.skip);
        const skips = entries.filter(e => e.skip);
        setBusy(true); setNote(null);
        setFrozen(f => f ?? new Map(items.map(i => [i.row.id, { status: i.status, linked: hasLink(i) }])));
        const done = [];
        const failed = [];
        try {
            if (links.length) {
                const res = await linkFeGuideRows(links.map(e => ({
                    testVehicleId: e.testVehicleId, feRowId: e.rowId, linkRowId: e.membershipId,
                })));
                const bad = new Set(res.failures.map(f => f.testVehicleId));
                for (const e of links) (bad.has(e.testVehicleId) ? failed : done).push(e);
            }
            for (const e of skips) {
                try {
                    await setFeLinkSkipped(e.testVehicleId, true, SKIP_NOTE, { linkRowId: e.membershipId });
                    done.push({ ...e, note: SKIP_NOTE });
                } catch {
                    failed.push(e);
                }
            }
        } catch (err) {
            setNote(`Failed: ${err.message}`);
        } finally {
            setWritten(w => [...w, ...done]);
            setQueue(new Map(failed.map(e => [e.membershipId, e])));
            if (done.length) setNote(`${done.filter(e => !e.skip).length} linked, ${done.filter(e => e.skip).length} skipped`
                + (failed.length ? ` · ${failed.length} failed and stay queued` : '') + '.');
            reloadProgress();
            setBusy(false);
        }
    };

    if (loading) return <div className="text-note">Loading the Guide and its certifications…</div>;
    if (error) return <div className="empty-state">Could not load the sweep: {String(error.message ?? error)}</div>;

    const queued = [...queue.values()];
    const unqueued = (list) => list.filter(e => queue.get(e.membershipId)?.rowId !== e.rowId);
    const sureNew = unqueued(sure);
    const namedNew = unqueued(named);

    return (
        <div className="flex flex-col gap-4">
            <div className="section-header">
                <div>
                    <div className="section-header-title">Link Guide rows to their test vehicles</div>
                    {progress && (
                        <div className="text-note">
                            {progress.linked} linked · {progress.awaiting} awaiting a decision
                            {progress.skipped > 0 && ` · ${progress.skipped} skipped`}
                            {' '}of {progress.total} certification memberships
                        </div>
                    )}
                </div>
            </div>

            <div className="text-note">
                Each EPA Label row lists the test vehicles of its certification, badged by how their lab figures
                match it. Tick what to link or skip; nothing is written until Submit. A test vehicle links one row
                per certification — where one test stands behind two rows, link the nearer and let the vehicle’s
                EPA Label link both.
            </div>

            <div className="sweep-batch sweep-queue-bar">
                <div className="text-note">
                    <strong>{queued.length}</strong> queued
                    {queued.length > 0 && ` (${queued.filter(e => !e.skip).length} links, ${queued.filter(e => e.skip).length} skips)`}
                    {namedNew.length > 0 && (
                        <> · on the {page.length} rows shown, {namedNew.length} more are named by one row’s Tested via
                        {sureNew.length > 0 && `, ${sureNew.length} of them sure (one test vehicle reproduces the row)`}</>
                    )}
                    {note && <> · {note}</>}
                </div>
                <div className="sweep-actions">
                    {sureNew.length > 0 && (
                        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => queueMany(sureNew)}
                            title="On the rows shown: those one test vehicle reproduces, exactly or within rounding">
                            Queue {sureNew.length} sure shown
                        </button>
                    )}
                    {namedNew.length > sureNew.length && (
                        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => queueMany(namedNew)}
                            title="On the rows shown: the sure rows, and every member of each blend — what each row’s Tested via names. A test vehicle two rows name goes to the row of its own carline; where neither is, it is left to you.">
                            Queue {namedNew.length} named shown
                        </button>
                    )}
                    {queued.length > 0 && (
                        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setQueue(new Map())}>Clear</button>
                    )}
                    <button type="button" className="btn btn-commit" disabled={busy || !queued.length} onClick={submit}>
                        {busy ? 'Submitting…' : `Submit ${queued.length || ''}`.trim()}
                    </button>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <div className="guide-facet-values">
                    {STATUS.map(s => (
                        <button key={s.key} type="button" title={s.why}
                            className={`guide-chip ${status === s.key ? 'active' : ''}`}
                            onClick={refilter(() => setStatus(s.key))}>
                            {s.label}<span className="guide-chip-count">{counts[s.key]}</span>
                        </button>
                    ))}
                </div>
                <select className="form-input w-auto" value={make} aria-label="Make"
                    onChange={refilter(e => setMake(e.target.value))}>
                    <option value="">Every make</option>
                    {makes.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                <select className="form-input w-auto" value={year} aria-label="Model year"
                    onChange={refilter(e => setYear(e.target.value))}>
                    <option value="">Every year</option>
                    {years.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
                <label className="text-note flex items-center gap-1.5" title="Hide every Guide row that already has a test vehicle linked to it">
                    <input type="checkbox" checked={hideLinked} onChange={refilter(e => setHideLinked(e.target.checked))} />
                    Hide rows already linked
                </label>
            </div>

            <div className="brand-list">
                {page.map(item => (
                    <SweepGuideRow key={item.row.id} item={item} titleOf={titleOf}
                        queue={queue} onToggle={toggle} onQueueNamed={queueNamed} />
                ))}
                {visible.length === 0 && <div className="empty-state">No EPA Label rows here.</div>}
                {visible.length > shown && (
                    <button type="button" className="btn btn-secondary self-center" onClick={() => setShown(s => s + PAGE)}>
                        Show {Math.min(PAGE, visible.length - shown)} more of {visible.length - shown}
                    </button>
                )}
            </div>

            {orphans.length > 0 && (
                <div className="flex flex-col gap-2">
                    <button type="button" className="btn btn-secondary self-start" onClick={() => setShowOrphans(o => !o)}>
                        {showOrphans ? 'Hide' : 'Show'} {orphans.length} awaiting with no Guide row in their certification
                    </button>
                    {showOrphans && (
                        <ul className="guide-match-list" aria-label="Awaiting with no Guide row">
                            {orphans.map(o => {
                                const q = queue.get(o.membershipId);
                                return (
                                    <li key={o.membershipId} className="guide-match-row">
                                        <span className="text-meta">MY{o.model_year}</span>
                                        <span className="min-w-0">
                                            <span className="font-mono">{o.test_vehicle_id}</span>
                                            {o.epa_carline_name && <span className="text-meta"> · {o.epa_carline_name}</span>}
                                        </span>
                                        <span className="guide-match-delta">{o.test_group}</span>
                                        <span className="guide-match-action">
                                            <label className="sweep-queue-toggle">
                                                <input type="checkbox" checked={!!q?.skip}
                                                    onChange={() => toggle({ membership: o, test_vehicle_id: o.test_vehicle_id }, q?.skip ? null : { skip: true })} />
                                                skip
                                            </label>
                                        </span>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}

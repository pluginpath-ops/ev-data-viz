import { useState, useEffect, useMemo } from 'react';
import { useAppContext } from '../../context/AppContext';
import { MATCH_FLOOR } from '../../utils/feGuideMatch';
import { guideConflicts } from '../../utils/feGuidePromotion';

/**
 * Attach a staged Fuel Economy Guide row to this EPA test group (#206, phase 3).
 *
 * This is where the curation happens. No key joins the two — the guide's smog
 * test group matches 1 of our 89 linked groups and is not unique per
 * configuration — so a human decides, and this exists to make that decision a
 * confirmation rather than a search.
 *
 * Filtering by make and year still leaves ~19 candidates on the real data, which
 * is too many to read. Ranked by carline similarity the correct row came first
 * in all 41 cases measured, so the top one is offered as a proposal and the rest
 * stay one click away. A proposal, not an answer: the curator confirms.
 */
/** Curator-facing names for the promoted columns. */
const FIELD_LABELS = {
    label_range_published: 'Label range',
    label_city_range_mi:   'City range',
    label_hwy_range_mi:    'Highway range',
    label_combined_mpge:   'Combined MPGe',
    label_city_mpge:       'City MPGe',
    label_hwy_mpge:        'Highway MPGe',
    unadj_city_mpge:       'Unadjusted city MPGe',
    unadj_hwy_mpge:        'Unadjusted highway MPGe',
    total_voltage:         'Pack voltage',
    nominal_pack_kwh:      'Pack energy (gross)',
    battery_specific_energy: 'Specific energy',
    label_adjustment_factor: 'Adjustment factor',
    label_calc_approach:     'Label method',
};

export default function FeGuidePicker({ group, canEdit, onChanged }) {
    const { getFeGuideCandidates, linkFeGuideRow, unlinkFeGuideRow,
            getFeGuideRow, acceptFeGuideValues } = useAppContext();

    const [candidates, setCandidates] = useState(null);
    const [linkedRow, setLinkedRow] = useState(null);
    const [busy, setBusy]         = useState(false);
    const [showAll, setShowAll]   = useState(false);
    const [query, setQuery]       = useState('');
    const [error, setError]       = useState(null);

    const linked = group?.fe_guide_row_id != null;

    // The PRIMITIVES the search depends on, not the group object. `group` in the
    // curator form is a useMemo over the row plus the unsaved edit buffer, so it
    // is a new object on every keystroke — depending on it refetched the whole
    // candidate list each time a curator typed a character in any field.
    const tgid      = group?.test_group_id;
    const make      = group?.make;
    const modelYear = group?.model_year;
    const carline   = group?.epa_carline_name;

    // Derived, not stored. Setting a loading flag synchronously in the effect is
    // the cascading-render shape the lint rule exists to catch, and the state it
    // tracked is already implied by candidates being unfetched.
    const loading = !linked && candidates === null && !error;

    useEffect(() => {
        if (!tgid || linked) return;
        let cancelled = false;
        getFeGuideCandidates({
            test_group_id: tgid, make, model_year: modelYear, epa_carline_name: carline,
        })
            .then(c => { if (!cancelled) setCandidates(c); })
            .catch(e => { if (!cancelled) setError(e.message); });
        return () => { cancelled = true; };
        // getFeGuideCandidates is recreated on every provider render and is
        // stable in behaviour; including it would refetch on unrelated global
        // state changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tgid, make, modelYear, carline, linked]);

    // The linked row itself, so the fields it was not allowed to fill can be
    // named. Promotion reports them once and forgets; the disagreement does not
    // go away, and the published figure may well be the one wanted.
    const feRowId = group?.fe_guide_row_id;
    useEffect(() => {
        // Only the async path sets state. Clearing synchronously on unlink is
        // the same cascading-render shape the loading flag had; deriving it from
        // feRowId instead means there is nothing to clear.
        if (feRowId == null) return;
        let cancelled = false;
        getFeGuideRow(feRowId)
            .then(r => { if (!cancelled) setLinkedRow(r); })
            .catch(() => { /* the conflict list is advisory; its absence is not an error */ });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [feRowId]);

    // Derived, so an unlinked group shows nothing without a state write: a
    // stale linkedRow from a previous link is simply not consulted.
    const conflicts = useMemo(
        () => (feRowId != null && linkedRow?.id === feRowId ? guideConflicts(group, linkedRow) : []),
        [group, linkedRow, feRowId],
    );

    const filtered = useMemo(() => {
        const all = candidates ?? [];
        if (!query.trim()) return all;
        const q = query.toLowerCase();
        return all.filter(c => String(c.row.carline ?? '').toLowerCase().includes(q));
    }, [candidates, query]);

    const best = filtered[0]?.score >= MATCH_FLOOR ? filtered[0] : null;
    const rest = best ? filtered.slice(1) : filtered;

    async function handleLink(feRowId) {
        setBusy(true);
        setError(null);
        try {
            await linkFeGuideRow(group.test_group_id, feRowId);
            onChanged?.();
        } catch (e) { setError(e.message); }
        finally { setBusy(false); }
    }

    async function handleAccept(columns) {
        setBusy(true);
        setError(null);
        try {
            await acceptFeGuideValues(group.test_group_id, columns);
            onChanged?.();
        } catch (e) { setError(e.message); }
        finally { setBusy(false); }
    }

    async function handleUnlink() {
        setBusy(true);
        setError(null);
        try {
            await unlinkFeGuideRow(group.test_group_id);
            onChanged?.();
        } catch (e) { setError(e.message); }
        finally { setBusy(false); }
    }

    if (!group) return null;

    if (linked) {
        return (
            <div className="fe-picker">
                <div className="fe-picker-head">
                    <span className="text-xs font-semibold text-secondary">Fuel Economy Guide</span>
                    <span className="fe-picker-badge">linked</span>
                </div>
                <p className="text-xs text-muted">
                    {linkedRow?.id === feRowId ? linkedRow.carline : 'Linked to the published guide.'}
                    {linkedRow?.id === feRowId && linkedRow.model_year != null && ` · ${linkedRow.model_year}`}
                </p>

                {conflicts.length > 0 && (
                    <div className="fe-conflicts">
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium" style={{ color: 'var(--color-warning)' }}>
                                {conflicts.length} field(s) kept your value over the guide&apos;s
                            </span>
                            {canEdit && (
                                <button
                                    type="button"
                                    onClick={() => handleAccept(conflicts.map(c => c.column))}
                                    disabled={busy}
                                    className="fe-picker-link-btn disabled:opacity-60"
                                >
                                    Use all published
                                </button>
                            )}
                        </div>
                        {conflicts.map(c => (
                            <div key={c.column} className="fe-conflict-row">
                                <span className="text-xs text-muted truncate">{FIELD_LABELS[c.column] ?? c.column}</span>
                                <span className="text-xs font-mono text-secondary whitespace-nowrap">
                                    {String(c.ours ?? '—')} → {String(c.theirs)}
                                </span>
                                {canEdit && (
                                    <button
                                        type="button"
                                        onClick={() => handleAccept([c.column])}
                                        disabled={busy}
                                        className="fe-picker-link-btn disabled:opacity-60"
                                    >
                                        use
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                )}
                {canEdit && (
                    <button
                        type="button"
                        onClick={handleUnlink}
                        disabled={busy}
                        className="fe-picker-link-btn disabled:opacity-60"
                    >
                        {busy ? 'Unlinking…' : 'Unlink'}
                    </button>
                )}
                {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
            </div>
        );
    }

    return (
        <div className="fe-picker">
            <div className="fe-picker-head">
                <span className="text-xs font-semibold text-secondary">Fuel Economy Guide</span>
                {loading && <span className="text-xs text-faint">searching…</span>}
            </div>

            {!loading && candidates?.length === 0 && (
                <p className="text-xs text-muted">
                    No staged guide rows for {group.make || 'this make'} in any imported year.
                    Import a guide under Admin → Fuel Economy Guide.
                </p>
            )}

            {best && (
                <div className="fe-candidate fe-candidate-best">
                    <div className="min-w-0">
                        <div className="text-sm font-medium text-secondary truncate">{best.row.carline}</div>
                        <div className="text-xs text-faint">
                            {best.row.label_comb_range_mi} mi combined
                            {best.row.label_comb_mpge != null && ` · ${best.row.label_comb_mpge} MPGe`}
                            {' · '}{Math.round(best.score * 100)}% name match
                        </div>
                    </div>
                    {canEdit && (
                        <button
                            type="button"
                            onClick={() => handleLink(best.row.id)}
                            disabled={busy}
                            className="btn btn-primary btn-sm disabled:opacity-60"
                        >
                            {busy ? '…' : 'Link'}
                        </button>
                    )}
                </div>
            )}

            {candidates?.length > 0 && (
                <>
                    <button
                        type="button"
                        onClick={() => setShowAll(v => !v)}
                        className="fe-picker-link-btn mt-1"
                    >
                        {showAll ? 'Hide' : `${best ? 'Not it? ' : ''}Show all ${candidates.length}`}
                    </button>

                    {showAll && (
                        <div className="mt-2">
                            <input
                                type="text"
                                value={query}
                                onChange={e => setQuery(e.target.value)}
                                placeholder="Filter by carline…"
                                className="form-input text-xs py-1 w-full mb-2"
                            />
                            <div className="fe-candidate-list">
                                {rest.map(c => (
                                    <div key={c.row.id} className="fe-candidate">
                                        <div className="min-w-0">
                                            <div className="text-xs text-secondary truncate">{c.row.carline}</div>
                                            <div className="text-xs text-faint">
                                                {c.row.label_comb_range_mi} mi
                                                {' · '}{Math.round(c.score * 100)}%
                                                {/* A different guide year is a real
                                                    difference, not a weaker match. */}
                                                {!c.exactYear && (
                                                    <span style={{ color: 'var(--color-warning)' }}>
                                                        {' · '}{c.row.model_year}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        {canEdit && (
                                            <button
                                                type="button"
                                                onClick={() => handleLink(c.row.id)}
                                                disabled={busy}
                                                className="fe-picker-link-btn disabled:opacity-60"
                                            >
                                                Link
                                            </button>
                                        )}
                                    </div>
                                ))}
                                {rest.length === 0 && (
                                    <p className="text-xs text-faint">Nothing matches that filter.</p>
                                )}
                            </div>
                        </div>
                    )}
                </>
            )}

            {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
        </div>
    );
}

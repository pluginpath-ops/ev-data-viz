import { useState, useMemo, useCallback } from 'react';
import { useAppContext } from '../../context/AppContext';
import { useAsyncResource } from '../../hooks/useAsyncResource';
import {
    TIERS, buildSweep, sweepProgress, batchable, NO_PROPOSAL_REASONS,
    impliedUsableKwh, groupEnergyFacts, estimatedAdjustedRange,
} from '../../utils/epaLinkSweep';
import { wheelSizeIn } from '../../utils/feGuideBrowse';

/**
 * Work through the certification groups with no Fuel Economy Guide row (#238).
 *
 * 159 of 211 groups are unlinked, and that link is the ceiling on the cert half
 * of #236: without it, drivetrain η and charger efficiency can only be reported
 * against a manufacturer's Vehicle ID rather than by class, brand or drive.
 *
 * `FeGuidePicker` already does this one group at a time, correctly, from the
 * vehicle's Tests & Data tab. What was missing is a way to work through the
 * list — and for the 113 groups linked to no vehicle at all, there is no Tests
 * & Data tab to reach, so this is the only place they can be linked.
 *
 * The proposal test is `bestFeCandidate`, unchanged. It declines below the
 * match floor, declines a borrowed model year, and declines a tie — the last
 * learned from data, where `Ioniq 5` scores identically against `Ioniq 5 N` and
 * `Ioniq 5 RWD`, cars 221 and ~300 miles apart. Applying a looser rule here,
 * at the moment those judgements are made in bulk, would quietly undo it.
 */
/**
 * The facts that tell two candidates apart.
 *
 * Pack size and implied energy are here because the carline often is not
 * enough: `R1T All-Terrain Performance Dual` scores 71% against Large, Large
 * Plus and Max alike, and nothing in the name says which. Those three are 116,
 * 150 and 150 kWh of pack and 128, 137 and 160 kWh of implied energy — the
 * numbers decide what the name cannot.
 *
 * Motor count stays for the ties it separates: MY25 lists HUMMER EV SUV twice
 * and the rows are the 2X and the 3X.
 */
function CandidateFacts({ row, score, exactYear }) {
    const implied = impliedUsableKwh(row);
    return (
        <span className="text-caption text-faint">
            {row.label_comb_range_mi} mi
            {row.label_comb_mpge != null && ` · ${row.label_comb_mpge} MPGe`}
            {/* Pulled out of the carline, where it is easy to miss when three
                rows differ by nothing else. */}
            {wheelSizeIn(row.carline) != null && ` · ${wheelSizeIn(row.carline)}" wheels`}
            {row.nominal_pack_kwh != null && ` · ${Number(row.nominal_pack_kwh).toFixed(1)} kWh pack`}
            {implied != null && (
                <span title="Range ÷ MPGe × 33.705 — the energy these label figures were computed from. AC basis, so it reads about 1/0.88 higher than a certification test's DC energy.">
                    {` · ~${implied.toFixed(0)} kWh implied`}
                </span>
            )}
            {row.motor_count != null && ` · ${row.motor_count} motor${row.motor_count === 1 ? '' : 's'}`}
            {' · '}
            <span style={exactYear ? undefined : { color: 'var(--color-warning)' }}>{row.model_year}</span>
            {score != null && ` · ${Math.round(score * 100)}%`}
        </span>
    );
}

/**
 * What the certification record knows about its own pack and mass.
 *
 * The other half of the disambiguation, shown beside the candidates rather than
 * differenced against them: the group's DC energy and the candidates' implied
 * energy are on different bases (DC against AC), so a subtraction would look
 * precise and be wrong. Side by side, a 144 kWh group against candidates at
 * 128, 137 and 160 is still an easy call.
 */
function GroupEnergyFacts({ group }) {
    const f = groupEnergyFacts(group);
    const est = estimatedAdjustedRange(group);
    if (f.dcEnergyKwh == null && f.etwLbs == null && f.useableKwh == null && est == null) return null;
    return (
        <div className="text-caption text-secondary">
            {/* The strongest hint when it exists: the group's own unadjusted
                range on a label basis, directly comparable with a candidate's. */}
            {est && (
                <span title={`${est.factor.toFixed(4)} adjustment ${est.factorIsDerived ? 'derived for this group' : '— the fixed default, since this group states none'}`}>
                    ~{est.miles.toFixed(0)} mi est. label range
                    {!est.factorIsDerived && '*'}
                    {' · '}
                </span>
            )}
            {f.dcEnergyKwh != null && (
                <span title={`Measured DC energy from procedure ${f.procedure}. DC basis — not directly comparable with a candidate's implied kWh, which is AC.`}>
                    {f.dcEnergyKwh.toFixed(1)} kWh measured DC
                </span>
            )}
            {f.useableKwh != null && ` · ${f.useableKwh.toFixed(1)} kWh useable`}
            {f.etwLbs != null && ` · ${f.etwLbs.toFixed(0)} lb test weight`}
        </div>
    );
}

function SweepRow({ item, busy, onLink, onSkip, onUnskip }) {
    const [open, setOpen] = useState(false);
    const [note, setNote] = useState('');
    const [asking, setAsking] = useState(false);
    const g = item.group;
    const vehicles = (g.epa_vehicle_mappings ?? []).map(m => m.vehicles).filter(Boolean);
    const skipped = g.fe_guide_skipped_at != null;

    return (
        <div className={`sweep-row ${skipped ? 'skipped' : ''}`}>
            <div className="sweep-row-main">
                <div className="sweep-group">
                    <div className="sweep-group-name">
                        {g.display_name || g.epa_carline_name || g.test_group_id}
                        {vehicles.length > 0 && (
                            <span className="guide-badge guide-badge-tested"
                                title={vehicles.map(v => `${v.year} ${v.name}`).join(', ')}>tested</span>
                        )}
                    </div>
                    {/* The name the RANKER scored against, when it differs from
                        the one on display. A curator reading "Touring AWd" and a
                        50% score cannot tell that the match was computed from
                        "Lucid Air Touring AWD" — and the score only makes sense
                        against the text that produced it. */}
                    {g.display_name && g.epa_carline_name && g.display_name !== g.epa_carline_name && (
                        <div className="text-caption text-secondary">matched as “{g.epa_carline_name}”</div>
                    )}
                    <div className="text-caption text-faint">
                        {g.model_year} {g.make} · {g.test_group_id}
                        {/* A carryover states which year the test actually came
                            from, which is usually why a candidate's year differs. */}
                        {g.carryover_model_year && ` · carried over from ${g.carryover_model_year}`}
                    </div>
                    <GroupEnergyFacts group={g} />
                </div>

                <div className="sweep-proposal">
                    {item.proposal ? (
                        <>
                            <div className="sweep-proposal-name">
                                {item.proposal.row.carline}
                                {/* Not a similarity score — the guide row carries
                                    this group's own identifier. */}
                                {item.exactIdMatch && (
                                    <span className="guide-badge guide-badge-tested" title="The guide row's test group is this group's id — an identifier match, not a name score">
                                        exact id
                                    </span>
                                )}
                            </div>
                            <CandidateFacts row={item.proposal.row}
                                score={item.exactIdMatch ? null : item.proposal.score}
                                exactYear={item.proposal.exactYear} />
                        </>
                    ) : (
                        <div className="text-caption text-secondary">
                            {NO_PROPOSAL_REASONS[item.reason] ?? 'No proposal.'}
                            {/* The unanswerable case, named. Without this a
                                curator hunts for a distinguishing fact that does
                                not exist in either dataset. */}
                            {item.shared && (
                                <div className="sweep-shared-note">
                                    These {item.shared.count} candidates are <strong>one certification</strong>
                                    {' '}({item.shared.smogTestGroup}) — EPA tested them once and the guide lists
                                    the wheel or tyre options separately. Nothing distinguishes them on our side,
                                    so pick the variant you mean.
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="sweep-actions">
                    {item.proposal && !skipped && (
                        <button className="btn btn-primary" disabled={busy}
                            onClick={() => onLink(g.test_group_id, item.proposal.row.id)}>
                            Link
                        </button>
                    )}
                    {item.candidateCount > 0 && (
                        <button className="btn btn-secondary" onClick={() => setOpen(o => !o)}>
                            {open ? 'Hide' : `${item.candidateCount} candidate${item.candidateCount === 1 ? '' : 's'}`}
                        </button>
                    )}
                    {skipped ? (
                        <button className="btn btn-secondary" disabled={busy}
                            onClick={() => onUnskip(g.test_group_id)}>Un-skip</button>
                    ) : (
                        <button className="btn btn-secondary" disabled={busy}
                            onClick={() => setAsking(a => !a)}>Skip</button>
                    )}
                </div>
            </div>

            {skipped && g.fe_guide_skip_note && (
                <div className="text-caption text-muted">Skipped: {g.fe_guide_skip_note}</div>
            )}

            {asking && (
                <div className="sweep-skip-ask">
                    <input className="brand-input" value={note} onChange={e => setNote(e.target.value)}
                        placeholder="Why is there nothing to link? (optional)" />
                    <button className="btn btn-warning" disabled={busy}
                        onClick={async () => { await onSkip(g.test_group_id, note.trim() || null); setAsking(false); }}>
                        Record skip
                    </button>
                    <button className="btn btn-secondary" onClick={() => setAsking(false)}>Cancel</button>
                </div>
            )}

            {open && (
                <div className="sweep-candidates">
                    {item.ranked.map(c => (
                        <div key={c.row.id} className="sweep-candidate">
                            <div>
                                <div>{c.row.carline}</div>
                                <CandidateFacts row={c.row} score={c.score} exactYear={c.exactYear} />
                            </div>
                            <button className="btn btn-secondary" disabled={busy}
                                onClick={() => onLink(g.test_group_id, c.row.id)}>Link this</button>
                        </div>
                    ))}
                    {/* A borrowed year is a legitimate link, not a weaker one:
                        a configuration often has no row in its own year. */}
                    {item.ranked.some(c => !c.exactYear) && (
                        <div className="text-hint">
                            Rows from another model year are marked in amber. Borrowing one is legitimate —
                            a configuration often has no row in its own year — but the figures may have moved.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export default function FeGuideLinkSweep() {
    const {
        getGroupsAwaitingFeLink, getFeLinkProgress, getFeGuideRows,
        linkFeGuideRow, linkFeGuideRows, setFeLinkSkipped,
    } = useAppContext();

    const [includeSkipped, setIncludeSkipped] = useState(false);
    const [tier, setTier] = useState('energy');
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState(null);
    const [result, setResult] = useState(null);

    const loadGroups   = useCallback(() => getGroupsAwaitingFeLink({ includeSkipped }), [getGroupsAwaitingFeLink, includeSkipped]);
    const loadRows     = useCallback(() => getFeGuideRows(), [getFeGuideRows]);
    const loadProgress = useCallback(() => getFeLinkProgress(), [getFeLinkProgress]);

    const { data: groups, loading, error, reload: reloadGroups } = useAsyncResource(loadGroups, [includeSkipped]);
    // Fetched ONCE and ranked in memory. FeGuidePicker fetches the corpus per
    // group, which is right for one group and 159 full-corpus reads here.
    const { data: feRows } = useAsyncResource(loadRows, []);
    const { data: progress, reload: reloadProgress } = useAsyncResource(loadProgress, []);

    const items = useMemo(
        () => buildSweep(groups ?? [], feRows ?? []),
        [groups, feRows],
    );
    const counts = useMemo(() => sweepProgress(items), [items]);
    const shown = useMemo(() => items.filter(i => i.tier === tier), [items, tier]);
    const batch = useMemo(() => batchable(shown), [shown]);

    const refresh = () => { reloadGroups(); reloadProgress(); };

    const run = async (fn, message) => {
        setBusy(true); setNote(null); setResult(null);
        try { await fn(); if (message) setNote(message); refresh(); }
        catch (e) { setNote(`Failed: ${e.message}`); }
        finally { setBusy(false); }
    };

    const linkOne = (groupId, rowId) =>
        run(() => linkFeGuideRow(groupId, rowId), 'Linked.');

    /**
     * The batch goes through `linkFeGuideRows`, not a loop over the single-link
     * call. The single-link wrapper refreshes every vehicle in the app after
     * each one — right for one, ninety-eight times over for a batch, which is
     * why this appeared to do nothing but churn.
     */
    const linkBatch = () => run(async () => {
        const pairs = batch.map(it => ({
            testGroupId: it.group.test_group_id,
            feRowId: it.proposal.row.id,
        }));
        const res = await linkFeGuideRows(pairs);
        setResult(res);
    });

    if (loading) return <div className="text-caption text-secondary">Loading groups…</div>;
    if (error) return <div className="empty-state">Could not load the sweep: {String(error.message ?? error)}</div>;

    const tierDef = TIERS.find(t => t.key === tier);

    return (
        <div className="flex flex-col gap-4">
            <div className="section-header">
                <div>
                    <div className="section-header-title">Link certification groups to guide rows</div>
                    {progress && (
                        <div className="text-caption text-secondary">
                            {progress.linked} linked · {progress.awaiting} awaiting a decision
                            {progress.skipped > 0 && ` · ${progress.skipped} skipped`}
                            {' '}of {progress.total}
                        </div>
                    )}
                    {progress === null && (
                        <div className="text-caption text-muted">
                            Skips cannot be recorded until migration 058 is applied.
                        </div>
                    )}
                </div>
                <div className="section-header-actions">
                    <label className="text-caption flex items-center gap-1.5">
                        <input type="checkbox" checked={includeSkipped}
                            onChange={e => setIncludeSkipped(e.target.checked)} />
                        Show skipped
                    </label>
                </div>
            </div>

            {note && <div className="guide-tested-note">{note}</div>}

            {/* A batch reports what it did as a whole. Per-link toasts are
                useful for one link and unreadable ninety-eight times over, and
                only the last one survived anyway. */}
            {result && (
                <div className={result.failures.length ? 'guide-warning' : 'guide-tested-note'}>
                    Linked {result.linked} group{result.linked === 1 ? '' : 's'};
                    {' '}{result.promoted} field{result.promoted === 1 ? '' : 's'} filled
                    {result.skipped > 0 && `, ${result.skipped} left as curator-set`}.
                    {result.failures.length > 0 && (
                        <> {result.failures.length} failed: {result.failures.slice(0, 5).map(f => f.testGroupId).join(', ')}.</>
                    )}
                </div>
            )}

            <div className="guide-facet-values">
                {TIERS.map(t => (
                    <button key={t.key} type="button"
                        className={`guide-chip ${tier === t.key ? 'active' : ''}`}
                        onClick={() => setTier(t.key)}
                        title={t.why}>
                        {t.label}
                        <span className="guide-chip-count">{counts[t.key].total}</span>
                    </button>
                ))}
            </div>

            <div className="text-hint">{tierDef?.why}</div>

            {batch.length > 0 && (
                <div className="sweep-batch">
                    <div className="text-caption">
                        <strong>{batch.length}</strong> of these have a single unambiguous same-year
                        match. Ties, borrowed years and weak matches are excluded and need a look.
                    </div>
                    <button className="btn btn-primary" disabled={busy} onClick={linkBatch}>
                        {busy ? 'Linking…' : `Link all ${batch.length}`}
                    </button>
                </div>
            )}

            <div className="brand-list">
                {shown.map(item => (
                    <SweepRow
                        key={item.group.test_group_id}
                        item={item}
                        busy={busy}
                        onLink={linkOne}
                        onSkip={(id, n) => run(() => setFeLinkSkipped(id, true, n), 'Skip recorded.')}
                        onUnskip={(id) => run(() => setFeLinkSkipped(id, false), 'Skip cleared.')}
                    />
                ))}
                {shown.length === 0 && (
                    <div className="empty-state">Nothing awaiting a decision in this tier.</div>
                )}
            </div>
        </div>
    );
}

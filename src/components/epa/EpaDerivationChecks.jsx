/**
 * Whether a stored EPA record actually reconciles — the curator's view (#222).
 *
 * These three checks were first built into the methodology diagram on the
 * Charts tab, which was the wrong home. That diagram answers a reader's
 * question — how EPA produced this car's range — and "the bags do not reconcile"
 * is not a fact about the car. It is a fact about our record of it, useful to
 * whoever is curating and noise to everyone else.
 *
 * So they live here, beside the data they judge, where the phases and energies
 * can be corrected in the same view.
 *
 * ── The three, and why each earns its place ─────────────────────────────────
 *
 * RECOMPUTED RANGE is the strongest, because it compares a record against
 * ITSELF: EPA states its own charge-depleting ranges, we recompute them from
 * the bags, and a gap is our phase data with nothing else in the frame. No
 * Fuel Economy Guide link needed, so it covers every imported group.
 *
 * UNADJUSTED MPGe compares against EPA's published figures, so it needs a
 * linked guide row — but it catches what the record cannot check about itself,
 * chiefly the recharge energy that never enters a range.
 *
 * THE LABEL INVARIANT is not a matter of degree. A maker may label at or below
 * the computed range and never above, so a label above it is proof rather than
 * disagreement.
 *
 * Presentational only. Every judgement is made in utils/epaDerivationCheck.
 */
import { CHECK_STATUS_LABELS, CHECK_SHAPE_ADVICE } from '../../utils/epaDerivationCheck';

const mi = (v) => (v == null ? '—' : `${v.toFixed(1)} mi`);

/**
 * @param {Object}  props.check        checkUnadjustedMpge result
 * @param {Object}  props.rangeCheck   checkStatedRanges result
 * @param {Object}  props.invariant    checkLabelInvariant result
 * @param {number}  props.adjustmentFixed  the flat factor, for the implied-factor message
 * @param {number}  props.inferredPhaseTypes  phases whose cycle was guessed from distance
 * @param {number}  props.competingMctTests   multi-cycle tests in this group
 */
export default function EpaDerivationChecks({
    check = null, rangeCheck = null, invariant = null,
    adjustmentFixed = 0.7, adjustmentUsed = null, adjustmentSource = null,
    integrity = null, inferredPhaseTypes = 0, competingMctTests = 0, derivedFrom = null,
}) {
    // The factor in force, and whether a guide row supplied it. Reporting the
    // flat constant while a linked row's factor was doing the work told curators
    // to link a row they had already linked, and named a number nothing used.
    const applied = Number.isFinite(adjustmentUsed) ? adjustmentUsed : adjustmentFixed;
    const fromGuide = adjustmentSource === 'guide';
    const anything = invariant?.violated || rangeCheck?.checked || check?.checked
        || integrity?.findings?.length > 0
        || inferredPhaseTypes > 0 || competingMctTests > 1;
    if (!anything) return null;

    return (
        <div className="epa-checks">
    {/* FIRST, and before anything that compares against EPA. Those checks ask
        which of two sources is right; these say the record contradicts itself,
        which no outside figure can resolve and which makes every derivation
        below it untrustworthy. Runs with no guide row linked, so it is often
        the only thing here. */}
    {integrity?.findings?.map(f => (
        <div key={f.code}
             className={`epa-check ${f.severity === 'error' ? 'epa-check-disagrees' : 'epa-check-close'}`}>
            <span className="text-label">{f.label}</span>
            <span className="text-xs text-faint">{f.detail}</span>
        </div>
    ))}
    {/* The regulatory invariant, first because it is not a matter of
        degree. A maker may label at or below the computed range and
        never above, so a label ABOVE it proves our derivation is too
        low — the alternative being that EPA certified an illegal label.
        It catches what the efficiency comparison cannot: a derivation
        wrong in a way that still reconciles with published MPGe. */}
    {invariant?.violated && (
        <div className="epa-check epa-check-disagrees">
            <span className="text-label">Impossible label</span>
            <span className="epa-check-row">
                Computed
                <strong className="text-secondary">{mi(invariant.computedMi)}</strong>
                <span className="text-faint">below the {mi(invariant.labeledMi)} label</span>
                <span className="epa-check-delta">
                    −{invariant.shortfallMi.toFixed(1)} mi
                </span>
            </span>
            <span className="text-xs text-faint">
                {invariant.cause === 'adjustment'
                    ? (fromGuide
                        ? `The bags reproduce this record\u2019s own stated ranges, so the phase data is sound, and the guide\u2019s own factor of ${applied.toFixed(4)} is already in use \u2014 yet the label still implies ${invariant.impliedAdjustment?.toFixed(4)}. Nothing here is known to be wrong; the residual is unexplained. Note the guide often reports its \u201cunrounded\u201d adjusted figures rounded to whole MPGe, which puts roughly \u00b10.005 of slack on that factor.`
                        : `The bags reproduce this record\u2019s own stated ranges, so the phase data is sound \u2014 the adjustment factor is too low. This label implies ${invariant.impliedAdjustment?.toFixed(4)}, not the ${applied} being applied. Link its Fuel Economy Guide row.`)
                    : invariant.cause === 'phases'
                        ? 'The bags do not reproduce this record\u2019s own stated ranges either, so the phase data is what is too low.'
                        : 'A label may never exceed the computed range, so something feeding this derivation is too low.'}
            </span>
        </div>
    )}

    {/* Recomputed range against the range the record itself states.
        The strongest check here and the one that needs no external
        source: same test, same quantity, so a gap is our phase data and
        nothing else. It also names the cycle at fault. */}
    {rangeCheck?.checked && (
        <div className={`epa-check epa-check-${rangeCheck.worst}`}>
            <span className="text-label">
                Recomputed range vs this record
                <span className="epa-check-verdict">
                    {rangeCheck.worst === 'agrees' ? 'bags reconcile' : 'bags do not reconcile'}
                </span>
            </span>
            {rangeCheck.cycles.map(c => (
                <span key={c.cycle} className="epa-check-row">
                    {c.label}
                    <strong className="text-secondary">{mi(c.ours)}</strong>
                    <span className="text-faint">vs {mi(c.stated)} stated</span>
                    <span className="epa-check-delta">
                        {c.deltaPct >= 0 ? '+' : ''}{c.deltaPct.toFixed(2)}%
                    </span>
                </span>
            ))}
            {rangeCheck.worst !== 'agrees' && (
                <span className="text-xs text-faint">
                    The record states its own range, so a gap is in the phase bags we
                    imported for that cycle \u2014 a wrong distance, a mistyped type, or one missing.
                </span>
            )}
        </div>
    )}

    {/* Our derivation against EPA's own published unadjusted figures.
        Shown for every configuration with a linked guide row, because
        until now the chain was verified against exactly one vehicle by
        hand — and two groups for the same car currently derive charging
        efficiencies 7 points apart, so at least one reading in the fleet
        is wrong and nothing said which.

        The UNADJUSTED figure is the one compared: the adjusted value
        embeds the adjustment factor, so a wrong factor and a wrong
        efficiency could cancel and pass. */}
    {check?.checked && (
        <div className={`epa-check epa-check-${check.worst}`}>
            <span className="text-label">
                Unadjusted MPGe vs EPA
                <span className="epa-check-verdict">{CHECK_STATUS_LABELS[check.worst]}</span>
            </span>
            {check.cycles.map(c => (
                <span key={c.cycle} className="epa-check-row">
                    {c.label}
                    <strong className="text-secondary">{c.ours.toFixed(1)}</strong>
                    <span className="text-faint">vs {c.epa.toFixed(1)}</span>
                    <span className="epa-check-delta">
                        {c.deltaPct >= 0 ? '+' : ''}{c.deltaPct.toFixed(2)}%
                    </span>
                </span>
            ))}
            <span className="text-xs text-faint">
                {check.worst === 'agrees'
                    ? 'The derivation reproduces EPA\u2019s published figures.'
                    : (CHECK_SHAPE_ADVICE[check.shape]
                        ?? 'Outside rounding, and the two cycles do not agree on how.')}
            </span>
        </div>
    )}
            {/* Provenance caveats. Not faults, but they change how much weight
                the figures above deserve, and both are fixable from this view. */}
            {competingMctTests > 1 && (
                <p className="text-xs" style={{ color: 'var(--color-warning)' }}>
                    This group holds {competingMctTests} multi-cycle tests, and every figure above
                    was derived from
                    {derivedFrom?.basis === 'selected' ? ' the one its guide row identifies' : ' the most recent'}
                    {derivedFrom?.testNumber && <> — <span className="font-mono">{derivedFrom.testNumber}</span></>}
                    {derivedFrom?.testDate && <>, {derivedFrom.testDate}</>}.
                    More than one run can be legitimate: the same vehicle is sometimes tested at two
                    laboratories, and the runs disagree without either being wrong. So this is a
                    choice, not a fault, and deleting the others would discard valid tests.
                    {derivedFrom?.basis !== 'selected' && <>
                        {' '}Nothing has settled which run EPA used, so these figures rest on a
                        default. Linking a Fuel Economy Guide row settles it — its published
                        highway figure identifies the run.
                    </>}
                </p>
            )}

            {inferredPhaseTypes > 0 && (
                <p className="text-xs" style={{ color: 'var(--color-warning)' }}>
                    {inferredPhaseTypes} phase{inferredPhaseTypes === 1 ? '' : 's'} had no recorded
                    cycle and were inferred from distance. Setting them below makes this derivation
                    certain rather than probable.
                </p>
            )}
        </div>
    );
}

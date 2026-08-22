/**
 * The Fuel Economy Guide linking sweep (#238).
 *
 * 159 of 211 certification groups carry no guide row. That link is what lets a
 * cert-side measurement be grouped by any guide dimension — class, corporate
 * parent, drive, pack band — so until it exists, drivetrain η and charger
 * efficiency can only be reported against a manufacturer's Vehicle ID. It is
 * the ceiling on the cert half of #236, not housekeeping.
 *
 * Pure module: tiering, proposal classification, and the counts the view
 * reports. The matching itself is `feGuideMatch`, unchanged.
 */
import { rankFeCandidates, bestFeCandidate, MATCH_FLOOR } from './feGuideMatch';
import { PROC_MCT, PROC_CD_HWY } from '../constants/epa';

// ── Priority ─────────────────────────────────────────────────────────────────

/**
 * Which groups to work through first, ordered by what the link unlocks rather
 * than by year or name.
 *
 * A sweep of 159 items will not be finished in one sitting, so the order
 * decides what gets done at all. Energy first because it is the scarcest input
 * — 65 groups in the whole corpus can produce a charger efficiency, and each
 * one that goes unlinked is a measurement that cannot be grouped by anything.
 * Coefficients next because they are the highest-coverage cert statistic we
 * have. Everything else last: still worth linking, but it unblocks nothing
 * specific.
 */
export const TIERS = [
    {
        key: 'energy',
        label: 'Unlocks charger efficiency and usable kWh',
        why: 'These groups report DC energy, so linking one adds a measurement that can then be grouped by class, brand or drive.',
    },
    {
        key: 'coefficients',
        label: 'Unlocks road-load and aero by class',
        why: 'Coefficients are on 203 of 204 groups — the highest-coverage cert figure — but need a guide link before they can be grouped.',
    },
    {
        key: 'other',
        label: 'Everything else',
        why: 'Worth linking for completeness; unblocks no statistic on its own.',
    },
];

/**
 * Null-safe numeric coercion.
 *
 * The null check is not decoration. `Number(null)` is `0` and `0` is finite, so
 * a bare `Number.isFinite(Number(v))` reports an ABSENT value as a present zero
 * — which here would have put every group with no recorded DC energy into the
 * top-priority tier, and told a curator that linking it unlocks a measurement
 * that does not exist.
 */
const num = (v) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

/** Whether a group carries DC energy on a test the derivations will actually use. */
export function hasDerivableEnergy(group) {
    // Procedure code decides, matching pickDerivationTest. A short cycle's DC
    // energy against a full recharge is where the 0.037 charger efficiency came
    // from, and a group whose only energy is on such a test unlocks nothing.
    return (group?.epa_tests ?? []).some(t =>
        [PROC_MCT, PROC_CD_HWY].includes(num(t.procedure_code)) && num(t.total_dc_energy_kwh) != null);
}

export function hasCoefficients(group) {
    return (group?.epa_coefficient_sets ?? []).some(c => num(c.target_a) != null);
}

export function tierOf(group) {
    if (hasDerivableEnergy(group)) return 'energy';
    if (hasCoefficients(group))    return 'coefficients';
    return 'other';
}

// ── Proposals ────────────────────────────────────────────────────────────────

/**
 * Why a group has no automatic proposal — worded for the person who has to
 * resolve it.
 *
 * Naming the reason is the point. "No proposal" is the same output for four
 * different situations, and they need four different actions: a tie needs the
 * curator to distinguish variants our carline does not, a borrowed year needs
 * them to accept a figure from another year, a weak match needs a search, and
 * no candidates at all usually means the guide year has not been imported.
 */
export const NO_PROPOSAL_REASONS = {
    'no-candidates': 'No guide row from this manufacturer in any imported year.',
    'below-floor':   'The make matches but no carline is close enough to propose.',
    'wrong-year':    'The closest row is from another model year — a legitimate link, but the curator’s call.',
    'tied':          'Two rows score identically, so our carline does not distinguish them.',
};

/**
 * Classify one group: its tier, its proposal if there is a safe one, and the
 * ranked list either way.
 *
 * The safe-proposal test is `bestFeCandidate`, unchanged and deliberately.
 * It already declines below the floor, declines a cross-year match, and
 * declines a tie — the last being the one learned from data, where `Ioniq 5`
 * scores identically against `Ioniq 5 N` and `Ioniq 5 RWD`, cars 221 and ~300
 * miles apart. Inventing a second, looser threshold here would quietly undo
 * that reasoning at the exact moment it is applied in bulk.
 */
export function classifyGroup(group, feRows) {
    const ranked = rankFeCandidates(group, feRows);
    const best = bestFeCandidate(group, feRows);

    let reason = null;
    if (!best) {
        const [top, next] = ranked;
        if (!top) reason = 'no-candidates';
        else if (top.score < MATCH_FLOOR) reason = 'below-floor';
        else if (!top.exactYear) reason = 'wrong-year';
        else if (next && next.exactYear && Math.abs(next.score - top.score) < 1e-9) reason = 'tied';
        else reason = 'below-floor';
    }

    return {
        group,
        tier: tierOf(group),
        proposal: best,
        reason,
        ranked: ranked.slice(0, 8),
        candidateCount: ranked.length,
    };
}

/**
 * Every group needing a decision, classified and ordered.
 *
 * Within a tier, groups WITH a safe proposal come first: they are the ones a
 * curator can clear in one click, and burying them behind the hard cases is
 * what makes a sweep feel endless.
 */
export function buildSweep(groups, feRows) {
    const tierRank = Object.fromEntries(TIERS.map((t, i) => [t.key, i]));
    return groups
        .map(g => classifyGroup(g, feRows))
        .sort((a, b) =>
            tierRank[a.tier] - tierRank[b.tier]
            || (a.proposal ? 0 : 1) - (b.proposal ? 0 : 1)
            || (b.proposal?.score ?? 0) - (a.proposal?.score ?? 0)
            || String(a.group.test_group_id).localeCompare(String(b.group.test_group_id)));
}

/** Counts per tier, for the progress the view reports against. */
export function sweepProgress(items) {
    const byTier = {};
    for (const t of TIERS) byTier[t.key] = { total: 0, proposed: 0, manual: 0 };
    for (const it of items) {
        const b = byTier[it.tier];
        b.total += 1;
        if (it.proposal) b.proposed += 1; else b.manual += 1;
    }
    return byTier;
}

/** The subset a batch confirm would act on — every safe proposal, nothing else. */
export const batchable = (items) => items.filter(i => i.proposal);

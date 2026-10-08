/**
 * The Fuel Economy Guide linking sweep (#238).
 *
 * 159 of 211 test vehicles carry no guide row. That link is what lets a
 * cert-side measurement be grouped by any guide dimension — class, corporate
 * parent, drive, pack band — so until it exists, drivetrain η and charger
 * efficiency can only be reported against a manufacturer's Vehicle ID. It is
 * the ceiling on the cert half of #236, not housekeeping.
 *
 * Pure module: tiering, proposal classification, and the counts the view
 * reports. The matching itself is `feGuideMatch`, unchanged.
 */
import { rankFeCandidates, bestFeCandidate, MATCH_FLOOR } from './feGuideMatch';
import { PROC_MCT, PROC_CD_HWY, MPG_E_CONVERSION, LABEL_ADJUSTMENT } from '../constants/epa';

// ── Priority ─────────────────────────────────────────────────────────────────

/**
 * Which test vehicles to work through first, ordered by what the link unlocks rather
 * than by year or name.
 *
 * A sweep of 159 items will not be finished in one sitting, so the order
 * decides what gets done at all. Energy first because it is the scarcest input
 * — 65 test vehicles in the whole corpus can produce a charger efficiency, and each
 * one that goes unlinked is a measurement that cannot be grouped by anything.
 * Coefficients next because they are the highest-coverage cert statistic we
 * have. Everything else last: still worth linking, but it unblocks nothing
 * specific.
 */
export const TIERS = [
    {
        key: 'energy',
        label: 'Unlocks charger efficiency and usable kWh',
        why: 'These test vehicles report DC energy, so linking one adds a measurement that can then be grouped by class, brand or drive.',
    },
    {
        key: 'coefficients',
        label: 'Unlocks road-load and aero by class',
        why: 'Coefficients are on 203 of 204 test vehicles — the highest-coverage cert figure — but need a guide link before they can be grouped.',
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
 * — which here would have put every test vehicle with no recorded DC energy into the
 * top-priority tier, and told a curator that linking it unlocks a measurement
 * that does not exist.
 */
const num = (v) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

/** Whether a test vehicle carries DC energy on a test the derivations will actually use. */
export function hasDerivableEnergy(testVehicle) {
    // Procedure code decides, matching pickDerivationTest. A short cycle's DC
    // energy against a full recharge is where the 0.037 charger efficiency came
    // from, and a test vehicle whose only energy is on such a test unlocks nothing.
    return (testVehicle?.epa_tests ?? []).some(t =>
        [PROC_MCT, PROC_CD_HWY].includes(num(t.procedure_code)) && num(t.total_dc_energy_kwh) != null);
}

export function hasCoefficients(testVehicle) {
    return (testVehicle?.epa_coefficient_sets ?? []).some(c => num(c.target_a) != null);
}

export function tierOf(testVehicle) {
    if (hasDerivableEnergy(testVehicle)) return 'energy';
    if (hasCoefficients(testVehicle))    return 'coefficients';
    return 'other';
}

// ── Telling near-identical candidates apart ──────────────────────────────────

/**
 * The energy a guide row implies, from its own range and efficiency.
 *
 * MPGe is miles per 33.705 kWh, so range ÷ MPGe × 33.705 is the energy the
 * label figures were computed from. This is the field that separates trims a
 * carline name does not: `R1T All-Terrain Performance Dual` matches Large, Large
 * Plus and Max identically at 71%, and those are 128, 137 and 160 kWh.
 *
 * ⚠ AC basis. MPGe is computed from energy drawn at the wall, so this includes
 * charging losses and reads roughly 1/0.88 higher than the DC energy a
 * certification test reports. It is a discriminator, NOT a quantity to compare
 * arithmetically against `total_dc_energy_kwh` — which is why the UI shows both
 * and labels each rather than differencing them.
 */
export function impliedUsableKwh(feRow) {
    const range = num(feRow?.label_comb_range_mi);
    const mpge  = num(feRow?.label_comb_mpge);
    if (range == null || mpge == null || mpge <= 0) return null;
    return (range / mpge) * MPG_E_CONVERSION;
}

/**
 * What the certification record itself knows about its pack and mass.
 *
 * The other half of the same question. A test vehicle carrying 144 kWh of measured DC
 * energy is a big-pack car whatever its carline says, and the equivalent test
 * weight moves with the pack too.
 */
export function testVehicleEnergyFacts(testVehicle) {
    const test = (testVehicle?.epa_tests ?? [])
        .filter(t => [PROC_MCT, PROC_CD_HWY].includes(num(t.procedure_code)))
        .find(t => num(t.total_dc_energy_kwh) != null);
    const etw = (testVehicle?.epa_coefficient_sets ?? [])
        .map(c => num(c.equiv_test_weight_lbs))
        .find(v => v != null);
    return {
        dcEnergyKwh: test ? num(test.total_dc_energy_kwh) : null,
        procedure:   test ? num(test.procedure_code) : null,
        etwLbs:      etw ?? null,
        useableKwh:  num(testVehicle?.useable_kwh),
    };
}

/**
 * The range this certification record implies, adjusted to a label basis.
 *
 * `cd_range_combined_calc` is the unadjusted combined range EPA computed from
 * the test. Multiplying by the adjustment gives roughly what the window sticker
 * should say — which is directly comparable to a candidate's `label_comb_range_mi`
 * and settles a set of trims a carline name cannot.
 *
 * Uses the test vehicle's own `derived_5cycle_coefficient` where it has one and the
 * fixed 0.7 otherwise, and reports which, because the difference between them
 * is several percent and a reader comparing 411 against 382 needs to know how
 * soft the number is.
 *
 * Only ~29 of the 158 unlinked test vehicles carry the unadjusted range, so this is a
 * strong hint where it exists rather than a general answer.
 */
export function estimatedAdjustedRange(testVehicle) {
    const unadjusted = num(testVehicle?.cd_range_combined_calc);
    if (unadjusted == null) return null;
    const derived = num(testVehicle?.derived_5cycle_coefficient);
    const factor = derived != null && derived > 0 ? derived : LABEL_ADJUSTMENT;
    return { miles: unadjusted * factor, factor, factorIsDerived: derived != null && derived > 0 };
}

/**
 * Wheel and tyre sizes named anywhere in a piece of free text.
 *
 * The distillation that makes the manufacturer's note usable in a list. The
 * note itself runs to a paragraph — axle ratios, N/V figures, software
 * variants — and the part a curator needs while linking is which wheel was on
 * the car:
 *
 *   "Tested on 20 inch tire, covering 22 inch tire as worst case" → [20, 22]
 *
 * Three notations, all real: `21 inch Wheels`, `(20in)`, `20''`, plus Lucid's
 * front/rear pairing `w/20F21R wheels`, which means 20 front and 21 rear and
 * would otherwise read as one nonsense number.
 *
 * Bounded to 15–26 inches so a model year, an axle ratio or an N/V figure in
 * the same sentence cannot arrive as a wheel size.
 */
export function wheelMentions(text) {
    const s = String(text ?? '');
    const out = new Set();
    const add = (v) => { const n = Number(v); if (n >= 15 && n <= 26) out.add(n); };

    // Lucid's front/rear pair first: "20F21R" is two sizes, not one.
    for (const m of s.matchAll(/(\d{2})\s*F\s*(\d{2})\s*R/gi)) { add(m[1]); add(m[2]); }
    for (const m of s.matchAll(/(\d{2})\s*(?:inch|in\b|''|"|')\s*(?:wheel|tire|tyre)?/gi)) add(m[1]);

    return [...out].sort((a, b) => a - b);
}

/**
 * Whether a test vehicle carries anything from its CSI certificate.
 *
 * The two fields that resolve an ambiguous match — the covered-models table and
 * the manufacturer's note — exist only on test vehicles imported from a CSI PDF. A
 * test vehicle that came from the certification CSV has neither, and no amount of
 * looking at it will produce them.
 *
 * Worth stating rather than leaving as an absence: it turns "there is nothing
 * to go on here" into "fetch this certificate", which is an action.
 */
export function hasCsiDetail(testVehicle) {
    return (testVehicle?.epa_covered_models?.length ?? 0) > 0
        || (testVehicle?.epa_tests ?? []).some(t => t.mfr_test_vehicle_comments);
}

/** Every wheel size this certificate's covered models name, deduplicated. */
export function coveredWheelSizes(testVehicle) {
    const out = new Set();
    for (const cm of testVehicle?.epa_covered_models ?? []) {
        for (const w of wheelMentions(cm.carline_name)) out.add(w);
    }
    return [...out].sort((a, b) => a - b);
}

/** Loose comparison for a carline: case, punctuation and spacing are noise. */
const carlineKey = (v) => String(v ?? '')
    .toLowerCase()
    .replace(/[''"".,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * A guide row whose carline IS one of the configurations this certificate says
 * it covers.
 *
 * The strongest signal available, and it comes from a page the importer only
 * started reading in #250. The Emission Data Vehicle Information page names one
 * represented vehicle for a whole certificate — `R1T All-Terrain Performance
 * Dual` — while the Models Covered table enumerates what it actually covers,
 * wheel variants and all, in words that match the guide almost exactly:
 *
 *     covered model : R1T Performance Dual Max (20in)
 *     guide carline : R1T Performance Dual Max (20in)
 *
 * So this is a name identity rather than a similarity, and it settles the cases
 * a score cannot: 59 of the 115 covered-model rows in the sample name a wheel
 * or tyre, which is exactly what the represented-vehicle name leaves out.
 *
 * Returns every match. A certificate covering four configurations legitimately
 * matches four guide rows, and choosing among them is still the curator's.
 */
export function coveredModelMatches(testVehicle, feRows = []) {
    const covered = new Set(
        (testVehicle?.epa_covered_models ?? []).map(cm => carlineKey(cm.carline_name)).filter(Boolean),
    );
    if (!covered.size) return [];
    return feRows.filter(r => covered.has(carlineKey(r.carline)));
}

/**
 * Guide rows in the certification's own year and Test Group.
 *
 * The Guide keys its rows by year and the smog-rating Test Group — the
 * certification. Migration 053 dismissed the join because, compared with our
 * record's Vehicle ID, it matched 1 of 87 linked records: the record was the
 * test vehicle, not the certification, and the two identifiers are different
 * things (#374). Compared with the certification's Test Group in its year, it
 * is the Guide's own key — for 163 of 809 unlinked certifications after a full
 * corpus import, exactly one row.
 *
 * Still not unique per configuration: a certificate covering four wheel sizes
 * matches four rows, which is why a proposal takes it only when there is one.
 * A record whose Vehicle ID IS a Test Group (made by hand from a lab PDF) still
 * matches on that.
 */
export function exactTestGroupMatches(testVehicle, feRows = []) {
    const norm = (v) => String(v ?? '').trim().toUpperCase();
    const tg = norm(testVehicle?.test_group);
    const id = norm(testVehicle?.test_vehicle_id);
    const year = Number(testVehicle?.model_year);
    return feRows.filter(r => {
        const s = norm(r.smog_test_group);
        if (!s) return false;
        if (tg && s === tg) return !year || Number(r.model_year) === year;
        return !!id && s === id;
    });
}

/**
 * Whether the remaining candidates are one certification seen several times.
 *
 * The Lucid case: `Air Touring AWD` appears three times in MY2024 at 411, 382
 * and 365 miles for 19, 20 and 21 inch wheels — and all three carry the SAME
 * smog Test Group, because EPA certified them once and the guide lists the
 * wheel options separately.
 *
 * So there is no fact that makes one of them the right answer, and a curator
 * hunting for one is looking for something that does not exist. Saying that
 * turns an unanswerable question into a choice: pick the wheel you mean.
 */
export function sharedCertification(ranked) {
    const testVehicles = ranked
        .map(c => String(c.row.smog_test_group ?? '').trim())
        .filter(Boolean);
    if (testVehicles.length < 2) return null;
    const unique = new Set(testVehicles);
    if (unique.size !== 1) return null;
    return { smogTestGroup: [...unique][0], count: ranked.length };
}

// ── Proposals ────────────────────────────────────────────────────────────────

/**
 * Why a test vehicle has no automatic proposal — worded for the person who has to
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
 * Classify one test vehicle: its tier, its proposal if there is a safe one, and the
 * ranked list either way.
 *
 * The safe-proposal test is `bestFeCandidate`, unchanged and deliberately.
 * It already declines below the floor, declines a cross-year match, and
 * declines a tie — the last being the one learned from data, where `Ioniq 5`
 * scores identically against `Ioniq 5 N` and `Ioniq 5 RWD`, cars 221 and ~300
 * miles apart. Inventing a second, looser threshold here would quietly undo
 * that reasoning at the exact moment it is applied in bulk.
 */
export function classifyTestVehicle(testVehicle, feRows) {
    const ranked = rankFeCandidates(testVehicle, feRows);

    // An identifier match is not a guess, so it is taken before the ranker is
    // consulted at all — and only when it is unambiguous, since the guide's
    // Test Group is not unique per configuration and several rows can carry it.
    const exact = exactTestGroupMatches(testVehicle, feRows);
    if (exact.length === 1) {
        return {
            testVehicle,
            tier: tierOf(testVehicle),
            proposal: { row: exact[0], score: 1, exactYear: Number(exact[0].model_year) === Number(testVehicle.model_year) },
            exactIdMatch: true,
            coveredMatch: false,
            reason: null,
            ranked: ranked.slice(0, 8),
            candidateCount: ranked.length,
            shared: sharedCertification(ranked.slice(0, 8)),
        };
    }

    // A carline that the certificate itself lists as covered. Same standing as
    // the identifier match — a name identity, not a score — and only taken when
    // it is unambiguous, since a certificate covering four configurations
    // matches four guide rows and picking among them is a judgement.
    const coveredSameYear = coveredModelMatches(testVehicle, feRows)
        .filter(r => Number(r.model_year) === Number(testVehicle.model_year));
    if (coveredSameYear.length === 1) {
        return {
            testVehicle,
            tier: tierOf(testVehicle),
            proposal: { row: coveredSameYear[0], score: 1, exactYear: true },
            exactIdMatch: false,
            coveredMatch: true,
            reason: null,
            ranked: ranked.slice(0, 8),
            candidateCount: ranked.length,
            shared: null,
        };
    }

    const best = bestFeCandidate(testVehicle, feRows);

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
        testVehicle,
        tier: tierOf(testVehicle),
        proposal: best,
        exactIdMatch: false,
        coveredMatch: false,
        reason,
        ranked: ranked.slice(0, 8),
        candidateCount: ranked.length,
        // Only worth saying when there is no proposal: if one candidate already
        // won cleanly, the fact that its siblings share a certification is not
        // what the curator is stuck on.
        shared: best ? null : sharedCertification(ranked.slice(0, 8)),
    };
}

/**
 * Every test vehicle needing a decision, classified and ordered.
 *
 * Within a tier, test vehicles WITH a safe proposal come first: they are the ones a
 * curator can clear in one click, and burying them behind the hard cases is
 * what makes a sweep feel endless.
 */
export function buildSweep(testVehicles, feRows) {
    const tierRank = Object.fromEntries(TIERS.map((t, i) => [t.key, i]));
    return testVehicles
        .map(g => classifyTestVehicle(g, feRows))
        .sort((a, b) =>
            tierRank[a.tier] - tierRank[b.tier]
            || (a.proposal ? 0 : 1) - (b.proposal ? 0 : 1)
            || (b.proposal?.score ?? 0) - (a.proposal?.score ?? 0)
            || String(a.testVehicle.test_vehicle_id).localeCompare(String(b.testVehicle.test_vehicle_id))
            || Number(a.testVehicle.model_year) - Number(b.testVehicle.model_year));
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

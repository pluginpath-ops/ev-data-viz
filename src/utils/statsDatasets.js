import {
    UNITS, MEASURES, measureByKey,
    summarise, overall, histogram, extremes,
    describe, bucketise, histogramOf, extremesOf,
} from './epaGuideStats';
import {
    CERT_MEASURES, certMeasureByKey, certObservations,
    coverageFor, nullImpossible,
} from './epaCertStats';

/**
 * The two statistics populations, as data rather than as branches (#236).
 *
 * `EpaStatsView` asked `isCert` in twelve places — which measures, which
 * default, which population, whether to null impossible values, whether to
 * report coverage, and four different summariser calls with different argument
 * shapes. Every one of those was the same question answered twelve times, and
 * the cost was not the verbosity: it was that adding a third population, or
 * changing what one of them means, meant finding all twelve.
 *
 * ── They are two datasets, not two views of one ─────────────────────────────
 *
 * The guide holds what reached the window sticker for 1,175 configurations; the
 * certification records hold the lab's own measurements for 181. Different
 * populations, different measures, different n. Which one is being read is a
 * deliberate choice, never inferred from the measure that happens to be
 * selected — so each entry here names its own default measure and resolves an
 * unknown one to it.
 *
 * ── Why the summarisers are wrapped rather than called directly ─────────────
 *
 * The guide's take a `unit` — its rows collapse to configurations, test groups
 * or makes, and which one you count is the whole question. The certification
 * side has no such question: a record IS the unit and there is nothing below it
 * to collapse. Wrapping both behind one signature is what lets the view stop
 * caring, and `hasUnitChoice` is what lets it stop rendering a control for a
 * question that is not being asked.
 */

/** Identity: the guide has no placeholder problem to clean up. See `cert`. */
const asPlotted = (rows) => rows;

export const STATS_DATASETS = {
    guide: {
        key: 'guide',
        label: 'Label figures',
        source: 'Fuel Economy Guide — what reached the window sticker',
        measures: MEASURES,
        measureByKey,
        defaultMeasure: 'label_comb_mpge',
        // The guide's rows are one per configuration per year, so how many
        // observations a make contributes depends on what you are counting.
        hasUnitChoice: true,
        /** How the caption names its observations, given the chosen unit. */
        unitPhrase: (unit) => UNITS.find(u => u.key === unit)?.label.toLowerCase() ?? '',
        observations: ({ guideRows }) => guideRows,
        plotted: asPlotted,
        coverage: () => null,
        summarise: (rows, { unit, dimension, measure, minN, sort }) =>
            summarise(rows, { unit, dimension, measure, minN, sort }),
        corpus: (rows, { unit, measure }) => overall(rows, { unit, measure }),
        histogram: (rows, { unit, measure, bins }) => histogram(rows, { unit, measure, bins }),
        extremes: (rows, { unit, measure, count }) => extremes(rows, { unit, measure, count }),
    },

    cert: {
        key: 'cert',
        label: 'Lab measurements',
        source: 'EPA certification records — road load, efficiency, energy',
        measures: CERT_MEASURES,
        measureByKey: certMeasureByKey,
        // Charger efficiency opens this side because it is the one figure here
        // with no counterpart anywhere else: nobody publishes it, it is
        // measured rather than derived from an assumption, and its spread is
        // the most immediate signal of whether a record imported soundly.
        defaultMeasure: 'charger_eff',
        hasUnitChoice: false,
        unitPhrase: () => 'per certification record',
        observations: ({ certObs }) => certObs,
        // A backstop, not the fix. Zoox filed 999.0 for energy, distance and
        // recharge alike and Karsan filed 1.0 for all three — placeholders, not
        // measurements — and one of them alone set the axis from 1 to 999 and
        // flattened every box on the table. The records want correcting on the
        // certification side; this stops a value that cannot be true from
        // reaching a median in the meantime.
        plotted: (rows, measure) => nullImpossible(rows, measure),
        // What the figure is computed from, and what it is not: a median over a
        // population padded with a fallback constant looks exactly like one
        // over 73 real derivations.
        coverage: (rows, measure) => coverageFor(rows, measure),
        summarise: (rows, { dimension, measure, minN, sort }) =>
            bucketise(rows, { dimension, measure, minN, sort }),
        corpus: (rows, { measure }) => describe(rows.map(o => o[measure])),
        histogram: (rows, { measure, bins }) => histogramOf(rows, { measure, bins }),
        extremes: (rows, { measure, count }) => extremesOf(rows, { measure, count }),
    },
};

/** In tab order, for the dataset switch. */
export const DATASET_LIST = [STATS_DATASETS.guide, STATS_DATASETS.cert];

/** Unknown keys resolve to the guide — the side every visitor can read. */
export function datasetByKey(key) {
    return STATS_DATASETS[key] ?? STATS_DATASETS.guide;
}

/**
 * Every measure key either dataset knows, for validating one out of a URL.
 *
 * Checked against BOTH catalogues, because only the guide's used to be: a
 * certification measure in a shared link failed validation, reverted to the
 * guide default, and the cert tab then swapped that for charger efficiency —
 * so every link to a certification measure opened on the wrong one.
 */
export function isKnownMeasure(key) {
    return DATASET_LIST.some(d => d.measures.some(m => m.key === key));
}

/**
 * Build the certification observations once, from what the view has loaded.
 *
 * Here rather than in the view so `observations` above is the only thing that
 * knows which population belongs to which dataset.
 */
export function certPopulation(certGroups, brandIndex) {
    return certObservations(certGroups ?? [], brandIndex);
}

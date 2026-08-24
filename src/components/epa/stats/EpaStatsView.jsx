import { useState, useMemo, useCallback, useEffect } from 'react';
import { useAppContext } from '../../../context/AppContext';
import { useAsyncResource } from '../../../hooks/useAsyncResource';
import { decorateRow, buildBrandIndex } from '../../../utils/feGuideBrowse';
import {
    UNITS, DEFAULT_UNIT, DIMENSIONS, MEASURES, measureByKey,
    summarise, overall, histogram, extremes, bucketise, describe,
    histogramOf, extremesOf,
} from '../../../utils/epaGuideStats';
import {
    CERT_MEASURES, certMeasureByKey, certObservations, coverageFor,
} from '../../../utils/epaCertStats';
import StatsTable from './StatsTable';
import StatsHistogram from './StatsHistogram';
import StatsExtremes from './StatsExtremes';
import LoadingSpinner from '../../LoadingSpinner';

/**
 * The statistics bank — phase 2 of #234, issue #236.
 *
 * What is typical, rather than what one car does. The value is context: "0.7294"
 * means nothing alone, where "0.7294, against a fixed 0.700 for over half the
 * fleet" is a fact about how the car was rated.
 *
 * Reads the same corpus the browser loads and computes in the client — see the
 * header of `epaGuideStats` for why this is not a set of RPCs.
 *
 * Guide-side only for now. The certification-side figures — drivetrain η,
 * charger efficiency, weight against consumption — need a guide link to be
 * grouped by anything here, and only 45 of 204 groups have one. That is #238,
 * and until it lands those statistics would describe a dozen makes and read as
 * though they described the fleet.
 */
const MIN_N = 3;

/**
 * Two datasets, not two views of one.
 *
 * The guide holds what reached the window sticker for 1,175 configurations; the
 * certification records hold the lab's own measurements for 181. Different
 * populations, different measures, different n — so which one is being read has
 * to be a deliberate choice rather than something inferred from the measure
 * that happens to be selected.
 */
const DATASETS = [
    { key: 'guide', label: 'Label figures', source: 'Fuel Economy Guide — what reached the window sticker' },
    { key: 'cert',  label: 'Lab measurements', source: 'EPA certification records — road load, efficiency, energy' },
];

export default function EpaStatsView({ subtab = 'stats' }) {
    const { getFeGuideRows, getBrandAliases, getCertGroupsForStats } = useAppContext();

    const loadRows    = useCallback(() => getFeGuideRows(), [getFeGuideRows]);
    const loadAliases = useCallback(() => getBrandAliases(), [getBrandAliases]);
    const { data: rawRows, loading, error } = useAsyncResource(loadRows, []);
    const { data: aliases } = useAsyncResource(loadAliases, []);
    const loadCert = useCallback(() => getCertGroupsForStats(), [getCertGroupsForStats]);
    const { data: certGroups } = useAsyncResource(loadCert, []);

    const [initial] = useState(() => {
        const p = new URLSearchParams(window.location.search);
        return {
            dataset:   DATASETS.some(d => d.key === p.get('ds')) ? p.get('ds') : 'guide',
            unit:      UNITS.some(u => u.key === p.get('u')) ? p.get('u') : DEFAULT_UNIT,
            dimension: DIMENSIONS.some(d => d.key === p.get('d')) ? p.get('d') : 'body_class',
            measure:   MEASURES.some(m => m.key === p.get('ms')) ? p.get('ms') : 'label_comb_mpge',
            // A list, so a reader can compare two years side by side. Absent
            // means "not chosen yet" and falls back to the best-covered year;
            // an explicitly empty list means every year.
            // `filter(Boolean)` BEFORE the map, not after: `Number('')` is 0
            // and 0 is finite, so `?yr=` alone decoded to the year zero and the
            // view reported "0 of 0 groups" for a filter nobody set.
            years: p.has('yr')
                ? p.get('yr').split(',').filter(Boolean).map(Number).filter(Number.isFinite)
                : null,
            classes: p.get('cl') ? p.get('cl').split(',').filter(Boolean) : [],
            drives:  p.get('dr') ? p.get('dr').split(',').filter(Boolean) : [],
        };
    });
    const [dataset, setDataset]     = useState(initial.dataset);
    const [unit, setUnit]           = useState(initial.unit);
    const [dimension, setDimension] = useState(initial.dimension);
    const [storedMeasure, setMeasure] = useState(initial.measure);
    const [years, setYears]         = useState(initial.years);
    const [classes, setClasses]     = useState(initial.classes);
    const [drives, setDrives]       = useState(initial.drives);

    const isCert = dataset === 'cert';
    const measures = isCert ? CERT_MEASURES : MEASURES;

    /**
     * A measure belongs to one dataset. Switching datasets with `aero_c`
     * selected would ask the guide for a road-load coefficient it has never
     * heard of and render an empty table with nothing to explain it.
     *
     * Resolved rather than reset in an effect: an effect would set state during
     * render and cascade, and this is derivable — the selection is only ever
     * the stored one when the active dataset actually has it.
     */
    const measure = measures.some(m => m.key === storedMeasure)
        ? storedMeasure
        : (isCert ? 'aero_c' : 'label_comb_mpge');
    const measDef = isCert ? certMeasureByKey(measure) : measureByKey(measure);

    const brandIndex = useMemo(() => buildBrandIndex(aliases ?? []), [aliases]);
    const allRows = useMemo(
        () => (rawRows ?? []).map(r => decorateRow(r, brandIndex)),
        [rawRows, brandIndex],
    );

    const allYears = useMemo(
        () => [...new Set(allRows.map(r => r.model_year).filter(Boolean))].sort((a, b) => b - a),
        [allRows],
    );

    /**
     * The default year is the best-covered one, not the newest.
     *
     * EPA files a model year over many months, so the newest is always the
     * thinnest: MY2027 holds 135 rows against MY2026's 323, which is 49 test
     * groups instead of 122 and puts three classes below the reporting
     * threshold. Landing there makes the corpus look sparse and several
     * segments unanswerable, when a year-old figure would answer them.
     */
    const bestCoveredYear = useMemo(() => {
        const counts = new Map();
        for (const r of allRows) {
            if (!r.model_year) continue;
            counts.set(r.model_year, (counts.get(r.model_year) ?? 0) + 1);
        }
        let best = null, bestN = -1;
        for (const [y, n] of counts) if (n > bestN || (n === bestN && y > best)) { best = y; bestN = n; }
        return best;
    }, [allRows]);

    // One year by default, because the same configuration recurs across years
    // at identical figures — the 2025 and 2026 Rivian groups are the same 24
    // rows — so a multi-year "what is typical" counts those cars more than
    // once. Selecting several is allowed and sometimes wanted; the view says
    // what it costs rather than refusing.
    // Memoised because the fallback allocates. As a bare expression it built a
    // new array on every render, so the `rows` memo below saw a changed
    // dependency each time and re-filtered all 1,175 rows for nothing.
    const selectedYears = useMemo(
        () => years ?? (bestCoveredYear ? [bestCoveredYear] : []),
        [years, bestCoveredYear],
    );
    /**
     * Filters narrow the population; the dimension splits what remains.
     *
     * A filter on the dimension being grouped by is deliberately not offered —
     * it would only remove rows from a table of that same field, which the eye
     * does better than a control. So the class filter appears when grouping by
     * anything but class, and likewise for drive.
     *
     * A hidden filter is not APPLIED, rather than being cleared. Leaving it
     * applied would narrow the data invisibly, with nothing on screen to
     * explain the missing rows; clearing it would lose a selection the moment
     * you glanced at another grouping. Skipping it does neither — switch back
     * and the choice is still there.
     */
    const showClassFilter = dimension !== 'body_class';
    const showDriveFilter = dimension !== 'drive_group';

    const rows = useMemo(() => {
        let out = allRows;
        if (selectedYears.length) out = out.filter(r => selectedYears.includes(r.model_year));
        if (showClassFilter && classes.length) out = out.filter(r => classes.includes(r.body_class));
        if (showDriveFilter && drives.length)  out = out.filter(r => drives.includes(r.drive_group));
        return out;
    }, [allRows, selectedYears, classes, drives, showClassFilter, showDriveFilter]);

    const allClasses = useMemo(
        () => [...new Set(allRows.map(r => r.body_class).filter(Boolean))].sort(),
        [allRows],
    );
    const allDrives = useMemo(
        () => [...new Set(allRows.map(r => r.drive_group).filter(Boolean))].sort(),
        [allRows],
    );

    const toggleIn = (list, setList) => (v) =>
        setList(list.includes(v) ? list.filter(x => x !== v) : [...list, v]);

    const toggleYear = (y) => {
        const next = selectedYears.includes(y)
            ? selectedYears.filter(v => v !== y)
            : [...selectedYears, y].sort((a, b) => b - a);
        setYears(next);
    };

    useEffect(() => {
        const p = new URLSearchParams();
        p.set('tab', 'epa');
        if (dataset !== 'guide')          p.set('ds', dataset);
        p.set('sub', subtab);
        if (unit !== DEFAULT_UNIT)        p.set('u', unit);
        if (dimension !== 'body_class')   p.set('d', dimension);
        if (measure !== 'label_comb_mpge') p.set('ms', measure);
        // Written even when empty, so "all years" survives a reload instead of
        // reverting to the best-covered default.
        if (years != null)                p.set('yr', years.join(','));
        if (showClassFilter && classes.length) p.set('cl', classes.join(','));
        if (showDriveFilter && drives.length)  p.set('dr', drives.join(','));
        window.history.replaceState({ view: 'epa' }, '', `?${p.toString()}`);
    }, [dataset, unit, dimension, measure, years, classes, drives, showClassFilter, showDriveFilter, subtab]);


    /**
     * Certification observations: one per test group, already flat, so they are
     * bucketed directly rather than clustered. The unit-of-analysis question
     * does not arise — a certification record IS the unit, and there is nothing
     * below it to collapse.
     */
    const certObs = useMemo(
        () => certObservations(certGroups ?? [], brandIndex),
        [certGroups, brandIndex],
    );
    const certFiltered = useMemo(() => {
        let out = certObs;
        if (selectedYears.length) out = out.filter(o => selectedYears.includes(o.model_year));
        if (showClassFilter && classes.length) out = out.filter(o => classes.includes(o.body_class));
        if (showDriveFilter && drives.length)  out = out.filter(o => drives.includes(o.drive_group));
        return out;
    }, [certObs, selectedYears, classes, drives, showClassFilter, showDriveFilter]);

    const coverage = useMemo(
        () => (isCert ? coverageFor(certFiltered, measure) : null),
        [isCert, certFiltered, measure],
    );

    const summary   = useMemo(
        () => (isCert
            ? bucketise(certFiltered, { dimension, measure, minN: MIN_N })
            : summarise(rows, { unit, dimension, measure, minN: MIN_N })),
        [isCert, certFiltered, rows, unit, dimension, measure],
    );
    const corpus    = useMemo(
        () => (isCert ? describe(certFiltered.map(o => o[measure])) : overall(rows, { unit, measure })),
        [isCert, certFiltered, rows, unit, measure],
    );
    const hist = useMemo(
        () => (isCert
            ? histogramOf(certFiltered, { measure, bins: 24 })
            : histogram(rows, { unit, measure, bins: 24 })),
        [isCert, certFiltered, rows, unit, measure],
    );
    const tails = useMemo(
        () => (isCert
            ? extremesOf(certFiltered, { measure, count: 5 })
            : extremes(rows, { unit, measure, count: 5 })),
        [isCert, certFiltered, rows, unit, measure],
    );

    if (loading) return <LoadingSpinner />;
    if (error) {
        return <div className="empty-state">The Fuel Economy Guide could not be loaded.</div>;
    }
    if (allRows.length === 0) {
        return (
            <div className="empty-state">
                No Fuel Economy Guide data has been imported yet.
                <div className="text-caption text-muted mt-1">
                    An admin can load a guide year from Admin → Fuel Economy Guide.
                </div>
            </div>
        );
    }

    const unitDef = UNITS.find(u => u.key === unit);
    const dimDef  = DIMENSIONS.find(d => d.key === dimension);
    const dsDef   = DATASETS.find(d => d.key === dataset);

    return (
        <div className="stats-view">
            <div className="section-header">
                <div>
                    <div className="section-title">EPA statistics</div>
                    <div className="text-caption text-secondary">
                        {measDef?.label} by {dimDef?.label.toLowerCase()}, {unitDef?.label.toLowerCase()},
                        {' '}{selectedYears.length === 0
                            ? 'all model years'
                            : selectedYears.length === 1
                                ? `model year ${selectedYears[0]}`
                                : `model years ${selectedYears.join(', ')}`}
                        {showClassFilter && classes.length > 0 && `, ${classes.join(' / ')} only`}
                        {showDriveFilter && drives.length > 0 && `, ${drives.join(' / ')} only`}.
                    </div>
                </div>
            </div>

            <div className="guide-filter-bar">
                {/* The unit leads, and states the question each answers. The
                    same query gives materially different numbers, and a reader
                    who does not know which one they are looking at cannot use
                    any of them. */}
                <div className="guide-facet stats-facet-unit">
                    <div className="guide-facet-label">Dataset</div>
                    <div className="guide-facet-values">
                        {DATASETS.map(d => (
                            <button key={d.key} type="button"
                                className={`guide-chip ${dataset === d.key ? 'active' : ''}`}
                                onClick={() => setDataset(d.key)}
                                title={d.source}>{d.label}</button>
                        ))}
                    </div>
                    <div className="text-hint">{dsDef?.source}</div>
                </div>

                {/* Only the guide has a unit-of-analysis question. A
                    certification record IS the unit; there is nothing below it
                    to collapse. */}
                {!isCert && (
                <div className="guide-facet stats-facet-unit">
                    <div className="guide-facet-label">Count one observation per</div>
                    <div className="guide-facet-values">
                        {UNITS.map(u => (
                            <button
                                key={u.key}
                                type="button"
                                className={`guide-chip ${unit === u.key ? 'active' : ''}`}
                                onClick={() => setUnit(u.key)}
                                title={u.answers}
                            >
                                {u.label.replace('Per ', '')}
                            </button>
                        ))}
                    </div>
                    <div className="text-hint">{unitDef?.answers}</div>
                </div>
                )}

                <div className="guide-facet">
                    <div className="guide-facet-label">Model year</div>
                    <div className="guide-facet-values">
                        {allYears.map(y => (
                            <button key={y} type="button"
                                className={`guide-chip ${selectedYears.includes(y) ? 'active' : ''}`}
                                onClick={() => toggleYear(y)}>{y}</button>
                        ))}
                        <button type="button"
                            className={`guide-chip ${selectedYears.length === 0 ? 'active' : ''}`}
                            onClick={() => setYears([])}>All</button>
                    </div>
                    {/* Stated rather than prevented. Comparing two years is a
                        real question; counting one car twice while asking what
                        is typical is a different one, and the reader should be
                        told which they are looking at. */}
                    {selectedYears.length !== 1 && (
                        <div className="text-hint">
                            A configuration that appears in several years is counted once per year.
                        </div>
                    )}
                </div>

                <div className="guide-facet">
                    <div className="guide-facet-label">Group by</div>
                    <div className="guide-facet-values">
                        {DIMENSIONS.map(d => (
                            <button key={d.key} type="button"
                                className={`guide-chip ${dimension === d.key ? 'active' : ''}`}
                                onClick={() => setDimension(d.key)}>{d.label}</button>
                        ))}
                    </div>
                </div>

                {showClassFilter && (
                    <div className="guide-facet">
                        <div className="guide-facet-label">Only these classes</div>
                        <div className="guide-facet-values">
                            {allClasses.map(c => (
                                <button key={c} type="button"
                                    className={`guide-chip ${classes.includes(c) ? 'active' : ''}`}
                                    onClick={() => toggleIn(classes, setClasses)(c)}>{c}</button>
                            ))}
                        </div>
                    </div>
                )}

                {showDriveFilter && (
                    <div className="guide-facet">
                        <div className="guide-facet-label">Only these drivetrains</div>
                        <div className="guide-facet-values">
                            {allDrives.map(d => (
                                <button key={d} type="button"
                                    className={`guide-chip ${drives.includes(d) ? 'active' : ''}`}
                                    onClick={() => toggleIn(drives, setDrives)(d)}>{d}</button>
                            ))}
                        </div>
                    </div>
                )}

                <div className="guide-facet">
                    <div className="guide-facet-label">Measure</div>
                    <div className="guide-facet-values">
                        {measures.map(m => (
                            <button key={m.key} type="button"
                                className={`guide-chip ${measure === m.key ? 'active' : ''}`}
                                onClick={() => setMeasure(m.key)}>{m.label}</button>
                        ))}
                    </div>
                </div>
            </div>

            {/* What the figure is computed from, and what it is not. A median
                over a population padded with a fallback constant looks exactly
                like one over 73 real derivations. */}
            {coverage && (
                <div className="text-hint">
                    {coverage.usable} of {coverage.total} certification groups carry this figure
                    {coverage.assumed > 0 && `; ${coverage.assumed} could not be derived and fall back to a default, so they are excluded rather than counted`}
                    {coverage.missing > 0 && `; ${coverage.missing} do not report it`}.
                </div>
            )}

            <StatsTable
                rows={summary}
                measureDef={measDef}
                overall={corpus}
                dimensionLabel={dimDef?.label ?? ''}
            />

            <div className="stats-panels">
                <div className="stats-panel">
                    <div className="section-header-title">Distribution</div>
                    <StatsHistogram data={hist} measureDef={measDef} />
                </div>
                <div className="stats-panel">
                    <div className="section-header-title">Named extremes</div>
                    <StatsExtremes data={tails} measure={measure} measureDef={measDef} />
                </div>
            </div>

            <div className="text-hint">
                Buckets with fewer than {MIN_N} observations are marked rather than dropped.
                Medians and quartiles throughout — these distributions are small and skewed,
                and one long-range outlier moves a mean in a way it does not move a median.
            </div>
        </div>
    );
}

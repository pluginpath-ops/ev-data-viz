import { useState, useMemo, useCallback, useEffect } from 'react';
import { useAppContext } from '../../../context/AppContext';
import { useAsyncResource } from '../../../hooks/useAsyncResource';
import { decorateRow, buildBrandIndex } from '../../../utils/feGuideBrowse';
import {
    UNITS, DEFAULT_UNIT, DIMENSIONS, SORT_KEYS, DEFAULT_SORT,
    applyStatsFilters, bestCoveredYear, yearsPresent,
} from '../../../utils/epaGuideStats';
import { UNKNOWN_DIMENSION } from '../../../utils/epaCertStats';
import { datasetByKey, isKnownMeasure, certPopulation } from '../../../utils/statsDatasets';
import StatsControls from './StatsControls';
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

export default function EpaStatsView({ subtab = 'labelstats', dataset = 'guide' }) {
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
            unit:      UNITS.some(u => u.key === p.get('u')) ? p.get('u') : DEFAULT_UNIT,
            dimension: DIMENSIONS.some(d => d.key === p.get('d')) ? p.get('d') : 'body_class',
            // Validated against both catalogues; which dataset OWNS the key
            // does not need deciding here, because `measure` below resolves
            // that against the active tab. Null when unknown, so the dataset's
            // own default answers rather than the guide's always answering.
            measure:   isKnownMeasure(p.get('ms')) ? p.get('ms') : null,
            // `key:dir` in one parameter — two would let a link carry half a
            // sort, and there is no sensible reading of a direction with no
            // column. Anything unrecognised falls back whole.
            sort: (() => {
                const [key, dir] = String(p.get('so') ?? '').split(':');
                return SORT_KEYS.includes(key) && (dir === 'asc' || dir === 'desc')
                    ? { key, dir } : DEFAULT_SORT;
            })(),
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
    const [unit, setUnit]           = useState(initial.unit);
    const [dimension, setDimension] = useState(initial.dimension);
    const [storedMeasure, setMeasure] = useState(initial.measure);
    const [years, setYears]         = useState(initial.years);
    const [sort, setSort]           = useState(initial.sort);
    const [classes, setClasses]     = useState(initial.classes);
    const [drives, setDrives]       = useState(initial.drives);

    const ds = datasetByKey(dataset);

    /**
     * A measure belongs to one dataset. Switching datasets with `aero_c`
     * selected would ask the guide for a road-load coefficient it has never
     * heard of and render an empty table with nothing to explain it.
     *
     * Resolved rather than reset in an effect: an effect would set state during
     * render and cascade, and this is derivable — the selection is only ever
     * the stored one when the active dataset actually has it.
     */
    const measure = ds.measures.some(m => m.key === storedMeasure)
        ? storedMeasure
        : ds.defaultMeasure;
    const measDef = ds.measureByKey(measure);

    const brandIndex = useMemo(() => buildBrandIndex(aliases ?? []), [aliases]);
    const allRows = useMemo(
        () => (rawRows ?? []).map(r => decorateRow(r, brandIndex)),
        [rawRows, brandIndex],
    );

    /**
     * Certification observations: one per test group, already flat, so they are
     * bucketed directly rather than clustered. The unit-of-analysis question
     * does not arise — a certification record IS the unit, and there is nothing
     * below it to collapse.
     */
    const certObs = useMemo(
        () => certPopulation(certGroups, brandIndex),
        [certGroups, brandIndex],
    );

    /**
     * The population on screen, chosen by the dataset rather than by an
     * `isCert` here. Everything below reads it: the year chips, the filter
     * chips, the filtered set and every statistic.
     */
    const active = useMemo(
        () => ds.observations({ guideRows: allRows, certObs }),
        [ds, allRows, certObs],
    );

    // Both derived from the dataset on screen. The guide's best-covered year is
    // not the certification records' — defaulting one tab to the other's answer
    // lands it on a thin year for no visible reason.
    const allYears = useMemo(() => yearsPresent(active), [active]);
    const defaultYear = useMemo(() => bestCoveredYear(active), [active]);


    // One year by default, because the same configuration recurs across years
    // at identical figures — the 2025 and 2026 Rivian groups are the same 24
    // rows — so a multi-year "what is typical" counts those cars more than
    // once. Selecting several is allowed and sometimes wanted; the view says
    // what it costs rather than refusing.
    // Memoised because the fallback allocates. As a bare expression it built a
    // new array on every render, so the `rows` memo below saw a changed
    // dependency each time and re-filtered all 1,175 rows for nothing.
    const selectedYears = useMemo(
        () => years ?? (defaultYear ? [defaultYear] : []),
        [years, defaultYear],
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


    /**
     * The filter chips, from the dataset on screen rather than always from the
     * guide.
     *
     * These read `allRows` whichever tab was open, which offered the
     * certification tab classes no certification group has. That became a real
     * hole once unlinked groups joined it: they read `Unknown`, the guide has
     * no such class, so `Unknown` could never be offered — and picking any
     * class chip then dropped every unlinked group with nothing on screen
     * saying so.
     *
     * `Unknown` sorts last rather than alphabetically. It is not a class.
     */
    const facetValues = (rows, key) => {
        const vals = [...new Set(rows.map(r => r[key]).filter(Boolean))];
        const known = vals.filter(v => v !== UNKNOWN_DIMENSION).sort();
        return vals.includes(UNKNOWN_DIMENSION) ? [...known, UNKNOWN_DIMENSION] : known;
    };
    const allClasses = useMemo(() => facetValues(active, 'body_class'), [active]);
    const allDrives  = useMemo(() => facetValues(active, 'drive_group'), [active]);

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
        p.set('sub', subtab);
        if (unit !== DEFAULT_UNIT)        p.set('u', unit);
        if (dimension !== 'body_class')   p.set('d', dimension);
        // Against the ACTIVE dataset's default, not always the guide's — the
        // certification tab wrote `ms=charger_eff` into every URL to say
        // "the default".
        if (measure !== ds.defaultMeasure) p.set('ms', measure);
        if (sort.key !== DEFAULT_SORT.key || sort.dir !== DEFAULT_SORT.dir) {
            p.set('so', `${sort.key}:${sort.dir}`);
        }
        // Written even when empty, so "all years" survives a reload instead of
        // reverting to the best-covered default.
        if (years != null)                p.set('yr', years.join(','));
        if (showClassFilter && classes.length) p.set('cl', classes.join(','));
        if (showDriveFilter && drives.length)  p.set('dr', drives.join(','));
        window.history.replaceState({ view: 'epa' }, '', `?${p.toString()}`);
    }, [ds, unit, dimension, measure, sort, years, classes, drives, showClassFilter, showDriveFilter, subtab]);

    /**
     * Guide rows and certification observations carry the same three dimension
     * fields by design, so one filter serves both. Written twice, the second
     * copy would drift the first time a filter was added — which is the failure
     * this whole module keeps arguing against elsewhere.
     */
    const filtered = useMemo(
        () => applyStatsFilters(active, {
            years: selectedYears, classes, drives,
            showClass: showClassFilter, showDrive: showDriveFilter,
        }),
        [active, selectedYears, classes, drives, showClassFilter, showDriveFilter],
    );

    /**
     * The plotted population: the filtered one, cleaned by whatever the dataset
     * says needs cleaning — see `statsDatasets` for the placeholder values on
     * the certification side.
     *
     * Everything below reads `plotted` rather than `filtered`, coverage
     * included, so the count in the caption describes the same numbers the
     * table and the histogram were built from.
     */
    const plotted  = useMemo(() => ds.plotted(filtered, measure), [ds, filtered, measure]);
    const coverage = useMemo(() => ds.coverage(plotted, measure), [ds, plotted, measure]);

    const summary = useMemo(
        () => ds.summarise(plotted, { unit, dimension, measure, minN: MIN_N, sort }),
        [ds, plotted, unit, dimension, measure, sort],
    );
    const corpus = useMemo(() => ds.corpus(plotted, { unit, measure }), [ds, plotted, unit, measure]);
    const hist   = useMemo(() => ds.histogram(plotted, { unit, measure, bins: 24 }), [ds, plotted, unit, measure]);
    const tails  = useMemo(() => ds.extremes(plotted, { unit, measure, count: 5 }), [ds, plotted, unit, measure]);

    if (loading) return <LoadingSpinner />;
    if (error) {
        return <div className="empty-state">The Fuel Economy Guide could not be loaded.</div>;
    }
    if (allRows.length === 0) {
        return (
            <div className="empty-state">
                No Fuel Economy Guide data has been imported yet.
                <div className="text-note mt-1">
                    An admin can load a guide year from Admin → Fuel Economy Guide.
                </div>
            </div>
        );
    }

    const unitDef = UNITS.find(u => u.key === unit);
    const dimDef  = DIMENSIONS.find(d => d.key === dimension);

    /* The controls say what is selected; this says what the numbers below MEAN,
       which is a different sentence. The unit clause is the guide's question —
       on the certification side there is no choice to report, so it states the
       record is the unit rather than echoing a control that is not on screen. */
    const scope = [
        ds.unitPhrase(unit),
        selectedYears.length === 0 ? 'all model years'
            : selectedYears.length === 1 ? `model year ${selectedYears[0]}`
                : `model years ${selectedYears.join(', ')}`,
        showClassFilter && classes.length > 0 ? `${classes.join(' / ')} only` : null,
        showDriveFilter && drives.length > 0 ? `${drives.join(' / ')} only` : null,
        corpus.n > 0 ? `n=${corpus.n}` : null,
    ].filter(Boolean);

    return (
        <div className="stats-view">
            <StatsControls
                units={UNITS}
                unit={unit}
                onUnit={setUnit}
                hasUnitChoice={ds.hasUnitChoice}
                measures={ds.measures}
                measure={measure}
                onMeasure={setMeasure}
                defaultMeasure={ds.defaultMeasure}
                dimensions={DIMENSIONS}
                dimension={dimension}
                onDimension={setDimension}
                allYears={allYears}
                selectedYears={selectedYears}
                onToggleYear={toggleYear}
                onAllYears={() => setYears([])}
                allClasses={allClasses}
                classes={classes}
                onToggleClass={toggleIn(classes, setClasses)}
                onClearClasses={() => setClasses([])}
                showClassFilter={showClassFilter}
                allDrives={allDrives}
                drives={drives}
                onToggleDrive={toggleIn(drives, setDrives)}
                onClearDrives={() => setDrives([])}
                showDriveFilter={showDriveFilter}
            />

            {/* The measure and the grouping, as a sentence, because the strip
                above states them as settings. `answers` is the unit's own
                question — the reason to care which unit is selected at all —
                and it sits at the right where the design puts it. */}
            <div className="stats-headline">
                <div>
                    <span className="stats-headline-title">
                        {measDef?.label} by {dimDef?.label.toLowerCase()}
                    </span>
                    <span className="stats-headline-scope">{scope.join(' · ')}</span>
                </div>
                {ds.hasUnitChoice && unitDef?.answers && (
                    <span className="stats-headline-question">“{unitDef.answers}”</span>
                )}
            </div>

            {/* What the figure is computed from, and what it is not. A median
                over a population padded with a fallback constant looks exactly
                like one over 73 real derivations. */}
            {coverage && (
                <div className="text-note">
                    {coverage.usable} of {coverage.total} certification groups carry this figure
                    {coverage.assumed > 0 && `; ${coverage.assumed} could not be derived and fall back to a default, so they are excluded rather than counted`}
                    {coverage.missing > 0 && `; ${coverage.missing} do not report it`}
                    {coverage.impossible > 0 && `; ${coverage.impossible} reported a value that cannot be one and were set aside, not clamped`}.
                    {/* The other half of the population question. These groups
                        used to be filtered out before this caption ran, so the
                        total read as the whole corpus when 90 of 413 were not
                        in it. */}
                    {coverage.unlinked > 0 && ` ${coverage.unlinked} have no Fuel Economy Guide link: `
                        + 'grouped by the make on the certification record, and Unknown for class and drivetrain.'}
                </div>
            )}

            <StatsTable
                rows={summary}
                measureDef={measDef}
                overall={corpus}
                sort={sort}
                onSort={setSort}
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

            <div className="text-note">
                Buckets with fewer than {MIN_N} observations are marked rather than dropped.
                Medians and quartiles throughout — these distributions are small and skewed,
                and one long-range outlier moves a mean in a way it does not move a median.
            </div>
        </div>
    );
}

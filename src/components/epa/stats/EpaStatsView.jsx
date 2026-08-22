import { useState, useMemo, useCallback, useEffect } from 'react';
import { useAppContext } from '../../../context/AppContext';
import { useAsyncResource } from '../../../hooks/useAsyncResource';
import { decorateRow, buildBrandIndex } from '../../../utils/feGuideBrowse';
import {
    UNITS, DEFAULT_UNIT, DIMENSIONS, MEASURES, measureByKey,
    summarise, overall, histogram, extremes,
} from '../../../utils/epaGuideStats';
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

export default function EpaStatsView({ subtab = 'stats' }) {
    const { getFeGuideRows, getBrandAliases } = useAppContext();

    const loadRows    = useCallback(() => getFeGuideRows(), [getFeGuideRows]);
    const loadAliases = useCallback(() => getBrandAliases(), [getBrandAliases]);
    const { data: rawRows, loading, error } = useAsyncResource(loadRows, []);
    const { data: aliases } = useAsyncResource(loadAliases, []);

    const [initial] = useState(() => {
        const p = new URLSearchParams(window.location.search);
        return {
            unit:      UNITS.some(u => u.key === p.get('u')) ? p.get('u') : DEFAULT_UNIT,
            dimension: DIMENSIONS.some(d => d.key === p.get('d')) ? p.get('d') : 'body_class',
            measure:   MEASURES.some(m => m.key === p.get('ms')) ? p.get('ms') : 'label_comb_mpge',
            year:      p.get('yr') === 'all' ? 'all' : (p.get('yr') ? Number(p.get('yr')) : null),
        };
    });
    const [unit, setUnit]           = useState(initial.unit);
    const [dimension, setDimension] = useState(initial.dimension);
    const [measure, setMeasure]     = useState(initial.measure);
    const [year, setYear]           = useState(initial.year);

    const brandIndex = useMemo(() => buildBrandIndex(aliases ?? []), [aliases]);
    const allRows = useMemo(
        () => (rawRows ?? []).map(r => decorateRow(r, brandIndex)),
        [rawRows, brandIndex],
    );

    const years = useMemo(
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

    // A single model year by default. The same configuration recurs across
    // years at identical figures — the 2025 and 2026 Rivian groups are the same
    // 24 rows — so a multi-year "what is typical" counts those cars twice.
    // 'all' is an explicit choice, never a fallback.
    const effectiveYear = year ?? bestCoveredYear;
    const rows = useMemo(
        () => (effectiveYear === 'all' || effectiveYear == null
            ? allRows
            : allRows.filter(r => r.model_year === effectiveYear)),
        [allRows, effectiveYear],
    );

    useEffect(() => {
        const p = new URLSearchParams();
        p.set('tab', 'epa');
        p.set('sub', subtab);
        if (unit !== DEFAULT_UNIT)        p.set('u', unit);
        if (dimension !== 'body_class')   p.set('d', dimension);
        if (measure !== 'label_comb_mpge') p.set('ms', measure);
        if (year != null)                 p.set('yr', String(year));
        window.history.replaceState({ view: 'epa' }, '', `?${p.toString()}`);
    }, [unit, dimension, measure, year, subtab]);

    const summary   = useMemo(() => summarise(rows, { unit, dimension, measure, minN: MIN_N }), [rows, unit, dimension, measure]);
    const corpus    = useMemo(() => overall(rows, { unit, measure }), [rows, unit, measure]);
    const hist      = useMemo(() => histogram(rows, { unit, measure, bins: 24 }), [rows, unit, measure]);
    const tails     = useMemo(() => extremes(rows, { unit, measure, count: 5 }), [rows, unit, measure]);

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
    const measDef = measureByKey(measure);

    return (
        <div className="stats-view">
            <div className="section-header">
                <div>
                    <div className="section-title">EPA statistics</div>
                    <div className="text-caption text-secondary">
                        {measDef?.label} by {dimDef?.label.toLowerCase()}, {unitDef?.label.toLowerCase()},
                        {' '}{effectiveYear === 'all' ? 'all model years' : `model year ${effectiveYear}`}.
                    </div>
                </div>
            </div>

            <div className="guide-filter-bar">
                {/* The unit leads, and states the question each answers. The
                    same query gives materially different numbers, and a reader
                    who does not know which one they are looking at cannot use
                    any of them. */}
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

                <div className="guide-facet">
                    <div className="guide-facet-label">Model year</div>
                    <div className="guide-facet-values">
                        {years.map(y => (
                            <button key={y} type="button"
                                className={`guide-chip ${effectiveYear === y ? 'active' : ''}`}
                                onClick={() => setYear(y)}>{y}</button>
                        ))}
                        <button type="button"
                            className={`guide-chip ${effectiveYear === 'all' ? 'active' : ''}`}
                            onClick={() => setYear('all')}
                            title="Counts a configuration once per year it appears in — the same car can be counted several times">All</button>
                    </div>
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

                <div className="guide-facet">
                    <div className="guide-facet-label">Measure</div>
                    <div className="guide-facet-values">
                        {MEASURES.map(m => (
                            <button key={m.key} type="button"
                                className={`guide-chip ${measure === m.key ? 'active' : ''}`}
                                onClick={() => setMeasure(m.key)}>{m.label}</button>
                        ))}
                    </div>
                </div>
            </div>

            <StatsTable
                rows={summary}
                measure={measure}
                overall={corpus}
                dimensionLabel={dimDef?.label ?? ''}
            />

            <div className="stats-panels">
                <div className="stats-panel">
                    <div className="section-header-title">Distribution</div>
                    <StatsHistogram data={hist} measure={measure} />
                </div>
                <div className="stats-panel">
                    <div className="section-header-title">Named extremes</div>
                    <StatsExtremes data={tails} measure={measure} />
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

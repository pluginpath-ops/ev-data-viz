import { useState, useMemo, useCallback } from 'react';
import { useAppContext } from '../../context/AppContext';
import { useAsyncResource } from '../../hooks/useAsyncResource';
import { KNOB_GROUPS } from '../../constants/knobs';
import { setOverride } from '../../constants/overrides';
import { vehicleLabel } from '../../utils/specHelpers';
import {
    CHECK_FIGURES, DATA_CHECKS, TESTED_RULES, LIMIT_KEYS, LOADED_LIMITS,
    runDataChecks, checkCounts, sourceNameVariants, groupPerformanceByVehicle,
} from '../../utils/dataChecks';

/**
 * Admin → Data Checks (#321): which vehicles disagree with their own sources.
 *
 * READ-ONLY. It measures how big each problem in #320 is before anything is
 * restructured, and it is where the limits get tuned — so the limits are local
 * state, applied on every keystroke, rather than the resolved constants, which
 * only change on a reload. Keeping a value writes the same local layer Model
 * Constants edits, so it shows there as local and is published from there.
 */

const KNOB_BY_KEY = Object.fromEntries(KNOB_GROUPS.flatMap(g => g.knobs).map(k => [k.key, k]));
const CHECK_LABEL = Object.fromEntries(DATA_CHECKS.map(c => [c.key, c.label]));

const sameLimit = (a, b) => (Array.isArray(a) ? a[0] === b[0] && a[1] === b[1] : a === b);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A cleared input keeps the previous value rather than becoming 0, which would flag everything. */
const numberOr = (raw, fallback) => {
    if (raw === '') return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
};

/** One limit, rendered from its knob's own metadata so the two can never describe it differently. */
function LimitInput({ limitKey, value, onChange }) {
    const knob = KNOB_BY_KEY[limitKey];
    if (!knob) return null;
    const { label, help, kind, min, max, step, unit } = knob;
    const input = (v, set) => (
        <input
            type="number" min={min} max={max} step={step}
            value={v}
            onChange={e => set(numberOr(e.target.value, v))}
            className="form-input w-20"
        />
    );
    return (
        <label className="data-check-limit" title={help}>
            <span className="text-note">{label}</span>
            <span className="flex items-center gap-1 shrink-0">
                {kind === 'range' ? (
                    <>
                        {input(value[0], v => onChange([v, value[1]]))}
                        <span className="text-meta">–</span>
                        {input(value[1], v => onChange([value[0], v]))}
                    </>
                ) : input(value, onChange)}
                <span className="text-meta w-6">{unit}</span>
            </span>
        </label>
    );
}

function Tally({ row }) {
    return (
        <span className="flex gap-2 shrink-0">
            {row.disagrees > 0 && (
                <span className="data-check-tally is-disagrees">{plural(row.disagrees, 'disagreement')}</span>
            )}
            {row.gaps > 0 && <span className="data-check-tally">{plural(row.gaps, 'gap')}</span>}
        </span>
    );
}

function VehicleRow({ row, only, open, onToggle }) {
    const shown = only ? row.findings.filter(f => f.check === only) : row.findings;
    return (
        <div className="data-check-row">
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={open}
                className="w-full text-left flex items-start justify-between gap-3 py-1"
            >
                <span className="min-w-0">
                    <span className="text-secondary truncate block">{vehicleLabel(row.vehicle)}</span>
                    <span className="text-meta block truncate">
                        {[...new Set(shown.map(f => CHECK_LABEL[f.check]))].join(' · ')}
                    </span>
                </span>
                <Tally row={row} />
            </button>
            {open && (
                <div className="flex flex-col gap-1 pl-2 pb-2">
                    {shown.map((f, i) => (
                        <div key={i} className={`data-check-finding is-${f.kind}`}>
                            <span className="text-note">{f.text}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default function DataChecksPanel() {
    const { vehicles, getPerformanceSummaries, getPerformanceSessions } = useAppContext();
    const fleet = useMemo(() => vehicles ?? [], [vehicles]);

    // Performance results are not on the vehicle object — getVehicles keeps the
    // performance tables out on purpose — so this page fetches them for itself,
    // and nothing outside Admin pays for it.
    const vehicleIds = useMemo(() => fleet.map(v => v.id), [fleet]);
    const loadPerformance = useCallback(async () => {
        const [summaries, sessions] = await Promise.all([
            getPerformanceSummaries(),
            vehicleIds.length ? getPerformanceSessions(vehicleIds) : [],
        ]);
        return { summaries: summaries ?? [], sessions: sessions ?? [] };
        // The context's fetchers are recreated on every render; the ids are what
        // decide whether the answer could have changed.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [vehicleIds]);
    const { data: perfData, loading: perfLoading, error: perfError } = useAsyncResource(loadPerformance, [loadPerformance]);
    const performance = useMemo(
        () => (perfData ? groupPerformanceByVehicle(perfData.summaries, perfData.sessions) : null),
        [perfData],
    );

    const [limits, setLimits] = useState(() => ({ ...LOADED_LIMITS }));
    const [rule, setRule]     = useState('nearer');
    const [only, setOnly]     = useState(null);
    const [query, setQuery]   = useState('');
    const [open, setOpen]     = useState(() => new Set());
    const [kept, setKept]     = useState(false);

    const rows   = useMemo(() => runDataChecks(fleet, { limits, testedRule: rule, performance }), [fleet, limits, rule, performance]);
    const counts = useMemo(() => checkCounts(rows), [rows]);

    // What each rule would report, so the choice between them is made against numbers.
    const ruleCounts = useMemo(() => Object.fromEntries(TESTED_RULES.map(r => [
        r.key,
        r.key === rule
            ? counts['tested-vs-label']
            : checkCounts(runDataChecks(fleet, { limits, testedRule: r.key, performance }))['tested-vs-label'],
    ])), [fleet, limits, rule, performance, counts]);

    const variants = useMemo(() => sourceNameVariants(perfData?.summaries ?? []), [perfData]);

    const changed = LIMIT_KEYS.filter(k => !sameLimit(limits[k], LOADED_LIMITS[k]));
    const setLimit = (key, value) => {
        setLimits(prev => ({ ...prev, [key]: value }));
        setKept(false);
    };
    const keepOnThisBrowser = () => {
        for (const key of changed) setOverride(key, limits[key]);
        setKept(true);
    };

    const reporting = rows.filter(r => r.findings.length);
    const q = query.trim().toLowerCase();
    const shown = reporting.filter(r =>
        (!only || r.findings.some(f => f.check === only))
        && (!q || vehicleLabel(r.vehicle).toLowerCase().includes(q)));

    const toggle = (id) => setOpen(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
    });

    return (
        <div className="card p-4">
            <h3 className="section-title mb-1">Data Checks</h3>
            <p className="text-note mb-4">
                Every vehicle against its own sources: range against its EPA labels, the
                manufacturer’s Usable and Gross against EPA tested, curb weight against EPA test
                weight, drive type and voltage against EPA, and claimed against tested 0–60.
                Read-only. A vehicle linked to several EPA configurations disagrees only when none
                of them agrees, because nothing yet says which one represents it.
            </p>

            <h4 className="subsection-title">Limits</h4>
            <p className="text-note mb-2">
                Change a limit and every count below updates at once. Nothing is saved until you
                keep it — kept values show as local in Model Constants, which is where they are
                published for everyone.
            </p>
            <div className="data-check-limits">
                {LIMIT_KEYS.map(key => (
                    <LimitInput key={key} limitKey={key} value={limits[key]} onChange={v => setLimit(key, v)} />
                ))}
            </div>

            <div className="flex flex-wrap items-center gap-3 mb-3">
                <span className="text-note">EPA tested is compared with</span>
                <div className="stats-segmented" role="group" aria-label="How EPA tested is compared">
                    {TESTED_RULES.map(r => (
                        <button
                            key={r.key}
                            type="button"
                            className={rule === r.key ? 'active' : ''}
                            aria-pressed={rule === r.key}
                            title={r.blurb}
                            onClick={() => setRule(r.key)}
                        >
                            {r.label} · {ruleCounts[r.key]}
                        </button>
                    ))}
                </div>
                <button
                    type="button"
                    className="btn btn-secondary text-sm"
                    disabled={!changed.length || kept}
                    onClick={keepOnThisBrowser}
                >
                    {kept ? 'Kept on this browser' : `Keep ${changed.length ? plural(changed.length, 'change') : 'changes'} on this browser`}
                </button>
                <button
                    type="button"
                    className="btn btn-secondary text-sm"
                    disabled={!changed.length}
                    onClick={() => { setLimits({ ...LOADED_LIMITS }); setKept(false); }}
                >
                    Back to loaded limits
                </button>
            </div>
            {kept && (
                <div className="note-panel is-info mb-3">
                    Kept on this browser. Model Constants shows these as local; publish them there to
                    apply them for everyone.
                </div>
            )}

            {/* Counts first, grouped by figure: the question is how many, and of
                what kind. Each doubles as the filter. */}
            <div className="flex flex-col gap-2 mt-4 mb-3">
                {CHECK_FIGURES.map(fig => (
                    <div key={fig.key} className="flex flex-wrap items-center gap-2">
                        <span className="text-meta w-32 shrink-0">{fig.label}</span>
                        {DATA_CHECKS.filter(c => c.figure === fig.key).map(c => (
                            <button
                                key={c.key}
                                type="button"
                                disabled={!counts[c.key]}
                                title={c.kind === 'gap' ? 'A gap: something missing, no limit crossed' : 'A disagreement past its limit'}
                                onClick={() => setOnly(only === c.key ? null : c.key)}
                                className={`guide-chip ${only === c.key ? 'active' : ''} disabled:opacity-40`}
                            >
                                {c.label} {counts[c.key]}
                            </button>
                        ))}
                        {fig.key === 'performance' && perfLoading && <span className="text-meta">loading…</span>}
                    </div>
                ))}
            </div>

            <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Filter by vehicle…"
                className="form-input w-full mb-2"
            />
            <p className="text-meta mb-2">
                {reporting.length} of {plural(rows.length, 'vehicle')} have something to report
                {(only || q) && ` · ${shown.length} shown`}
            </p>

            <div className="flex flex-col gap-1">
                {shown.map(r => (
                    <VehicleRow
                        key={r.vehicle.id}
                        row={r}
                        only={only}
                        open={open.has(r.vehicle.id)}
                        onToggle={() => toggle(r.vehicle.id)}
                    />
                ))}
                {!shown.length && <p className="text-note">Nothing matches.</p>}
            </div>

            <h4 className="subsection-title mt-6">Across the fleet</h4>
            {perfError ? (
                <p className="text-note">Performance results could not be loaded: {perfError.message}</p>
            ) : perfLoading ? (
                <p className="text-note">Loading performance results…</p>
            ) : variants.length ? (
                <div className="flex flex-col gap-1">
                    {variants.map(names => (
                        <div key={names[0].name} className="data-check-finding">
                            <span className="text-note">
                                One source, {names.length} spellings on published results:{' '}
                                {names.map(n => `“${n.name}” (${plural(n.count, 'result')})`).join(', ')}.
                            </span>
                        </div>
                    ))}
                </div>
            ) : (
                <p className="text-note">Every published source is spelled one way.</p>
            )}
        </div>
    );
}

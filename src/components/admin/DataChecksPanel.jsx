import ChargeSummaryMaintenance from './ChargeSummaryMaintenance';
import { useState, useMemo, useCallback } from 'react';
import { useAppContext } from '../../context/AppContext';
import { useAsyncResource } from '../../hooks/useAsyncResource';
import { KNOB_GROUPS } from '../../constants/knobs';
import { setOverride } from '../../constants/overrides';
import { vehicleLabel, resolveEffectiveSpecs } from '../../utils/specHelpers';
import { columnMoves, checkFields, withSpecValues, epaSectionHref, EPA_SECTION_CHECKS } from '../../utils/dataCheckFixes';
import { SpecField } from '../EditSpecsForm';
import PrimaryConfigurationPicker from '../epa/PrimaryConfigurationPicker';
import {
    CHECK_FIGURES, DATA_CHECKS, TESTED_RULES, LIMIT_KEYS, LOADED_LIMITS,
    runDataChecks, checkCounts, sourceNameVariants, groupPerformanceByVehicle,
    overlaySkips, skipKey, keepOrder,
} from '../../utils/dataChecks';

/**
 * Admin → Data Checks (#321): which vehicles disagree with their own sources.
 *
 * It measures how big each problem in #320 is before anything is restructured,
 * and it is where the limits get tuned — so the limits are local state, applied
 * on every keystroke, rather than the resolved constants, which only change on
 * a reload. Keeping a value writes the same local layer Model Constants edits,
 * so it shows there as local and is published from there.
 *
 * The one thing it writes is a skip (migration 066): a curator's decision that
 * a finding is correct as it stands. A skip holds while the finding's values
 * hold, so nothing here has to notice when it lapses — the checks do.
 *
 * Skips apply the moment they are clicked and are written behind the scenes.
 * A recompute of the whole fleet measured under a millisecond; the lag was the
 * write and a reload of every skip before anything moved.
 */

const KNOB_BY_KEY = Object.fromEntries(KNOB_GROUPS.flatMap(g => g.knobs).map(k => [k.key, k]));
const CHECK_LABEL = Object.fromEntries(DATA_CHECKS.map(c => [c.key, c.label]));
const NOTE_PLACEHOLDER = 'Why is this correct as it stands? (optional)';

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
            {row.skipped > 0 && <span className="data-check-tally">{row.skipped} skipped</span>}
        </span>
    );
}

/**
 * One spec field a finding compares, edited where the finding is.
 *
 * Save is always present and disabled until the value changes, so typing never
 * moves a control a curator is about to click. The caller keys this by the
 * stored value, so a save from elsewhere resets the draft.
 */
function FixField({ vehicle, category, field, def, inheritedValue, onSave }) {
    const own = vehicle.specs?.[category]?.[field] ?? null;
    const [draft, setDraft] = useState(own);
    const [saving, setSaving] = useState(false);
    const dirty = (draft ?? null) !== own;
    const save = async () => {
        setSaving(true);
        await onSave(category, { [field]: draft });
        setSaving(false);
    };
    return (
        <span className="data-check-fix-field">
            <span className="text-note">{def.label}</span>
            <SpecField field={def} value={draft} onChange={setDraft} inheritedValue={inheritedValue} />
            <button type="button" className="btn btn-secondary text-sm" disabled={!dirty || saving} onClick={save}>
                {saving ? 'Saving…' : 'Save'}
            </button>
        </span>
    );
}

/**
 * What can be done about one finding (#321): moves out of the retiring columns,
 * the spec fields it compares, the primary configuration, and its EPA section.
 * See utils/dataCheckFixes.js for which finding offers what.
 */
function FindingFixes({ finding: f, vehicle, fleet, onMove, onSaveSpec, onChoosePrimary }) {
    const [busy, setBusy] = useState(false);
    const moves = columnMoves(f);
    const fields = checkFields(f.check).filter(x => x.def);
    const toEpa = EPA_SECTION_CHECKS.has(f.check);
    const choosePrimary = f.check === 'no-primary';
    if (!moves.length && !fields.length && !toEpa && !choosePrimary) return null;

    // The parent's values, shown as the hint an empty own field inherits.
    const parent = vehicle.spec_source_vehicle_id ? fleet.find(v => v.id === vehicle.spec_source_vehicle_id) : null;
    const inherited = fields.length && parent ? resolveEffectiveSpecs(parent, fleet) : null;

    const move = async (m) => {
        setBusy(true);
        await onMove(vehicle, m);
        setBusy(false);
    };

    return (
        <div className="data-check-fixes">
            {moves.map(m => (
                <button key={m.key} type="button" className="btn btn-secondary text-sm" title={m.title} disabled={busy} onClick={() => move(m)}>
                    {m.label}
                </button>
            ))}
            {fields.map(({ category, field, def }) => (
                <FixField
                    key={`${category}.${field}:${vehicle.specs?.[category]?.[field] ?? ''}`}
                    vehicle={vehicle}
                    category={category}
                    field={field}
                    def={def}
                    inheritedValue={inherited?.[category]?.[field] ?? null}
                    onSave={(cat, values) => onSaveSpec(vehicle, cat, values)}
                />
            ))}
            {toEpa && (
                <a className="btn btn-secondary text-sm" href={epaSectionHref(vehicle.id)}>Open EPA section</a>
            )}
            {choosePrimary && (
                <div className="w-full">
                    <PrimaryConfigurationPicker
                        vehicle={vehicle}
                        mappings={vehicle.epa_mappings ?? []}
                        canEdit
                        onChoose={onChoosePrimary}
                    />
                </div>
            )}
        </div>
    );
}

/**
 * One finding, with the controls to skip or un-skip it.
 *
 * While its vehicle's "Skip all" is armed, an open finding shows only a note
 * field — the vehicle's button records them together, so a per-finding button
 * would be a second way to do the same thing mid-way through the first.
 *
 * A resurfaced finding — skipped once, values changed since — says so, and
 * shows the old note, because the curator's earlier reasoning is exactly what
 * is needed to decide whether it still applies.
 */
function FindingItem({ finding: f, fixes, canSkip, armed, armedNote, onArmedNote, onSkip, onUnskip }) {
    const [asking, setAsking] = useState(false);
    const [note, setNote] = useState('');
    const when = f.skip?.skipped_at ? new Date(f.skip.skipped_at).toLocaleDateString() : null;
    const earlierNote = f.skip?.note;
    const armedHere = armed && !f.skipped;

    return (
        <div className={`data-check-finding is-${f.kind}${f.skipped ? ' is-skipped' : ''}`}>
            <div className="flex items-start justify-between gap-3">
                <span className="text-note">{f.text}</span>
                {canSkip && !asking && !armedHere && (
                    f.skipped ? (
                        <button type="button" className="btn btn-secondary text-sm shrink-0" onClick={onUnskip}>
                            Un-skip
                        </button>
                    ) : (
                        <button type="button" className="btn btn-secondary text-sm shrink-0" onClick={() => setAsking(true)}>
                            Skip
                        </button>
                    )
                )}
            </div>

            {/* A skipped finding needs nothing doing — that is what the skip said. */}
            {!f.skipped && fixes}

            {f.skipped && (
                <span className="text-meta">
                    Skipped{when ? ` ${when}` : ''}{earlierNote ? `: ${earlierNote}` : ''}
                </span>
            )}
            {f.resurfaced && (
                <span className="text-meta">
                    Skipped{when ? ` ${when}` : ''}, but its values have changed since
                    {earlierNote ? ` — the note said: ${earlierNote}` : '.'}
                </span>
            )}

            {armedHere && (
                <input
                    className="form-input w-full"
                    value={armedNote}
                    onChange={e => onArmedNote(e.target.value)}
                    placeholder={NOTE_PLACEHOLDER}
                />
            )}

            {asking && !armedHere && (
                <div className="skip-ask">
                    <input
                        className="form-input flex-1"
                        value={note}
                        onChange={e => setNote(e.target.value)}
                        placeholder={NOTE_PLACEHOLDER}
                    />
                    <button
                        type="button"
                        className="btn btn-warning"
                        onClick={() => {
                            onSkip(note.trim() || null);
                            setAsking(false);
                            setNote('');
                        }}
                    >
                        Record skip
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={() => setAsking(false)}>Cancel</button>
                </div>
            )}
        </div>
    );
}

/**
 * One vehicle and its findings.
 *
 * "Skip all" arms on the first click — opening a note field under every open
 * finding — and records on the second. So a quick double click skips the whole
 * vehicle without notes, and nothing needs to tell a double click from two
 * singles. The button sits in the header, above the fields it reveals, and holds
 * one width in both states, so the second click lands where the first did.
 */
function VehicleRow({ row, findings, fleet, open, onToggle, canSkip, onSkip, onUnskip, onSkipAll, onMove, onSaveSpec, onChoosePrimary }) {
    const [armed, setArmed] = useState(false);
    const [notes, setNotes] = useState({});
    const openFindings = findings.filter(f => !f.skipped);
    const showSkipAll = canSkip && (armed || openFindings.length > 0);

    const disarm = () => {
        setArmed(false);
        setNotes({});
    };
    const clickSkipAll = () => {
        if (!armed) {
            if (!open) onToggle();
            setArmed(true);
            return;
        }
        onSkipAll(openFindings.map(f => ({ finding: f, note: notes[f.check]?.trim() || null })));
        disarm();
    };

    return (
        <div className="data-check-row">
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={onToggle}
                    aria-expanded={open}
                    className="flex-1 min-w-0 text-left flex items-start justify-between gap-3 py-1"
                >
                    <span className="min-w-0">
                        <span className="text-secondary truncate block">{vehicleLabel(row.vehicle)}</span>
                        <span className="text-meta block truncate">
                            {findings.length
                                ? [...new Set(findings.map(f => CHECK_LABEL[f.check]))].join(' · ')
                                : 'Nothing outstanding. It leaves the list on Re-sort.'}
                        </span>
                    </span>
                    <Tally row={row} />
                </button>
                {armed && (
                    <button type="button" className="btn btn-secondary text-sm" onClick={disarm}>Cancel</button>
                )}
                {showSkipAll && (
                    <button
                        type="button"
                        className={`btn ${armed ? 'btn-warning' : 'btn-secondary'} text-sm data-check-skip-all`}
                        title={armed
                            ? `Record ${plural(openFindings.length, 'skip')}, with any notes written below`
                            : 'Skip every finding shown for this vehicle. Click again to record — or double click to skip without notes.'}
                        onClick={clickSkipAll}
                    >
                        {armed ? 'Record skips' : 'Skip all'}
                    </button>
                )}
            </div>
            {open && (
                <div className="flex flex-col gap-1 pl-2 pb-2">
                    {findings.map(f => (
                        <FindingItem
                            key={f.check}
                            finding={f}
                            fixes={(
                                <FindingFixes
                                    finding={f}
                                    vehicle={row.vehicle}
                                    fleet={fleet}
                                    onMove={onMove}
                                    onSaveSpec={onSaveSpec}
                                    onChoosePrimary={onChoosePrimary}
                                />
                            )}
                            canSkip={canSkip}
                            armed={armed}
                            armedNote={notes[f.check] ?? ''}
                            onArmedNote={(text) => setNotes(prev => ({ ...prev, [f.check]: text }))}
                            onSkip={(note) => onSkip(row.vehicle.id, f, note)}
                            onUnskip={() => onUnskip(row.vehicle.id, f)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

export default function DataChecksPanel() {
    const {
        vehicles, getPerformanceSummaries, getPerformanceSessions,
        getDataCheckSkips, setDataCheckSkip, recordDataCheckSkips,
        updateVehicle, updateVehicleSpecs, setPrimaryEpaMapping,
    } = useAppContext();
    const fleet = useMemo(() => vehicles ?? [], [vehicles]);

    // Performance results are not on the vehicle object — getVehicles keeps the
    // performance tables out on purpose — so this page fetches them for itself,
    // and nothing outside Admin pays for it.
    // Keyed on the ids themselves, not the fleet array: every save hands back a
    // new array, and keying on it refetched performance after each fix — and
    // flipped the panel back to loading, which released the held row order.
    const idsKey = fleet.map(v => v.id).join(',');
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const vehicleIds = useMemo(() => fleet.map(v => v.id), [idsKey]);
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

    // Skips as loaded, with this session's changes laid over them. The overlay
    // is what the screen shows; there is no reload after a write, because the
    // overlay already says what the write made true.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const loadSkips = useCallback(() => getDataCheckSkips(), []);
    const { data: skipData, loading: skipsLoading } = useAsyncResource(loadSkips, []);
    const [pending, setPending] = useState(() => new Map());
    const skips = useMemo(() => overlaySkips(skipData?.skips ?? [], pending), [skipData, pending]);
    const canSkip = skipData?.available === true;

    const [limits, setLimits]           = useState(() => ({ ...LOADED_LIMITS }));
    const [rule, setRule]               = useState('nearer');
    const [only, setOnly]               = useState(null);
    const [query, setQuery]             = useState('');
    const [open, setOpen]               = useState(() => new Set());
    const [kept, setKept]               = useState(false);
    const [showSkipped, setShowSkipped] = useState(false);
    const [writeError, setWriteError]   = useState(null);

    const rows   = useMemo(() => runDataChecks(fleet, { limits, testedRule: rule, performance, skips }), [fleet, limits, rule, performance, skips]);
    const counts = useMemo(() => checkCounts(rows), [rows]);

    // What each rule would report, so the choice between them is made against numbers.
    const ruleCounts = useMemo(() => Object.fromEntries(TESTED_RULES.map(r => [
        r.key,
        r.key === rule
            ? counts['tested-vs-label']
            : checkCounts(runDataChecks(fleet, { limits, testedRule: r.key, performance, skips }))['tested-vs-label'],
    ])), [fleet, limits, rule, performance, skips, counts]);

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

    /**
     * Show skip changes at once, then write them. A failed write takes them back
     * out, so the screen never claims a skip the database refused.
     *
     * @param {Array<{ vehicleId, finding, note?, skip: boolean }>} changes
     * @param {Function} write  the database call that makes them true
     */
    async function applySkipChanges(changes, write) {
        const keys = changes.map(c => skipKey(c.vehicleId, c.finding.check));
        // What each key held before, so a failure restores exactly that.
        const previous = new Map(keys.map(k => [k, pending.has(k) ? pending.get(k) : undefined]));
        const skippedAt = new Date().toISOString();
        setPending(prev => {
            const next = new Map(prev);
            for (const c of changes) {
                next.set(skipKey(c.vehicleId, c.finding.check), c.skip
                    ? { vehicle_id: c.vehicleId, check_key: c.finding.check, fingerprint: c.finding.fingerprint, note: c.note ?? null, skipped_at: skippedAt }
                    : null);
            }
            return next;
        });
        setWriteError(null);
        try {
            await write();
        } catch (e) {
            setPending(prev => {
                const next = new Map(prev);
                for (const [k, v] of previous) {
                    if (v === undefined) next.delete(k);
                    else next.set(k, v);
                }
                return next;
            });
            setWriteError(`Not saved, so it has been put back: ${e.message}`);
        }
    }

    const recordSkip = (vehicleId, f, note) => applySkipChanges(
        [{ vehicleId, finding: f, note, skip: true }],
        () => setDataCheckSkip(vehicleId, f.check, f.fingerprint, note));
    const clearSkip = (vehicleId, f) => applySkipChanges(
        [{ vehicleId, finding: f, skip: false }],
        () => setDataCheckSkip(vehicleId, f.check, null));
    const skipAll = (vehicleId, entries) => applySkipChanges(
        entries.map(({ finding, note }) => ({ vehicleId, finding, note, skip: true })),
        () => recordDataCheckSkips(entries.map(({ finding, note }) => ({
            vehicleId, checkKey: finding.check, fingerprint: finding.fingerprint, note,
        }))));

    /**
     * A move out of vehicles.battery or vehicles.range: the spec first, the
     * column only once the spec is saved. The context reports a failed write
     * itself and returns false, so a refused spec leaves the column — until then
     * the only copy of the value — untouched.
     */
    const moveValue = async (vehicle, move) => {
        if (move.spec) {
            const ok = await updateVehicleSpecs(vehicle.id, withSpecValues(vehicle.specs, move.spec.category, move.spec.values));
            if (!ok) return;
        }
        await updateVehicle(vehicle.id, { [move.clear]: null });
    };
    const saveSpec = (vehicle, category, values) =>
        updateVehicleSpecs(vehicle.id, withSpecValues(vehicle.specs, category, values));

    const skippedTotal = rows.reduce((n, r) => n + r.skipped, 0);
    const outstanding = rows.filter(r => r.disagrees || r.gaps);
    const q = query.trim().toLowerCase();
    const visibleFindings = (row) => row.findings.filter(f =>
        (showSkipped || !f.skipped) && (!only || f.check === only));
    const matchesQuery = (row) => !q || vehicleLabel(row.vehicle).toLowerCase().includes(q);
    const liveIds = rows.filter(row => visibleFindings(row).length && matchesQuery(row)).map(row => row.vehicle.id);

    // Rows hold their places while fixes and skips land (see keepOrder) — but
    // only once the first load is complete. Until vehicles, performance results
    // and skips have all arrived the list is still filling in, and holding it
    // then would pin an order missing whatever came last. A failed load counts
    // as arrived: it is not going to change the list.
    //
    // After that, a new order is taken only when the curator asks for a
    // different list: a filter, the search, a limit, the rule, Show skipped, or
    // Re-sort. Set during render, React's pattern for state derived from a
    // changed input, so no frame shows the old order.
    //
    // Latched: once the first load is done it stays done. A later refetch must
    // not release the held order — that is what made a fixed vehicle vanish and
    // come back.
    const [firstLoadDone, setFirstLoadDone] = useState(false);
    if (!firstLoadDone && fleet.length > 0 && !perfLoading && !skipsLoading) setFirstLoadDone(true);
    const loaded = firstLoadDone;
    const listKey = JSON.stringify([limits, rule, only, q, showSkipped]);
    const [order, setOrder] = useState({ key: null, ids: [] });
    if (loaded && order.key !== listKey) setOrder({ key: listKey, ids: liveIds });
    const displayIds = loaded && order.key === listKey ? keepOrder(order.ids, liveIds) : liveIds;
    const outOfOrder = displayIds.join() !== liveIds.join();
    const rowById = new Map(rows.map(r => [r.vehicle.id, r]));
    const shown = displayIds
        .map(id => rowById.get(id))
        .filter(Boolean)
        .map(row => ({ row, findings: visibleFindings(row) }));

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
                weight, drive type and voltage against EPA, and claimed against tested 0–60. A
                vehicle is judged against its primary EPA configuration; with several and none
                chosen, it disagrees only when none of them agrees. Fix a finding from under it —
                sort a typed battery or range into the field that says what it is, edit the spec it
                compares, or choose the primary — or skip it if it is correct as it stands. A skip
                comes back if its values change.
            </p>

            {/* First, not last: it is the one section with a button a curator
                must press after a deploy, and at the foot of a long findings
                list it went unseen. */}
            <h4 className="subsection-title">Charging summaries</h4>
            <ChargeSummaryMaintenance />

            <h4 className="subsection-title mt-6">Limits</h4>
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
                what kind. Each doubles as the filter. Skipped findings are not
                counted — the numbers are what is still outstanding. */}
            <div className="flex flex-col gap-2 mt-4 mb-3">
                {CHECK_FIGURES.map(fig => (
                    <div key={fig.key} className="flex flex-wrap items-center gap-2">
                        <span className="text-meta w-32 shrink-0">{fig.label}</span>
                        {DATA_CHECKS.filter(c => c.figure === fig.key).map(c => (
                            <button
                                key={c.key}
                                type="button"
                                disabled={!counts[c.key] && only !== c.key}
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

            <div className="flex flex-wrap items-center gap-3 mb-2">
                <input
                    type="text"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Filter by vehicle…"
                    className="form-input flex-1"
                />
                <label className="flex items-center gap-2 text-note">
                    <input type="checkbox" checked={showSkipped} onChange={e => setShowSkipped(e.target.checked)} />
                    Show skipped ({skippedTotal})
                </label>
                {/* Always present, so it can never appear under the cursor. */}
                <button
                    type="button"
                    className="btn btn-secondary text-sm"
                    disabled={!outOfOrder}
                    title="Rows keep their places while you fix and skip. Re-sort to put the worst first and drop what is resolved."
                    onClick={() => setOrder({ key: listKey, ids: liveIds })}
                >
                    Re-sort
                </button>
            </div>
            <p className="text-meta mb-2">
                {outstanding.length} of {plural(rows.length, 'vehicle')} have something outstanding
                {skippedTotal > 0 && ` · ${plural(skippedTotal, 'finding')} skipped`}
                {(only || q) && ` · ${shown.length} shown`}
            </p>
            {skipData && !canSkip && (
                <p className="text-note mb-2">Skips cannot be recorded until migration 066 is applied.</p>
            )}
            {writeError && <div className="note-panel is-danger mb-2">{writeError}</div>}

            <div className="flex flex-col gap-1">
                {shown.map(({ row, findings }) => (
                    <VehicleRow
                        key={row.vehicle.id}
                        row={row}
                        findings={findings}
                        fleet={fleet}
                        onMove={moveValue}
                        onSaveSpec={saveSpec}
                        onChoosePrimary={setPrimaryEpaMapping}
                        open={open.has(row.vehicle.id)}
                        onToggle={() => toggle(row.vehicle.id)}
                        canSkip={canSkip}
                        onSkip={recordSkip}
                        onUnskip={clearSkip}
                        onSkipAll={(entries) => skipAll(row.vehicle.id, entries)}
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

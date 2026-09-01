import { useState, useMemo, useCallback } from 'react';
import { KNOB_GROUPS, knobDefault } from '../../constants/knobs';
import { getOverrides, setOverride, clearOverrides, getSiteConstants } from '../../constants/overrides';
import { useAppContext } from '../../context/AppContext';
import { useAsyncResource } from '../../hooks/useAsyncResource';
import { allBandEvidence, bandVerdict } from '../../utils/epaBandEvidence';

/**
 * Admin panel for tuning the EPA model constants.
 *
 * Three layers, highest first (#261):
 *
 *   local     this browser's sandbox — try a change without imposing it
 *   site      published to the database; what every other curator and every
 *             public visitor computes from
 *   default   the compiled-in value
 *
 * The number inputs edit the LOCAL layer, as they always have. Publishing
 * promotes what you are looking at to the site layer and drops the local
 * override, so the row then reads its value from where everyone else does.
 *
 * Every change — local or published — applies on the next page reload, because
 * constants/epa.js resolves at module load. That is the property this panel is
 * built around rather than against; see constants/overrides.js.
 */
const eq = (a, b) =>
    Array.isArray(a) && Array.isArray(b) ? a[0] === b[0] && a[1] === b[1] : a === b;

/** Layer-comparison that treats "absent" as its own value. */
const eqSlot = (a, b) => (a == null || b == null ? a == null && b == null : eq(a, b));

const numOrNull = (s) => (s === '' || s == null ? null : Number(s));

const show = (v) => (Array.isArray(v) ? `${v[0]}–${v[1]}` : String(v));

export default function ConstantsKnobs() {
    // The corpus, once, on an admin page. Nothing on a vehicle card pays for
    // this — showing a band's evidence beside a knob costs one fetch on the
    // panel that sets it, which is the same trade the statistics view makes.
    const { getCertGroupsForStats, publishModelConstant, clearPublishedConstants, isAdmin } = useAppContext();
    const loadCert = useCallback(() => getCertGroupsForStats(), [getCertGroupsForStats]);
    const { data: certGroups } = useAsyncResource(loadCert, []);
    const evidence = useMemo(() => allBandEvidence(certGroups ?? [], null), [certGroups]);

    const [overrides, setOverrides] = useState(getOverrides);
    // The published map as this page load saw it, then as our own writes leave
    // it. The RPC returns the whole map, so a concurrent edit by another admin
    // is picked up by the next publish rather than silently lost.
    const [published, setPublished] = useState(getSiteConstants);
    const [dirty, setDirty] = useState(false);
    const [busyKey, setBusyKey] = useState(null);
    const [failure, setFailure] = useState(null);

    // Effective (live) value for a knob, and which layer it came from.
    const valueOf = (key) => {
        if (key in overrides && overrides[key] != null) return overrides[key];
        if (key in published && published[key] != null) return published[key];
        return knobDefault(key);
    };
    const sourceOf = (key) => {
        if (key in overrides && overrides[key] != null) return 'local';
        if (key in published && published[key] != null) return 'site';
        return 'default';
    };

    /** What the layer BELOW local resolves to — what a local reset falls back to. */
    const beneathLocal = (key) =>
        (key in published && published[key] != null ? published[key] : knobDefault(key));

    function commit(key, value) {
        // Store a local override only where it actually differs from the layer
        // it sits over, so the source badge never claims a sandbox that only
        // restates the published value.
        if (value == null || eq(value, beneathLocal(key))) setOverride(key, null);
        else setOverride(key, value);
        setOverrides(getOverrides());
        setDirty(true);
    }

    function resetKey(key) {
        setOverride(key, null);
        setOverrides(getOverrides());
        setDirty(true);
    }

    function resetAll() {
        clearOverrides();
        setOverrides(getOverrides());
        setDirty(true);
    }

    /** The published entry a publish of `key` would produce (undefined = revert). */
    const publishTarget = (key) => {
        const v = valueOf(key);
        return eq(v, knobDefault(key)) ? null : v;
    };

    async function publish(key) {
        setBusyKey(key);
        setFailure(null);
        try {
            const map = await publishModelConstant(key, publishTarget(key));
            setPublished(map ?? {});
            // The value now comes from the site layer, so the sandbox copy of
            // it would be a lie about where it came from.
            setOverride(key, null);
            setOverrides(getOverrides());
            setDirty(true);
        } catch (e) {
            setFailure({ key, message: e.message });
        } finally {
            setBusyKey(null);
        }
    }

    async function revertPublished() {
        setBusyKey('__all__');
        setFailure(null);
        try {
            const map = await clearPublishedConstants();
            setPublished(map ?? {});
            setDirty(true);
        } catch (e) {
            setFailure({ key: null, message: e.message });
        } finally {
            setBusyKey(null);
        }
    }

    const anyLocal = KNOB_GROUPS.some(g => g.knobs.some(k => sourceOf(k.key) === 'local'));
    const anyPublished = Object.keys(published).length > 0;

    return (
        <div className="card p-5">
            <div className="flex items-start justify-between gap-4 mb-1">
                <div>
                    <h3 className="section-title">Model Constants</h3>
                    <p className="text-sm text-secondary mt-0.5">
                        The assumptions and sanity bands the EPA math runs on. Editing a value
                        changes it on <strong>this browser only</strong>; <strong>Publish</strong> promotes
                        it to the site, where every curator and every public visitor computes
                        from it. Both apply on the next page reload.
                    </p>
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                    <button
                        onClick={resetAll}
                        disabled={!anyLocal}
                        className="btn btn-secondary text-sm whitespace-nowrap disabled:opacity-40"
                    >
                        Reset local
                    </button>
                    {isAdmin && (
                        <button
                            onClick={revertPublished}
                            disabled={!anyPublished || busyKey === '__all__'}
                            title="Revert every published constant to its compiled default, for everyone"
                            className="btn btn-secondary text-sm whitespace-nowrap disabled:opacity-40"
                        >
                            {busyKey === '__all__' ? 'Reverting…' : 'Revert published'}
                        </button>
                    )}
                </div>
            </div>

            {failure && !failure.key && (
                <div className="notice-error my-3 p-3 rounded-lg text-sm">{failure.message}</div>
            )}

            {dirty && (
                <div className="notice-info my-3 flex items-center justify-between gap-3 p-3 rounded-lg">
                    <span className="text-sm">
                        Saved — reload to apply the change to the calculations here. Anyone else
                        picks up a published value on their next load.
                    </span>
                    <button onClick={() => window.location.reload()} className="btn btn-primary text-sm whitespace-nowrap">
                        ↻ Reload now
                    </button>
                </div>
            )}

            {KNOB_GROUPS.map(group => (
                <div key={group.title} className="mt-4">
                    <h4 className="subsection-title">{group.title}</h4>
                    {group.blurb && <p className="text-xs text-meta mb-2">{group.blurb}</p>}
                    <div className="divide-y divide-[var(--color-border)] border-t border-[var(--color-border)]">
                        {group.knobs.map(knob => (
                            <KnobRow
                                key={knob.key}
                                knob={knob}
                                value={valueOf(knob.key)}
                                def={knobDefault(knob.key)}
                                source={sourceOf(knob.key)}
                                siteValue={published[knob.key] ?? null}
                                canPublish={isAdmin}
                                publishable={!eqSlot(publishTarget(knob.key), published[knob.key] ?? null)}
                                busy={busyKey === knob.key}
                                failure={failure?.key === knob.key ? failure.message : null}
                                onChange={(v) => commit(knob.key, v)}
                                onReset={() => resetKey(knob.key)}
                                onPublish={() => publish(knob.key)}
                                evidence={evidence[knob.key] ?? null}
                            />
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

/**
 * What the corpus says about a band, under the band's own control.
 *
 * These bounds decide whether a derived figure is flagged on every EPA card and
 * all of them were set by hand. The records they judge are now numerous enough
 * to say what the real spread is — so it is shown here rather than baked into
 * the constants, because the corpus moves and a literal in a file is re-read
 * never. It informs the choice without making it: how much of a tail to call
 * suspect is a curation decision, which is why these are knobs at all.
 */
function BandEvidence({ evidence, band }) {
    if (!evidence) return null;

    if (!evidence.enough) {
        return (
            <p className="text-[11px] text-meta mt-0.5">
                observed: only {evidence.n} of {evidence.total} records carry a measured
                {' '}{evidence.label.toLowerCase()} — too few to set a bound from.
            </p>
        );
    }

    const d = (v) => v.toFixed(evidence.digits);
    const verdict = bandVerdict(band, evidence);
    const tone = verdict?.key === 'tight' ? 'var(--color-danger)'
        : verdict?.key === 'loose' ? 'var(--color-warning)'
        : 'var(--color-success)';

    return (
        <p className="text-[11px] text-meta mt-0.5">
            observed: <code>{d(evidence.p5)}–{d(evidence.p95)}</code> p5–p95,
            {' '}median <code>{d(evidence.median)}</code>,
            {' '}full <code>{d(evidence.min)}–{d(evidence.max)}</code>
            {' '}(n={evidence.n} measured of {evidence.total})
            {verdict && <>{' · '}<span style={{ color: tone }}>{verdict.text}</span></>}
        </p>
    );
}

/**
 * Where this row's live value came from.
 *
 * A curator setting a band from the evidence beside it needs to know whether
 * they are looking at their own sandbox, at what the site publishes, or at the
 * shipped default — the same question `overrideSource` answers on a curator
 * field, and for the same reason: an unlabelled number invites you to assume
 * it is the one everyone else sees.
 */
function SourceBadge({ source }) {
    if (source === 'local') {
        return <span className="knob-source-local" title="Set on this browser only — publish it to apply site-wide">local</span>;
    }
    if (source === 'site') {
        return <span className="knob-source-site" title="Published — every user computes from this">site</span>;
    }
    return null;
}

function KnobRow({
    knob, value, def, source, siteValue, canPublish, publishable, busy, failure,
    onChange, onReset, onPublish, evidence,
}) {
    const { key, label, help, kind, min, max, step, unit } = knob;

    return (
        <div className="py-3 flex items-start justify-between gap-4">
            <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{label}</span>
                    <code className="text-[11px] text-secondary bg-[var(--color-surface-sunken)] px-1.5 py-0.5 rounded">
                        {key}
                    </code>
                    <SourceBadge source={source} />
                </div>
                {help && <p className="text-xs text-meta mt-0.5">{help}</p>}
                <p className="text-[11px] text-meta mt-0.5">
                    default: <code>{show(def)}</code>{unit ? ` ${unit}` : ''}
                    {siteValue != null && (
                        <> {' · '} published: <code>{show(siteValue)}</code>{unit ? ` ${unit}` : ''}</>
                    )}
                </p>
                <BandEvidence evidence={evidence} band={value} />
                {failure && <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-danger)' }}>{failure}</p>}
            </div>

            <div className="flex items-center gap-2 shrink-0">
                {kind === 'range' ? (
                    <>
                        <input
                            type="number" min={min} max={max} step={step}
                            value={value[0]}
                            onChange={(e) => onChange([numOrNull(e.target.value) ?? def[0], value[1]])}
                            className="form-input form-input w-20"
                        />
                        <span className="text-meta text-sm">–</span>
                        <input
                            type="number" min={min} max={max} step={step}
                            value={value[1]}
                            onChange={(e) => onChange([value[0], numOrNull(e.target.value) ?? def[1]])}
                            className="form-input form-input w-20"
                        />
                    </>
                ) : (
                    <input
                        type="number" min={min} max={max} step={step}
                        value={value}
                        onChange={(e) => onChange(numOrNull(e.target.value))}
                        className="form-input form-input w-24"
                    />
                )}
                {unit && <span className="text-xs text-meta w-7">{unit}</span>}
                {canPublish && (
                    <button
                        onClick={onPublish}
                        disabled={!publishable || busy}
                        title={publishable
                            ? 'Publish this value site-wide'
                            : 'Already what the site publishes'}
                        className="text-xs text-meta hover:text-secondary disabled:opacity-30 px-1"
                    >
                        {busy ? '…' : '⇧'}
                    </button>
                )}
                <button
                    onClick={onReset}
                    disabled={source !== 'local'}
                    title="Drop this browser's override"
                    className="text-xs text-meta hover:text-secondary disabled:opacity-30 px-1"
                >
                    ↺
                </button>
            </div>
        </div>
    );
}

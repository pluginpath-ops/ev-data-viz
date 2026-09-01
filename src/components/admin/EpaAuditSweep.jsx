import { useState, useMemo, useCallback } from 'react';
import { useAppContext } from '../../context/AppContext';
import { useAsyncResource } from '../../hooks/useAsyncResource';
import { auditGroups, auditSummary, auditFindings, AUDIT_VERDICTS } from '../../utils/epaAudit';

/**
 * Which of our EPA records do not reconcile? (#229)
 *
 * The four checks run one vehicle at a time, on the card you happen to have
 * open. After any change to the derivation, confirming nothing regressed meant
 * opening records one by one — which is how #226 was verified, and is not a
 * thing anyone will do twice.
 *
 * READ-ONLY, and no recalculation. Derivations are computed at read time and
 * nothing is stored, so a change to the method already takes effect everywhere
 * on reload. There is nothing here to re-run; what was missing is the ability
 * to see the result across the fleet at once.
 *
 * It also reaches records the per-vehicle view cannot. Most groups are linked
 * to no vehicle, and a group with no vehicle has no Tests & Data tab — so for
 * those, this is the only place a verdict is ever shown.
 */

const TONE_CLASS = {
    disagrees: 'epa-check-disagrees',
    close:     'epa-check-close',
    agrees:    'epa-check-agrees',
    unchecked: '',
};

function VerdictPill({ verdict }) {
    const meta = AUDIT_VERDICTS.find(v => v.key === verdict) ?? AUDIT_VERDICTS.at(-1);
    const colour = meta.tone === 'disagrees' ? 'var(--color-danger)'
        : meta.tone === 'close' ? 'var(--color-warning)'
        : meta.tone === 'agrees' ? 'var(--color-success)'
        : 'var(--color-text-meta)';
    return (
        <span className="text-note font-medium whitespace-nowrap" style={{ color: colour }}>
            {meta.label}
        </span>
    );
}

/** One row, expanded: every finding the four checks produced, as sentences. */
function Findings({ row }) {
    const findings = auditFindings(row);
    if (!findings.length) {
        return <p className="text-note">Everything checkable was checked and agreed.</p>;
    }
    return (
        <div className="flex flex-col gap-1">
            {findings.map((f, i) => (
                <div key={i} className={`epa-check ${TONE_CLASS[f.severity] ?? ''}`}>
                    <span className="text-note">{f.text}</span>
                </div>
            ))}
        </div>
    );
}

export default function EpaAuditSweep() {
    const { getEpaGroupsForAudit } = useAppContext();
    const load = useCallback(() => getEpaGroupsForAudit(), [getEpaGroupsForAudit]);
    const { data: groups, loading, error } = useAsyncResource(load, []);

    const [only, setOnly]   = useState(null);   // verdict key, or null for all
    const [query, setQuery] = useState('');
    const [open, setOpen]   = useState(() => new Set());

    const rows    = useMemo(() => auditGroups(groups ?? []), [groups]);
    const summary = useMemo(() => auditSummary(rows), [rows]);

    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        return rows.filter(r => {
            if (only && r.verdict !== only) return false;
            if (!q) return true;
            return [r.testGroupId, r.make, r.carline, ...r.vehicles.map(v => v.name)]
                .some(v => String(v ?? '').toLowerCase().includes(q));
        });
    }, [rows, only, query]);

    const toggle = (id) => setOpen(prev => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
    });

    if (loading) return <p className="text-secondary">Checking every EPA record…</p>;
    if (error)   return <p className="text-red-500">{error.message}</p>;

    return (
        <div className="card p-4">
            <h3 className="section-title mb-1">Reconciliation sweep</h3>
            <p className="text-note mb-3">
                Every EPA test group against the same four checks the curator card runs, worst
                first. Read-only — nothing here recomputes or writes, because derivations are
                already computed at read time.
            </p>

            {/* Counts first: the useful question is how many are wrong, and
                which kind. Doubles as the filter. */}
            <div className="flex flex-wrap gap-2 mb-3">
                <button
                    type="button"
                    onClick={() => setOnly(null)}
                    className={`guide-chip ${only === null ? 'active' : ''}`}
                >
                    All {rows.length}
                </button>
                {AUDIT_VERDICTS.map(v => (
                    <button
                        key={v.key}
                        type="button"
                        title={v.blurb}
                        disabled={!summary[v.key]}
                        onClick={() => setOnly(only === v.key ? null : v.key)}
                        className={`guide-chip ${only === v.key ? 'active' : ''} disabled:opacity-40`}
                    >
                        {v.label} {summary[v.key]}
                    </button>
                ))}
            </div>

            <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Filter by group, make, carline or vehicle…"
                className="form-input form-input w-full mb-3"
            />

            {!shown.length && (
                <p className="text-note">Nothing matches that filter.</p>
            )}

            <div className="flex flex-col gap-1">
                {shown.map(r => (
                    <div key={r.testGroupId} className="epa-audit-row">
                        <button
                            type="button"
                            onClick={() => toggle(r.testGroupId)}
                            className="w-full text-left flex items-start justify-between gap-3 py-1"
                        >
                            <span className="min-w-0">
                                <span className="text-secondary truncate block">
                                    {r.make} {r.carline}
                                    {r.modelYear && <span className="text-meta"> · {r.modelYear}</span>}
                                </span>
                                <span className="text-meta block truncate">
                                    <span className="font-mono">{r.testGroupId}</span>
                                    {r.vehicles.length > 0 && ` · ${r.vehicles.map(v => v.name).join(', ')}`}
                                    {r.notes.length > 0 && ` · ${r.notes.join(' · ')}`}
                                </span>
                            </span>
                            <VerdictPill verdict={r.verdict} />
                        </button>
                        {open.has(r.testGroupId) && (
                            <div className="pl-2 pb-2"><Findings row={r} /></div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

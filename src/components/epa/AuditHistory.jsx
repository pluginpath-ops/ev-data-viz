/**
 * Audit-trail viewer for one EPA test group (Section: cross-cutting audit
 * requirement). Lists who changed what, when, prior → new, and any source
 * citation, across the group row and all its child rows (coefficient sets,
 * tests, phases). Collapsible; loads on first open.
 */
import { useState } from 'react';

const TABLE_LABEL = {
    epa_test_groups:     'group',
    epa_coefficient_sets:'coeff',
    epa_tests:           'test',
    epa_test_phases:     'phase',
};

function timeAgo(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default function AuditHistory({ group, getEpaAuditForGroup }) {
    const [open, setOpen]       = useState(false);
    const [rows, setRows]       = useState(null); // null = not loaded
    const [loading, setLoading] = useState(false);
    const [error, setError]     = useState(null);

    const childIds = [
        ...(group.epa_coefficient_sets || []).map(s => s.id),
        ...(group.epa_tests || []).flatMap(t => [t.id, ...(t.epa_test_phases || []).map(p => p.id)]),
    ].filter(id => id != null);

    const load = async () => {
        setLoading(true); setError(null);
        try {
            setRows(await getEpaAuditForGroup(group.test_group_id, childIds));
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const toggle = () => {
        const next = !open;
        setOpen(next);
        if (next && rows === null) load();
    };

    return (
        <div className="mt-3 border-t border-[var(--color-border)] pt-2">
            <button
                type="button"
                onClick={toggle}
                className="text-xs font-medium text-secondary hover:underline"
            >
                {open ? '▾' : '▸'} Edit history{rows?.length ? ` (${rows.length})` : ''}
            </button>
            {open && (
                <div className="mt-2 text-[11px]">
                    {loading && <p className="text-meta italic">Loading…</p>}
                    {error && <p className="text-red-500">Error: {error}</p>}
                    {!loading && !error && rows && rows.length === 0 && (
                        <p className="text-meta italic">No edits recorded yet.</p>
                    )}
                    {!loading && rows && rows.length > 0 && (
                        <div className="max-h-56 overflow-y-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="text-meta text-[10px] uppercase tracking-wide text-left">
                                        <th className="font-semibold pr-2 py-0.5">When</th>
                                        <th className="font-semibold pr-2">Field</th>
                                        <th className="font-semibold pr-2">Change</th>
                                        <th className="font-semibold">Source</th>
                                    </tr>
                                </thead>
                                <tbody className="font-mono">
                                    {rows.map(r => (
                                        <tr key={r.id} className="border-t border-[var(--color-border)] align-top">
                                            <td className="pr-2 py-0.5 text-meta whitespace-nowrap">{timeAgo(r.edited_at)}</td>
                                            <td className="pr-2">
                                                <span className="text-meta">{TABLE_LABEL[r.table_name] || r.table_name}·</span>{r.field}
                                            </td>
                                            <td className="pr-2">
                                                <span className="text-meta line-through">{r.prior_value ?? '∅'}</span>
                                                {' → '}
                                                <span className="text-secondary">{r.new_value ?? '∅'}</span>
                                            </td>
                                            <td className="text-meta italic">{r.source_citation || '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

/**
 * Admin panel card — lists all imported EPA test groups with filter + delete.
 *
 * Filter is client-side (the full list loads once on mount) and matches on
 * make, carline name, vehicle config ID, EPA family ID, display name, and
 * linked vehicle names — the same fields visible in the table.
 *
 * Delete removes the vehicle mapping(s) first (no CASCADE on the FK) then the
 * test group row, and shows a confirmation that names any linked vehicles.
 *
 * Display name and label method are inline-editable. Display name is folded
 * into the carline column to avoid horizontal scroll.
 */
import { useState, useEffect } from 'react';

const CONFIDENCE_COLORS = {
    verified: 'text-green-700 bg-green-50 border-green-200 dark:text-green-300 dark:bg-green-900/30 dark:border-green-700',
    likely:   'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-900/30 dark:border-amber-700',
    inferred: 'text-gray-500 bg-gray-50 border-gray-200 dark:text-gray-400 dark:bg-gray-800/40 dark:border-gray-600',
};

// Short labels keep the select narrow; full names shown in title tooltip
const LABEL_METHOD_OPTIONS = [
    { value: '',                 label: '—',        title: 'Unknown / not set'    },
    { value: '2-cycle',          label: '2-cycle',  title: '2-cycle (city + hwy)' },
    { value: '5-cycle',          label: '5-cycle',  title: '5-cycle adjusted'     },
    { value: 'vehicle-specific', label: 'Veh-spec', title: 'Vehicle-specific test' },
    { value: 'mpg-based',        label: 'MPG',      title: 'MPG-based (PHEV)'     },
];

export default function EpaDataCard({ getEpaTestGroupsAdmin, deleteEpaTestGroup, updateEpaLabelMethod, updateEpaTestGroup }) {
    const [groups,         setGroups]         = useState([]);
    const [loading,        setLoading]        = useState(true);
    const [query,          setQuery]          = useState('');
    const [deleting,       setDeleting]       = useState(new Set());
    const [updatingMethod, setUpdatingMethod] = useState(new Set());
    const [draftNames,     setDraftNames]     = useState({});   // keyed by test_group_id
    const [savingName,     setSavingName]     = useState(new Set());
    const [error,          setError]          = useState(null);

    useEffect(() => { load(); }, []);

    // Seed drafts whenever the group list changes
    useEffect(() => {
        const seed = {};
        groups.forEach(g => { seed[g.test_group_id] = g.display_name ?? ''; });
        setDraftNames(seed);
    }, [groups]);

    async function load() {
        setLoading(true);
        setError(null);
        try {
            setGroups(await getEpaTestGroupsAdmin());
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }

    async function handleDelete(group) {
        const linked = (group.epa_vehicle_mappings || [])
            .map(m => m.vehicles?.name).filter(Boolean);
        const suffix = linked.length
            ? `\n\nThis will also unlink it from: ${linked.join(', ')}.`
            : '';
        if (!window.confirm(`Delete "${group.epa_carline_name}" (${group.test_group_id})?${suffix}`)) return;

        setDeleting(prev => new Set(prev).add(group.test_group_id));
        try {
            await deleteEpaTestGroup(group.test_group_id);
            setGroups(prev => prev.filter(g => g.test_group_id !== group.test_group_id));
        } catch (e) {
            setError('Delete failed: ' + e.message);
        } finally {
            setDeleting(prev => { const s = new Set(prev); s.delete(group.test_group_id); return s; });
        }
    }

    async function handleDisplayNameSave(group) {
        const draft   = (draftNames[group.test_group_id] ?? '').trim();
        const current = group.display_name ?? '';
        if (draft === current) return;
        setSavingName(prev => new Set(prev).add(group.test_group_id));
        try {
            await updateEpaTestGroup?.(group.test_group_id, { display_name: draft || null });
            setGroups(prev => prev.map(g =>
                g.test_group_id === group.test_group_id
                    ? { ...g, display_name: draft || null }
                    : g
            ));
        } catch (e) {
            setError('Save failed: ' + e.message);
            setDraftNames(prev => ({ ...prev, [group.test_group_id]: current }));
        } finally {
            setSavingName(prev => { const s = new Set(prev); s.delete(group.test_group_id); return s; });
        }
    }

    async function handleLabelMethodChange(group, method) {
        setUpdatingMethod(prev => new Set(prev).add(group.test_group_id));
        try {
            await updateEpaLabelMethod?.(group.test_group_id, method);
            setGroups(prev => prev.map(g =>
                g.test_group_id === group.test_group_id
                    ? { ...g, label_method: method || null }
                    : g
            ));
        } catch (e) {
            setError('Update failed: ' + e.message);
        } finally {
            setUpdatingMethod(prev => { const s = new Set(prev); s.delete(group.test_group_id); return s; });
        }
    }

    // ── Client-side filter ────────────────────────────────────────────────────

    const q = query.trim().toLowerCase();
    const filtered = q
        ? groups.filter(g =>
            g.make?.toLowerCase().includes(q) ||
            g.epa_carline_name?.toLowerCase().includes(q) ||
            g.display_name?.toLowerCase().includes(q) ||
            g.test_group_id?.toLowerCase().includes(q) ||
            g.epa_test_family_id?.toLowerCase().includes(q) ||
            (g.epa_vehicle_mappings || []).some(m => m.vehicles?.name?.toLowerCase().includes(q))
          )
        : groups;

    const linkedCount = groups.filter(g => g.epa_vehicle_mappings?.length > 0).length;

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div className="card p-0 overflow-hidden mt-6">

            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b">
                <div>
                    <h3 className="font-semibold text-sm">EPA Test Groups</h3>
                    <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                        {loading ? 'Loading…' : `${groups.length} imported · ${linkedCount} linked to vehicles`}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <input
                        type="text"
                        placeholder="Filter by make, carline, ID, vehicle…"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        className="form-input text-sm py-1.5 w-64"
                    />
                    <button
                        onClick={load}
                        disabled={loading}
                        className="btn btn-secondary text-xs py-1.5 px-3"
                        title="Refresh"
                    >
                        {loading ? '…' : '↻ Refresh'}
                    </button>
                </div>
            </div>

            {/* Error */}
            {error && (
                <div className="px-4 py-2 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-700 text-red-800 dark:text-red-300 text-xs">
                    ⚠️ {error}
                </div>
            )}

            {/* Body */}
            {loading ? (
                <div className="px-4 py-8 text-center text-sm text-gray-400">Loading…</div>
            ) : filtered.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-gray-400">
                    {q ? 'No test groups match that filter.' : 'No EPA test groups imported yet. Use Import → EPA Test Car Data to add some.'}
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="border-b bg-gray-50 dark:bg-slate-800/50 text-left">
                                <th className="px-3 py-2 text-gray-500 font-semibold whitespace-nowrap">Config ID</th>
                                <th className="px-3 py-2 text-gray-500 font-semibold">Year · Make · Carline</th>
                                <th className="px-3 py-2 text-gray-500 font-semibold whitespace-nowrap">Drive / ETW</th>
                                <th className="px-3 py-2 text-gray-500 font-semibold whitespace-nowrap">A · B · C</th>
                                <th className="px-3 py-2 text-gray-500 font-semibold whitespace-nowrap">MPGe</th>
                                <th className="px-3 py-2 text-gray-500 font-semibold whitespace-nowrap">Method</th>
                                <th className="px-3 py-2 text-gray-500 font-semibold">Linked Vehicles</th>
                                <th className="px-3 py-2" />
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {filtered.map(g => {
                                const mappings = g.epa_vehicle_mappings || [];
                                const isDel    = deleting.has(g.test_group_id);
                                const isSaving = savingName.has(g.test_group_id);
                                return (
                                    <tr
                                        key={g.test_group_id}
                                        className={`transition hover:bg-gray-50/50 dark:hover:bg-slate-800/30 ${isDel ? 'opacity-40 pointer-events-none' : ''}`}
                                    >
                                        {/* Config ID + family ID */}
                                        <td className="px-3 py-2 font-mono whitespace-nowrap">
                                            <div className="text-gray-700 dark:text-slate-300">{g.test_group_id}</div>
                                            {g.epa_test_family_id && g.epa_test_family_id !== g.test_group_id && (
                                                <div className="text-[10px] text-gray-400 dark:text-slate-500 mt-0.5">
                                                    fam: {g.epa_test_family_id}
                                                </div>
                                            )}
                                        </td>

                                        {/* Year / Make / Carline + inline display-name edit */}
                                        <td className="px-3 py-2 max-w-[200px]">
                                            {/* Carline name: wraps, no truncation */}
                                            <div className="font-medium text-gray-700 dark:text-slate-300 leading-snug">
                                                {g.epa_carline_name}
                                            </div>
                                            <div className="text-gray-400 dark:text-slate-500 mt-0.5 whitespace-nowrap">
                                                {g.model_year}{g.make ? ` · ${g.make}` : ''}
                                            </div>
                                            {/* Display name input — inline below the carline */}
                                            <input
                                                type="text"
                                                value={draftNames[g.test_group_id] ?? ''}
                                                placeholder="Display name…"
                                                disabled={isDel || isSaving}
                                                onChange={e => setDraftNames(prev => ({ ...prev, [g.test_group_id]: e.target.value }))}
                                                onBlur={() => handleDisplayNameSave(g)}
                                                onKeyDown={e => {
                                                    if (e.key === 'Enter')  { e.target.blur(); }
                                                    if (e.key === 'Escape') {
                                                        setDraftNames(prev => ({ ...prev, [g.test_group_id]: g.display_name ?? '' }));
                                                        e.target.blur();
                                                    }
                                                }}
                                                className="form-input text-xs py-0.5 mt-1.5 w-full disabled:opacity-50 placeholder:text-gray-300 dark:placeholder:text-slate-600 placeholder:italic"
                                                title="Friendly display name used in charts. Leave blank to use the EPA carline name."
                                            />
                                        </td>

                                        {/* Drive / ETW */}
                                        <td className="px-3 py-2 whitespace-nowrap text-gray-500 dark:text-slate-400">
                                            <div>{g.drive || '—'}</div>
                                            <div className="text-gray-400 dark:text-slate-500 mt-0.5">
                                                {g.equiv_test_weight_lbs != null
                                                    ? `${Number(g.equiv_test_weight_lbs).toLocaleString()} lbs`
                                                    : '—'}
                                            </div>
                                        </td>

                                        {/* Road-load A / B / C — prefer target; fall back to set */}
                                        <td className="px-3 py-2 font-mono whitespace-nowrap">
                                            {(() => {
                                                const a = g.target_a ?? g.set_a;
                                                const b = g.target_b ?? g.set_b;
                                                const c = g.target_c ?? g.set_c;
                                                const isTarget = g.target_a != null;
                                                if (a == null) return <span className="text-gray-300 dark:text-slate-600">—</span>;
                                                return (
                                                    <div
                                                        className={`text-[11px] leading-tight ${isTarget ? 'text-gray-600 dark:text-slate-300' : 'text-gray-400 dark:text-slate-500'}`}
                                                        title={isTarget ? 'Target coefficients (road load)' : 'Set coefficients (dyno-programmed)'}
                                                    >
                                                        <div>{Number(a).toFixed(2)}</div>
                                                        <div>{Number(b).toFixed(4)}</div>
                                                        <div>{Number(c).toFixed(5)}</div>
                                                        {!isTarget && <div className="text-[9px] text-amber-500 mt-0.5">set only</div>}
                                                    </div>
                                                );
                                            })()}
                                        </td>

                                        {/* Label MPGe */}
                                        <td className="px-3 py-2 whitespace-nowrap">
                                            {g.label_combined_mpge != null && g.label_combined_mpge < 500 ? (
                                                <span
                                                    className={g.label_combined_mpge < 60
                                                        ? 'text-amber-600 dark:text-amber-400 font-medium'
                                                        : 'text-gray-500 dark:text-slate-400'}
                                                    title={g.label_combined_mpge < 60
                                                        ? 'Label < 60 MPGe — source column may be in MPGe not kWh/100mi. Re-import with the unit flip toggle.'
                                                        : undefined}
                                                >
                                                    {g.label_combined_mpge < 60 && '⚠ '}
                                                    {g.label_combined_mpge}
                                                </span>
                                            ) : (
                                                <span className="text-gray-300 dark:text-slate-600">—</span>
                                            )}
                                        </td>

                                        {/* Label method — compact select */}
                                        <td className="px-3 py-2">
                                            <select
                                                value={g.label_method ?? ''}
                                                disabled={updatingMethod.has(g.test_group_id) || isDel}
                                                onChange={e => handleLabelMethodChange(g, e.target.value)}
                                                className="form-input text-xs py-0.5 w-24 disabled:opacity-50"
                                                title={LABEL_METHOD_OPTIONS.find(o => o.value === (g.label_method ?? ''))?.title
                                                    ?? 'Range label derivation method — look up on fueleconomy.gov'}
                                            >
                                                {LABEL_METHOD_OPTIONS.map(o => (
                                                    <option key={o.value} value={o.value} title={o.title}>{o.label}</option>
                                                ))}
                                            </select>
                                        </td>

                                        {/* Linked vehicles with confidence badges */}
                                        <td className="px-3 py-2">
                                            {mappings.length === 0 ? (
                                                <span className="text-gray-300 dark:text-slate-600 italic">none</span>
                                            ) : (
                                                <div className="flex flex-wrap gap-1">
                                                    {mappings.map(m => (
                                                        <span
                                                            key={m.id}
                                                            className={`px-1.5 py-0.5 rounded border font-medium ${CONFIDENCE_COLORS[m.confidence] ?? CONFIDENCE_COLORS.inferred}`}
                                                        >
                                                            {m.vehicles?.name || '?'}
                                                            {m.vehicles?.year ? ` (${m.vehicles.year})` : ''}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </td>

                                        {/* Delete */}
                                        <td className="px-3 py-2">
                                            <button
                                                type="button"
                                                disabled={isDel}
                                                onClick={() => handleDelete(g)}
                                                className="btn btn-secondary text-xs py-0.5 px-2 text-red-600 border-red-200 hover:bg-red-50 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-900/30 disabled:opacity-40"
                                            >
                                                {isDel ? '…' : 'Delete'}
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Footer: row count when filter is active */}
            {!loading && groups.length > 0 && q && filtered.length !== groups.length && (
                <div className="px-4 py-2 border-t text-xs text-gray-400 dark:text-slate-500">
                    Showing {filtered.length} of {groups.length} test groups
                </div>
            )}
        </div>
    );
}

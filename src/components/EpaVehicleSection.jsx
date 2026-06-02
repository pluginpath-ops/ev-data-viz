/**
 * EPA testing data section — shown in the Tests & Data (RunsView) per-vehicle panel.
 *
 * Shows:
 *   • A card for each linked EPA test group (coefficients, cycle results, label values)
 *   • An "Assign EPA Testing Data" combobox for linking additional test groups
 *   • Unlink controls (contributor+)
 */
import { useState, useRef } from 'react';
import InfoIcon from './InfoIcon';
import { EPA_EXPLAINERS } from '../utils/epaExplainers';
import DerivedValues from './epa/DerivedValues';
import EpaCuratorEditor from './epa/EpaCuratorEditor';

const CONFIDENCE_COLORS = {
    verified: 'text-green-700 bg-green-50 border-green-200 dark:text-green-300 dark:bg-green-900/30 dark:border-green-700',
    likely:   'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-900/30 dark:border-amber-700',
    inferred: 'text-gray-500 bg-gray-50 border-gray-200 dark:text-gray-400 dark:bg-gray-800/40 dark:border-gray-600',
};

function ConfidenceBadge({ confidence }) {
    return (
        <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${CONFIDENCE_COLORS[confidence] ?? CONFIDENCE_COLORS.inferred}`}>
            {confidence}
        </span>
    );
}

/** One row of a label/value table inside the card. */
function DataRow({ label, value, muted }) {
    if (value == null) return null;
    return (
        <div className="flex justify-between gap-4 py-0.5">
            <span className="text-gray-500 dark:text-slate-400 shrink-0">{label}</span>
            <span className={`font-mono text-right ${muted ? 'text-gray-400 dark:text-slate-500' : ''}`}>{value}</span>
        </div>
    );
}

/** Card displaying the data for one EPA test group mapping. */
function EpaGroupCard({ mapping, canEdit, onUnlink, onUpdateConfidence, onUpdateDisplayName }) {
    const [unlinking,    setUnlinking]    = useState(false);
    const [updatingConf, setUpdatingConf] = useState(false);
    const [draftName,    setDraftName]    = useState(null); // null = not editing
    const [savingName,   setSavingName]   = useState(false);
    const [curating,     setCurating]     = useState(false);
    const g = mapping.epaGroup;
    if (!g) return null;

    const fmt = (n, dp = 4) => n != null ? n.toFixed(dp) : null;
    // Coefficients now live on the primary coefficient set, not flat columns.
    const coeff = (g.epa_coefficient_sets || []).find(s => s.is_primary)
        || (g.epa_coefficient_sets || [])[0] || {};

    const handleUnlink = async () => {
        setUnlinking(true);
        try { await onUnlink(mapping.id); } finally { setUnlinking(false); }
    };

    const handleConfidence = async (e) => {
        setUpdatingConf(true);
        try { await onUpdateConfidence(mapping.id, e.target.value); } finally { setUpdatingConf(false); }
    };

    const handleNameFocus = () => {
        if (!canEdit) return;
        setDraftName(g.display_name ?? '');
    };

    const handleNameSave = async () => {
        if (draftName === null) return;
        const trimmed = draftName.trim();
        const current = g.display_name ?? '';
        setDraftName(null);
        if (trimmed === current) return;
        setSavingName(true);
        try {
            await onUpdateDisplayName?.(g.test_group_id, trimmed || null);
        } finally {
            setSavingName(false);
        }
    };

    const handleNameKeyDown = (e) => {
        if (e.key === 'Enter')  { e.target.blur(); }
        if (e.key === 'Escape') { setDraftName(null); }
    };

    return (
        <div className="card p-4 mb-3">
            {/* Card header */}
            <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0 flex-1">
                    {/* Display name — editable when canEdit */}
                    {canEdit ? (
                        <input
                            type="text"
                            value={draftName !== null ? draftName : (g.display_name ?? '')}
                            placeholder={g.epa_carline_name}
                            disabled={savingName}
                            onFocus={handleNameFocus}
                            onChange={e => setDraftName(e.target.value)}
                            onBlur={handleNameSave}
                            onKeyDown={handleNameKeyDown}
                            className="form-input text-sm font-semibold py-0.5 w-full disabled:opacity-50 placeholder:text-gray-400 dark:placeholder:text-slate-500 placeholder:font-normal placeholder:italic"
                            title="Friendly display name used in charts. Leave blank to use the EPA carline name."
                        />
                    ) : (
                        <div className="font-semibold text-sm truncate">
                            {g.display_name || g.epa_carline_name}
                        </div>
                    )}
                    {/* Show raw EPA name as subtitle when a display name is set or being edited */}
                    {(g.display_name || draftName !== null) && (
                        <div className="text-xs text-gray-400 dark:text-slate-500 italic truncate mt-0.5">{g.epa_carline_name}</div>
                    )}
                    <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                        {g.model_year}{g.make ? ` · ${g.make}` : ''}{g.drive ? ` · ${g.drive}` : ''}
                        {g.transmission ? ` · ${g.transmission}` : ''}
                    </div>
                    <div className="font-mono text-xs text-gray-400 mt-0.5">
                        {g.test_group_id}
                        {g.epa_test_family_id && g.epa_test_family_id !== g.test_group_id && (
                            <span className="ml-1 text-gray-300 dark:text-slate-600">· family: {g.epa_test_family_id}</span>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                    {canEdit ? (
                        <select
                            value={mapping.confidence}
                            onChange={handleConfidence}
                            disabled={updatingConf}
                            className="form-input text-xs py-0.5 w-28"
                        >
                            <option value="verified">Verified</option>
                            <option value="likely">Likely</option>
                            <option value="inferred">Inferred</option>
                        </select>
                    ) : (
                        <ConfidenceBadge confidence={mapping.confidence} />
                    )}
                    {canEdit && (
                        <button
                            type="button"
                            disabled={unlinking}
                            onClick={handleUnlink}
                            className="btn btn-secondary text-xs py-0.5 px-2 disabled:opacity-40"
                        >
                            {unlinking ? '…' : 'Unlink'}
                        </button>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1 text-xs">

                {/* Physical */}
                <div>
                    <div className="text-gray-400 text-[10px] uppercase tracking-wide mb-1 font-semibold">
                        Test Setup
                    </div>
                    <DataRow label="Test weight" value={coeff.equiv_test_weight_lbs != null ? coeff.equiv_test_weight_lbs.toLocaleString() + ' lbs' : null} />
                    <DataRow label="Fuel type" value={g.fuel_type} />
                    <DataRow label="Config #" value={g.vehicle_config_number} />
                </div>

                {/* Road-load coefficients (primary set) */}
                <div>
                    <div className="text-gray-400 text-[10px] uppercase tracking-wide mb-1 font-semibold flex items-center gap-1">
                        Road-Load Coefficients
                        <InfoIcon text={EPA_EXPLAINERS.roadLoad} position="right" />
                    </div>
                    {coeff.target_a != null ? (
                        <>
                            <DataRow label="Target A" value={fmt(coeff.target_a, 3) + ' lbf'} />
                            <DataRow label="Target B" value={fmt(coeff.target_b, 5) + ' lbf/mph'} />
                            <DataRow label="Target C" value={fmt(coeff.target_c, 6) + ' lbf/mph²'} />
                        </>
                    ) : coeff.set_a != null ? (
                        <>
                            <DataRow label="Set A" value={fmt(coeff.set_a, 3) + ' lbf'} muted />
                            <DataRow label="Set B" value={fmt(coeff.set_b, 5) + ' lbf/mph'} muted />
                            <DataRow label="Set C" value={fmt(coeff.set_c, 6) + ' lbf/mph²'} muted />
                        </>
                    ) : (
                        <p className="text-gray-400 text-[10px] italic">No coefficients yet</p>
                    )}
                </div>

                {/* Label results + live derivations */}
                <div className="space-y-2">
                    <div>
                        <div className="text-gray-400 text-[10px] uppercase tracking-wide mb-1 font-semibold">
                            Label Results
                        </div>
                        {g.label_combined_mpge != null && g.label_combined_mpge < 500 && (
                            <DataRow label="Label combined" value={g.label_combined_mpge.toFixed(1) + ' MPGe'} />
                        )}
                        {g.label_hwy_mpge != null && g.label_hwy_mpge < 500 && (
                            <DataRow label="Label highway" value={g.label_hwy_mpge.toFixed(1) + ' MPGe'} />
                        )}
                        {g.label_range_published != null && (
                            <DataRow label="Label range" value={g.label_range_published.toFixed(0) + ' mi'} />
                        )}
                        {g.label_combined_mpge == null && g.label_hwy_mpge == null && (
                            <p className="text-gray-400 text-[10px] italic">No label data</p>
                        )}
                    </div>
                    <DerivedValues group={g} />
                </div>
            </div>

            {mapping.notes && (
                <p className="mt-2 text-xs text-gray-500 dark:text-slate-400 italic border-t pt-2">{mapping.notes}</p>
            )}

            {/* Curator form — contributor/admin only */}
            {canEdit && (
                <>
                    <button
                        type="button"
                        onClick={() => setCurating(c => !c)}
                        className="mt-3 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                        {curating ? '▾ Hide curator fields' : '▸ Curate fields & test data'}
                    </button>
                    {curating && <EpaCuratorEditor testGroupId={g.test_group_id} canEdit={canEdit} />}
                </>
            )}
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

const EPA_SOURCE_URL = 'https://dis.epa.gov/otaqpub/publist1.jsp';

export default function EpaVehicleSection({ vehicle, canEdit, searchEpaTestGroups, onLink, onCreate, onUnlink, onUpdateConfidence, onUpdateDisplayName }) {
    const [query, setQuery]               = useState('');
    const [results, setResults]           = useState([]);
    const [searching, setSearching]       = useState(false);
    const [searchError, setSearchError]   = useState(null);
    const [showDropdown, setShowDropdown] = useState(false);
    const [linking, setLinking]           = useState(false);
    const [showCreate, setShowCreate]     = useState(false);
    const [createDraft, setCreateDraft]   = useState({ test_group_id: '', model_year: '', make: '', epa_carline_name: '' });
    const [creating, setCreating]         = useState(false);
    const [createError, setCreateError]   = useState(null);
    const debounceRef = useRef(null);

    const mappings = vehicle?.epa_mappings ?? [];

    const handleCreate = async () => {
        const id = createDraft.test_group_id.trim();
        if (!id) { setCreateError('Test Group ID is required.'); return; }
        setCreating(true);
        setCreateError(null);
        // Mark hand-entered identity fields as curator-sourced.
        const overrides = {};
        const fields = { test_group_id: id, overrides };
        if (createDraft.model_year.trim())       { fields.model_year = Number(createDraft.model_year) || null; overrides.model_year = { source: 'manual' }; }
        if (createDraft.make.trim())             { fields.make = createDraft.make.trim(); overrides.make = { source: 'manual' }; }
        if (createDraft.epa_carline_name.trim()) { fields.epa_carline_name = createDraft.epa_carline_name.trim(); overrides.epa_carline_name = { source: 'manual' }; }
        try {
            await onCreate(vehicle.id, fields);
            setShowCreate(false);
            setCreateDraft({ test_group_id: '', model_year: '', make: '', epa_carline_name: '' });
        } catch (e) {
            setCreateError(e?.message || 'Create failed');
        } finally {
            setCreating(false);
        }
    };

    const handleQueryChange = (e) => {
        const q = e.target.value;
        setQuery(q);
        setShowDropdown(true);
        setSearchError(null);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        if (!q.trim()) { setResults([]); return; }
        debounceRef.current = setTimeout(async () => {
            setSearching(true);
            try {
                // No year filter — EPA model years often differ from the vehicle's model year
                // by 1–2 years; the year is shown in dropdown results for manual verification.
                const rows = await searchEpaTestGroups?.(q.trim());
                setResults(rows || []);
            } catch (err) {
                setSearchError(err?.message || 'Search failed');
                setResults([]);
            } finally {
                setSearching(false);
            }
        }, 300);
    };

    const handleSelect = async (group) => {
        setShowDropdown(false);
        setQuery('');
        setResults([]);
        if (!vehicle?.id || !onLink) return;
        setLinking(true);
        try {
            await onLink(vehicle.id, group.test_group_id, 'inferred', null);
        } finally {
            setLinking(false);
        }
    };

    return (
        <div className="mt-6">
            <div className="flex items-center justify-between gap-2 mb-3">
                <h3 className="section-title">
                    EPA Testing Data
                    <InfoIcon text={EPA_EXPLAINERS.steadyStateCurve} position="right" className="ml-1" />
                </h3>
                <a
                    href={EPA_SOURCE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap"
                    title="EPA Annual Certification Data — look up Test Groups, coefficients, and lab reports"
                >
                    EPA source data ↗
                </a>
            </div>

            {/* Existing mappings */}
            {mappings.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-slate-400 mb-3">
                    No EPA test group linked yet.
                    {canEdit && ' Use the search below to assign one.'}
                </p>
            ) : (
                mappings.map(m => (
                    <EpaGroupCard
                        key={m.id}
                        mapping={m}
                        canEdit={canEdit}
                        onUnlink={onUnlink}
                        onUpdateConfidence={onUpdateConfidence}
                        onUpdateDisplayName={onUpdateDisplayName}
                    />
                ))
            )}

            {/* Link combobox — contributors only */}
            {canEdit && (
                <div className="mt-2">
                    <div className="relative">
                        <input
                            type="text"
                            placeholder="Assign EPA testing data — search by make or carline…"
                            value={query}
                            onChange={handleQueryChange}
                            onFocus={() => query && setShowDropdown(true)}
                            onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                            disabled={linking}
                            className="form-input text-sm w-full"
                        />
                        {linking && (
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">Linking…</span>
                        )}
                        {showDropdown && (results.length > 0 || searching || searchError) && (
                            <ul className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border shadow-lg bg-white dark:bg-slate-800 dark:border-slate-600">
                                {searching && (
                                    <li className="px-3 py-2 text-sm text-gray-400 italic">Searching…</li>
                                )}
                                {!searching && searchError && (
                                    <li className="px-3 py-2 text-sm text-red-500">Error: {searchError}</li>
                                )}
                                {!searching && results.map(g => (
                                    <li
                                        key={g.test_group_id}
                                        className="px-3 py-2 text-sm cursor-pointer hover:bg-indigo-50 dark:hover:bg-indigo-900"
                                        onMouseDown={e => { e.preventDefault(); handleSelect(g); }}
                                    >
                                        <span className="font-medium">{g.make} · {g.epa_carline_name}</span>
                                        <span className="text-gray-400 ml-2 text-xs">
                                            {g.model_year}{g.drive ? ` · ${g.drive}` : ''} · {g.test_group_id}
                                        </span>
                                    </li>
                                ))}
                                {!searching && !searchError && results.length === 0 && query.trim() && (
                                    <li className="px-3 py-2 text-sm text-gray-400 italic">No results</li>
                                )}
                            </ul>
                        )}
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                        Import test groups via Admin → Import → EPA Test Car Data, or create one by hand below.
                    </p>

                    {/* Create from scratch — for vehicles with only a lab-submission PDF */}
                    {!showCreate ? (
                        <button
                            type="button"
                            onClick={() => { setShowCreate(true); setCreateError(null); }}
                            className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline mt-2"
                        >
                            + Create EPA test group from scratch
                        </button>
                    ) : (
                        <div className="mt-2 border rounded-lg p-3 border-gray-200 dark:border-slate-700">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-semibold">New EPA test group</span>
                                <a href={EPA_SOURCE_URL} target="_blank" rel="noopener noreferrer"
                                    className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline">
                                    Find the Certified Test Group on EPA ↗
                                </a>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <label className="text-xs">
                                    <span className="text-gray-500 dark:text-slate-400">Test Group ID *</span>
                                    <input
                                        type="text" autoFocus
                                        value={createDraft.test_group_id}
                                        onChange={e => setCreateDraft(d => ({ ...d, test_group_id: e.target.value }))}
                                        placeholder="e.g. SRIVT00.0R2A"
                                        className="form-input text-xs w-full mt-0.5"
                                    />
                                </label>
                                <label className="text-xs">
                                    <span className="text-gray-500 dark:text-slate-400">Model year</span>
                                    <input
                                        type="number"
                                        value={createDraft.model_year}
                                        onChange={e => setCreateDraft(d => ({ ...d, model_year: e.target.value }))}
                                        className="form-input text-xs w-full mt-0.5"
                                    />
                                </label>
                                <label className="text-xs">
                                    <span className="text-gray-500 dark:text-slate-400">Manufacturer</span>
                                    <input
                                        type="text"
                                        value={createDraft.make}
                                        onChange={e => setCreateDraft(d => ({ ...d, make: e.target.value }))}
                                        placeholder="e.g. Rivian"
                                        className="form-input text-xs w-full mt-0.5"
                                    />
                                </label>
                                <label className="text-xs">
                                    <span className="text-gray-500 dark:text-slate-400">Carline</span>
                                    <input
                                        type="text"
                                        value={createDraft.epa_carline_name}
                                        onChange={e => setCreateDraft(d => ({ ...d, epa_carline_name: e.target.value }))}
                                        placeholder="e.g. R2"
                                        className="form-input text-xs w-full mt-0.5"
                                    />
                                </label>
                            </div>
                            {createError && <p className="text-xs text-red-500 mt-1">{createError}</p>}
                            <p className="text-[11px] text-gray-400 mt-1">
                                Creates and links the group; add coefficients, tests and phases in the curator fields afterward.
                            </p>
                            <div className="flex gap-2 mt-2">
                                <button type="button" onClick={handleCreate} disabled={creating}
                                    className="btn btn-primary text-xs py-1 px-3 disabled:opacity-50">
                                    {creating ? 'Creating…' : 'Create & link'}
                                </button>
                                <button type="button" onClick={() => setShowCreate(false)} disabled={creating}
                                    className="btn btn-secondary text-xs py-1 px-3">
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

/**
 * EPA testing data section — shown in the Tests & Data (RunsView) per-vehicle panel.
 *
 * Shows:
 *   • A card for each linked EPA test group (coefficients, cycle results, label values)
 *   • An "Assign EPA Testing Data" combobox for linking additional test groups
 *   • Unlink controls (contributor+)
 */
import { useState, useRef, useMemo } from 'react';
import InfoIcon from './InfoIcon';
import SectionHeader, { SectionAction } from './SectionHeader';
import { EPA_EXPLAINERS } from '../utils/epaExplainers';
import DerivedValues from './epa/DerivedValues';
import EpaDerivationChecks from './epa/EpaDerivationChecks';
import EpaCuratorEditor from './epa/EpaCuratorEditor';
import FeGuidePicker from './epa/FeGuidePicker';
import { epaRecordFromGroup } from '../utils/epaRecordFromGroup';
import { buildMethodologyModel } from '../utils/epaMethodology';
import { checkUnadjustedMpge, checkStatedRanges, checkLabelInvariant } from '../utils/epaDerivationCheck';
import { checkRecordIntegrity } from '../utils/epaIntegrity';
import LazyBoundary from './LazyBoundary';
import { EpaPdfImportModal } from './lazyComponents';
import { useAppContext } from '../context/AppContext';

const CONFIDENCE_COLORS = {
    verified: 'text-green-700 bg-green-50 border-green-200 dark:text-green-300 dark:bg-green-900/30 dark:border-green-700',
    likely:   'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-900/30 dark:border-amber-700',
    inferred: 'text-muted bg-[var(--color-surface-muted)] border-[var(--color-border)]',
};

function ConfidenceBadge({ confidence }) {
    return (
        <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${CONFIDENCE_COLORS[confidence] ?? CONFIDENCE_COLORS.inferred}`}>
            {confidence}
        </span>
    );
}

/** One row of a label/value table inside the card. */
/** Figures the card prints, or a dash. Nulls read as "not known", not as zero. */
const mpge  = (v) => (v != null && v < 500) ? v.toFixed(0) : null;
const miles = (v) => v != null ? `${v.toFixed(0)} mi` : null;

/**
 * Which EPA cycles this group's stored tests actually drove.
 *
 * From the phases, not from the label's declared method: `Calc Approach Desc`
 * says "5-cycle label" on records whose adjustment is exactly the flat 0.7
 * factor, so it does not describe what was driven (#206).
 */
function cyclesTested(group) {
    const phases = (group?.epa_tests ?? []).flatMap(t => t.epa_test_phases ?? []);
    const counts = new Map();
    for (const p of phases) {
        if (!p.phase_type) continue;
        counts.set(p.phase_type, (counts.get(p.phase_type) ?? 0) + 1);
    }
    if (counts.size) {
        return [...counts.entries()].map(([type, n]) => n > 1 ? `${type}x${n}` : type).join(' · ');
    }
    // No phases stored: fall back to naming the procedures that ran.
    const procs = [...new Set((group?.epa_tests ?? []).map(t => t.procedure_code).filter(Boolean))];
    return procs.length ? procs.map(c => `proc ${c}`).join(' · ') : null;
}

function DataRow({ label, value, muted, always = false }) {
    // `always` holds the row when the figure is absent, so a column keeps the
    // shape it was specified with. Without it a group with no label data showed
    // two bare headings and read as broken rather than as empty.
    if (value == null && !always) return null;
    return (
        <div className="flex justify-between gap-4 py-0.5">
            <span className="text-muted shrink-0">{label}</span>
            <span className={`font-mono text-right ${muted || value == null ? 'text-faint' : ''}`}>
                {value ?? '—'}
            </span>
        </div>
    );
}

/** Card displaying the data for one EPA test group mapping. */
function EpaGroupCard({ mapping, vehicle, canEdit, onUnlink, onDelete, onUpdateConfidence, onUpdateDisplayName, onGroupChanged }) {
    const [unlinking,    setUnlinking]    = useState(false);
    const [deleting,     setDeleting]     = useState(false);
    const [updatingConf, setUpdatingConf] = useState(false);
    const [draftName,    setDraftName]    = useState(null); // null = not editing
    const [savingName,   setSavingName]   = useState(false);
    const [curating,     setCurating]     = useState(false);
    const [curatorDirty, setCuratorDirty] = useState(false);
    const g = mapping.epaGroup;

    // Recomputed on render like every other derived figure here — nothing is
    // stored, so a corrected phase shows its effect immediately.
    const derivationChecks = useMemo(() => {
        const { record, inferredPhaseTypes, competingMctTests, derivedFrom, statedRanges }
            = epaRecordFromGroup(g);
        const model = record ? buildMethodologyModel(record) : null;
        // The ranges belonging to the test the phases came from, not the
        // group's headline pair — on a group holding two multi-cycle tests
        // those are different figures (#227).
        const rangeCheck = checkStatedRanges(model, {
            cityMi: statedRanges?.cityMi,
            hwyMi:  statedRanges?.hwyMi,
        });
        return {
            check: checkUnadjustedMpge(model, { city: g?.unadj_city_mpge, hwy: g?.unadj_hwy_mpge }),
            rangeCheck,
            invariant: checkLabelInvariant(model, {
                bagsReconcile: rangeCheck.checked ? rangeCheck.worst === 'agrees' : null,
            }),
            // What is ACTUALLY being applied, and where it came from. Passing
            // only adjustmentFixed made the invariant message report 0.700 even
            // when a linked guide row had already supplied the real factor.
            adjustmentUsed:   model?.adjustment ?? null,
            adjustmentSource: model?.adjustmentSource ?? null,
            adjustmentFixed: model?.adjustmentFixed ?? 0.7,
            // Answerable from the record alone, so unlike the three checks above
            // it runs whether or not a guide row has ever been linked.
            integrity: checkRecordIntegrity(g),
            inferredPhaseTypes,
            competingMctTests,
            derivedFrom,
        };
    }, [g]);
    if (!g) return null;

    // Guard collapse: confirm before discarding unsaved buffered curator edits.
    const toggleCurate = () => {
        if (curating) {
            if (curatorDirty && !window.confirm('You have unsaved curator edits. Discard them and close?')) return;
            setCuratorDirty(false);
            setCurating(false);
        } else {
            setCuratorDirty(false);
            setCurating(true);
        }
    };

    // Coefficients now live on the primary coefficient set, not flat columns.
    const coeff = (g.epa_coefficient_sets || []).find(s => s.is_primary)
        || (g.epa_coefficient_sets || [])[0] || {};

    const handleUnlink = async () => {
        setUnlinking(true);
        try { await onUnlink(mapping.id); } finally { setUnlinking(false); }
    };

    const handleDelete = async () => {
        if (!window.confirm(
            `Delete EPA test group "${g.test_group_id}" entirely?\n\n` +
            `This removes its coefficients, tests and phases and unlinks it from ALL vehicles. ` +
            `It cannot be undone. (Use "Unlink" to only detach it from this vehicle.)`
        )) return;
        setDeleting(true);
        try { await onDelete?.(g.test_group_id); } finally { setDeleting(false); }
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
                            className="form-input text-sm font-semibold py-0.5 w-full disabled:opacity-50 placeholder:text-[var(--color-text-faint)] placeholder:font-normal placeholder:italic"
                            title="Friendly display name used in charts. Leave blank to use the EPA carline name."
                        />
                    ) : (
                        <div className="font-semibold text-sm truncate">
                            {g.display_name || g.epa_carline_name}
                        </div>
                    )}
                    {/* Show raw EPA name as subtitle when a display name is set or being edited */}
                    {(g.display_name || draftName !== null) && (
                        <div className="text-xs text-faint italic truncate mt-0.5">{g.epa_carline_name}</div>
                    )}
                    <div className="text-xs text-muted mt-0.5">
                        {g.model_year}{g.make ? ` · ${g.make}` : ''}{g.drive ? ` · ${g.drive}` : ''}
                        {g.transmission ? ` · ${g.transmission}` : ''}
                    </div>
                    <div className="font-mono text-xs text-faint mt-0.5">
                        {g.test_group_id}
                        {g.epa_test_family_id && g.epa_test_family_id !== g.test_group_id && (
                            <span className="ml-1 text-faint">· family: {g.epa_test_family_id}</span>
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
                            disabled={unlinking || deleting}
                            onClick={handleUnlink}
                            className="btn btn-secondary text-xs py-0.5 px-2 disabled:opacity-40"
                            title="Detach this test group from this vehicle (keeps the shared record)"
                        >
                            {unlinking ? '…' : 'Unlink'}
                        </button>
                    )}
                    {canEdit && onDelete && (
                        <button
                            type="button"
                            disabled={unlinking || deleting}
                            onClick={handleDelete}
                            className="btn btn-danger text-xs py-0.5 px-2 disabled:opacity-40"
                            title="Delete the shared test group and all its data (affects every linked vehicle)"
                        >
                            {deleting ? '…' : 'Delete'}
                        </button>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-1 text-xs">

                <div>
                    <div className="text-faint text-[10px] uppercase tracking-wide mb-1 font-semibold">
                        Test Setup
                    </div>
                    <DataRow always label="Test weight" value={coeff.equiv_test_weight_lbs != null ? coeff.equiv_test_weight_lbs.toLocaleString() + ' lbs' : null} />
                    <DataRow always label="Config" value={g.vehicle_config_number} />
                    {/* What was actually driven. Read from the stored phases
                        rather than from the label's declared method, which says
                        "5-cycle" on records whose adjustment is the flat 0.7
                        factor and cannot be trusted (#206). */}
                    <DataRow always label="Cycles tested" value={cyclesTested(g)} />
                </div>

                <div>
                    <div className="text-faint text-[10px] uppercase tracking-wide mb-1 font-semibold">
                        Label Efficiency
                    </div>
                    <DataRow always label="MPGe combined" value={mpge(g.label_combined_mpge)} />
                    <DataRow always label="MPGe city"     value={mpge(g.label_city_mpge)} />
                    <DataRow always label="MPGe highway"  value={mpge(g.label_hwy_mpge)} />
                </div>

                <div>
                    <div className="text-faint text-[10px] uppercase tracking-wide mb-1 font-semibold">
                        Label Range
                    </div>
                    {/* Combined above city and highway, matching the efficiency
                        column: it is the headline figure, and seeing city sit
                        well above it is the point. */}
                    <DataRow always label="Range combined" value={miles(g.label_range_published)} />
                    <DataRow always label="Range city"     value={miles(g.label_city_range_mi)} />
                    <DataRow always label="Range highway"  value={miles(g.label_hwy_range_mi)} />
                </div>

                <DerivedValues group={g} vehicle={vehicle} />

                {/* Does this record reconcile? Beside the data it judges, so a
                    phase can be corrected in the same view it is questioned in. */}
                <EpaDerivationChecks {...derivationChecks} />
            </div>

            {/* The link that fills Label Results, beside the figures it fills —
                it was behind the curator disclosure, which is two clicks from
                the only place its effect is visible.

                Curators only. It is a curation tool: a reader gets nothing from
                a list of candidate guide rows, and rendering it for everyone
                also ran a candidate query on every anonymous card view. Same
                gate as the curator form below, because the writes behind it are
                contributor-only at the RLS layer anyway — showing the controls
                to anyone else offers buttons that would be refused. */}
            {canEdit && (
                <FeGuidePicker group={g} canEdit={canEdit} onChanged={onGroupChanged} />
            )}

            {mapping.notes && (
                <p className="mt-2 text-xs text-muted italic border-t pt-2">{mapping.notes}</p>
            )}

            {/* Curator form — contributor/admin only */}
            {canEdit && (
                <>
                    <button
                        type="button"
                        onClick={toggleCurate}
                        className="mt-3 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                        {curating ? '▾ Hide curator fields' : '▸ Curate fields & test data'}
                        {curating && curatorDirty && <span className="ml-1 text-amber-500" title="Unsaved edits">●</span>}
                    </button>
                    {curating && (
                        <EpaCuratorEditor
                            testGroupId={g.test_group_id}
                            canEdit={canEdit}
                            onDirtyChange={setCuratorDirty}
                            vehicle={vehicle}
                        />
                    )}
                </>
            )}
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

const EPA_SOURCE_URL = 'https://dis.epa.gov/otaqpub/publist1.jsp';

export default function EpaVehicleSection({ vehicle, canEdit, searchEpaTestGroups, onLink, onCreate, onUnlink, onUpdateConfidence, onUpdateDisplayName, onGroupChanged }) {
    const [query, setQuery]               = useState('');
    const [results, setResults]           = useState([]);
    const [searching, setSearching]       = useState(false);
    const [searchError, setSearchError]   = useState(null);
    const [showDropdown, setShowDropdown] = useState(false);
    const [linking, setLinking]           = useState(false);
    const [showPdfModal, setShowPdfModal] = useState(false);
    const { importEpaCsiGroups, getExistingEpaTestGroupIds, deleteEpaTestGroup } = useAppContext();
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
            <SectionHeader
                title="EPA Testing Data"
                info={<InfoIcon text={EPA_EXPLAINERS.steadyStateCurve} position="right" className="ml-1" />}
                actions={canEdit && (
                    <>
                        <SectionAction onClick={() => setShowPdfModal(true)}>📑 Import from EPA lab PDF</SectionAction>
                        <SectionAction onClick={() => { setShowCreate(true); setCreateError(null); }}>
                            + Create EPA test group from scratch
                        </SectionAction>
                    </>
                )}
                trailing={
                    <a
                        href={EPA_SOURCE_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap"
                        title="EPA Annual Certification Data — look up Test Groups, coefficients, and lab reports"
                    >
                        EPA source data ↗
                    </a>
                }
            />

            {/* Linking is the first thing a curator wants here, so it leads rather
                than trailing the list it adds to. Contributors only. */}
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
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-faint">Linking…</span>
                        )}
                        {showDropdown && (results.length > 0 || searching || searchError) && (
                            <ul className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border shadow-lg bg-[var(--color-surface-input)] border-[var(--color-border)]">
                                {searching && (
                                    <li className="px-3 py-2 text-sm text-faint italic">Searching…</li>
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
                                        <span className="text-faint ml-2 text-xs">
                                            {g.model_year}{g.drive ? ` · ${g.drive}` : ''} · {g.test_group_id}
                                        </span>
                                    </li>
                                ))}
                                {!searching && !searchError && results.length === 0 && query.trim() && (
                                    <li className="px-3 py-2 text-sm text-faint italic">No results</li>
                                )}
                            </ul>
                        )}
                    </div>
                    <p className="text-xs text-faint mt-1">
                        Import an EPA lab PDF, the Test Car Data CSV (Admin), or create one by hand below.
                    </p>

                    {/* Import from lab PDF — parses + links the matching config to this vehicle */}
                    <button
                        type="button"
                        onClick={() => setShowPdfModal(true)}
                        className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline mt-2 mr-4"
                    >
                        📑 Import from EPA lab PDF
                    </button>
                    {showPdfModal && (
                        <LazyBoundary>
                            <EpaPdfImportModal
                                targetVehicle={vehicle}
                                onImport={importEpaCsiGroups}
                                getExistingIds={getExistingEpaTestGroupIds}
                                onClose={() => setShowPdfModal(false)}
                            />
                        </LazyBoundary>
                    )}

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
                        <div className="mt-2 border rounded-lg p-3 border-[var(--color-border)]">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-semibold">New EPA test group</span>
                                <a href={EPA_SOURCE_URL} target="_blank" rel="noopener noreferrer"
                                    className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline">
                                    Find the Certified Test Group on EPA ↗
                                </a>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <label className="text-xs">
                                    <span className="text-muted">Test Group ID *</span>
                                    <input
                                        type="text" autoFocus
                                        value={createDraft.test_group_id}
                                        onChange={e => setCreateDraft(d => ({ ...d, test_group_id: e.target.value }))}
                                        placeholder="e.g. SRIVT00.0R2A"
                                        className="form-input text-xs w-full mt-0.5"
                                    />
                                </label>
                                <label className="text-xs">
                                    <span className="text-muted">Model year</span>
                                    <input
                                        type="number"
                                        value={createDraft.model_year}
                                        onChange={e => setCreateDraft(d => ({ ...d, model_year: e.target.value }))}
                                        className="form-input text-xs w-full mt-0.5"
                                    />
                                </label>
                                <label className="text-xs">
                                    <span className="text-muted">Manufacturer</span>
                                    <input
                                        type="text"
                                        value={createDraft.make}
                                        onChange={e => setCreateDraft(d => ({ ...d, make: e.target.value }))}
                                        placeholder="e.g. Rivian"
                                        className="form-input text-xs w-full mt-0.5"
                                    />
                                </label>
                                <label className="text-xs">
                                    <span className="text-muted">Carline</span>
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
                            <p className="text-[11px] text-faint mt-1">
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

            {/* Existing mappings */}
            {mappings.length === 0 ? (
                <p className="text-sm text-muted mb-3">
                    No EPA test group linked yet.
                    {canEdit && ' Use the search below to assign one.'}
                </p>
            ) : (
                mappings.map(m => (
                    <EpaGroupCard
                        key={m.id}
                        mapping={m}
                        vehicle={vehicle}
                        canEdit={canEdit}
                        onGroupChanged={onGroupChanged}
                        onUnlink={onUnlink}
                        onDelete={deleteEpaTestGroup}
                        onUpdateConfidence={onUpdateConfidence}
                        onUpdateDisplayName={onUpdateDisplayName}
                    />
                ))
            )}

        </div>
    );
}

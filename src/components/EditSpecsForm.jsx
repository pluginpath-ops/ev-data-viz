import { useState, useEffect, useRef } from 'react';
import { useAppContext } from '../context/AppContext';
import { SPEC_CATEGORIES, normalizeCustomKey, formatCustomKey } from '../utils/vehicleSpecSchema';
import { SpecVouchButton, SpecFieldFlagButton } from './VoteButtons';
import { vehicleLabel, resolveEffectiveSpecs } from '../utils/specHelpers';

/**
 * Modal form for editing all spec categories of a vehicle.
 * Categories are collapsed by default — user expands only what they want to fill in.
 *
 * Props:
 *   vehicle                   — the vehicle object (id + current specs)
 *   specCustomFieldSuggestions — { [category]: Set<normalizedKey> } for autocomplete
 *   onSave                    — async (vehicleId, specs, specSourceVehicleId?) => void
 *   onClose                   — () => void
 */

/** Build an initial local state from existing specs, defaulting missing keys to null. */
function buildInitialSpecs(existingSpecs) {
    const result = {};
    for (const cat of SPEC_CATEGORIES) {
        const existing = existingSpecs?.[cat.key] || {};
        result[cat.key] = {
            ...cat.fields.reduce((acc, f) => {
                acc[f.key] = existing[f.key] !== undefined ? existing[f.key] : null;
                return acc;
            }, {}),
            _custom: { ...(existing._custom || {}) },
        };
    }
    return result;
}

/** Strip null/empty predefined fields; drop empty categories to keep the blob minimal. */
function cleanSpecs(localSpecs) {
    const result = {};
    for (const cat of SPEC_CATEGORIES) {
        const catData = localSpecs[cat.key];
        const cleaned = {};
        for (const f of cat.fields) {
            const v = catData[f.key];
            if (v !== null && v !== undefined && v !== '') {
                cleaned[f.key] = v;
            }
        }
        const hasValues = Object.keys(cleaned).length > 0;
        const hasCustom = Object.keys(catData._custom || {}).length > 0;
        if (hasValues || hasCustom) {
            result[cat.key] = { ...cleaned, _custom: { ...(catData._custom || {}) } };
        }
    }
    return result;
}

/**
 * Build a "full" export object — includes every predefined field (null if blank)
 * so the recipient can see what's missing and fill it in.
 */
function buildExportSpecs(vehicle, localSpecs) {
    const full = {};
    for (const cat of SPEC_CATEGORIES) {
        const catData = localSpecs[cat.key] || {};
        const catOut  = {};
        for (const f of cat.fields) {
            catOut[f.key] = catData[f.key] !== undefined ? catData[f.key] : null;
        }
        const custom = catData._custom;
        if (custom && Object.keys(custom).length > 0) catOut._custom = { ...custom };
        full[cat.key] = catOut;
    }
    return {
        vehicleId:   vehicle.id,
        vehicleName: vehicle.name,
        specs:       full,
    };
}

/** Merge an imported specs object (or full export envelope) into localSpecs state. */
function mergeImportedSpecs(raw, setLocalSpecs, setImportError) {
    try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const incoming = parsed?.specs ?? parsed;
        if (typeof incoming !== 'object' || Array.isArray(incoming)) throw new Error();
        setLocalSpecs(prev => {
            const next = { ...prev };
            for (const cat of SPEC_CATEGORIES) {
                if (!incoming[cat.key]) continue;
                const catData = incoming[cat.key];
                next[cat.key] = { ...next[cat.key] };
                for (const f of cat.fields) {
                    if (catData[f.key] !== undefined) next[cat.key][f.key] = catData[f.key];
                }
                if (catData._custom) {
                    next[cat.key]._custom = { ...next[cat.key]._custom, ...catData._custom };
                }
            }
            return next;
        });
        setImportError(null);
    } catch {
        setImportError('Invalid JSON — could not import specs.');
    }
}

/** Format an inherited value for display in a hint line. */
function fmtInheritedHint(value, field) {
    if (value === null || value === undefined) return null;
    if (field.type === 'boolean') return value === true ? 'Yes' : value === false ? 'No' : null;
    return String(value);
}

function SpecField({ field, value, onChange, inheritedValue }) {
    const hasInherited = inheritedValue !== null && inheritedValue !== undefined;
    const isEmpty      = value === null || value === undefined || value === '';
    const hint         = hasInherited && isEmpty ? fmtInheritedHint(inheritedValue, field) : null;

    if (field.type === 'boolean') {
        const selectValue = value === true ? 'yes' : value === false ? 'no' : '';
        return (
            <div>
                <select
                    className="form-input text-sm w-full"
                    value={selectValue}
                    onChange={e => {
                        const v = e.target.value;
                        onChange(v === 'yes' ? true : v === 'no' ? false : null);
                    }}
                >
                    <option value="">—</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                </select>
                {hint && <p className="text-xs text-indigo-400 mt-0.5 pl-0.5">↑ {hint}</p>}
            </div>
        );
    }
    if (field.type === 'enum') {
        return (
            <div>
                <select
                    className="form-input text-sm w-full"
                    value={value ?? ''}
                    onChange={e => onChange(e.target.value || null)}
                >
                    <option value="">—</option>
                    {field.options.map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                    ))}
                </select>
                {hint && <p className="text-xs text-indigo-400 mt-0.5 pl-0.5">↑ {hint}</p>}
            </div>
        );
    }
    if (field.type === 'integer') {
        return (
            <input
                type="number"
                step="1"
                className="form-input text-sm w-full"
                value={value ?? ''}
                placeholder={hint ?? undefined}
                onChange={e => onChange(e.target.value === '' ? null : parseInt(e.target.value, 10))}
            />
        );
    }
    if (field.type === 'number') {
        return (
            <input
                type="number"
                step="any"
                className="form-input text-sm w-full"
                value={value ?? ''}
                placeholder={hint ?? undefined}
                onChange={e => onChange(e.target.value === '' ? null : parseFloat(e.target.value))}
            />
        );
    }
    // text
    return (
        <input
            type="text"
            className="form-input text-sm w-full"
            value={value ?? ''}
            placeholder={hint ?? undefined}
            onChange={e => onChange(e.target.value || null)}
        />
    );
}

export default function EditSpecsForm({ vehicle, specCustomFieldSuggestions, onSave, onClose }) {
    const { vehicles, specVouches, loadSpecVouches, flagSpecField, unflagSpecField, isAdmin } = useAppContext();

    const [localSpecs, setLocalSpecs] = useState(() => buildInitialSpecs(vehicle.specs));
    const [openCategories, setOpenCategories] = useState(() => new Set(SPEC_CATEGORIES.map(c => c.key)));
    const [saving, setSaving] = useState(false);
    const [importError, setImportError] = useState(null);
    const fileInputRef = useRef(null);
    // Per-category "add custom field" input state
    const [newCustomKey, setNewCustomKey] = useState({});
    const [newCustomVal, setNewCustomVal] = useState({});
    // Spec inheritance
    const [inheritFromId, setInheritFromId] = useState(
        vehicle.spec_source_vehicle_id ? String(vehicle.spec_source_vehicle_id) : ''
    );
    const [parentSearch, setParentSearch] = useState('');
    const [showParentDropdown, setShowParentDropdown] = useState(false);

    // Load vouch count for display in footer
    useEffect(() => { loadSpecVouches(vehicle.id); }, [vehicle.id]);
    const vouches = specVouches[vehicle.id] ?? { count: 0, myVouch: false };

    // Read flagged_specs from live context so admin unflag reflects immediately
    const liveVehicle = vehicles.find(v => v.id === vehicle.id) || vehicle;
    const flaggedSpecs = liveVehicle.flagged_specs || [];

    // Source vehicle specs for inheritance hints — resolve the full ancestor chain
    // so hints show the value that would actually be inherited (not just direct parent's own fields).
    const sourceVehicle  = inheritFromId ? vehicles.find(v => String(v.id) === inheritFromId) : null;
    const inheritedSpecs = sourceVehicle
        ? resolveEffectiveSpecs(sourceVehicle, vehicles, new Set([vehicle.id]))
        : {};

    // Build the set of descendant IDs so we can exclude them from the parent picker
    // (selecting a descendant as parent would create a circular inheritance chain).
    const getDescendantIds = (rootId, allVehicles, visited = new Set()) => {
        const ids = new Set();
        for (const v of allVehicles) {
            if (v.spec_source_vehicle_id === rootId && !visited.has(v.id)) {
                ids.add(v.id);
                const childVisited = new Set([...visited, v.id]);
                for (const d of getDescendantIds(v.id, allVehicles, childVisited)) ids.add(d);
            }
        }
        return ids;
    };
    const descendantIds = getDescendantIds(vehicle.id, vehicles || []);

    // Other vehicles available as inheritance sources (excluding self and descendants)
    const otherVehicles = (vehicles || [])
        .filter(v => v.id !== vehicle.id && !descendantIds.has(v.id))
        .sort((a, b) => vehicleLabel(a).localeCompare(vehicleLabel(b)));

    // Filtered list for combobox
    const parentSearchLower = parentSearch.toLowerCase();
    const filteredParents = parentSearch
        ? otherVehicles.filter(v => vehicleLabel(v).toLowerCase().includes(parentSearchLower))
        : otherVehicles;

    // Label for the currently-selected parent (shown in the closed combobox)
    const selectedParentLabel = inheritFromId
        ? vehicleLabel(otherVehicles.find(v => String(v.id) === inheritFromId) || {})
        : '';

    const toggleCategory = (key) => {
        setOpenCategories(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const setFieldValue = (catKey, fieldKey, value) => {
        setLocalSpecs(prev => ({
            ...prev,
            [catKey]: { ...prev[catKey], [fieldKey]: value },
        }));
    };

    const setCustomValue = (catKey, customKey, value) => {
        setLocalSpecs(prev => ({
            ...prev,
            [catKey]: {
                ...prev[catKey],
                _custom: { ...prev[catKey]._custom, [customKey]: value },
            },
        }));
    };

    const removeCustomField = (catKey, customKey) => {
        setLocalSpecs(prev => {
            const custom = { ...prev[catKey]._custom };
            delete custom[customKey];
            return { ...prev, [catKey]: { ...prev[catKey], _custom: custom } };
        });
    };

    const addCustomField = (catKey) => {
        const rawKey = newCustomKey[catKey] || '';
        const val = newCustomVal[catKey] || '';
        if (!rawKey.trim() || !val.trim()) return;
        const normalized = normalizeCustomKey(rawKey);
        // Don't let custom key collide with a predefined field key
        const cat = SPEC_CATEGORIES.find(c => c.key === catKey);
        if (cat?.fields.some(f => f.key === normalized)) return;
        setLocalSpecs(prev => ({
            ...prev,
            [catKey]: {
                ...prev[catKey],
                _custom: { ...prev[catKey]._custom, [normalized]: val },
            },
        }));
        setNewCustomKey(prev => ({ ...prev, [catKey]: '' }));
        setNewCustomVal(prev => ({ ...prev, [catKey]: '' }));
    };

    const handleExport = () => {
        const data = buildExportSpecs(vehicle, localSpecs);
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `${(vehicle.name || 'vehicle').replace(/\s+/g, '_')}-specs.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => mergeImportedSpecs(ev.target.result, setLocalSpecs, setImportError);
        reader.readAsText(file);
        e.target.value = ''; // reset so same file can be re-imported
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const cleaned = cleanSpecs(localSpecs);
            await onSave(vehicle.id, cleaned, inheritFromId || null);
            onClose();
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div
                className="modal-panel rounded-xl shadow-2xl w-full mx-4"
                style={{ maxWidth: '640px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="modal-header px-6 pt-5 pb-3">
                    <h3 className="section-title mb-0">Edit Specs — {vehicle.name}</h3>
                    <button
                        onClick={onClose}
                        className="text-faint hover:text-secondary text-xl leading-none"
                        aria-label="Close"
                    >
                        ×
                    </button>
                </div>

                {/* Scrollable body */}
                <div className="modal-body flex-1 overflow-y-auto">

                    {/* ── Inherit from selector (combobox) ── */}
                    <div className="mb-4 pb-4 border-b">
                        <div className="flex items-center gap-3">
                            <label className="text-sm font-medium text-secondary whitespace-nowrap">Inherit from:</label>
                            <div className="relative flex-1">
                                {showParentDropdown ? (
                                    <input
                                        autoFocus
                                        type="text"
                                        value={parentSearch}
                                        onChange={e => setParentSearch(e.target.value)}
                                        onBlur={() => setTimeout(() => setShowParentDropdown(false), 150)}
                                        placeholder="Type to filter vehicles…"
                                        className="form-input text-sm w-full"
                                    />
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => { setParentSearch(''); setShowParentDropdown(true); }}
                                        className="form-input text-sm w-full text-left truncate"
                                    >
                                        {selectedParentLabel || <span className="text-faint">— None —</span>}
                                    </button>
                                )}
                                {showParentDropdown && (
                                    <ul className="absolute z-50 mt-1 w-full max-h-52 overflow-y-auto rounded-lg border shadow-lg bg-[var(--color-surface-input)] border-[var(--color-border)]">
                                        <li
                                            className="px-3 py-2 text-sm cursor-pointer text-faint hover:bg-[var(--color-surface-sunken)]"
                                            onMouseDown={() => {
                                                setInheritFromId('');
                                                setShowParentDropdown(false);
                                                setParentSearch('');
                                            }}
                                        >
                                            — None —
                                        </li>
                                        {filteredParents.map(v => (
                                            <li
                                                key={v.id}
                                                className={`px-3 py-2 text-sm cursor-pointer hover:bg-indigo-50 dark:hover:bg-indigo-900 ${String(v.id) === inheritFromId ? 'font-semibold text-indigo-600 dark:text-indigo-300' : ''}`}
                                                onMouseDown={() => {
                                                    setInheritFromId(String(v.id));
                                                    setShowParentDropdown(false);
                                                    setParentSearch('');
                                                }}
                                            >
                                                {vehicleLabel(v)}
                                            </li>
                                        ))}
                                        {filteredParents.length === 0 && (
                                            <li className="px-3 py-2 text-sm text-faint italic">No matches</li>
                                        )}
                                    </ul>
                                )}
                            </div>
                            {inheritFromId && (
                                <button
                                    type="button"
                                    onClick={() => setInheritFromId('')}
                                    className="text-faint hover:text-secondary text-lg leading-none flex-shrink-0"
                                    title="Clear inheritance"
                                >×</button>
                            )}
                        </div>
                        {sourceVehicle && (
                            <p className="text-xs text-indigo-500 mt-1.5">
                                Fields you leave blank will show <span className="font-medium">↑ inherited</span> hints.
                            </p>
                        )}
                    </div>

                    <div className="flex items-center justify-between mb-4">
                        <p className="text-sm text-muted">Fields left blank are not saved.</p>
                        <button
                            type="button"
                            onClick={() => {
                                const allOpen = openCategories.size === SPEC_CATEGORIES.length;
                                setOpenCategories(allOpen ? new Set() : new Set(SPEC_CATEGORIES.map(c => c.key)));
                            }}
                            className="text-xs text-blue-600 hover:text-blue-800 underline flex-shrink-0 ml-4"
                        >
                            {openCategories.size === SPEC_CATEGORIES.length ? 'Collapse All' : 'Expand All'}
                        </button>
                    </div>

                    {SPEC_CATEGORIES.map(cat => {
                        const isOpen = openCategories.has(cat.key);
                        const catData = localSpecs[cat.key];
                        const customEntries = Object.entries(catData._custom || {});
                        const suggestions = [...(specCustomFieldSuggestions?.[cat.key] || new Set())];
                        const datalistId = `specs-custom-suggestions-${cat.key}`;
                        const inheritedCat = inheritedSpecs?.[cat.key] ?? {};

                        return (
                            <div key={cat.key} className="specs-category">
                                <button
                                    type="button"
                                    className="specs-category-header"
                                    onClick={() => toggleCategory(cat.key)}
                                >
                                    <span
                                        className="specs-chevron"
                                        style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
                                    >
                                        ▶
                                    </span>
                                    {cat.label}
                                </button>

                                {isOpen && (
                                    <div className="mt-2 mb-3">
                                        {/* Predefined fields */}
                                        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                                            {cat.fields.map(field => {
                                                const fieldKey = `${cat.key}.${field.key}`;
                                                const isFlagged = flaggedSpecs.includes(fieldKey);
                                                const inheritedValue = sourceVehicle
                                                    ? inheritedCat[field.key] ?? null
                                                    : undefined;
                                                return (
                                                    <div key={field.key}>
                                                        <label className="block text-xs text-muted mb-0.5 flex items-center gap-1">
                                                            {field.label}
                                                            {isFlagged && (
                                                                <SpecFieldFlagButton
                                                                    isFlagged={true}
                                                                    onUnflag={() => unflagSpecField(vehicle.id, fieldKey)}
                                                                    isAdmin={isAdmin}
                                                                />
                                                            )}
                                                        </label>
                                                        <SpecField
                                                            field={field}
                                                            value={catData[field.key]}
                                                            onChange={v => setFieldValue(cat.key, field.key, v)}
                                                            inheritedValue={inheritedValue}
                                                        />
                                                    </div>
                                                );
                                            })}
                                        </div>

                                        {/* Custom fields */}
                                        {(
                                            <div className="mt-3 pt-2 border-t">
                                                <p className="text-xs text-faint mb-1.5">Custom fields</p>
                                                {customEntries.map(([key, val]) => (
                                                    <div key={key} className="specs-custom-row mb-1.5">
                                                        <span className="text-xs text-muted w-32 flex-shrink-0 truncate" title={formatCustomKey(key)}>
                                                            {formatCustomKey(key)}
                                                        </span>
                                                        <input
                                                            type="text"
                                                            className="form-input text-sm flex-1"
                                                            value={val}
                                                            onChange={e => setCustomValue(cat.key, key, e.target.value)}
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() => removeCustomField(cat.key, key)}
                                                            className="text-red-400 hover:text-red-600 text-sm px-1"
                                                            title="Remove field"
                                                        >
                                                            ×
                                                        </button>
                                                    </div>
                                                ))}

                                                {/* Add custom field row */}
                                                <datalist id={datalistId}>
                                                    {suggestions
                                                        .filter(s => !(catData._custom || {})[s])
                                                        .map(s => <option key={s} value={formatCustomKey(s)} />)
                                                    }
                                                </datalist>
                                                <div className="specs-add-custom-row">
                                                    <input
                                                        type="text"
                                                        list={datalistId}
                                                        placeholder="Field name"
                                                        className="form-input text-sm flex-1"
                                                        value={newCustomKey[cat.key] || ''}
                                                        onChange={e => setNewCustomKey(prev => ({ ...prev, [cat.key]: e.target.value }))}
                                                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomField(cat.key); } }}
                                                    />
                                                    <input
                                                        type="text"
                                                        placeholder="Value"
                                                        className="form-input text-sm flex-1"
                                                        value={newCustomVal[cat.key] || ''}
                                                        onChange={e => setNewCustomVal(prev => ({ ...prev, [cat.key]: e.target.value }))}
                                                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomField(cat.key); } }}
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => addCustomField(cat.key)}
                                                        className="px-2 py-1 rounded text-xs bg-[var(--color-surface-sunken)] hover:bg-[var(--color-surface-muted)] text-secondary flex-shrink-0"
                                                    >
                                                        Add
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Footer */}
                <div className="modal-footer flex-col gap-2 items-stretch">
                    {importError && (
                        <p className="text-xs text-red-500 w-full">{importError}</p>
                    )}
                    <div className="flex justify-between w-full">
                        <div className="flex gap-2 items-center">
                            <SpecVouchButton count={vouches.count} readOnly />
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".json,application/json"
                                className="hidden"
                                onChange={handleFileChange}
                            />
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                className="btn btn-secondary text-xs"
                                title="Import specs from a JSON file"
                            >
                                Import JSON
                            </button>
                            <button
                                type="button"
                                onClick={handleExport}
                                className="btn btn-secondary text-xs"
                                title="Export specs as JSON (includes blank fields)"
                            >
                                Export JSON
                            </button>
                        </div>
                        <div className="flex gap-2">
                            <button type="button" onClick={onClose} className="btn btn-secondary text-sm">
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleSave}
                                disabled={saving}
                                className="btn btn-primary text-sm"
                            >
                                {saving ? 'Saving…' : 'Save Specs'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

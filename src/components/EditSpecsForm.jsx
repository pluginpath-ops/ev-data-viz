import { useState, useEffect, useRef } from 'react';
import { useAppContext } from '../context/AppContext';
import { SPEC_CATEGORIES, normalizeCustomKey, formatCustomKey } from '../utils/vehicleSpecSchema';
import { SpecVouchButton, SpecFieldFlagButton } from './VoteButtons';

/**
 * Modal form for editing all spec categories of a vehicle.
 * Categories are collapsed by default — user expands only what they want to fill in.
 *
 * Props:
 *   vehicle                   — the vehicle object (id + current specs)
 *   specCustomFieldSuggestions — { [category]: Set<normalizedKey> } for autocomplete
 *   onSave                    — async (vehicleId, specs) => void
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

function SpecField({ field, value, onChange }) {
    if (field.type === 'boolean') {
        const selectValue = value === true ? 'yes' : value === false ? 'no' : '';
        return (
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
        );
    }
    if (field.type === 'enum') {
        return (
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
        );
    }
    if (field.type === 'integer') {
        return (
            <input
                type="number"
                step="1"
                className="form-input text-sm w-full"
                value={value ?? ''}
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

    // Load vouch count for display in footer
    useEffect(() => { loadSpecVouches(vehicle.id); }, [vehicle.id]);
    const vouches = specVouches[vehicle.id] ?? { count: 0, myVouch: false };

    // Read flagged_specs from live context so admin unflag reflects immediately
    const liveVehicle = vehicles.find(v => v.id === vehicle.id) || vehicle;
    const flaggedSpecs = liveVehicle.flagged_specs || [];

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
            await onSave(vehicle.id, cleaned);
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
                        className="text-gray-400 hover:text-gray-600 text-xl leading-none"
                        aria-label="Close"
                    >
                        ×
                    </button>
                </div>

                {/* Scrollable body */}
                <div className="modal-body flex-1 overflow-y-auto">
                    <div className="flex items-center justify-between mb-4">
                        <p className="text-sm text-gray-500">Fields left blank are not saved.</p>
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
                                                return (
                                                    <div key={field.key}>
                                                        <label className="block text-xs text-gray-500 mb-0.5 flex items-center gap-1">
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
                                                        />
                                                    </div>
                                                );
                                            })}
                                        </div>

                                        {/* Custom fields */}
                                        {(customEntries.length > 0 || true) && (
                                            <div className="mt-3 pt-2 border-t">
                                                <p className="text-xs text-gray-400 mb-1.5">Custom fields</p>
                                                {customEntries.map(([key, val]) => (
                                                    <div key={key} className="specs-custom-row mb-1.5">
                                                        <span className="text-xs text-gray-500 w-32 flex-shrink-0 truncate" title={formatCustomKey(key)}>
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
                                                        className="px-2 py-1 rounded text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 flex-shrink-0"
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

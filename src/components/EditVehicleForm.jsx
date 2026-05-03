// Shared vehicle edit form — used in VehiclesView (inline) and RunsView (modal).
// Lifted to module level so React never unmounts it mid-keystroke due to a new
// function reference being created inside a parent render.
import { useState, useRef, useCallback } from 'react';
import ReactCrop from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import InfoIcon from './InfoIcon';
import { EPA_EXPLAINERS } from '../utils/epaExplainers';

const ASPECT = 16 / 9;
const MAX_W = 1600;
const MAX_H = 900;

// Render the completed crop region to a canvas and return a JPEG blob,
// scaled down to fit within MAX_W × MAX_H if needed.
function getCroppedBlob(imgEl, completedCrop) {
    return new Promise((resolve, reject) => {
        const canvas = document.createElement('canvas');
        const scaleX = imgEl.naturalWidth / imgEl.width;
        const scaleY = imgEl.naturalHeight / imgEl.height;

        const naturalW = completedCrop.width * scaleX;
        const naturalH = completedCrop.height * scaleY;
        const scale = Math.min(1, MAX_W / naturalW, MAX_H / naturalH);

        canvas.width = Math.round(naturalW * scale);
        canvas.height = Math.round(naturalH * scale);

        const ctx = canvas.getContext('2d');
        ctx.drawImage(
            imgEl,
            completedCrop.x * scaleX,
            completedCrop.y * scaleY,
            naturalW,
            naturalH,
            0, 0,
            canvas.width,
            canvas.height,
        );
        canvas.toBlob(
            blob => blob ? resolve(blob) : reject(new Error('Canvas toBlob failed')),
            'image/jpeg',
            0.92,
        );
    });
}

// Confidence badge — same style as EpaCurvesView
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

export default function EditVehicleForm({
    formData, onFormChange,
    editingId,
    formTags, onAddTag, onRemoveTag,
    newTagName, onNewTagNameChange, onCreateTag,
    tags, availableTagsForForm,
    editingVehicle,
    imageUploading, onImageReady,
    onSubmit, onCancel,
    // Manufacturer
    manufacturers = [],
    onAddManufacturer,
    // EPA linking (edit mode only, contributor+)
    searchEpaTestGroups,
    onLinkEpaTestGroup,
    onUpdateEpaMapping,
    onUnlinkEpaTestGroup,
}) {
    const [imgSrc, setImgSrc] = useState('');
    const [crop, setCrop] = useState();
    const [completedCrop, setCompletedCrop] = useState(null);
    const imgRef = useRef(null);
    const fileInputRef = useRef(null);

    // New manufacturer inline creation
    const [showNewMfg, setShowNewMfg] = useState(false);
    const [newMfgName, setNewMfgName] = useState('');
    const [newMfgCountry, setNewMfgCountry] = useState('');
    const [mfgSaving, setMfgSaving] = useState(false);

    // ── EPA linking state ─────────────────────────────────────────────────────
    const [epaQuery, setEpaQuery]           = useState('');
    const [epaResults, setEpaResults]       = useState([]);
    const [epaSearching, setEpaSearching]   = useState(false);
    const [showEpaDropdown, setShowEpaDropdown] = useState(false);
    const [epaLinking, setEpaLinking]       = useState(false);  // in-flight link
    const [epaUnlinking, setEpaUnlinking]   = useState(null);   // mappingId being unlinked
    const epaDebounceRef = useRef(null);

    const handleFileSelect = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        // Reset input so the same file can be re-selected after cancel
        e.target.value = '';
        const reader = new FileReader();
        reader.onload = () => setImgSrc(reader.result);
        reader.readAsDataURL(file);
    };

    // Set an initial centered 16:9 crop once the image loads
    const onImageLoad = useCallback((e) => {
        const { width, height } = e.currentTarget;
        const cropW = Math.min(width, height * ASPECT);
        const cropH = cropW / ASPECT;
        const initial = {
            unit: 'px',
            x: (width - cropW) / 2,
            y: (height - cropH) / 2,
            width: cropW,
            height: cropH,
        };
        setCrop(initial);
        setCompletedCrop(initial);
    }, []);

    const handleCropConfirm = async () => {
        if (!completedCrop || !imgRef.current) return;
        const blob = await getCroppedBlob(imgRef.current, completedCrop);
        setImgSrc('');
        setCrop(undefined);
        setCompletedCrop(null);
        onImageReady(blob);
    };

    const handleCropCancel = () => {
        setImgSrc('');
        setCrop(undefined);
        setCompletedCrop(null);
    };

    // ── Manufacturer handlers ─────────────────────────────────────────────────

    const handleManufacturerChange = (e) => {
        const id = e.target.value ? parseInt(e.target.value, 10) : null;
        const mfg = manufacturers.find(m => m.id === id);
        onFormChange({
            ...formData,
            manufacturer_id: id || null,
            make: mfg ? mfg.name : formData.make,
        });
    };

    const handleCreateManufacturer = async () => {
        if (!newMfgName.trim() || !onAddManufacturer) return;
        setMfgSaving(true);
        try {
            const mfg = await onAddManufacturer(newMfgName.trim(), newMfgCountry.trim() || null);
            if (mfg) {
                onFormChange({ ...formData, manufacturer_id: mfg.id, make: mfg.name });
            }
            setNewMfgName('');
            setNewMfgCountry('');
            setShowNewMfg(false);
        } finally {
            setMfgSaving(false);
        }
    };


    // ── EPA linking handlers ──────────────────────────────────────────────────

    const handleEpaQueryChange = (e) => {
        const q = e.target.value;
        setEpaQuery(q);
        setShowEpaDropdown(true);
        if (epaDebounceRef.current) clearTimeout(epaDebounceRef.current);
        if (!q.trim()) { setEpaResults([]); return; }
        epaDebounceRef.current = setTimeout(async () => {
            setEpaSearching(true);
            try {
                // No year filter — EPA model years often differ from the vehicle's model year;
                // the year is visible in dropdown results for manual verification.
                const rows = await searchEpaTestGroups?.(q.trim());
                setEpaResults(rows || []);
            } catch {
                setEpaResults([]);
            } finally {
                setEpaSearching(false);
            }
        }, 300);
    };

    const handleEpaSelect = async (group) => {
        setShowEpaDropdown(false);
        setEpaQuery('');
        setEpaResults([]);
        if (!editingId || !onLinkEpaTestGroup) return;
        setEpaLinking(true);
        try {
            await onLinkEpaTestGroup(editingId, group.test_group_id, 'inferred', null);
        } finally {
            setEpaLinking(false);
        }
    };

    const handleEpaUnlink = async (mappingId) => {
        if (!onUnlinkEpaTestGroup) return;
        setEpaUnlinking(mappingId);
        try {
            await onUnlinkEpaTestGroup(mappingId);
        } finally {
            setEpaUnlinking(null);
        }
    };

    const handleConfidenceChange = async (mappingId, confidence) => {
        await onUpdateEpaMapping?.(mappingId, { confidence });
    };

    // Current EPA mappings come from editingVehicle (refreshed by parent on success)
    const currentEpaMappings = editingVehicle?.epa_mappings ?? [];

    return (
        <>
            <form onSubmit={onSubmit} className="card">
                <h3 className="section-title mb-4">{editingId ? 'Edit Vehicle' : 'Add New Vehicle'}</h3>
                <div className="form-grid gap-4">
                    <input
                        placeholder="Display Name (e.g., Model 3 LR 2024)"
                        value={formData.name}
                        onChange={(e) => onFormChange({ ...formData, name: e.target.value })}
                        className="form-input col-span-2"
                        required
                    />

                    {/* Manufacturer select — replaces free-text make input */}
                    <div className="col-span-2">
                        {!showNewMfg ? (
                            <div className="flex gap-2 items-center">
                                <select
                                    value={formData.manufacturer_id || ''}
                                    onChange={handleManufacturerChange}
                                    className="form-input flex-1"
                                >
                                    <option value="">— Manufacturer —</option>
                                    {manufacturers.map(m => (
                                        <option key={m.id} value={m.id}>{m.name}</option>
                                    ))}
                                </select>
                                {onAddManufacturer && (
                                    <button
                                        type="button"
                                        onClick={() => setShowNewMfg(true)}
                                        className="btn btn-secondary text-sm whitespace-nowrap"
                                    >
                                        + New
                                    </button>
                                )}
                            </div>
                        ) : (
                            <div className="flex gap-2 items-center">
                                <input
                                    autoFocus
                                    placeholder="Manufacturer name"
                                    value={newMfgName}
                                    onChange={e => setNewMfgName(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCreateManufacturer(); } if (e.key === 'Escape') setShowNewMfg(false); }}
                                    className="form-input flex-1"
                                />
                                <input
                                    placeholder="Country (optional)"
                                    value={newMfgCountry}
                                    onChange={e => setNewMfgCountry(e.target.value)}
                                    className="form-input w-32"
                                />
                                <button
                                    type="button"
                                    onClick={handleCreateManufacturer}
                                    disabled={!newMfgName.trim() || mfgSaving}
                                    className="btn btn-primary text-sm disabled:opacity-40"
                                >
                                    {mfgSaving ? 'Saving…' : 'Create'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowNewMfg(false)}
                                    className="btn btn-secondary text-sm"
                                >
                                    Cancel
                                </button>
                            </div>
                        )}
                    </div>

                    <input placeholder="Model"          value={formData.model}   onChange={(e) => onFormChange({ ...formData, model: e.target.value })}   className="form-input" />
                    <input placeholder="Trim"           value={formData.trim ?? ''}  onChange={(e) => onFormChange({ ...formData, trim: e.target.value })}    className="form-input" />
                    <input placeholder="Year"           value={formData.year}    onChange={(e) => onFormChange({ ...formData, year: e.target.value })}    className="form-input" />
                    <input placeholder="Battery (kWh)"  value={formData.battery} onChange={(e) => onFormChange({ ...formData, battery: e.target.value })} className="form-input" />
                    <input placeholder="EPA Range (mi)" value={formData.range}   onChange={(e) => onFormChange({ ...formData, range: e.target.value })}   className="form-input" />
                </div>

                {/* Tags — edit mode only */}
                {editingId && (
                    <div className="form-section mt-5">
                        <label className="block font-medium mb-2">Tags</label>
                        {formTags.length > 0 && (
                            <div className="flex flex-wrap gap-2 mb-3">
                                {formTags.map(tag => (
                                    <div
                                        key={tag.id}
                                        className="flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium"
                                        style={{ backgroundColor: 'var(--color-primary-light)', color: 'var(--color-primary-text)' }}
                                    >
                                        <span>{tag.name}</span>
                                        <button
                                            type="button"
                                            onClick={() => onRemoveTag(tag.id)}
                                            className="ml-1 rounded-full w-4 h-4 flex items-center justify-center hover:opacity-70"
                                            style={{ fontSize: '12px' }}
                                        >
                                            &times;
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                        {availableTagsForForm.length > 0 && (
                            <div className="mb-2">
                                <select
                                    onChange={(e) => {
                                        const tag = tags.find(t => t.id === parseInt(e.target.value));
                                        if (tag) onAddTag(tag);
                                        e.target.value = '';
                                    }}
                                    className="form-input w-full text-sm"
                                    defaultValue=""
                                >
                                    <option value="" disabled>Add existing tag…</option>
                                    {availableTagsForForm.map(tag => (
                                        <option key={tag.id} value={tag.id}>{tag.name}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                        <div className="flex gap-2">
                            <input
                                type="text"
                                placeholder="New tag name"
                                value={newTagName}
                                onChange={(e) => onNewTagNameChange(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onCreateTag(); } }}
                                className="form-input text-sm flex-1"
                            />
                            <button type="button" onClick={onCreateTag} className="btn btn-primary text-sm">
                                Create tag
                            </button>
                        </div>
                    </div>
                )}

                {/* Image upload — edit mode only */}
                {editingId && (
                    <div className="form-section mt-4">
                        <label className="block font-medium mb-2">Card Background Image</label>
                        {editingVehicle?.image_url && (
                            <img
                                src={editingVehicle.image_url}
                                alt="Current"
                                className="h-24 w-full object-cover rounded mb-2 border"
                            />
                        )}
                        <label className="image-upload-label">
                            <span className="btn btn-primary text-sm">
                                {imageUploading ? 'Uploading…' : editingVehicle?.image_url ? 'Replace image' : 'Upload image'}
                            </span>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={handleFileSelect}
                                disabled={imageUploading}
                            />
                        </label>
                        <p className="text-xs text-gray-400 mt-1">16:9 crop · max 1600×900 · saved as JPEG</p>
                    </div>
                )}

                {/* EPA Test Group linking — edit mode only */}
                {editingId && searchEpaTestGroups && (
                    <div className="form-section mt-5">
                        <label className="block font-medium mb-2">
                            EPA Test Group
                            <InfoIcon
                                text={EPA_EXPLAINERS.roadLoad}
                                position="right"
                                className="ml-1"
                            />
                        </label>

                        {/* Current mappings list */}
                        {currentEpaMappings.length === 0 ? (
                            <p className="text-sm text-gray-500 dark:text-slate-400 mb-3">No EPA test group linked yet.</p>
                        ) : (
                            <div className="flex flex-col gap-2 mb-3">
                                {currentEpaMappings.map(m => {
                                    const g = m.epaGroup;
                                    if (!g) return null;
                                    return (
                                        <div key={m.id} className="flex items-center gap-2 flex-wrap rounded border border-gray-200 dark:border-slate-600 p-2 text-sm">
                                            <span className="flex-1 min-w-0">
                                                <span className="font-medium">{g.epa_carline_name}</span>
                                                <span className="text-gray-500 dark:text-slate-400 ml-1">({g.model_year})</span>
                                                {m.notes && (
                                                    <span className="text-gray-500 dark:text-slate-400 ml-1">· {m.notes}</span>
                                                )}
                                            </span>
                                            <select
                                                value={m.confidence}
                                                onChange={e => handleConfidenceChange(m.id, e.target.value)}
                                                className="form-input text-xs py-0.5 w-28"
                                            >
                                                <option value="verified">Verified</option>
                                                <option value="likely">Likely</option>
                                                <option value="inferred">Inferred</option>
                                            </select>
                                            <ConfidenceBadge confidence={m.confidence} />
                                            <button
                                                type="button"
                                                disabled={epaUnlinking === m.id}
                                                onClick={() => handleEpaUnlink(m.id)}
                                                className="btn btn-secondary text-xs py-0.5 px-2 disabled:opacity-40"
                                            >
                                                {epaUnlinking === m.id ? 'Unlinking…' : 'Unlink'}
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* Search combobox for adding a new mapping */}
                        <div className="relative">
                            <input
                                type="text"
                                placeholder="Search EPA test groups by make or carline…"
                                value={epaQuery}
                                onChange={handleEpaQueryChange}
                                onFocus={() => epaQuery && setShowEpaDropdown(true)}
                                onBlur={() => setTimeout(() => setShowEpaDropdown(false), 150)}
                                className="form-input text-sm w-full"
                                disabled={epaLinking}
                            />
                            {epaLinking && (
                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 dark:text-slate-400">Linking…</span>
                            )}
                            {showEpaDropdown && (epaResults.length > 0 || epaSearching) && (
                                <ul className="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto rounded-lg border shadow-lg bg-white dark:bg-slate-800 dark:border-slate-600">
                                    {epaSearching && (
                                        <li className="px-3 py-2 text-sm text-gray-400 italic">Searching…</li>
                                    )}
                                    {!epaSearching && epaResults.map(g => (
                                        <li
                                            key={g.test_group_id}
                                            className="px-3 py-2 text-sm cursor-pointer hover:bg-indigo-50 dark:hover:bg-indigo-900"
                                            onMouseDown={e => { e.preventDefault(); handleEpaSelect(g); }}
                                        >
                                            <span className="font-medium">{g.make} · {g.epa_carline_name}</span>
                                            <span className="text-gray-400 ml-2">
                                                {g.model_year}{g.drive ? ` · ${g.drive}` : ''} · {g.test_group_id}
                                            </span>
                                        </li>
                                    ))}
                                    {!epaSearching && epaResults.length === 0 && epaQuery.trim() && (
                                        <li className="px-3 py-2 text-sm text-gray-400 italic">No results</li>
                                    )}
                                </ul>
                            )}
                        </div>
                        <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                            Results are pre-filtered by vehicle year when available.
                        </p>
                    </div>
                )}

                <div className="form-actions mt-4">
                    <button type="button" onClick={onCancel} className="btn btn-secondary text-sm">
                        Cancel
                    </button>
                    <button type="submit" className="btn btn-primary text-sm">
                        {editingId ? 'Save Changes' : 'Add Vehicle'}
                    </button>
                </div>
            </form>

            {/* Crop modal — rendered outside the form to avoid z-index / stacking issues */}
            {imgSrc && (
                <div className="modal-overlay">
                    <div className="crop-modal-panel">
                        <div className="crop-modal-header">
                            <h3 className="font-semibold text-base">Crop Image (16:9)</h3>
                            <p className="text-xs text-gray-500 mt-0.5">Drag to reposition · resize handles to adjust · max output 1600×900</p>
                        </div>
                        <div className="crop-modal-body">
                            <ReactCrop
                                crop={crop}
                                onChange={c => setCrop(c)}
                                onComplete={c => setCompletedCrop(c)}
                                aspect={ASPECT}
                                minWidth={80}
                            >
                                <img
                                    ref={imgRef}
                                    src={imgSrc}
                                    alt="Crop preview"
                                    className="crop-modal-img"
                                    onLoad={onImageLoad}
                                />
                            </ReactCrop>
                        </div>
                        <div className="crop-modal-footer">
                            <button
                                type="button"
                                onClick={handleCropCancel}
                                className="btn btn-secondary text-sm"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleCropConfirm}
                                disabled={!completedCrop?.width}
                                className="btn btn-primary text-sm"
                            >
                                Use this crop
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

// Shared vehicle edit form — used in VehiclesView (inline) and RunsView (modal).
// Lifted to module level so React never unmounts it mid-keystroke due to a new
// function reference being created inside a parent render.
import { ownValues } from '../utils/vehicleInheritance';
import { useState, useRef, useCallback } from 'react';
import ReactCrop from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { FULL_MAX, buildRenditions, displayImageUrl } from '../utils/imageRenditions';
import SeriesColorPicker from './SeriesColorPicker';
import { DEFAULT_RUN_COLOR } from '../utils/colorUtils';
import CardBandPreview from './vehicles/CardBandPreview';
import { CARD_BAND_MAX_WIDTH, PHOTO_ASPECT, focalY } from '../utils/cardBand';
import { makeModelLine } from '../utils/specHelpers';
import { usePhotoAspect } from '../hooks/usePhotoAspect';

// Extract the completed crop region into an offscreen canvas at full rendition
// resolution. Encoding is left to buildRenditions, which needs one shared source
// to derive the full and thumbnail JPEGs from.
function getCroppedCanvas(imgEl, completedCrop) {
    const scaleX = imgEl.naturalWidth / imgEl.width;
    const scaleY = imgEl.naturalHeight / imgEl.height;

    const naturalW = completedCrop.width * scaleX;
    const naturalH = completedCrop.height * scaleY;
    const scale = Math.min(1, FULL_MAX.width / naturalW, FULL_MAX.height / naturalH);

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(naturalW * scale);
    canvas.height = Math.round(naturalH * scale);

    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
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
    return canvas;
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
}) {
    // What the vehicle being edited inherits (vehicleInheritance.js). The form
    // edits own values only; these are shown beside them, never saved.
    const inheritedColor = editingVehicle?.inheritedFrom?.color ?? null;
    // Inherited tags show only while the vehicle has none of its own: tags are
    // one set, overridden whole. The first change a curator makes here adopts
    // the inherited set as the vehicle's own and applies the change to that,
    // so removing one inherited tag keeps the rest rather than losing them all.
    const inheritedTags = (formTags?.length ?? 0) > 0 ? [] : Object.entries(editingVehicle?.inheritedFrom?.tags ?? {})
        .map(([id, from]) => ({ tag: (editingVehicle.tags ?? []).find(t => String(t.id) === id), from }))
        .filter(({ tag }) => tag);
    const adoptInheritedTags = (exceptId = null) => {
        for (const { tag } of inheritedTags) if (tag.id !== exceptId) onAddTag(tag);
    };

    // The photo on screen is the resolved one — a variant shows its source's —
    // but only a vehicle's OWN photo can be reframed here. See the note by the
    // preview for why an inherited one is read-only.
    const photoUrl = displayImageUrl(editingVehicle);
    const canReposition = Boolean(photoUrl) && !editingVehicle?.inheritedFrom?.photo;
    // The stored photo's own shape, which is not always 16:9 (see the hook).
    const photoAspect = usePhotoAspect(photoUrl);
    const setFocal = (value) => onFormChange({ ...formData, image_focal_y: value });

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
        const cropW = Math.min(width, height * PHOTO_ASPECT);
        const cropH = cropW / PHOTO_ASPECT;
        const initial = {
            unit: 'px',
            x: (width - cropW) / 2,
            y: (height - cropH) / 2,
            width: cropW,
            height: cropH,
        };
        setCrop(initial);
        setCompletedCrop(initial);
    }, [setCrop, setCompletedCrop]);

    const handleCropConfirm = async () => {
        if (!completedCrop || !imgRef.current) return;
        const renditions = await buildRenditions(getCroppedCanvas(imgRef.current, completedCrop));
        setImgSrc('');
        setCrop(undefined);
        setCompletedCrop(null);
        // A focal point frames ONE picture. `uploadVehicleImage` clears the
        // stored one in the same patch as the new URLs; this clears the copy
        // the form is holding, which would otherwise be written straight back
        // over it by the next Save.
        setFocal(null);
        onImageReady(renditions);
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

    return (
        <>
            <form onSubmit={onSubmit} className="card">
                <h3 className="section-title mb-4">{editingId ? 'Edit Vehicle' : 'Add New Vehicle'}</h3>
                <div className="form-grid gap-4">
                    <input
                        placeholder="Display Name (e.g., Model 3 LR 2024)"
                        value={formData.name}
                        onChange={(e) => onFormChange({ ...formData, name: e.target.value })}
                        className="form-input form-input col-span-2"
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
                                    className="form-input form-input flex-1"
                                />
                                <input
                                    placeholder="Country (optional)"
                                    value={newMfgCountry}
                                    onChange={e => setNewMfgCountry(e.target.value)}
                                    className="form-input form-input w-32"
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

                    <input placeholder="Model"          value={formData.model}   onChange={(e) => onFormChange({ ...formData, model: e.target.value })}   className="form-input form-input" />
                    <input placeholder="Trim"           value={formData.trim ?? ''}  onChange={(e) => onFormChange({ ...formData, trim: e.target.value })}    className="form-input form-input" />
                    <input placeholder="Year"           value={formData.year}    onChange={(e) => onFormChange({ ...formData, year: e.target.value })}    className="form-input form-input" />
                    <input placeholder="Battery (kWh)"  value={formData.battery} onChange={(e) => onFormChange({ ...formData, battery: e.target.value })} className="form-input form-input" />
                    <input placeholder="EPA Range (mi)" value={formData.range}   onChange={(e) => onFormChange({ ...formData, range: e.target.value })}   className="form-input form-input" />
                </div>

                {/* ── Series color (#308) ──────────────────────────────────
                  * The vehicle's own, not a run's. Color used to be curated per
                  * TEST, which does not survive contact with hundreds of cars at
                  * two to ten tests each — and it was never what a reader wanted
                  * anyway. What you recognise on a chart is the car.
                  *
                  * The same picker the chart sidebars use, deliberately: this is
                  * the one place the value is DURABLE, so it gets no scope
                  * control — there is nothing to scope, a vehicle being one
                  * series base. */}
                <div className="form-section mt-5">
                    <label className="block font-medium mb-2">Series color</label>
                    <div className="flex items-center gap-3">
                        <SeriesColorPicker
                            value={formData.color || (inheritedColor ? editingVehicle.color : null) || DEFAULT_RUN_COLOR}
                            stored={formData.color ?? null}
                            label={formData.name?.trim() || 'this vehicle'}
                            onChange={hex => onFormChange({ ...formData, color: hex })}
                            onReset={() => onFormChange({ ...formData, color: null })}
                        />
                        <span className="text-note">
                            {formData.color
                                ? 'Every chart draws this vehicle from here, shading its tests off it.'
                                : inheritedColor
                                    ? `Inherited from ${inheritedColor.name}. Set one to override it.`
                                    : 'Unset — the palette chooses. The press-car color is usually the one that stands out.'}
                        </span>
                    </div>
                </div>

                {/* Tags — edit mode only */}
                {editingId && (
                    <div className="form-section mt-5">
                        <label className="block font-medium mb-2">Tags</label>
                        {(formTags.length > 0 || inheritedTags.length > 0) && (
                            <div className="flex flex-wrap gap-2 mb-3">
                                {formTags.map(tag => (
                                    <div key={tag.id} className="vehicle-tag is-editable">
                                        <span>{tag.name}</span>
                                        <button
                                            type="button"
                                            onClick={() => onRemoveTag(tag.id)}
                                            className="vehicle-tag-remove"
                                            aria-label={`Remove ${tag.name}`}
                                        >
                                            &times;
                                        </button>
                                    </div>
                                ))}
                                {/* Inherited tags, while this vehicle has none of its
                                    own. Any change adopts them first (see
                                    adoptInheritedTags), so the set is edited as a
                                    whole rather than silently dropped. */}
                                {inheritedTags.map(({ tag, from }) => (
                                    <div key={tag.id} className="vehicle-tag is-editable is-inherited" title={`Inherited from ${from.name}`}>
                                        <span>{tag.name}</span>
                                        <button
                                            type="button"
                                            onClick={() => adoptInheritedTags(tag.id)}
                                            className="vehicle-tag-remove"
                                            aria-label={`Remove ${tag.name}`}
                                        >
                                            &times;
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                        {inheritedTags.length > 0 && (
                            <p className="text-note mb-2">
                                Inherited from {inheritedTags[0].from.name}. Changing a tag here gives this vehicle its own set.
                            </p>
                        )}
                        {availableTagsForForm.length > 0 && (
                            <div className="mb-2">
                                <select
                                    onChange={(e) => {
                                        const tag = tags.find(t => t.id === parseInt(e.target.value));
                                        if (tag) { adoptInheritedTags(); onAddTag(tag); }
                                        e.target.value = '';
                                    }}
                                    className="form-input form-input w-full"
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
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); adoptInheritedTags(); onCreateTag(); } }}
                                className="form-input form-input flex-1"
                            />
                            <button type="button" onClick={() => { adoptInheritedTags(); onCreateTag(); }} className="btn btn-primary text-sm">
                                Create tag
                            </button>
                        </div>
                    </div>
                )}

                {/* Image upload — edit mode only */}
                {editingId && (
                    <div className="form-section mt-4">
                        <label className="block font-medium mb-2">Photo</label>
                        {/* The stored photo under the card's view of it, and —
                            when the photo is this vehicle's own — a handle.
                            Dragging sets the focal point, which is the whole of
                            repositioning: nothing is re-encoded or re-uploaded,
                            the number is what Save writes.

                            Read-only on an inherited photo. The focal point is
                            a property of the picture, so writing one here would
                            leave this vehicle holding a number that frames a
                            photo belonging to another car — and it would go on
                            framing whatever the source uploaded next. */}
                        {photoUrl && (
                            <div className="mb-2">
                                <div
                                    className="card-band-frame"
                                    style={{
                                        // The desktop card's width at 1:1, and
                                        // the photo's OWN shape, so the frame
                                        // shows all of it and `cover` crops
                                        // nothing. A 16:9 frame over a 3:2 photo
                                        // lined the window up with an edge that
                                        // was not the photo's.
                                        maxWidth: CARD_BAND_MAX_WIDTH,
                                        aspectRatio: photoAspect,
                                        backgroundImage: `url(${photoUrl})`,
                                    }}
                                >
                                    <CardBandPreview
                                        name={formData.name}
                                        subtitle={makeModelLine(formData)}
                                        focal={formData.image_focal_y}
                                        aspect={photoAspect}
                                        onFocalChange={canReposition ? setFocal : undefined}
                                    />
                                </div>
                                <div className="flex items-center gap-2 mt-1.5">
                                    <span className="text-note flex-1">
                                        {!canReposition
                                            ? 'The media band is what a card shows of it.'
                                            : formData.image_focal_y == null
                                                ? 'Drag the media band up or down to reframe the card. Centered until you do.'
                                                : `Focal point ${focalY(formData.image_focal_y)}% down the photo.`}
                                    </span>
                                    {canReposition && formData.image_focal_y != null && (
                                        <button
                                            type="button"
                                            onClick={() => setFocal(null)}
                                            className="btn btn-secondary text-sm"
                                        >
                                            Center
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}
                        <label className="image-upload-label">
                            <span className="btn btn-primary text-sm">
                                {imageUploading ? 'Uploading…' : ownValues(editingVehicle ?? {}).image_url ? 'Replace image' : 'Upload image'}
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
                        {editingVehicle?.inheritedFrom?.photo && (
                            <p className="text-note mt-1">
                                Inherited from {editingVehicle.inheritedFrom.photo.name}, and follows it when that photo changes. Upload one to override it.
                            </p>
                        )}
                        <p className="text-xs text-meta mt-1">16:9 crop · max 1600×900 · saved as JPEG</p>
                    </div>
                )}

                {/* EPA test groups are assigned in Tests & Data, not here — keeps
                    this modal compact regardless of how many are linked. */}

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
                            <p className="text-xs text-secondary mt-0.5">
                                Drag to reposition · resize handles to adjust · max output 1600×900.
                                The bright area is the card's media band — crop a little wide and you
                                can move the photo up or down inside it afterwards.
                            </p>
                        </div>
                        <div className="crop-modal-body">
                            <ReactCrop
                                crop={crop}
                                onChange={c => setCrop(c)}
                                onComplete={c => setCompletedCrop(c)}
                                aspect={PHOTO_ASPECT}
                                minWidth={80}
                            >
                                <img
                                    ref={imgRef}
                                    src={imgSrc}
                                    alt="Crop preview"
                                    className="crop-modal-img"
                                    onLoad={onImageLoad}
                                />
                                {/* The card's view, over the crop rectangle.
                                    Without it the curator frames for the 16:9
                                    file and the card then cuts a third of it
                                    off, roof and wheels first.

                                    A sibling of the image inside ReactCrop, so
                                    the crop's own pixel coordinates place it:
                                    .ReactCrop is the positioned ancestor and
                                    the image sits at its origin. `crop` rather
                                    than `completedCrop` so it tracks the drag
                                    rather than jumping at the end of it. */}
                                {crop?.width > 0 && (
                                    <div
                                        className="crop-modal-card-view"
                                        style={{ top: crop.y, left: crop.x, width: crop.width, height: crop.height }}
                                    >
                                        <CardBandPreview
                                            name={formData.name}
                                            subtitle={makeModelLine(formData)}
                                        />
                                    </div>
                                )}
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

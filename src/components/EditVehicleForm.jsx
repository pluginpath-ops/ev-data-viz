// Shared vehicle edit form — used in VehiclesView (inline) and RunsView (modal).
// Lifted to module level so React never unmounts it mid-keystroke due to a new
// function reference being created inside a parent render.
import { useState, useRef, useCallback } from 'react';
import ReactCrop from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';

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

export default function EditVehicleForm({
    formData, onFormChange,
    editingId,
    formTags, onAddTag, onRemoveTag,
    newTagName, onNewTagNameChange, onCreateTag,
    tags, availableTagsForForm,
    editingVehicle,
    imageUploading, onImageReady,
    onSubmit, onCancel,
}) {
    const [imgSrc, setImgSrc] = useState('');
    const [crop, setCrop] = useState();
    const [completedCrop, setCompletedCrop] = useState(null);
    const imgRef = useRef(null);
    const fileInputRef = useRef(null);

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
                    <input placeholder="Make"           value={formData.make}    onChange={(e) => onFormChange({ ...formData, make: e.target.value })}    className="form-input" />
                    <input placeholder="Model"          value={formData.model}   onChange={(e) => onFormChange({ ...formData, model: e.target.value })}   className="form-input" />
                    <input placeholder="Year"           value={formData.year}    onChange={(e) => onFormChange({ ...formData, year: e.target.value })}    className="form-input" />
                    <input placeholder="Battery (kWh)"  value={formData.battery} onChange={(e) => onFormChange({ ...formData, battery: e.target.value })} className="form-input" />
                    <input placeholder="EPA Range (mi)" value={formData.range}   onChange={(e) => onFormChange({ ...formData, range: e.target.value })}   className="form-input" />
                    <input placeholder="Peak Power (kW)" value={formData.power}  onChange={(e) => onFormChange({ ...formData, power: e.target.value })}   className="form-input" />
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
                <div className="modal-overlay" onClick={handleCropCancel}>
                    <div className="crop-modal-panel" onClick={e => e.stopPropagation()}>
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

// Shared vehicle edit form — used in VehiclesView (inline) and RunsView (modal).
// Lifted to module level so React never unmounts it mid-keystroke due to a new
// function reference being created inside a parent render.
export default function EditVehicleForm({
    formData, onFormChange,
    editingId,
    formTags, onAddTag, onRemoveTag,
    newTagName, onNewTagNameChange, onCreateTag,
    tags, availableTagsForForm,
    editingVehicle,
    imageUploading, onImageUpload,
    onSubmit, onCancel,
}) {
    return (
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
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={onImageUpload}
                            disabled={imageUploading}
                        />
                    </label>
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
    );
}

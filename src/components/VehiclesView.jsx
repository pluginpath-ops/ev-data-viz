import { useState } from 'react';

export default function VehiclesView({
    vehicles, selectedVehicles, onToggleSelection, onAdd, onUpdate, onDelete, onViewRuns,
    isOwner, onToggleVisibility, tags, onCreateTag, onSyncVehicleTags, onUploadVehicleImage
}) {
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [formData, setFormData] = useState({
        name: '', make: '', model: '', year: '',
        battery: '', range: '', power: ''
    });
    const [formTags, setFormTags] = useState([]);
    const [newTagName, setNewTagName] = useState('');
    const [activeTagFilters, setActiveTagFilters] = useState([]);
    const [imageUploading, setImageUploading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (editingId) {
            await onUpdate(editingId, formData);
            await onSyncVehicleTags(editingId, formTags.map(t => t.id));
            setEditingId(null);
        } else {
            onAdd(formData);
        }
        setFormTags([]);
        setFormData({ name: '', make: '', model: '', year: '', battery: '', range: '', power: '' });
        setShowForm(false);
    };

    const handleEdit = (vehicle, e) => {
        e.stopPropagation();
        setFormData({
            name: vehicle.name,
            make: vehicle.make || '',
            model: vehicle.model || '',
            year: vehicle.year || '',
            battery: vehicle.battery || '',
            range: vehicle.range || '',
            power: vehicle.power || ''
        });
        setFormTags(vehicle.tags || []);
        setEditingId(vehicle.id);
        setShowForm(true);
    };

    const handleCancel = () => {
        setShowForm(false);
        setEditingId(null);
        setFormTags([]);
        setNewTagName('');
        setFormData({ name: '', make: '', model: '', year: '', battery: '', range: '', power: '' });
    };

    const handleCardClick = (vehicle) => {
        onToggleSelection(vehicle.id);
    };

    const handleAddFormTag = (tag) => {
        if (!formTags.some(t => t.id === tag.id)) {
            setFormTags(prev => [...prev, tag]);
        }
    };

    const handleRemoveFormTag = (tagId) => {
        setFormTags(prev => prev.filter(t => t.id !== tagId));
    };

    const handleCreateTag = async () => {
        const trimmed = newTagName.trim();
        if (!trimmed) return;
        const existing = tags.find(t => t.name.toLowerCase() === trimmed.toLowerCase());
        if (existing) {
            handleAddFormTag(existing);
        } else {
            const newTag = await onCreateTag(trimmed);
            if (newTag) handleAddFormTag(newTag);
        }
        setNewTagName('');
    };

    const handleImageUpload = async (e) => {
        const file = e.target.files[0];
        if (!file || !editingId) return;
        setImageUploading(true);
        await onUploadVehicleImage(editingId, file);
        setImageUploading(false);
    };

    const toggleTagFilter = (tagId) => {
        setActiveTagFilters(prev =>
            prev.includes(tagId) ? prev.filter(id => id !== tagId) : [...prev, tagId]
        );
    };

    const filteredVehicles = activeTagFilters.length === 0
        ? vehicles
        : vehicles.filter(v =>
            activeTagFilters.every(tagId => v.tags?.some(t => t.id === tagId))
        );

    const availableTagsForForm = tags.filter(t => !formTags.some(ft => ft.id === t.id));
    const editingVehicle = editingId ? vehicles.find(v => v.id === editingId) : null;

    return (
        <div>
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold">Vehicles</h2>
                <button onClick={() => setShowForm(!showForm)} className="btn btn-primary">
                    {showForm && !editingId ? 'Cancel' : '+ Add Vehicle'}
                </button>
            </div>

            {/* Tag filter bar */}
            {tags.length > 0 && (
                <div className="flex flex-wrap gap-2 items-center mb-6">
                    <span className="text-sm font-medium text-gray-500">Filter:</span>
                    {tags.map(tag => (
                        <button
                            key={tag.id}
                            onClick={() => toggleTagFilter(tag.id)}
                            className={`px-3 py-1 rounded-full text-sm font-medium transition border ${
                                activeTagFilters.includes(tag.id)
                                    ? 'bg-blue-500 text-white border-blue-500'
                                    : 'bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-200'
                            }`}
                            style={activeTagFilters.includes(tag.id) ? { backgroundColor: 'var(--color-primary)', borderColor: 'var(--color-primary)' } : {}}
                        >
                            {tag.name}
                        </button>
                    ))}
                    {activeTagFilters.length > 0 && (
                        <button
                            onClick={() => setActiveTagFilters([])}
                            className="text-xs text-gray-400 hover:text-gray-600 underline ml-1"
                        >
                            Clear
                        </button>
                    )}
                </div>
            )}

            {showForm && (
                <form onSubmit={handleSubmit} className="card mb-6">
                    <h3 className="text-lg font-bold mb-4">{editingId ? 'Edit Vehicle' : 'Add New Vehicle'}</h3>
                    <div className="grid grid-cols-2 gap-4">
                        <input
                            placeholder="Display Name (e.g., Model 3 LR 2024)"
                            value={formData.name}
                            onChange={(e) => setFormData({...formData, name: e.target.value})}
                            className="border p-2 rounded col-span-2"
                            required
                        />
                        <input placeholder="Make" value={formData.make} onChange={(e) => setFormData({...formData, make: e.target.value})} className="border p-2 rounded" />
                        <input placeholder="Model" value={formData.model} onChange={(e) => setFormData({...formData, model: e.target.value})} className="border p-2 rounded" />
                        <input placeholder="Year" value={formData.year} onChange={(e) => setFormData({...formData, year: e.target.value})} className="border p-2 rounded" />
                        <input placeholder="Battery (kWh)" value={formData.battery} onChange={(e) => setFormData({...formData, battery: e.target.value})} className="border p-2 rounded" />
                        <input placeholder="EPA Range (mi)" value={formData.range} onChange={(e) => setFormData({...formData, range: e.target.value})} className="border p-2 rounded" />
                        <input placeholder="Peak Power (kW)" value={formData.power} onChange={(e) => setFormData({...formData, power: e.target.value})} className="border p-2 rounded" />
                    </div>

                    {/* Tags — edit mode only */}
                    {editingId && (
                        <div className="mt-5 border-t pt-4">
                            <label className="block font-medium mb-2">Tags</label>

                            {/* Current tags as pills */}
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
                                                onClick={() => handleRemoveFormTag(tag.id)}
                                                className="ml-1 rounded-full w-4 h-4 flex items-center justify-center hover:opacity-70"
                                                style={{ fontSize: '12px' }}
                                            >
                                                &times;
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Add existing tag */}
                            {availableTagsForForm.length > 0 && (
                                <div className="mb-2">
                                    <select
                                        onChange={(e) => {
                                            const tag = tags.find(t => t.id === parseInt(e.target.value));
                                            if (tag) handleAddFormTag(tag);
                                            e.target.value = '';
                                        }}
                                        className="border p-2 rounded text-sm w-full"
                                        defaultValue=""
                                    >
                                        <option value="" disabled>Add existing tag…</option>
                                        {availableTagsForForm.map(tag => (
                                            <option key={tag.id} value={tag.id}>{tag.name}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            {/* Create new tag */}
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    placeholder="New tag name"
                                    value={newTagName}
                                    onChange={(e) => setNewTagName(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleCreateTag(); } }}
                                    className="border p-2 rounded text-sm flex-1"
                                />
                                <button
                                    type="button"
                                    onClick={handleCreateTag}
                                    className="btn btn-secondary text-sm"
                                >
                                    Create tag
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Image upload — edit mode only */}
                    {editingId && (
                        <div className="mt-4 border-t pt-4">
                            <label className="block font-medium mb-2">Card Background Image</label>
                            {editingVehicle?.image_url && (
                                <img
                                    src={editingVehicle.image_url}
                                    alt="Current"
                                    className="h-24 w-full object-cover rounded mb-2 border"
                                />
                            )}
                            <label className="flex items-center gap-2 cursor-pointer">
                                <span className="btn btn-secondary text-sm">
                                    {imageUploading ? 'Uploading…' : editingVehicle?.image_url ? 'Replace image' : 'Upload image'}
                                </span>
                                <input
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={handleImageUpload}
                                    disabled={imageUploading}
                                />
                            </label>
                        </div>
                    )}

                    <div className="mt-4 flex gap-2">
                        <button type="submit" className="btn btn-primary">
                            {editingId ? 'Save Changes' : 'Add Vehicle'}
                        </button>
                        <button type="button" onClick={handleCancel} className="btn btn-secondary">
                            Cancel
                        </button>
                    </div>
                </form>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredVehicles.map(vehicle => {
                    const isSelected = selectedVehicles.includes(vehicle.id);
                    return (
                        <div
                            key={vehicle.id}
                            onClick={() => handleCardClick(vehicle)}
                            className="card hover:shadow-lg transition cursor-pointer relative overflow-hidden"
                            style={{
                                borderWidth: '2px',
                                borderStyle: 'solid',
                                borderColor: isSelected ? 'var(--color-primary)' : 'transparent'
                            }}
                        >
                            {/* Background image + overlay */}
                            {vehicle.image_url && (
                                <>
                                    <div
                                        className="absolute inset-0"
                                        style={{
                                            backgroundImage: `url(${vehicle.image_url})`,
                                            backgroundSize: 'cover',
                                            backgroundPosition: 'center',
                                        }}
                                    />
                                    <div className="absolute inset-0 bg-white/80" />
                                </>
                            )}

                            <div className="relative z-10">
                                {isSelected && (
                                    <div
                                        className="absolute -top-5 -right-5 w-6 h-6 rounded-full flex items-center justify-center text-white font-bold"
                                        style={{ backgroundColor: 'var(--color-primary)' }}
                                    >
                                        &#10003;
                                    </div>
                                )}

                                <div className="flex items-center justify-between mb-2">
                                    <h3 className="text-xl font-bold">{vehicle.name}</h3>
                                    {isOwner ? (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); onToggleVisibility(vehicle.id, vehicle.visibility === 'public' ? 'private' : 'public'); }}
                                            title={`Click to make ${vehicle.visibility === 'public' ? 'private' : 'public'}`}
                                            className={`flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full border transition ${
                                                vehicle.visibility === 'public'
                                                    ? 'bg-green-100 text-green-700 border-green-300 hover:bg-green-200'
                                                    : 'bg-gray-100 text-gray-500 border-gray-300 hover:bg-gray-200'
                                            }`}
                                        >
                                            {vehicle.visibility === 'public' ? '🌐 Public' : '🔒 Private'}
                                        </button>
                                    ) : (
                                        <span className={`flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full border ${
                                            vehicle.visibility === 'public'
                                                ? 'bg-green-100 text-green-700 border-green-300'
                                                : 'bg-gray-100 text-gray-500 border-gray-300'
                                        }`}>
                                            {vehicle.visibility === 'public' ? '🌐 Public' : '🔒 Private'}
                                        </span>
                                    )}
                                </div>

                                <p className="text-gray-600 mb-3">{vehicle.make} {vehicle.model} {vehicle.year}</p>
                                <div className="text-sm text-gray-700 space-y-1 mb-3">
                                    {vehicle.battery && <p>Battery: {vehicle.battery} kWh</p>}
                                    {vehicle.range && <p>Range: {vehicle.range} mi</p>}
                                    {vehicle.power && <p>Power: {vehicle.power} kW</p>}
                                    <p className="font-semibold mt-2">Test Runs: {vehicle.runs?.length || 0}</p>
                                </div>

                                {/* Tag pills */}
                                {vehicle.tags?.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mb-3">
                                        {vehicle.tags.map(tag => (
                                            <span
                                                key={tag.id}
                                                className="px-2 py-0.5 rounded-full text-xs font-medium"
                                                style={{ backgroundColor: 'var(--color-primary-light)', color: 'var(--color-primary-text)' }}
                                            >
                                                {tag.name}
                                            </span>
                                        ))}
                                    </div>
                                )}

                                <div className="flex gap-2">
                                    <button onClick={(e) => { e.stopPropagation(); onViewRuns(vehicle); }} className="btn btn-primary flex-1">
                                        View Runs
                                    </button>
                                    <button onClick={(e) => handleEdit(vehicle, e)} className="btn btn-edit">
                                        Edit
                                    </button>
                                    <button onClick={(e) => { e.stopPropagation(); onDelete(vehicle.id); }} className="btn btn-danger">
                                        Delete
                                    </button>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {filteredVehicles.length === 0 && !showForm && (
                <div className="text-center py-12 text-gray-500">
                    {activeTagFilters.length > 0
                        ? <p className="text-lg">No vehicles match the selected tags.</p>
                        : <p className="text-lg">No vehicles yet. Click "Add Vehicle" to get started!</p>
                    }
                </div>
            )}
        </div>
    );
}

import { useState } from 'react';
import { useDeleteQueue } from '../hooks/useDeleteQueue';
import DeleteQueueBar from './DeleteQueueBar';

// Icons for view toggle
const CardViewIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <rect x="1" y="1" width="6" height="6" rx="1"/>
        <rect x="9" y="1" width="6" height="6" rx="1"/>
        <rect x="1" y="9" width="6" height="6" rx="1"/>
        <rect x="9" y="9" width="6" height="6" rx="1"/>
    </svg>
);

const ListViewIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <rect x="1" y="2" width="14" height="2.5" rx="1"/>
        <rect x="1" y="6.75" width="14" height="2.5" rx="1"/>
        <rect x="1" y="11.5" width="14" height="2.5" rx="1"/>
    </svg>
);

// ── EditForm lifted outside VehiclesView so its identity is stable across re-renders.
// Defining it inside the parent causes React to unmount+remount it on every keystroke
// (new function reference = new component type), which kills input focus.
function EditForm({
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
            <h3 className="text-lg font-bold mb-4">{editingId ? 'Edit Vehicle' : 'Add New Vehicle'}</h3>
            <div className="grid grid-cols-2 gap-4">
                <input
                    placeholder="Display Name (e.g., Model 3 LR 2024)"
                    value={formData.name}
                    onChange={(e) => onFormChange({ ...formData, name: e.target.value })}
                    className="border p-2 rounded col-span-2"
                    required
                />
                <input placeholder="Make"           value={formData.make}    onChange={(e) => onFormChange({ ...formData, make: e.target.value })}    className="border p-2 rounded" />
                <input placeholder="Model"          value={formData.model}   onChange={(e) => onFormChange({ ...formData, model: e.target.value })}   className="border p-2 rounded" />
                <input placeholder="Year"           value={formData.year}    onChange={(e) => onFormChange({ ...formData, year: e.target.value })}    className="border p-2 rounded" />
                <input placeholder="Battery (kWh)"  value={formData.battery} onChange={(e) => onFormChange({ ...formData, battery: e.target.value })} className="border p-2 rounded" />
                <input placeholder="EPA Range (mi)" value={formData.range}   onChange={(e) => onFormChange({ ...formData, range: e.target.value })}   className="border p-2 rounded" />
                <input placeholder="Peak Power (kW)" value={formData.power}  onChange={(e) => onFormChange({ ...formData, power: e.target.value })}   className="border p-2 rounded" />
            </div>

            {/* Tags — edit mode only */}
            {editingId && (
                <div className="mt-5 border-t pt-4">
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
                    <div className="flex gap-2">
                        <input
                            type="text"
                            placeholder="New tag name"
                            value={newTagName}
                            onChange={(e) => onNewTagNameChange(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onCreateTag(); } }}
                            className="border p-2 rounded text-sm flex-1"
                        />
                        <button type="button" onClick={onCreateTag} className="btn btn-primary text-sm">
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

            {/* Footer: Cancel left, Save right, both text-sm to match image button */}
            <div className="mt-4 flex gap-2 justify-end">
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

export default function VehiclesView({
    vehicles, selectedVehicles, onToggleSelection, onAdd, onUpdate, onDelete, onViewRuns,
    isOwner, onToggleVisibility, tags, onCreateTag, onSyncVehicleTags, onUploadVehicleImage,
    onReorderVehicles,
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
    const [viewMode, setViewMode] = useState('card'); // 'card' | 'list'
    const [sortBy, setSortBy] = useState('default');
    const [textFilter, setTextFilter] = useState('');
    const [editingOrder, setEditingOrder] = useState(false);

    const {
        pendingDeletes, committedDeletes, undoState, secondsLeft,
        queueDelete, restoreItem, clearQueue, commitDeletes, undoDelete,
    } = useDeleteQueue(onDelete);

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

    // Stage 1: tag + committed-delete filter
    const tagFiltered = (activeTagFilters.length === 0
        ? vehicles
        : vehicles.filter(v => activeTagFilters.every(tagId => v.tags?.some(t => t.id === tagId)))
    ).filter(v => !committedDeletes.has(v.id));

    // Stage 2: text filter
    const textLower = textFilter.trim().toLowerCase();
    const textFiltered = !textLower ? tagFiltered : tagFiltered.filter(v =>
        [v.name, v.make, v.model, String(v.year || '')].some(f => (f || '').toLowerCase().includes(textLower))
    );

    // Stage 3: sort
    const sortedFilteredVehicles = [...textFiltered].sort((a, b) => {
        switch (sortBy) {
            case 'default': {
                const aN = a.sort_order == null, bN = b.sort_order == null;
                if (!aN && !bN) return a.sort_order - b.sort_order;
                if (!aN) return -1; if (!bN) return 1;
                return new Date(b.created_at) - new Date(a.created_at);
            }
            case 'date_newest': return new Date(b.created_at) - new Date(a.created_at);
            case 'date_oldest': return new Date(a.created_at) - new Date(b.created_at);
            case 'brand_az':    return (a.make  || '').localeCompare(b.make  || '');
            case 'brand_za':    return (b.make  || '').localeCompare(a.make  || '');
            case 'model_az':    return (a.model || '').localeCompare(b.model || '');
            case 'model_za':    return (b.model || '').localeCompare(a.model || '');
            case 'year_newest': return Number(b.year || 0) - Number(a.year || 0);
            case 'year_oldest': return Number(a.year || 0) - Number(b.year || 0);
            default: return 0;
        }
    });

    const availableTagsForForm = tags.filter(t => !formTags.some(ft => ft.id === t.id));
    const editingVehicle = editingId ? vehicles.find(v => v.id === editingId) : null;

    // ── Shared sub-components ────────────────────────────────────────────────

    const VisibilityPill = ({ vehicle }) => {
        const base = 'flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full border transition';
        const pubCls = 'bg-green-100 text-green-700 border-green-300 hover:bg-green-200';
        const privCls = 'bg-gray-100 text-gray-500 border-gray-300 hover:bg-gray-200';
        const isPublic = vehicle.visibility === 'public';
        if (isOwner) {
            return (
                <button
                    onClick={(e) => { e.stopPropagation(); onToggleVisibility(vehicle.id, isPublic ? 'private' : 'public'); }}
                    title={`Click to make ${isPublic ? 'private' : 'public'}`}
                    className={`${base} ${isPublic ? pubCls : privCls}`}
                >
                    {isPublic ? '🌐 Public' : '🔒 Private'}
                </button>
            );
        }
        return (
            <span className={`${base} ${isPublic ? 'bg-green-100 text-green-700 border-green-300' : 'bg-gray-100 text-gray-500 border-gray-300'}`}>
                {isPublic ? '🌐 Public' : '🔒 Private'}
            </span>
        );
    };

    const ActionButtons = ({ vehicle, layout }) => {
        const isVertical = layout === 'list';
        return (
            <div className={isVertical ? 'flex flex-col gap-1' : 'flex gap-2'}>
                <button
                    onClick={(e) => { e.stopPropagation(); onViewRuns(vehicle); }}
                    className={`px-3 py-1 rounded-md text-xs font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 transition${isVertical ? '' : ' flex-1'}`}
                >
                    View Runs
                </button>
                {isOwner && (
                    <button
                        onClick={(e) => handleEdit(vehicle, e)}
                        className="px-3 py-1 rounded-md text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
                    >
                        Edit
                    </button>
                )}
                {isOwner && (() => {
                    const isPending = pendingDeletes.has(vehicle.id);
                    return (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                isPending ? restoreItem(vehicle.id) : queueDelete(vehicle.id);
                            }}
                            className={`px-3 py-1 rounded-md text-xs font-medium transition${isVertical ? '' : ''} ${
                                isPending
                                    ? 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                                    : 'bg-red-50 text-red-600 hover:bg-red-100'
                            }`}
                        >
                            {isPending ? '↩ Restore' : 'Delete'}
                        </button>
                    );
                })()}
            </div>
        );
    };

    const TagPills = ({ vehicle }) => {
        if (!vehicle.tags?.length) return null;
        return (
            <div className="flex flex-wrap gap-1">
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
        );
    };

    // Shared props bundle for the module-level EditForm component
    const editFormProps = {
        formData, onFormChange: setFormData,
        editingId,
        formTags, onAddTag: handleAddFormTag, onRemoveTag: handleRemoveFormTag,
        newTagName, onNewTagNameChange: setNewTagName, onCreateTag: handleCreateTag,
        tags, availableTagsForForm,
        editingVehicle,
        imageUploading, onImageUpload: handleImageUpload,
        onSubmit: handleSubmit, onCancel: handleCancel,
    };

    const handleMoveVehicle = async (vehicleId, direction) => {
        const allOrdered = [...vehicles]
            .filter(v => !committedDeletes.has(v.id))
            .sort((a, b) => {
                const aN = a.sort_order == null, bN = b.sort_order == null;
                if (!aN && !bN) return a.sort_order - b.sort_order;
                if (!aN) return -1; if (!bN) return 1;
                return new Date(b.created_at) - new Date(a.created_at);
            });
        const idx = allOrdered.findIndex(v => v.id === vehicleId);
        const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (idx === -1 || swapIdx < 0 || swapIdx >= allOrdered.length) return;
        [allOrdered[idx], allOrdered[swapIdx]] = [allOrdered[swapIdx], allOrdered[idx]];
        await onReorderVehicles(allOrdered.map((v, i) => ({ id: v.id, sort_order: i })));
    };

    const showReorderButtons = isOwner && sortBy === 'default'
        && textFilter.trim() === '' && activeTagFilters.length === 0
        && editingOrder;

    // ────────────────────────────────────────────────────────────────────────

    const barVisible = pendingDeletes.size > 0 || !!undoState;

    return (
        <div className={barVisible ? 'pb-20' : ''}>
            {/* Header */}
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold">Vehicles</h2>
                <div className="flex items-center gap-2">
                    {/* View mode toggle */}
                    <div className="flex border rounded-lg overflow-hidden text-gray-500">
                        <button
                            onClick={() => setViewMode('card')}
                            title="Card view"
                            className={`px-2 py-1.5 transition ${viewMode === 'card' ? 'bg-gray-200 text-gray-800' : 'hover:bg-gray-100'}`}
                        >
                            <CardViewIcon />
                        </button>
                        <button
                            onClick={() => setViewMode('list')}
                            title="List view"
                            className={`px-2 py-1.5 transition ${viewMode === 'list' ? 'bg-gray-200 text-gray-800' : 'hover:bg-gray-100'}`}
                        >
                            <ListViewIcon />
                        </button>
                    </div>
                    <button
                        onClick={() => { setEditingId(null); setShowForm(!showForm); }}
                        className="btn btn-primary"
                    >
                        {showForm && !editingId ? 'Cancel' : '+ Add Vehicle'}
                    </button>
                </div>
            </div>

            {/* Sort + search bar */}
            <div className="flex gap-3 items-center mb-3">
                <input
                    type="text"
                    placeholder="Search by name, make, model, year…"
                    value={textFilter}
                    onChange={e => setTextFilter(e.target.value)}
                    className="border p-2 rounded text-sm flex-1"
                />
                <select
                    value={sortBy}
                    onChange={e => setSortBy(e.target.value)}
                    className="border p-2 rounded text-sm"
                >
                    <option value="default">Default Order</option>
                    <option value="date_newest">Date Added (Newest)</option>
                    <option value="date_oldest">Date Added (Oldest)</option>
                    <option value="brand_az">Brand A→Z</option>
                    <option value="brand_za">Brand Z→A</option>
                    <option value="model_az">Model A→Z</option>
                    <option value="model_za">Model Z→A</option>
                    <option value="year_newest">Year (Newest)</option>
                    <option value="year_oldest">Year (Oldest)</option>
                </select>
                {isOwner && sortBy === 'default' && textFilter.trim() === '' && activeTagFilters.length === 0 && (
                    <button
                        onClick={() => setEditingOrder(v => !v)}
                        className={`text-sm px-3 py-2 rounded border transition flex-shrink-0 ${
                            editingOrder
                                ? 'bg-blue-50 border-blue-300 text-blue-700'
                                : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'
                        }`}
                        style={editingOrder ? { backgroundColor: 'var(--color-primary-light)', borderColor: 'var(--color-primary)', color: 'var(--color-primary-text)' } : {}}
                    >
                        ✏️ Edit Order
                    </button>
                )}
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

            {/* Add form — above grid, only when not editing */}
            {showForm && !editingId && (
                <div className="mb-6">
                    <EditForm {...editFormProps} />
                </div>
            )}

            {/* ── CARD VIEW ── */}
            {viewMode === 'card' && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {sortedFilteredVehicles.map(vehicle => {
                        const isSelected = selectedVehicles.includes(vehicle.id);
                        const isPending  = pendingDeletes.has(vehicle.id);
                        return (
                            <div key={vehicle.id} className="contents">
                                <div
                                    onClick={() => handleCardClick(vehicle)}
                                    className={`card hover:shadow-lg transition cursor-pointer relative overflow-hidden flex flex-col${isPending ? ' opacity-60' : ''}`}
                                    style={{
                                        borderWidth: '2px',
                                        borderStyle: 'solid',
                                        borderColor: isPending ? 'rgb(252,165,165)' : isSelected ? 'var(--color-primary)' : 'transparent'
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

                                    {/* Reorder buttons — owner only, default sort, no filters */}
                                    {showReorderButtons && (
                                        <div className="absolute top-1 left-1 flex flex-col gap-0.5 z-20">
                                            <button
                                                onClick={e => { e.stopPropagation(); handleMoveVehicle(vehicle.id, 'up'); }}
                                                className="w-6 h-6 flex items-center justify-center rounded bg-white/80 text-gray-500 hover:bg-white hover:text-gray-800 border border-gray-200 text-xs shadow-sm"
                                                title="Move up"
                                            >▲</button>
                                            <button
                                                onClick={e => { e.stopPropagation(); handleMoveVehicle(vehicle.id, 'down'); }}
                                                className="w-6 h-6 flex items-center justify-center rounded bg-white/80 text-gray-500 hover:bg-white hover:text-gray-800 border border-gray-200 text-xs shadow-sm"
                                                title="Move down"
                                            >▼</button>
                                        </div>
                                    )}

                                    <div className="relative z-10 flex flex-col flex-1">
                                        {isSelected && (
                                            <div
                                                className="absolute -top-5 -right-5 w-6 h-6 rounded-full flex items-center justify-center text-white font-bold"
                                                style={{ backgroundColor: 'var(--color-primary)' }}
                                            >
                                                &#10003;
                                            </div>
                                        )}

                                        {/* Top content */}
                                        <div>
                                            <div className="flex items-center justify-between mb-2">
                                                <h3 className="text-xl font-bold">{vehicle.name}</h3>
                                                <VisibilityPill vehicle={vehicle} />
                                            </div>
                                            <p className="text-gray-600 mb-2">{vehicle.make} {vehicle.model} {vehicle.year}</p>
                                            <div className="text-sm text-gray-700 space-y-1">
                                                {vehicle.battery && <p>Battery: {vehicle.battery} kWh</p>}
                                                {vehicle.range && <p>Range: {vehicle.range} mi</p>}
                                                {vehicle.power && <p>Power: {vehicle.power} kW</p>}
                                            </div>
                                        </div>

                                        {/* Bottom anchor — Test Runs, tags, buttons always at card base */}
                                        <div className="mt-auto pt-3">
                                            <p className="text-sm font-semibold mb-2">Test Runs: {vehicle.runs?.length || 0}</p>
                                            {vehicle.tags?.length > 0 && (
                                                <div className="mb-2">
                                                    <TagPills vehicle={vehicle} />
                                                </div>
                                            )}
                                            <ActionButtons vehicle={vehicle} layout="card" />
                                        </div>
                                    </div>
                                </div>

                                {/* Inline edit form — spans full grid width below the edited card's row */}
                                {editingId === vehicle.id && showForm && (
                                    <div className="col-span-full">
                                        <EditForm {...editFormProps} />
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ── LIST VIEW ── */}
            {viewMode === 'list' && (
                <div className="flex flex-col gap-2">
                    {sortedFilteredVehicles.map(vehicle => {
                        const isSelected = selectedVehicles.includes(vehicle.id);
                        const isPending  = pendingDeletes.has(vehicle.id);
                        return (
                            <div key={vehicle.id}>
                                <div
                                    onClick={() => handleCardClick(vehicle)}
                                    className={`card hover:shadow-lg transition cursor-pointer flex items-center gap-4 py-3 px-4 relative overflow-hidden${isPending ? ' opacity-60' : ''}`}
                                    style={{
                                        borderWidth: '2px',
                                        borderStyle: 'solid',
                                        borderColor: isPending ? 'rgb(252,165,165)' : isSelected ? 'var(--color-primary)' : 'transparent'
                                    }}
                                >
                                    {isSelected && (
                                        <div
                                            className="absolute -top-5 -right-5 w-6 h-6 rounded-full flex items-center justify-center text-white font-bold z-10"
                                            style={{ backgroundColor: 'var(--color-primary)' }}
                                        >
                                            &#10003;
                                        </div>
                                    )}

                                    {/* Reorder buttons — owner only, default sort, no filters */}
                                    {showReorderButtons && (
                                        <div className="flex flex-col gap-0.5 flex-shrink-0">
                                            <button
                                                onClick={e => { e.stopPropagation(); handleMoveVehicle(vehicle.id, 'up'); }}
                                                className="w-6 h-6 flex items-center justify-center rounded bg-gray-100 text-gray-500 hover:bg-gray-200 border border-gray-200 text-xs"
                                                title="Move up"
                                            >▲</button>
                                            <button
                                                onClick={e => { e.stopPropagation(); handleMoveVehicle(vehicle.id, 'down'); }}
                                                className="w-6 h-6 flex items-center justify-center rounded bg-gray-100 text-gray-500 hover:bg-gray-200 border border-gray-200 text-xs"
                                                title="Move down"
                                            >▼</button>
                                        </div>
                                    )}

                                    {/* Thumbnail */}
                                    <div className="list-thumbnail">
                                        {vehicle.image_url
                                            ? <img src={vehicle.image_url} alt={vehicle.name} className="w-full h-full object-cover" />
                                            : <span>🚗</span>
                                        }
                                    </div>

                                    {/* Name + make + tags */}
                                    <div className="flex-1 min-w-0">
                                        <h3 className="font-bold text-lg leading-tight truncate">{vehicle.name}</h3>
                                        <p className="text-gray-500 text-sm mb-1">{vehicle.make} {vehicle.model} {vehicle.year}</p>
                                        <TagPills vehicle={vehicle} />
                                    </div>

                                    {/* Specs */}
                                    <div className="text-sm text-gray-600 space-y-0.5 w-36 flex-shrink-0 hidden sm:block">
                                        {vehicle.battery && <p>Battery: {vehicle.battery} kWh</p>}
                                        {vehicle.range && <p>Range: {vehicle.range} mi</p>}
                                        {vehicle.power && <p>Power: {vehicle.power} kW</p>}
                                        <p className="font-medium">Runs: {vehicle.runs?.length || 0}</p>
                                    </div>

                                    {/* Visibility + action buttons */}
                                    <div className="flex flex-col items-end gap-2 flex-shrink-0">
                                        <VisibilityPill vehicle={vehicle} />
                                        <ActionButtons vehicle={vehicle} layout="list" />
                                    </div>
                                </div>

                                {/* Inline edit form below this list row */}
                                {editingId === vehicle.id && showForm && (
                                    <div className="mt-2">
                                        <EditForm {...editFormProps} />
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {sortedFilteredVehicles.length === 0 && !showForm && (
                <div className="text-center py-12 text-gray-500">
                    {textFilter.trim()
                        ? <p className="text-lg">No vehicles match "{textFilter.trim()}".</p>
                        : activeTagFilters.length > 0
                            ? <p className="text-lg">No vehicles match the selected tags.</p>
                            : <p className="text-lg">No vehicles yet. Click "Add Vehicle" to get started!</p>
                    }
                </div>
            )}

            <DeleteQueueBar
                pendingCount={pendingDeletes.size}
                onClearQueue={clearQueue}
                onCommit={commitDeletes}
                undoState={undoState}
                secondsLeft={secondsLeft}
                onUndo={undoDelete}
                noun="vehicle"
            />
        </div>
    );
}

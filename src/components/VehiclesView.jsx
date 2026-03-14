import { useState, useEffect } from 'react';
import { useDeleteQueue } from '../hooks/useDeleteQueue';
import DeleteQueueBar from './DeleteQueueBar';
import EditVehicleForm from './EditVehicleForm';

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


export default function VehiclesView({
    vehicles, selectedVehicles, onToggleSelection, onAdd, onUpdate, onDelete, onViewRuns,
    isOwner, onToggleVisibility, tags, onCreateTag, onSyncVehicleTags, onUploadVehicleImage,
    onReorderVehicles, onDuplicateVehicle,
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
    const [pendingOrder, setPendingOrder] = useState(null);   // [{id, sort_order}] or null
    const [savingOrder, setSavingOrder]   = useState(false);
    const [duplicatingId, setDuplicatingId] = useState(null);
    const [vehiclePage, setVehiclePage] = useState(1);
    const VEHICLES_PER_PAGE = 24;

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

    const handleDuplicateVehicle = async (vehicle, e) => {
        e.stopPropagation();
        setDuplicatingId(vehicle.id);
        try {
            await onDuplicateVehicle(vehicle.id);
        } finally {
            setDuplicatingId(null);
        }
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
                // Use pending sort_order when available (instant visual feedback before DB save)
                const aOrder = pendingOrder?.find(u => u.id === a.id)?.sort_order ?? a.sort_order;
                const bOrder = pendingOrder?.find(u => u.id === b.id)?.sort_order ?? b.sort_order;
                const aN = aOrder == null, bN = bOrder == null;
                if (!aN && !bN) return aOrder - bOrder;
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
    const totalPages = Math.max(1, Math.ceil(sortedFilteredVehicles.length / VEHICLES_PER_PAGE));
    const pagedVehicles = sortedFilteredVehicles.slice(
        (vehiclePage - 1) * VEHICLES_PER_PAGE,
        vehiclePage * VEHICLES_PER_PAGE
    );

    // ── Shared sub-components ────────────────────────────────────────────────

    const VisibilityPill = ({ vehicle, fullWidth }) => {
        const base = `flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full border transition${fullWidth ? ' w-full justify-center' : ''}`;
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

    const ActionButtons = ({ vehicle }) => {
        const isPending = pendingDeletes.has(vehicle.id);
        return (
            <div className="flex flex-col gap-1 items-stretch">
                {isOwner && (
                    <button
                        onClick={(e) => handleEdit(vehicle, e)}
                        className="px-3 py-1 rounded-md text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
                    >
                        Edit
                    </button>
                )}
                {isOwner && (
                    <button
                        onClick={(e) => handleDuplicateVehicle(vehicle, e)}
                        disabled={duplicatingId !== null}
                        title="Duplicate vehicle and all tests"
                        className="px-3 py-1 rounded-md text-xs font-medium bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition disabled:opacity-50"
                    >
                        {duplicatingId === vehicle.id ? '…' : '⧉ Copy'}
                    </button>
                )}
                {isOwner && (
                    <button
                        onClick={(e) => { e.stopPropagation(); isPending ? restoreItem(vehicle.id) : queueDelete(vehicle.id); }}
                        className={`px-3 py-1 rounded-md text-xs font-medium transition ${isPending ? 'bg-orange-100 text-orange-700 hover:bg-orange-200' : 'bg-red-50 text-red-600 hover:bg-red-100'}`}
                    >
                        {isPending ? '↩ Restore' : 'Delete'}
                    </button>
                )}
            </div>
        );
    };

    const TagPills = ({ vehicle }) => {
        if (!vehicle.tags?.length) return null;
        return (
            <div className="vehicle-tags">
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

    // Shared props bundle for EditVehicleForm
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

    const handleMoveVehicle = (vehicleId, direction) => {
        // Build current order using any in-flight pending order, falling back to DB sort_order
        const getEffectiveOrder = (v) => {
            if (pendingOrder) {
                const p = pendingOrder.find(u => u.id === v.id);
                if (p) return p.sort_order;
            }
            return v.sort_order;
        };
        const allOrdered = [...vehicles]
            .filter(v => !committedDeletes.has(v.id))
            .sort((a, b) => {
                const aO = getEffectiveOrder(a), bO = getEffectiveOrder(b);
                const aN = aO == null, bN = bO == null;
                if (!aN && !bN) return aO - bO;
                if (!aN) return -1; if (!bN) return 1;
                return new Date(b.created_at) - new Date(a.created_at);
            });
        const idx = allOrdered.findIndex(v => v.id === vehicleId);
        const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (idx === -1 || swapIdx < 0 || swapIdx >= allOrdered.length) return;
        [allOrdered[idx], allOrdered[swapIdx]] = [allOrdered[swapIdx], allOrdered[idx]];
        // Update local state immediately — no DB call yet
        setPendingOrder(allOrdered.map((v, i) => ({ id: v.id, sort_order: i })));
    };

    const handleMoveVehicleToIndex = (vehicleId, targetIndex) => {
        const getEffectiveOrder = (v) => {
            if (pendingOrder) {
                const p = pendingOrder.find(u => u.id === v.id);
                if (p) return p.sort_order;
            }
            return v.sort_order;
        };
        const allOrdered = [...vehicles]
            .filter(v => !committedDeletes.has(v.id))
            .sort((a, b) => {
                const aO = getEffectiveOrder(a), bO = getEffectiveOrder(b);
                const aN = aO == null, bN = bO == null;
                if (!aN && !bN) return aO - bO;
                if (!aN) return -1; if (!bN) return 1;
                return new Date(b.created_at) - new Date(a.created_at);
            });
        const idx = allOrdered.findIndex(v => v.id === vehicleId);
        if (idx === -1) return;
        const clamped = Math.max(0, Math.min(targetIndex, allOrdered.length - 1));
        const [moved] = allOrdered.splice(idx, 1);
        allOrdered.splice(clamped, 0, moved);
        setPendingOrder(allOrdered.map((v, i) => ({ id: v.id, sort_order: i })));
    };

    const handleSaveOrder = async () => {
        if (!pendingOrder) return;
        setSavingOrder(true);
        try {
            await onReorderVehicles(pendingOrder);
            setPendingOrder(null);
        } finally {
            setSavingOrder(false);
        }
    };

    const handleCancelOrder = () => {
        setPendingOrder(null);
    };

    // Reset to page 1 when filter/sort changes
    useEffect(() => { setVehiclePage(1); }, [textFilter, activeTagFilters, sortBy]);

    const showReorderButtons = isOwner && sortBy === 'default'
        && textFilter.trim() === '' && activeTagFilters.length === 0
        && editingOrder;

    // ────────────────────────────────────────────────────────────────────────

    const barVisible = pendingDeletes.size > 0 || !!undoState || !!pendingOrder;

    return (
        <div className={barVisible ? 'pb-20' : ''}>
            {/* Header */}
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold">Vehicles</h2>
                <div className="inline-row">
                    {/* View mode toggle */}
                    <div className="view-toggle">
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
            <div className="vehicle-filter-bar">
                <input
                    type="text"
                    placeholder="Search by name, make, model, year…"
                    value={textFilter}
                    onChange={e => setTextFilter(e.target.value)}
                    className="form-input text-sm flex-1"
                />
                <select
                    value={sortBy}
                    onChange={e => setSortBy(e.target.value)}
                    className="form-input text-sm"
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
                        onClick={() => { if (editingOrder) setPendingOrder(null); setEditingOrder(v => !v); }}
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
                <div className="tag-filter-bar">
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


            {/* ── CARD VIEW ── */}
            {viewMode === 'card' && (
                <div className="vehicle-grid">
                    {pagedVehicles.map(vehicle => {
                        const isSelected = selectedVehicles.includes(vehicle.id);
                        const isPending  = pendingDeletes.has(vehicle.id);
                        const globalPos  = sortedFilteredVehicles.findIndex(v => v.id === vehicle.id);
                        const totalCount = sortedFilteredVehicles.length;
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

                                    <div className="relative z-10 flex flex-col flex-1">
                                        {isSelected && (
                                            <div
                                                className="absolute -top-5 -right-5 w-6 h-6 rounded-full flex items-center justify-center text-white font-bold"
                                                style={{ backgroundColor: 'var(--color-primary)' }}
                                            >
                                                &#10003;
                                            </div>
                                        )}

                                        {/* Reorder controls — shown in edit order mode */}
                                        {showReorderButtons && (
                                            <div className="reorder-controls mb-2 flex-wrap" onClick={e => e.stopPropagation()}>
                                                <button title="Top" onClick={e => { e.stopPropagation(); handleMoveVehicleToIndex(vehicle.id, 0); }} className="reorder-btn">⇈</button>
                                                <button title="-10" onClick={e => { e.stopPropagation(); handleMoveVehicleToIndex(vehicle.id, globalPos - 10); }} disabled={globalPos < 1} className="reorder-btn disabled:opacity-30">▲▲</button>
                                                <button title="Up" onClick={e => { e.stopPropagation(); handleMoveVehicle(vehicle.id, 'up'); }} disabled={globalPos === 0} className="reorder-btn disabled:opacity-30">▲</button>
                                                <input
                                                    type="number" min={1} max={totalCount}
                                                    defaultValue={globalPos + 1}
                                                    key={`pos-${vehicle.id}-${globalPos}`}
                                                    onClick={e => e.stopPropagation()}
                                                    onKeyDown={e => { if (e.key === 'Enter') { const v = parseInt(e.target.value); if (!isNaN(v)) handleMoveVehicleToIndex(vehicle.id, v - 1); e.target.blur(); } }}
                                                    onBlur={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v !== globalPos + 1) handleMoveVehicleToIndex(vehicle.id, v - 1); }}
                                                    className="w-10 h-6 text-center text-xs border rounded bg-white [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                                />
                                                <button title="Down" onClick={e => { e.stopPropagation(); handleMoveVehicle(vehicle.id, 'down'); }} disabled={globalPos === totalCount - 1} className="reorder-btn disabled:opacity-30">▼</button>
                                                <button title="+10" onClick={e => { e.stopPropagation(); handleMoveVehicleToIndex(vehicle.id, globalPos + 10); }} disabled={globalPos >= totalCount - 1} className="reorder-btn disabled:opacity-30">▼▼</button>
                                                <button title="Bottom" onClick={e => { e.stopPropagation(); handleMoveVehicleToIndex(vehicle.id, totalCount - 1); }} className="reorder-btn">⇊</button>
                                            </div>
                                        )}

                                        {/* Main row: left content + right action column */}
                                        <div className="flex flex-1 gap-3">
                                            {/* Left: vehicle info */}
                                            <div className="flex-1 min-w-0">
                                                <h3 className="text-xl font-bold mb-1">{vehicle.name}</h3>
                                                <p className="text-gray-600 mb-2">{vehicle.make} {vehicle.model} {vehicle.year}</p>
                                                <div className="text-sm text-gray-700 space-y-1">
                                                    {vehicle.battery && <p>Battery: {vehicle.battery} kWh</p>}
                                                    {vehicle.range && <p>Range: {vehicle.range} mi</p>}
                                                    {vehicle.power && <p>Power: {vehicle.power} kW</p>}
                                                </div>
                                                <p className="text-sm font-semibold mt-2">Tests: {vehicle.runs?.length || 0}</p>
                                                {vehicle.tags?.length > 0 && (
                                                    <div className="mt-2">
                                                        <TagPills vehicle={vehicle} />
                                                    </div>
                                                )}
                                            </div>
                                            {/* Right: vertical action column */}
                                            <div className="flex flex-col gap-1 flex-shrink-0 items-stretch" onClick={e => e.stopPropagation()}>
                                                <VisibilityPill vehicle={vehicle} fullWidth />
                                                <ActionButtons vehicle={vehicle} />
                                            </div>
                                        </div>

                                        {/* Footer: View Tests & Data full width */}
                                        <div className="mt-auto pt-3" onClick={e => e.stopPropagation()}>
                                            <button
                                                onClick={() => onViewRuns(vehicle)}
                                                className="w-full px-3 py-2 rounded-md text-sm font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 transition"
                                            >
                                                View Tests &amp; Data →
                                            </button>
                                        </div>
                                    </div>
                                </div>

                            </div>
                        );
                    })}
                </div>
            )}

            {/* ── LIST VIEW ── */}
            {viewMode === 'list' && (
                <div className="vehicle-list">
                    {pagedVehicles.map(vehicle => {
                        const isSelected = selectedVehicles.includes(vehicle.id);
                        const isPending  = pendingDeletes.has(vehicle.id);
                        const globalPos  = sortedFilteredVehicles.findIndex(v => v.id === vehicle.id);
                        const totalCount = sortedFilteredVehicles.length;
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

                                    {/* Reorder controls — owner only, default sort, no filters */}
                                    {showReorderButtons && (
                                        <div className="reorder-controls flex-shrink-0" onClick={e => e.stopPropagation()}>
                                            <button title="Top" onClick={e => { e.stopPropagation(); handleMoveVehicleToIndex(vehicle.id, 0); }} className="reorder-btn">⇈</button>
                                            <button title="-10" onClick={e => { e.stopPropagation(); handleMoveVehicleToIndex(vehicle.id, globalPos - 10); }} disabled={globalPos < 1} className="reorder-btn disabled:opacity-30">▲▲</button>
                                            <button title="Up" onClick={e => { e.stopPropagation(); handleMoveVehicle(vehicle.id, 'up'); }} disabled={globalPos === 0} className="reorder-btn disabled:opacity-30">▲</button>
                                            <input
                                                type="number" min={1} max={totalCount}
                                                defaultValue={globalPos + 1}
                                                key={`pos-${vehicle.id}-${globalPos}`}
                                                onClick={e => e.stopPropagation()}
                                                onKeyDown={e => { if (e.key === 'Enter') { const v = parseInt(e.target.value); if (!isNaN(v)) handleMoveVehicleToIndex(vehicle.id, v - 1); e.target.blur(); } }}
                                                onBlur={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v !== globalPos + 1) handleMoveVehicleToIndex(vehicle.id, v - 1); }}
                                                className="w-10 h-6 text-center text-xs border rounded bg-white [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                            />
                                            <button title="Down" onClick={e => { e.stopPropagation(); handleMoveVehicle(vehicle.id, 'down'); }} disabled={globalPos === totalCount - 1} className="reorder-btn disabled:opacity-30">▼</button>
                                            <button title="+10" onClick={e => { e.stopPropagation(); handleMoveVehicleToIndex(vehicle.id, globalPos + 10); }} disabled={globalPos >= totalCount - 1} className="reorder-btn disabled:opacity-30">▼▼</button>
                                            <button title="Bottom" onClick={e => { e.stopPropagation(); handleMoveVehicleToIndex(vehicle.id, totalCount - 1); }} className="reorder-btn">⇊</button>
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
                                        <p className="font-medium">Tests: {vehicle.runs?.length || 0}</p>
                                    </div>

                                    {/* View Tests & Data — dedicated column */}
                                    <button
                                        onClick={(e) => { e.stopPropagation(); onViewRuns(vehicle); }}
                                        className="px-4 py-2 rounded-md text-sm font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 transition flex-shrink-0"
                                    >
                                        View Tests &amp; Data →
                                    </button>

                                    {/* Action column: Visibility → Edit → Copy → Delete */}
                                    <div className="flex flex-col gap-1 flex-shrink-0 items-stretch w-28" onClick={e => e.stopPropagation()}>
                                        <VisibilityPill vehicle={vehicle} fullWidth />
                                        <ActionButtons vehicle={vehicle} />
                                    </div>
                                </div>

                            </div>
                        );
                    })}
                </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="vehicle-pagination">
                    <button onClick={() => setVehiclePage(1)} disabled={vehiclePage === 1} className="pagination-btn">«</button>
                    <button onClick={() => setVehiclePage(p => p - 1)} disabled={vehiclePage === 1} className="pagination-btn">‹</button>
                    <span className="text-sm text-gray-600">Page {vehiclePage} of {totalPages}</span>
                    <button onClick={() => setVehiclePage(p => p + 1)} disabled={vehiclePage === totalPages} className="pagination-btn">›</button>
                    <button onClick={() => setVehiclePage(totalPages)} disabled={vehiclePage === totalPages} className="pagination-btn">»</button>
                </div>
            )}

            {sortedFilteredVehicles.length === 0 && !showForm && (
                <div className="empty-state">
                    {textFilter.trim()
                        ? <p className="text-lg">No vehicles match "{textFilter.trim()}".</p>
                        : activeTagFilters.length > 0
                            ? <p className="text-lg">No vehicles match the selected tags.</p>
                            : <p className="text-lg">No vehicles yet. Click "Add Vehicle" to get started!</p>
                    }
                </div>
            )}

            {pendingOrder && (
                <div className="fixed bottom-0 left-0 right-0 z-40 bg-blue-50 border-t-2 border-blue-200 shadow-2xl">
                    <div className="max-w-7xl mx-auto px-6 py-3 flex items-center gap-4">
                        <span className="font-medium flex-1" style={{ color: 'var(--color-primary-text)' }}>
                            Vehicle default order changed
                        </span>
                        <button onClick={handleCancelOrder} disabled={savingOrder} className="btn btn-secondary text-sm">
                            Cancel
                        </button>
                        <button onClick={handleSaveOrder} disabled={savingOrder} className="btn btn-primary text-sm flex items-center gap-2">
                            {savingOrder && (
                                <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                                </svg>
                            )}
                            {savingOrder ? 'Saving…' : 'Save Order →'}
                        </button>
                    </div>
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

            {/* Add / Edit vehicle modal */}
            {showForm && (
                <div className="modal-overlay" onClick={handleCancel}>
                    <div className="modal-panel rounded-xl shadow-2xl max-w-xl w-full mx-4" onClick={e => e.stopPropagation()}>
                        <EditVehicleForm {...editFormProps} />
                    </div>
                </div>
            )}
        </div>
    );
}

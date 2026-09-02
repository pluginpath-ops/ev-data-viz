import { useState, useEffect, useMemo, useRef } from 'react';
import { useAppContext } from '../context/AppContext';
import { DATA_CATEGORIES, vehicleDataCategories, hasDataCategory, filterByDataCategories } from '../utils/vehicleDataCategories';
import { distanceValue, distanceUnit } from '../utils/unitConversions';
import StatCell from './StatCell';
import VehicleMedia from './vehicles/VehicleMedia';
import TestedFigure from './vehicles/TestedFigure';
import { testedRangeSummary } from '../utils/testedRange';
import { useDeleteQueue } from '../hooks/useDeleteQueue';
import DeleteQueueBar from './DeleteQueueBar';
import EditSpecsForm from './EditSpecsForm';
import ViewSpecsModal from './ViewSpecsModal';
import LazyBoundary from './LazyBoundary';
import { EditVehicleForm, ImportVehiclesModal } from './lazyComponents';

// ── Test-count row ────────────────────────────────────────────────────────────

/**
 * Renders a "Tests: Charging (n) Range (n) EPA (n)" line that matches the
 * styling of Battery/Range rows. "Tests:" inherits the parent's text-sm color;
 * the type names are 1pt smaller and colored. Zero-count categories omitted.
 */
function TestCountPills({ vehicle, performanceCounts = {} }) {
    const counts = vehicleDataCategories(vehicle, performanceCounts);
    const shown = DATA_CATEGORIES.filter(c => counts[c.key] > 0);
    if (shown.length === 0) return null;

    return (
        <p className="flex flex-wrap items-baseline gap-x-1.5">
            <span>Tests:</span>
            {shown.map(c => (
                <span key={c.key} className={`text-[13px] font-medium ${c.colorClass}`}>
                    {c.label} ({counts[c.key]})
                </span>
            ))}
        </p>
    );
}

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
    vehicles, selectedVehicles, onToggleSelection, onSelectAllVisible, onClearAllVisible, onAdd, onUpdate, onDelete, onViewRuns,
    canCreate, canEdit, canDelete, canPublish, onToggleVisibility,
    tags, onCreateTag, onSyncVehicleTags, onUploadVehicleImage,
    onReorderVehicles, onDuplicateVehicle,
    onUpdateVehicleSpecs, specCustomFieldSuggestions,
    pendingEditVehicle, onClearPendingEdit,
    savedState, onSaveState,
}) {
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [formData, setFormData] = useState({
        name: '', make: '', model: '', trim: '', year: '',
        battery: '', range: '', manufacturer_id: null,
    });
    const [mfgFilterStates, setMfgFilterStates] = useState(savedState?.mfgFilterStates ?? {}); // { [mfgId]: 'or' | 'not' }
    const [modelFilter, setModelFilter] = useState(savedState?.modelFilter ?? new Set());
    const [formTags, setFormTags] = useState([]);
    const [newTagName, setNewTagName] = useState('');
    const [tagFilterStates, setTagFilterStates] = useState(savedState?.tagFilterStates ?? {}); // { [tagId]: 'or' | 'and' | 'not' }
    const [dataFilterStates, setDataFilterStates] = useState(savedState?.dataFilterStates ?? {}); // { [categoryKey]: 'or' | 'and' | 'not' }
    const [imageUploading, setImageUploading] = useState(false);
    const [viewMode, setViewMode] = useState(savedState?.viewMode ?? 'card'); // 'card' | 'list'
    const [sortBy, setSortBy] = useState(savedState?.sortBy ?? 'default');
    const [textFilter, setTextFilter] = useState(savedState?.textFilter ?? '');
    const [editingOrder, setEditingOrder] = useState(false);
    const [pendingOrder, setPendingOrder] = useState(null);   // [{id, sort_order}] or null
    const [savingOrder, setSavingOrder]   = useState(false);
    const [duplicatingId, setDuplicatingId] = useState(null);
    const [vehiclePage, setVehiclePage] = useState(savedState?.vehiclePage ?? 1);
    const [specsEditingVehicle, setSpecsEditingVehicle] = useState(null);
    const [specsViewingVehicle, setSpecsViewingVehicle] = useState(null);
    const [showImportModal, setShowImportModal] = useState(false);
    const VEHICLES_PER_PAGE = 24;

    // Keep a ref always pointing at latest filter/sort/page so the unmount
    // cleanup can save it without stale-closure issues.
    const persistableState = useRef({});
    useEffect(() => {
        persistableState.current = {
            textFilter, tagFilterStates, mfgFilterStates, dataFilterStates, modelFilter,
            sortBy, viewMode, vehiclePage,
        };
    }, [textFilter, tagFilterStates, mfgFilterStates, dataFilterStates, modelFilter, sortBy, viewMode, vehiclePage]);

    // Save state back to App when this tab is left (unmount).
    useEffect(() => {
        return () => { onSaveState?.(persistableState.current); };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps -- intentional: fire only on unmount

    const {
        units, manufacturers, addManufacturer, isContributor, addSpecLink, deleteSpecLink, user,
        performanceCounts,
    } = useAppContext();

    const {
        pendingDeletes, committedDeletes, undoState, secondsLeft,
        queueDelete, restoreItem, clearQueue, commitDeletes, undoDelete,
    } = useDeleteQueue(onDelete);

    // Open edit modal for a vehicle duplicated from the Tests tab
    useEffect(() => {
        if (!pendingEditVehicle) return;
        onClearPendingEdit();
        handleEdit(pendingEditVehicle, { stopPropagation: () => {} });
    }, []); // run once on mount — pendingEditVehicle is set before navigation

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
        setFormData({ name: '', make: '', model: '', trim: '', year: '', battery: '', range: '', manufacturer_id: null });
        setShowForm(false);
    };

    const handleEdit = (vehicle, e) => {
        e.stopPropagation();
        setFormData({
            name: vehicle.name,
            make: vehicle.make || '',
            model: vehicle.model || '',
            trim: vehicle.trim || '',
            year: vehicle.year || '',
            battery: vehicle.battery || '',
            range: vehicle.range || '',
            manufacturer_id: vehicle.manufacturer?.id ?? null,
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
        setFormData({ name: '', make: '', model: '', trim: '', year: '', battery: '', range: '', manufacturer_id: null });
    };

    const handleDuplicateVehicle = async (vehicle, e) => {
        e.stopPropagation();
        setDuplicatingId(vehicle.id);
        try {
            const newVehicle = await onDuplicateVehicle(vehicle.id);
            if (newVehicle) handleEdit(newVehicle, { stopPropagation: () => {} });
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

    const handleImageReady = async (renditions) => {
        if (!renditions || !editingId) return;
        setImageUploading(true);
        await onUploadVehicleImage(editingId, renditions);
        setImageUploading(false);
    };

    // Cycle brand filter state: N/A → OR (green) → NOT (red) → N/A  (no AND — doesn't make sense for brands)
    const cycleMfgFilter = (mfgId) => {
        setMfgFilterStates(prev => {
            const cur = prev[mfgId];
            if (!cur)         return { ...prev, [mfgId]: 'or' };
            if (cur === 'or') return { ...prev, [mfgId]: 'not' };
            const next = { ...prev }; delete next[mfgId]; return next; // not → N/A
        });
        setModelFilter(new Set()); // reset model filter when brand filter changes
    };

    // Cycle tag filter state: N/A → OR (green) → AND (blue) → NOT (red) → N/A
    const cycleTagFilter = (tagId) => {
        setTagFilterStates(prev => {
            const cur = prev[tagId];
            if (!cur)          return { ...prev, [tagId]: 'or' };
            if (cur === 'or')  return { ...prev, [tagId]: 'and' };
            if (cur === 'and') return { ...prev, [tagId]: 'not' };
            const next = { ...prev }; delete next[tagId]; return next; // not → N/A
        });
    };

    // AND → NOT → clear. No OR state: the useful questions about data coverage
    // are "has charging AND range" and "has no EPA data" — nobody asks for
    // "charging or braking", so that state would only sit in the way.
    const cycleDataFilter = (key) => {
        setDataFilterStates(prev => {
            const cur = prev[key];
            if (!cur)          return { ...prev, [key]: 'and' };
            if (cur === 'and') return { ...prev, [key]: 'not' };
            const next = { ...prev }; delete next[key]; return next;
        });
    };

    // Stage 1: quad-state tag filter + committed-delete filter
    const orTags  = Object.entries(tagFilterStates).filter(([, s]) => s === 'or' ).map(([id]) => Number(id));
    const andTags = Object.entries(tagFilterStates).filter(([, s]) => s === 'and').map(([id]) => Number(id));
    const notTags = Object.entries(tagFilterStates).filter(([, s]) => s === 'not').map(([id]) => Number(id));

    const tagFiltered = vehicles.filter(v => {
        if (notTags.some(id => v.tags?.some(t => t.id === id))) return false;
        if (andTags.length && !andTags.every(id => v.tags?.some(t => t.id === id))) return false;
        if (orTags.length  && !orTags.some(id  => v.tags?.some(t => t.id === id))) return false;
        return true;
    }).filter(v => !committedDeletes.has(v.id));

    // Stage 2: manufacturer filter (OR = show only these brands, NOT = hide these brands)
    const orMfgs  = Object.entries(mfgFilterStates).filter(([, s]) => s === 'or' ).map(([id]) => Number(id));
    const notMfgs = Object.entries(mfgFilterStates).filter(([, s]) => s === 'not').map(([id]) => Number(id));
    const mfgFiltered = (orMfgs.length === 0 && notMfgs.length === 0) ? tagFiltered : tagFiltered.filter(v => {
        if (notMfgs.length && notMfgs.includes(v.manufacturer?.id ?? null)) return false;
        if (orMfgs.length  && !orMfgs.includes(v.manufacturer?.id ?? null)) return false;
        return true;
    });

    // Stage 2b: model filter — only active when at least one OR-brand is selected
    const availableModels = orMfgs.length > 0
        ? [...new Set(mfgFiltered.map(v => v.model).filter(Boolean))].sort()
        : [];
    const modelFiltered = modelFilter.size === 0 ? mfgFiltered : mfgFiltered.filter(v =>
        v.model && modelFilter.has(v.model)
    );

    // Stage 2c: data-type filter — which kinds of test data the vehicle holds
    const dataFiltered = filterByDataCategories(modelFiltered, dataFilterStates, performanceCounts);

    // Stage 3: text filter
    const textLower = textFilter.trim().toLowerCase();
    const textFiltered = !textLower ? dataFiltered : dataFiltered.filter(v => {
        if ([v.name, v.make, v.model].some(f => (f || '').toLowerCase().includes(textLower))) return true;
        const year = String(v.year || '');
        if (year.toLowerCase().includes(textLower)) return true;
        // Range match: "2022-2024" should match a search for "2023"
        const queryNum = parseInt(textLower, 10);
        if (!isNaN(queryNum) && /^\d{4}\s*[-–]\s*\d{4}$/.test(year)) {
            const parts = year.split(/[-–]/).map(s => parseInt(s.trim(), 10));
            if (parts.length === 2) return queryNum >= parts[0] && queryNum <= parts[1];
        }
        return false;
    });

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
            case 'mfg_az': {
                const aMfg = a.manufacturer?.name || a.make || '';
                const bMfg = b.manufacturer?.name || b.make || '';
                const mfgCmp = aMfg.localeCompare(bMfg);
                return mfgCmp !== 0 ? mfgCmp : (a.name || '').localeCompare(b.name || '');
            }
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

    // `onMedia` places it on the photograph's top-right corner, on the dark
    // plate that keeps it readable over any image. Off the media it is an
    // ordinary inline badge. The emoji are gone: a lock and a globe were doing
    // the work of a word, at the cost of rendering differently on every
    // platform and carrying no meaning to a screen reader.
    const VisibilityPill = ({ vehicle, onMedia }) => {
        if (!user) return null;
        const isPublic = vehicle.visibility === 'public';
        const cls = `vehicle-media-badge ${isPublic ? 'is-public' : 'is-private'}`
            + (onMedia ? '' : ' is-inline');
        const label = isPublic ? 'PUBLIC' : 'PRIVATE';
        if (canPublish()) {
            return (
                <button
                    onClick={(e) => { e.stopPropagation(); onToggleVisibility(vehicle.id, isPublic ? 'private' : 'public'); }}
                    title={`Click to make ${isPublic ? 'private' : 'public'}`}
                    className={cls}
                >
                    {label}
                </button>
            );
        }
        return <span className={cls}>{label}</span>;
    };

    const ActionButtons = ({ vehicle }) => {
        const isPending = pendingDeletes.has(vehicle.id);
        return (
            <div className="flex flex-col gap-1 items-stretch">
                {canEdit(vehicle) && (
                    <button
                        onClick={(e) => handleEdit(vehicle, e)}
                        className="px-3 py-1 rounded-md text-xs font-medium bg-[var(--color-surface-sunken)] text-secondary hover:bg-[var(--color-surface-muted)] transition"
                    >
                        Edit
                    </button>
                )}
                {canEdit(vehicle) ? (
                    <button
                        onClick={(e) => { e.stopPropagation(); setSpecsEditingVehicle(vehicle); }}
                        className="px-3 py-1 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition"
                    >
                        Specs
                    </button>
                ) : vehicle.specs && Object.keys(vehicle.specs).length > 0 && (
                    <button
                        onClick={(e) => { e.stopPropagation(); setSpecsViewingVehicle(vehicle); }}
                        className="px-3 py-1 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition"
                    >
                        Specs
                    </button>
                )}
                {canEdit(vehicle) && (
                    <button
                        onClick={(e) => handleDuplicateVehicle(vehicle, e)}
                        disabled={duplicatingId !== null}
                        title="Duplicate vehicle and all tests"
                        className="px-3 py-1 rounded-md text-xs font-medium bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition disabled:opacity-50 flex items-center gap-1"
                    >
                        {duplicatingId === vehicle.id
                            ? <><span className="inline-block w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"/>Copying…</>
                            : '⧉ Copy'}
                    </button>
                )}
                {canDelete(vehicle) && (
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
        imageUploading, onImageReady: handleImageReady,
        onSubmit: handleSubmit, onCancel: handleCancel,
        // Manufacturer
        manufacturers,
        onAddManufacturer: addManufacturer,
        // EPA test groups are assigned in Tests & Data, not in this edit modal.
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

    // Reset to page 1 when filter/sort changes — but NOT on the initial mount,
    // otherwise the effect would immediately overwrite the restored vehiclePage.
    const didMount = useRef(false);
    useEffect(() => {
        if (!didMount.current) { didMount.current = true; return; }
        setVehiclePage(1);
    }, [textFilter, tagFilterStates, sortBy, mfgFilterStates, dataFilterStates]);

    const showReorderButtons = canEdit({}) && sortBy === 'default'
        && textFilter.trim() === '' && Object.keys(tagFilterStates).length === 0
        && editingOrder;

    // ────────────────────────────────────────────────────────────────────────

    const barVisible = pendingDeletes.size > 0 || !!undoState || !!pendingOrder;

    // Counted from what is already loaded rather than fetched: this is a glance
    // beside the heading, not a report, and it must not cost a round trip. The
    // whole list, deliberately — a survey that moved when you typed in the
    // search box would be describing the filter, not the fleet.
    const totalTests = useMemo(
        () => vehicles.reduce((n, v) => n + (v.runs?.length ?? 0), 0),
        [vehicles],
    );

    return (
        <div className={barVisible ? 'pb-20' : ''}>
            {/* Header */}
            <div className="flex justify-between items-center mb-4">
                <div className="flex items-baseline gap-2">
                    <h2 className="text-2xl font-bold">Vehicles</h2>
                    {/* A survey of the corpus, not of the selection. It sat in
                      * the nav's selection strip, where "65 vehicles · 129
                      * tests" read as a count of what you had selected — a
                      * category error, not a styling one. Beside the title it
                      * describes the thing the title names, and it appears on
                      * this tab only, because nowhere else is looking at the
                      * whole fleet.
                      *
                      * Counts only: nothing in the loaded shape carries a
                      * reliable "last updated", and inventing one would be
                      * worse than omitting it. */}
                    <span className="fleet-state">
                        {vehicles.length} vehicles · {totalTests} tests
                    </span>
                </div>
                <div className="inline-row">
                    {/* View mode toggle */}
                    <div className="view-toggle">
                        <button
                            onClick={() => setViewMode('card')}
                            title="Card view"
                            className={`px-2 py-1.5 transition ${viewMode === 'card' ? 'bg-[var(--color-surface-muted)] text-[var(--color-text-primary)]' : 'hover:bg-[var(--color-surface-sunken)]'}`}
                        >
                            <CardViewIcon />
                        </button>
                        <button
                            onClick={() => setViewMode('list')}
                            title="List view"
                            className={`px-2 py-1.5 transition ${viewMode === 'list' ? 'bg-[var(--color-surface-muted)] text-[var(--color-text-primary)]' : 'hover:bg-[var(--color-surface-sunken)]'}`}
                        >
                            <ListViewIcon />
                        </button>
                    </div>
                    {canCreate && (
                        <>
                            <button
                                onClick={() => setShowImportModal(true)}
                                className="btn btn-secondary"
                                title="Bulk-add vehicles and specs from a CSV or JSON file"
                            >
                                Import…
                            </button>
                            <button
                                onClick={() => { setEditingId(null); setShowForm(!showForm); }}
                                className="btn btn-primary"
                            >
                                {showForm && !editingId ? 'Cancel' : '+ Add Vehicle'}
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Sort + search bar */}
            <div className="vehicle-filter-bar">
                <input
                    type="text"
                    placeholder="Search by name, make, model, year…"
                    value={textFilter}
                    onChange={e => setTextFilter(e.target.value)}
                    className="form-input form-input flex-1"
                />
                <select
                    value={sortBy}
                    onChange={e => setSortBy(e.target.value)}
                    className="form-input form-input"
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
                    <option value="mfg_az">Group by Manufacturer</option>
                </select>
                {canEdit({}) && sortBy === 'default' && textFilter.trim() === '' && Object.keys(tagFilterStates).length === 0 && (
                    <button
                        onClick={() => { if (editingOrder) setPendingOrder(null); setEditingOrder(v => !v); }}
                        className={`text-sm px-3 py-2 rounded border transition flex-shrink-0 ${
                            editingOrder
                                ? 'bg-blue-50 border-blue-300 text-blue-700'
                                : 'bg-[var(--color-surface-muted)] border-[var(--color-border)] text-secondary hover:bg-[var(--color-surface-sunken)]'
                        }`}
                        style={editingOrder ? { backgroundColor: 'var(--color-primary-light)', borderColor: 'var(--color-primary)', color: 'var(--color-primary-text)' } : {}}
                    >
                        ✏️ Edit Order
                    </button>
                )}
            </div>

            {/* Tag filter bar — quad-state: N/A → OR (green) → AND (blue) → NOT (red) */}
            {tags.length > 0 && (
                <div className="tag-filter-bar">
                    <span className="text-sm font-medium text-secondary flex-shrink-0">Filter:</span>
                    {tags.map(tag => {
                        const state = tagFilterStates[tag.id]; // undefined = 'na'
                        const stateClass = state === 'or' ? 'tag-filter-or'
                            : state === 'and' ? 'tag-filter-and'
                            : state === 'not' ? 'tag-filter-not'
                            : 'tag-filter-na';
                        const tooltip = state === 'or'  ? `OR — any vehicle with "${tag.name}" is shown. Click for AND.`
                            : state === 'and' ? `AND — vehicles must have "${tag.name}". Click for NOT.`
                            : state === 'not' ? `NOT — vehicles with "${tag.name}" are hidden. Click to clear.`
                            : `Click to filter: OR (show any vehicle with "${tag.name}")`;
                        return (
                            <button
                                key={tag.id}
                                onClick={() => cycleTagFilter(tag.id)}
                                className={`tag-filter-btn ${stateClass}`}
                                title={tooltip}
                            >
                                {tag.name}
                            </button>
                        );
                    })}
                    {Object.keys(tagFilterStates).length > 0 && (
                        <button
                            onClick={() => setTagFilterStates({})}
                            className="text-xs text-meta hover:text-secondary underline ml-1 flex-shrink-0"
                        >
                            Clear
                        </button>
                    )}
                    <span className="tag-filter-legend" title="Click a tag to cycle: OR (green) shows vehicles with any matching tag · AND (blue) requires all matching tags · NOT (red) hides matching vehicles">
                        <span className="text-green-500">●</span> OR
                        <span className="text-blue-500 ml-1">●</span> AND
                        <span className="text-red-500 ml-1">●</span> NOT
                    </span>
                </div>
            )}
            {/* Manufacturer filter bar — tri-state: N/A → OR (green) → NOT (red) → N/A */}
            {manufacturers.length > 0 && (
                <div className="tag-filter-bar">
                    <span className="text-sm font-medium text-secondary flex-shrink-0">Brand:</span>
                    {manufacturers.map(mfg => {
                        const state = mfgFilterStates[mfg.id];
                        const stateClass = state === 'or'  ? 'tag-filter-or'
                            : state === 'not' ? 'tag-filter-not'
                            : 'tag-filter-na';
                        const tooltip = state === 'or'  ? `OR — showing only "${mfg.name}" vehicles. Click for NOT.`
                            : state === 'not' ? `NOT — hiding "${mfg.name}" vehicles. Click to clear.`
                            : `Click to filter: OR (show only "${mfg.name}" vehicles)`;
                        return (
                            <button
                                key={mfg.id}
                                onClick={() => cycleMfgFilter(mfg.id)}
                                className={`tag-filter-btn ${stateClass}`}
                                title={tooltip}
                            >
                                {mfg.name}
                            </button>
                        );
                    })}
                    {Object.keys(mfgFilterStates).length > 0 && (
                        <button
                            onClick={() => { setMfgFilterStates({}); setModelFilter(new Set()); }}
                            className="text-xs text-meta hover:text-secondary underline ml-1 flex-shrink-0"
                        >
                            Clear
                        </button>
                    )}
                </div>
            )}

            {/* Model filter bar — visible when a brand is selected and multiple models exist */}
            {availableModels.length > 1 && (
                <div className="tag-filter-bar">
                    <span className="text-sm font-medium text-secondary flex-shrink-0">Model:</span>
                    {availableModels.map(model => {
                        const active = modelFilter.has(model);
                        return (
                            <button
                                key={model}
                                onClick={() => setModelFilter(prev => {
                                    const next = new Set(prev);
                                    next.has(model) ? next.delete(model) : next.add(model);
                                    return next;
                                })}
                                className={`tag-filter-btn ${active ? 'tag-filter-or' : 'tag-filter-na'}`}
                                title={active ? `Remove "${model}" filter` : `Show only ${model} variants`}
                            >
                                {model}
                            </button>
                        );
                    })}
                    {modelFilter.size > 0 && (
                        <button
                            onClick={() => setModelFilter(new Set())}
                            className="text-xs text-meta hover:text-secondary underline ml-1 flex-shrink-0"
                        >
                            Clear
                        </button>
                    )}
                </div>
            )}

            {/* Data filter bar — which kinds of test data a vehicle holds.
                Tri-state AND (blue) → NOT (red) → clear; no OR, see cycleDataFilter.
                Counts are of the vehicles still standing after the tag/brand/model
                filters, so a zero here means "none left", not "none in the database". */}
            <div className="tag-filter-bar">
                <span className="text-sm font-medium text-secondary flex-shrink-0">Data:</span>
                {DATA_CATEGORIES.map(cat => {
                    const state = dataFilterStates[cat.key];
                    const stateClass = state === 'and' ? 'tag-filter-and'
                        : state === 'not' ? 'tag-filter-not'
                        : 'tag-filter-na';
                    const available = modelFiltered.filter(v => hasDataCategory(v, cat.key, performanceCounts)).length;
                    const tooltip = state === 'and' ? `AND — vehicles must have ${cat.label} data. Click for NOT.`
                        : state === 'not' ? `NOT — vehicles with ${cat.label} data are hidden. Click to clear.`
                        : `Click to show only vehicles with ${cat.label} data`;
                    return (
                        <button
                            key={cat.key}
                            onClick={() => cycleDataFilter(cat.key)}
                            className={`tag-filter-btn ${stateClass}`}
                            title={tooltip}
                        >
                            {cat.label} ({available})
                        </button>
                    );
                })}
                {Object.keys(dataFilterStates).length > 0 && (
                    <button
                        onClick={() => setDataFilterStates({})}
                        className="text-xs text-meta hover:text-secondary underline ml-1 flex-shrink-0"
                    >
                        Clear
                    </button>
                )}
            </div>

            {/* Select All / Clear All Visible */}
            {textFiltered.length > 0 && (
                <div className="flex justify-end gap-2 mb-4 -mt-3">
                    <button
                        onClick={() => onSelectAllVisible(textFiltered.map(v => v.id))}
                        className="btn btn-primary"
                        title="Add all currently visible vehicles to the comparison selection"
                    >
                        Select All Visible ({textFiltered.length})
                    </button>
                    <button
                        onClick={() => onClearAllVisible(textFiltered.map(v => v.id))}
                        className="btn btn-secondary"
                        title="Remove all currently visible vehicles from the comparison selection"
                    >
                        Clear All Visible
                    </button>
                </div>
            )}


            {/* ── CARD VIEW ── */}
            {viewMode === 'card' && (
                <div className="vehicle-grid">
                    {pagedVehicles.map((vehicle, pageIdx) => {
                        const isSelected = selectedVehicles.includes(vehicle.id);
                        const isPending  = pendingDeletes.has(vehicle.id);
                        const globalPos  = sortedFilteredVehicles.findIndex(v => v.id === vehicle.id);
                        const totalCount = sortedFilteredVehicles.length;
                        // Insert a manufacturer group header when group changes
                        const mfgName = vehicle.manufacturer?.name || vehicle.make || 'Unknown';
                        const prevVehicle = pagedVehicles[pageIdx - 1];
                        const prevMfgName = prevVehicle ? (prevVehicle.manufacturer?.name || prevVehicle.make || 'Unknown') : null;
                        const showMfgHeader = sortBy === 'mfg_az' && mfgName !== prevMfgName;
                        return (
                            <div key={vehicle.id} className="contents">
                                {showMfgHeader && (
                                    <div className="col-span-full pt-2 pb-1 border-b border-[var(--color-border)] mb-1">
                                        <h3 className="text-sm font-semibold text-secondary uppercase tracking-wider">{mfgName}</h3>
                                    </div>
                                )}
                                <div
                                    onClick={() => handleCardClick(vehicle)}
                                    className={`vehicle-card${isSelected ? ' is-selected' : ''}${isPending ? ' is-pending' : ''}`}
                                >
                                    {/* The photograph as content: a band with a
                                        scrim carrying the identity, rather than a
                                        full-card background under an 80% wash that
                                        made it unreadable AND unlookable-at. */}
                                    <VehicleMedia vehicle={vehicle}>
                                        <div className="vehicle-media-title">
                                            <h3>{vehicle.name}</h3>
                                            <p>{[vehicle.make, vehicle.model, vehicle.trim, vehicle.year].filter(Boolean).join(' · ')}</p>
                                        </div>
                                        <VisibilityPill vehicle={vehicle} onMedia />
                                    </VehicleMedia>

                                    <div className="vehicle-card-body">
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
                                                    className="form-input form-input reorder-position-input"
                                                />
                                                <button title="Down" onClick={e => { e.stopPropagation(); handleMoveVehicle(vehicle.id, 'down'); }} disabled={globalPos === totalCount - 1} className="reorder-btn disabled:opacity-30">▼</button>
                                                <button title="+10" onClick={e => { e.stopPropagation(); handleMoveVehicleToIndex(vehicle.id, globalPos + 10); }} disabled={globalPos >= totalCount - 1} className="reorder-btn disabled:opacity-30">▼▼</button>
                                                <button title="Bottom" onClick={e => { e.stopPropagation(); handleMoveVehicleToIndex(vehicle.id, totalCount - 1); }} className="reorder-btn">⇊</button>
                                            </div>
                                        )}

                                        {/* The figures, set as figures. They were prose —
                                            "Battery: 82 kWh" in the same face and weight
                                            as the sentence beside it — which made the
                                            LABELS the loudest thing on a card whose whole
                                            job is to compare numbers. */}
                                        <div className="stat-grid">
                                            <StatCell label="Battery" value={vehicle.battery} unit="kWh" />
                                            <StatCell
                                                label="EPA range"
                                                value={vehicle.range ? distanceValue(vehicle.range, units) : null}
                                                unit={distanceUnit(units)}
                                            />
                                            {vehicle.power != null && (
                                                <StatCell label="Power" value={vehicle.power} unit="kW" />
                                            )}
                                        </div>

                                        {/* The measurement, with the conditions that
                                            produced it and no verdict attached. */}
                                        <TestedFigure tested={testedRangeSummary(vehicle)} units={units} />

                                        <TestCountPills vehicle={vehicle} performanceCounts={performanceCounts} />

                                        {vehicle.tags?.length > 0 && <TagPills vehicle={vehicle} />}

                                        {/* Actions sit at the foot of the card, on one
                                            row: the primary action reads first and the
                                            per-vehicle controls follow it, rather than
                                            occupying a column that squeezed the content
                                            beside them. */}
                                        <div className="vehicle-card-actions" onClick={e => e.stopPropagation()}>
                                            <button
                                                onClick={() => onViewRuns(vehicle)}
                                                className="btn btn-primary flex-1"
                                            >
                                                View Tests &amp; Data →
                                            </button>
                                            <ActionButtons vehicle={vehicle} />
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
                    {pagedVehicles.map((vehicle, pageIdx) => {
                        const isSelected = selectedVehicles.includes(vehicle.id);
                        const isPending  = pendingDeletes.has(vehicle.id);
                        const globalPos  = sortedFilteredVehicles.findIndex(v => v.id === vehicle.id);
                        const totalCount = sortedFilteredVehicles.length;
                        const mfgName = vehicle.manufacturer?.name || vehicle.make || 'Unknown';
                        const prevVehicle = pagedVehicles[pageIdx - 1];
                        const prevMfgName = prevVehicle ? (prevVehicle.manufacturer?.name || prevVehicle.make || 'Unknown') : null;
                        const showMfgHeader = sortBy === 'mfg_az' && mfgName !== prevMfgName;
                        return (
                            <div key={vehicle.id}>
                                {showMfgHeader && (
                                    <div className="pt-2 pb-1 border-b border-[var(--color-border)] mb-1">
                                        <h3 className="text-sm font-semibold text-secondary uppercase tracking-wider">{mfgName}</h3>
                                    </div>
                                )}
                                <div
                                    onClick={() => handleCardClick(vehicle)}
                                    className={`vehicle-card vehicle-row${isSelected ? ' is-selected' : ''}${isPending ? ' is-pending' : ''}`}
                                >

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
                                                className="form-input form-input reorder-position-input"
                                            />
                                            <button title="Down" onClick={e => { e.stopPropagation(); handleMoveVehicle(vehicle.id, 'down'); }} disabled={globalPos === totalCount - 1} className="reorder-btn disabled:opacity-30">▼</button>
                                            <button title="+10" onClick={e => { e.stopPropagation(); handleMoveVehicleToIndex(vehicle.id, globalPos + 10); }} disabled={globalPos >= totalCount - 1} className="reorder-btn disabled:opacity-30">▼▼</button>
                                            <button title="Bottom" onClick={e => { e.stopPropagation(); handleMoveVehicleToIndex(vehicle.id, totalCount - 1); }} className="reorder-btn">⇊</button>
                                        </div>
                                    )}

                                    {/* Thumbnail — the same component the card uses, so
                                        a photoless vehicle reads identically in both
                                        views. The 🚗 it replaced said "broken image". */}
                                    <VehicleMedia
                                        vehicle={vehicle}
                                        height={54}
                                        className="vehicle-media-thumb"
                                    />

                                    {/* Name + make + tags */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <h3 className="font-bold text-lg leading-tight truncate">{vehicle.name}</h3>
                                            <VisibilityPill vehicle={vehicle} />
                                        </div>
                                        <p className="text-secondary text-sm mb-1">{[vehicle.make, vehicle.model, vehicle.trim, vehicle.year].filter(Boolean).join(' · ')}</p>
                                        <TagPills vehicle={vehicle} />
                                    </div>

                                    {/* Specs */}
                                    <div className="w-64 flex-shrink-0 hidden md:flex flex-col gap-1.5">
                                        <div className="stat-grid">
                                            <StatCell label="Battery" value={vehicle.battery} unit="kWh" />
                                            <StatCell
                                                label="Range"
                                                value={vehicle.range ? distanceValue(vehicle.range, units) : null}
                                                unit={distanceUnit(units)}
                                                title="EPA range"
                                            />
                                        </div>
                                        <TestedFigure tested={testedRangeSummary(vehicle)} units={units} />
                                        <TestCountPills vehicle={vehicle} performanceCounts={performanceCounts} />
                                    </div>

                                    {/* Actions. Visibility moved up beside the name —
                                        it describes the vehicle, not what you can do
                                        to it, and stacking it above the buttons made
                                        it read as a fourth one. */}
                                    <div className="flex items-center gap-1.5 flex-shrink-0" onClick={e => e.stopPropagation()}>
                                        <button
                                            onClick={() => onViewRuns(vehicle)}
                                            className="btn btn-primary"
                                        >
                                            Tests &amp; Data →
                                        </button>
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
                    <span className="text-sm text-secondary">Page {vehiclePage} of {totalPages}</span>
                    <button onClick={() => setVehiclePage(p => p + 1)} disabled={vehiclePage === totalPages} className="pagination-btn">›</button>
                    <button onClick={() => setVehiclePage(totalPages)} disabled={vehiclePage === totalPages} className="pagination-btn">»</button>
                </div>
            )}

            {sortedFilteredVehicles.length === 0 && !showForm && (
                <div className="empty-state">
                    {textFilter.trim()
                        ? <p className="text-lg">No vehicles match "{textFilter.trim()}".</p>
                        : Object.keys(tagFilterStates).length > 0 || Object.keys(mfgFilterStates).length > 0
                            ? <p className="text-lg">No vehicles match the active filters.</p>
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
                    <div className="modal-panel rounded-xl shadow-2xl max-w-xl w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                        <LazyBoundary><EditVehicleForm {...editFormProps} /></LazyBoundary>
                    </div>
                </div>
            )}

            {/* Edit Specs modal (contributors/owners) */}
            {specsEditingVehicle && (
                <EditSpecsForm
                    vehicle={specsEditingVehicle}
                    specCustomFieldSuggestions={specCustomFieldSuggestions}
                    onSave={onUpdateVehicleSpecs}
                    onClose={() => setSpecsEditingVehicle(null)}
                />
            )}

            {/* View Specs modal (read-only, all users) */}
            {specsViewingVehicle && (
                <ViewSpecsModal
                    vehicle={specsViewingVehicle}
                    onClose={() => setSpecsViewingVehicle(null)}
                />
            )}

            {/* Bulk import modal (contributors/owners) */}
            {showImportModal && (
                <LazyBoundary>
                    <ImportVehiclesModal onClose={() => setShowImportModal(false)} />
                </LazyBoundary>
            )}
        </div>
    );
}

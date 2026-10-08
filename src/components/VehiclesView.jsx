import NewVariantButton from './NewVariantButton';
import { ownValues } from '../utils/vehicleInheritance';
import { useState, useEffect, useMemo, useRef } from 'react';
import SeriesColorPicker from './SeriesColorPicker';
import { DEFAULT_RUN_COLOR } from '../utils/colorUtils';
import { filterTests } from '../utils/runUtils';
import { EMPTY_VEHICLE_FORM, vehicleFormFrom } from '../utils/vehicleForm';
import { useAppContext } from '../context/AppContext';
import { DATA_CATEGORIES, vehicleDataCategories, vehiclePooledCounts } from '../utils/vehicleDataCategories';
import { distanceValue, distanceUnit } from '../utils/unitConversions';
import StatCell from './StatCell';
import VehicleMedia from './vehicles/VehicleMedia';
import { CARD_BAND_HEIGHT } from '../utils/cardBand';
import TestedFigure from './vehicles/TestedFigure';
import { PlatformLine } from './vehicles/PlatformLine';
import { testedRangeSummary } from '../utils/testedRange';
import { useDeleteQueue } from '../hooks/useDeleteQueue';
import DeleteQueueBar from './DeleteQueueBar';
import EditSpecsForm from './EditSpecsForm';
import ViewSpecsModal from './ViewSpecsModal';
import VehicleFilterBar from './vehicles/VehicleFilterBar';
import { useFilteredVehicles } from '../hooks/useFilteredVehicles';
import { EMPTY_VEHICLE_FILTERS, filtersActive } from '../utils/vehicleFilters';
import VehicleListHeader from './vehicles/VehicleListHeader';
import VehicleRowMenu from './vehicles/VehicleRowMenu';
import TestCounts, { countTitle } from './vehicles/TestCounts';
import LazyBoundary from './LazyBoundary';
import { EditVehicleForm, ImportVehiclesModal } from './lazyComponents';
import { SOC_WINDOW_BASIS, EPA_RANGE_BASIS } from '../utils/vehicleFigures';
import { deletionImpact, impactLines } from '../utils/vehicleDeletion';

/**
 * The card's EPA range figure: the resolved range, or — with several EPA
 * configurations and no primary — the span of their labels, rather than one
 * picked silently.
 */
function epaRangeValue(vehicle, units) {
    if (vehicle.epaRangeMi) return distanceValue(vehicle.epaRangeMi, units);
    const span = vehicle.epaRange?.spanMi;
    return span ? span.map(mi => distanceValue(mi, units)).join('–') : null;
}

/** A word beside the range only when it is not an EPA label. */
function epaRangeBasisMark(vehicle) {
    return ['expected', 'unsorted'].includes(vehicle.epaRangeBasis) ? vehicle.epaRangeBasis : null;
}

/** Compare two figures in a direction, blanks last whichever way the column sorts. */
function byNumber(a, b, dir = 'asc') {
    const an = Number(a), bn = Number(b);
    const aOk = a != null && a !== '' && Number.isFinite(an), bOk = b != null && b !== '' && Number.isFinite(bn);
    if (aOk && bOk) return dir === 'asc' ? an - bn : bn - an;
    return aOk ? -1 : bOk ? 1 : 0;
}

/** A vehicle's tested range in miles, as the List shows it (scaled when it was). */
function testedMiles(vehicle) {
    const t = testedRangeSummary(vehicle);
    return t ? (t.fullPackMi ?? t.distanceMi) : null;
}

/**
 * A figure in a List column (#338): the value and unit, and beneath it the
 * basis where there is one — the vehicle table's shape, without the label the
 * column header already gives. Blank is an em dash, never an empty cell.
 */
function ListFigure({ value, unit, basis }) {
    if (value == null || value === '') return <span className="stat-cell-empty" aria-label="not recorded">—</span>;
    return (
        <>
            <span className="stat-cell-value">{value}{unit && <span className="stat-cell-unit">{unit}</span>}</span>
            {basis && <span className="stat-cell-basis">{basis}</span>}
        </>
    );
}

// ── Test-count row ────────────────────────────────────────────────────────────

/**
 * Renders a "Tests: Charging (n) Range (n) EPA (n)" line that matches the
 * styling of Battery/Range rows. "Tests:" inherits the parent's text-sm color;
 * the type names are 1pt smaller and colored. Zero-count categories omitted.
 */
function TestCountPills({ vehicle, performanceCounts = {} }) {
    const counts = vehicleDataCategories(vehicle, performanceCounts);
    const pooled = vehiclePooledCounts(vehicle);
    const shown = DATA_CATEGORIES.filter(c => counts[c.key] > 0 || pooled[c.key] > 0);
    if (shown.length === 0) return null;

    // "Charging (4/2)": listed tests, then in grey the unlisted ones that still
    // count in the statistics (#394, the pool).
    return (
        <p className="flex flex-wrap items-baseline gap-x-1.5">
            <span>Tests:</span>
            {shown.map(c => (
                <span key={c.key} className={`card-test-count ${c.colorClass}`} title={countTitle(c, counts[c.key], pooled[c.key])}>
                    {c.label} ({counts[c.key]}{pooled[c.key] > 0 && <span className="test-count-pool">/{pooled[c.key]}</span>})
                </span>
            ))}
        </p>
    );
}

export default function VehiclesView({
    vehicles, selectedVehicles, onToggleSelection, onSelectAllVisible, onClearAllVisible, onAdd, onUpdate, onDelete, onViewRuns, onOpenTest,
    canCreate, canEdit, canDelete, canPublish, onToggleVisibility,
    tags, onCreateTag, onSyncVehicleTags, onUploadVehicleImage,
    onReorderVehicles, onDuplicateVehicle, onCreateVariant,
    onUpdateVehicleSpecs, specCustomFieldSuggestions,
    pendingEditVehicle, onClearPendingEdit,
    savedState, onSaveState,
    // Cards or List: chosen in the sub-nav since #338, not by a toggle here.
    viewMode = 'card',
    // Vehicles & Specs' filters, shared with the Table (#338).
    filters = EMPTY_VEHICLE_FILTERS, onFiltersChange = () => {},
}) {
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [formData, setFormData] = useState(EMPTY_VEHICLE_FORM);
    const [formTags, setFormTags] = useState([]);
    const [newTagName, setNewTagName] = useState('');
    const [imageUploading, setImageUploading] = useState(false);
    const [sortBy, setSortBy] = useState(savedState?.sortBy ?? 'default');
    const [editingOrder, setEditingOrder] = useState(false);
    const [pendingOrder, setPendingOrder] = useState(null);   // [{id, sort_order}] or null
    const [savingOrder, setSavingOrder]   = useState(false);
    const [duplicatingId, setDuplicatingId] = useState(null);
    const [vehiclePage, setVehiclePage] = useState(savedState?.vehiclePage ?? 1);
    const [specsEditingVehicle, setSpecsEditingVehicle] = useState(null);
    const [specsViewingVehicle, setSpecsViewingVehicle] = useState(null);
    const [showImportModal, setShowImportModal] = useState(false);
    // A card is tall and a list row is one line, so a page of rows holds more (#338).
    const VEHICLES_PER_PAGE = viewMode === 'list' ? 50 : 24;

    // Keep a ref always pointing at latest filter/sort/page so the unmount
    // cleanup can save it without stale-closure issues.
    const persistableState = useRef({});
    useEffect(() => {
        persistableState.current = {
            sortBy, vehiclePage,
        };
    }, [sortBy, vehiclePage]);

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

    // What the queued deletes do to vehicles that inherit from them, said before
    // the delete rather than found out after.
    const deleteNotes = useMemo(
        () => impactLines(deletionImpact(vehicles, [...pendingDeletes])),
        [vehicles, pendingDeletes],
    );

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
        setFormData(EMPTY_VEHICLE_FORM);
        setShowForm(false);
    };

    const handleEdit = (vehicle, e) => {
        e.stopPropagation();
        setFormData(vehicleFormFrom(vehicle));
        // Own tags only: the inherited ones come from the source and are shown
        // beside the editor, never saved onto this vehicle.
        setFormTags(ownValues(vehicle).tags);
        setEditingId(vehicle.id);
        setShowForm(true);
    };

    const handleCancel = () => {
        setShowForm(false);
        setEditingId(null);
        setFormTags([]);
        setNewTagName('');
        setFormData(EMPTY_VEHICLE_FORM);
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

    // The filters are Vehicles & Specs' own, shared with List and Table (#338);
    // committed deletes are the only narrowing this view adds.
    const { ctx: filterCtx, filtered: filteredVehicles } = useFilteredVehicles(vehicles, filters, performanceCounts);
    const shownVehicles = filteredVehicles.filter(v => !committedDeletes.has(v.id));

    // Stage 3: sort
    const sortedFilteredVehicles = [...shownVehicles].sort((a, b) => {
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
            // The List view's column headers (#338); blanks last either way.
            case 'name_az':      return (a.name || '').localeCompare(b.name || '');
            case 'name_za':      return (b.name || '').localeCompare(a.name || '');
            case 'battery_desc': return byNumber(a.socWindowKwh, b.socWindowKwh, 'desc');
            case 'battery_asc':  return byNumber(a.socWindowKwh, b.socWindowKwh);
            case 'range_desc':   return byNumber(a.epaRangeMi, b.epaRangeMi, 'desc');
            case 'range_asc':    return byNumber(a.epaRangeMi, b.epaRangeMi);
            case 'tested_desc':  return byNumber(testedMiles(a), testedMiles(b), 'desc');
            case 'tested_asc':   return byNumber(testedMiles(a), testedMiles(b));
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

    /**
     * A List row's ⋯ menu (#338): the card's Specs and curator buttons, as
     * menu items, with the same handlers. Delete stays last.
     */
    const rowMenuItems = (vehicle) => {
        const isPending = pendingDeletes.has(vehicle.id);
        const hasSpecs = vehicle.specs && Object.keys(vehicle.specs).length > 0;
        return [
            canEdit(vehicle)
                ? { key: 'specs', label: 'Specs', onClick: () => setSpecsEditingVehicle(vehicle) }
                : hasSpecs && { key: 'specs', label: 'Specs', onClick: () => setSpecsViewingVehicle(vehicle) },
            canEdit(vehicle) && { key: 'edit', label: 'Edit', onClick: (e) => handleEdit(vehicle, e) },
            canEdit(vehicle) && {
                key: 'copy', label: '⧉ Copy', disabled: duplicatingId !== null,
                title: 'Copy this vehicle, with its own copies of its specs and tests',
                onClick: (e) => handleDuplicateVehicle(vehicle, e),
            },
            canEdit(vehicle) && onCreateVariant && {
                key: 'variant', label: '＋ Variant', disabled: duplicatingId !== null,
                title: 'A new vehicle that inherits this one\u2019s specs, tests, color, photo and tags. Set only what differs.',
                onClick: async () => {
                    const variant = await onCreateVariant(vehicle.id);
                    if (variant) handleEdit(variant, { stopPropagation: () => {} });
                },
            },
            canDelete(vehicle) && (isPending
                ? { key: 'restore', label: '↩ Restore', onClick: () => restoreItem(vehicle.id) }
                : { key: 'delete', label: 'Delete', danger: true, onClick: () => queueDelete(vehicle.id) }),
        ];
    };

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

    /**
     * Specs: the editor for someone who can edit the vehicle, the read-only view
     * for everyone else, and nothing when there is nothing to view. It sits
     * beside View Tests & Data for every reader, so the first row of a card
     * reads the same whoever is signed in.
     */
    const SpecsButton = ({ vehicle }) => {
        if (canEdit(vehicle)) {
            return (
                <button
                    onClick={(e) => { e.stopPropagation(); setSpecsEditingVehicle(vehicle); }}
                    className="btn btn-secondary"
                >
                    Specs
                </button>
            );
        }
        if (!vehicle.specs || Object.keys(vehicle.specs).length === 0) return null;
        return (
            <button
                onClick={(e) => { e.stopPropagation(); setSpecsViewingVehicle(vehicle); }}
                className="btn btn-secondary"
            >
                Specs
            </button>
        );
    };

    /**
     * What a curator can do TO a vehicle: Copy, Variant, Edit, Delete, in that
     * order. Rendered bare so the card can give them a row of their own and the
     * list can run them on after its other controls. Delete is last, so the
     * destructive one is never between two harmless ones.
     */
    const CuratorActions = ({ vehicle }) => {
        const isPending = pendingDeletes.has(vehicle.id);
        return (
            <>
                {canEdit(vehicle) && (
                    <button
                        onClick={(e) => handleDuplicateVehicle(vehicle, e)}
                        disabled={duplicatingId !== null}
                        title="Copy this vehicle, with its own copies of its specs and tests"
                        className="btn btn-primary disabled:opacity-50"
                    >
                        {duplicatingId === vehicle.id
                            ? <><span className="spinner-inline"/>Copying…</>
                            : '⧉ Copy'}
                    </button>
                )}
                {canEdit(vehicle) && onCreateVariant && (
                    <NewVariantButton
                        disabled={duplicatingId !== null}
                        onCreate={async () => {
                            const variant = await onCreateVariant(vehicle.id);
                            if (variant) handleEdit(variant, { stopPropagation: () => {} });
                        }}
                    />
                )}
                {canEdit(vehicle) && (
                    <button onClick={(e) => handleEdit(vehicle, e)} className="btn btn-edit">
                        Edit
                    </button>
                )}
                {canDelete(vehicle) && (
                    <button
                        onClick={(e) => { e.stopPropagation(); isPending ? restoreItem(vehicle.id) : queueDelete(vehicle.id); }}
                        className={`btn ${isPending ? 'btn-restore' : 'btn-danger'}`}
                    >
                        {isPending ? '↩ Restore' : 'Delete'}
                    </button>
                )}
            </>
        );
    };

    const TagPills = ({ vehicle }) => {
        if (!vehicle.tags?.length) return null;
        return (
            <div className="vehicle-tags">
                {vehicle.tags.map(tag => {
                    // A tag that came down the inheritance chain is drawn as
                    // one, so a curator can tell it from a tag set here.
                    const from = vehicle.inheritedFrom?.tags?.[tag.id];
                    return (
                        <span
                            key={tag.id}
                            className={`vehicle-tag${from ? ' is-inherited' : ''}`}
                            title={from ? `Inherited from ${from.name}` : undefined}
                        >
                            {tag.name}
                        </span>
                    );
                })}
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
        // EPA test vehicles are assigned in Tests & Data, not in this edit modal.
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
    }, [filters, sortBy]);

    const showReorderButtons = canEdit({}) && sortBy === 'default'
        && !filtersActive(filters) && editingOrder;

    // ────────────────────────────────────────────────────────────────────────

    const barVisible = pendingDeletes.size > 0 || !!undoState || !!pendingOrder;

    // Counted from what is already loaded rather than fetched: this is a glance
    // beside the heading, not a report, and it must not cost a round trip. The
    // whole list, deliberately — a survey that moved when you typed in the
    // search box would be describing the filter, not the fleet.
    const totalTests = useMemo(
        // Tests only — a stored composite curve (#313) is not one.
        () => vehicles.reduce((n, v) => n + filterTests(v.runs).length, 0),
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

            {/* One filter bar for Cards, List and Table (#338): the chip walls
                that sat here — Filter, Brand, Data — are its dropdowns now. The
                sort and Edit Order ride in its row, since they change what
                this view shows. */}
            <VehicleFilterBar
                vehicles={vehicles}
                filters={filters}
                onChange={onFiltersChange}
                ctx={filterCtx}
                shownCount={shownVehicles.length}
            >
                    <select
                        value={sortBy}
                        onChange={e => setSortBy(e.target.value)}
                        className="form-input vehicle-sort-select"
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
                        {/* The List view's column sorts, so Cards can use them too (#338). */}
                        <option value="name_az">Name A→Z</option>
                        <option value="name_za">Name Z→A</option>
                        <option value="battery_desc">Battery (Largest)</option>
                        <option value="battery_asc">Battery (Smallest)</option>
                        <option value="range_desc">EPA Range (Longest)</option>
                        <option value="range_asc">EPA Range (Shortest)</option>
                        <option value="tested_desc">Tested Range (Longest)</option>
                        <option value="tested_asc">Tested Range (Shortest)</option>
                    </select>
                    {canEdit({}) && sortBy === 'default' && !filtersActive(filters) && (
                        <button
                            onClick={() => { if (editingOrder) setPendingOrder(null); setEditingOrder(v => !v); }}
                            className={`btn btn-toggle${editingOrder ? ' active' : ''} flex-shrink-0`}
                            style={editingOrder ? { backgroundColor: 'var(--color-primary-light)', borderColor: 'var(--color-primary)', color: 'var(--color-primary-text)' } : {}}
                        >
                            ✏️ Edit Order
                        </button>
                    )}
            </VehicleFilterBar>

            {shownVehicles.length > 0 && (
                <div className="flex justify-end gap-2 mb-4 -mt-3">
                    <button
                        onClick={() => onSelectAllVisible(shownVehicles.map(v => v.id))}
                        className="btn btn-primary"
                        title="Add all currently visible vehicles to the comparison selection"
                    >
                        Select All Visible ({shownVehicles.length})
                    </button>
                    <button
                        onClick={() => onClearAllVisible(shownVehicles.map(v => v.id))}
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
                                    <VehicleMedia vehicle={vehicle} height={CARD_BAND_HEIGHT} className="is-card-band">
                                        <div className="vehicle-media-title">
                                            <h3>{vehicle.name}</h3>
                                            <p>{[vehicle.make, vehicle.model, vehicle.trim, vehicle.year].filter(Boolean).join(' · ')}</p>
                                        </div>
                                        <VisibilityPill vehicle={vehicle} onMedia />
                                        {/* The curator's swatch, on the band under the
                                            selection mark's corner. It was the first row
                                            of the card body, which made a curator's card
                                            taller than everyone else's and pushed the
                                            figures down. On the band it costs no height.
                                            It used to be kept off the photograph because
                                            a control there fights an arbitrary image; the
                                            swatch is a bordered solid chip that reads over
                                            anything, and its caption takes the name's
                                            shadow. Editing in place is still the point:
                                            coloring a catalogue this size is a
                                            scroll-and-click pass. */}
                                        {canEdit(vehicle) && (
                                            <div className="vehicle-media-color" onClick={e => e.stopPropagation()}>
                                                <SeriesColorPicker
                                                    value={vehicle.color || DEFAULT_RUN_COLOR}
                                                    stored={ownValues(vehicle).color}
                                                    label={vehicle.name}
                                                    onChange={hex => onUpdate(vehicle.id, { color: hex })}
                                                    onReset={() => onUpdate(vehicle.id, { color: null })}
                                                />
                                                <span className="vehicle-media-color-caption">
                                                    {vehicle.inheritedFrom?.color
                                                        ? `Inherited from ${vehicle.inheritedFrom.color.name}`
                                                        : vehicle.color ? 'Series color' : 'No color set'}
                                                </span>
                                            </div>
                                        )}
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
                                            <StatCell
                                                label="Battery"
                                                value={vehicle.socWindowKwh}
                                                unit="kWh"
                                                basis={SOC_WINDOW_BASIS[vehicle.socWindowBasis]?.label}
                                                title={SOC_WINDOW_BASIS[vehicle.socWindowBasis]?.note}
                                            />
                                            <StatCell
                                                label="EPA range"
                                                value={epaRangeValue(vehicle, units)}
                                                unit={distanceUnit(units)}
                                                basis={epaRangeBasisMark(vehicle)}
                                            />
                                            {vehicle.power != null && (
                                                <StatCell label="Power" value={vehicle.power} unit="kW" />
                                            )}
                                        </div>

                                        {/* The measurement, with the conditions that
                                            produced it and no verdict attached. */}
                                        <TestedFigure vehicle={vehicle} tested={testedRangeSummary(vehicle)} units={units} onOpenTest={onOpenTest} />

                                        <PlatformLine vehicle={vehicle} />

                                        <TestCountPills vehicle={vehicle} performanceCounts={performanceCounts} />

                                        {vehicle.tags?.length > 0 && <TagPills vehicle={vehicle} />}

                                        {/* Actions at the foot of the card, in two rows.
                                            The first is what anyone can do with the
                                            vehicle, the same for every reader. The
                                            second is what a curator can do TO it, and
                                            appears only for them. It was one column of
                                            five stacked buttons beside the primary action,
                                            which made a curator's card half controls. */}
                                        <div className="vehicle-card-actions" onClick={e => e.stopPropagation()}>
                                            <div className="flex items-center gap-1.5">
                                                <button
                                                    onClick={() => onViewRuns(vehicle)}
                                                    className="btn btn-primary flex-1"
                                                >
                                                    View Tests &amp; Data →
                                                </button>
                                                <SpecsButton vehicle={vehicle} />
                                            </div>
                                            {(canEdit(vehicle) || canDelete(vehicle)) && (
                                                <div className="vehicle-card-curator-actions flex items-center gap-1.5">
                                                    <CuratorActions vehicle={vehicle} />
                                                </div>
                                            )}
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
                <div className="vehicle-list" role="table" aria-label="Vehicles">
                    <VehicleListHeader
                        sortBy={sortBy}
                        onSort={setSortBy}
                        allSelected={pagedVehicles.length > 0 && pagedVehicles.every(v => selectedVehicles.includes(v.id))}
                        someSelected={pagedVehicles.some(v => selectedVehicles.includes(v.id))}
                        onToggleAll={() => {
                            const ids = pagedVehicles.map(v => v.id);
                            if (ids.every(id => selectedVehicles.includes(id))) onClearAllVisible(ids);
                            else onSelectAllVisible(ids);
                        }}
                    />
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
                            <div key={vehicle.id} role="rowgroup">
                                {showMfgHeader && <h3 className="vehicle-list-group text-micro">{mfgName}</h3>}
                                {/* Every row is the same grid as the header (#338):
                                    a column is blank ("—"), never missing, so no
                                    row's figures sit anywhere but under their
                                    heading. The row still selects on click; the
                                    checkbox says so where the ✓ on the photo did. */}
                                <div
                                    role="row"
                                    onClick={() => handleCardClick(vehicle)}
                                    className={`vehicle-card vehicle-row${isSelected ? ' is-selected' : ''}${isPending ? ' is-pending' : ''}`}
                                >
                                    <span className="vehicle-list-select" role="cell" onClick={e => e.stopPropagation()}>
                                        <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={() => handleCardClick(vehicle)}
                                            aria-label={`Select ${vehicle.name}`}
                                        />
                                    </span>
                                    <span role="cell" className="vehicle-list-photo">
                                        {/* Reorder controls replace the photo while
                                            Edit Order is on: the same slot, so the
                                            columns do not move. */}
                                        {showReorderButtons ? (
                                            <span className="reorder-controls" onClick={e => e.stopPropagation()}>
                                                <button title="Up" onClick={() => handleMoveVehicle(vehicle.id, 'up')} disabled={globalPos === 0} className="reorder-btn">▲</button>
                                                <input
                                                    type="number" min={1} max={totalCount}
                                                    defaultValue={globalPos + 1}
                                                    key={`pos-${vehicle.id}-${globalPos}`}
                                                    onKeyDown={e => { if (e.key === 'Enter') { const v = parseInt(e.target.value); if (!isNaN(v)) handleMoveVehicleToIndex(vehicle.id, v - 1); } }}
                                                    onBlur={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v !== globalPos + 1) handleMoveVehicleToIndex(vehicle.id, v - 1); }}
                                                    className="form-input reorder-position-input"
                                                    aria-label={`Position of ${vehicle.name}`}
                                                />
                                                <button title="Down" onClick={() => handleMoveVehicle(vehicle.id, 'down')} disabled={globalPos === totalCount - 1} className="reorder-btn">▼</button>
                                            </span>
                                        ) : (
                                            <VehicleMedia vehicle={vehicle} height={54} className="vehicle-media-thumb" />
                                        )}
                                    </span>
                                    <span role="cell" className="flex flex-col gap-0.5 min-w-0">
                                        <span className="flex items-center gap-2 min-w-0">
                                            {/* The curator's swatch, edited in place: setting
                                                a color per vehicle is a scroll-and-click pass. */}
                                            {canEdit(vehicle) && (
                                                <SeriesColorPicker
                                                    value={vehicle.color || DEFAULT_RUN_COLOR}
                                                    stored={ownValues(vehicle).color}
                                                    label={vehicle.name}
                                                    onChange={hex => onUpdate(vehicle.id, { color: hex })}
                                                    onReset={() => onUpdate(vehicle.id, { color: null })}
                                                />
                                            )}
                                            <span className="vehicle-list-name-text">{vehicle.name}</span>
                                            <VisibilityPill vehicle={vehicle} />
                                        </span>
                                        {/* What it is: make · model · trim · year. */}
                                        <span className="vehicle-list-meta">
                                            {[vehicle.make, vehicle.model, vehicle.trim, vehicle.year].filter(Boolean).join(' · ')}
                                        </span>
                                        {/* What it is filed under, a step smaller: its
                                            tags, then its platform. Its own line, so a
                                            long trim no longer clips the tags away. */}
                                        <span className="vehicle-list-extra">
                                            <TagPills vehicle={vehicle} />
                                            <PlatformLine vehicle={vehicle} bare />
                                        </span>
                                    </span>
                                    <span role="cell" className="vehicle-list-figure" title={SOC_WINDOW_BASIS[vehicle.socWindowBasis]?.note}>
                                        <ListFigure value={vehicle.socWindowKwh} unit="kWh" basis={SOC_WINDOW_BASIS[vehicle.socWindowBasis]?.label} />
                                    </span>
                                    <span role="cell" className="vehicle-list-figure" title={EPA_RANGE_BASIS[vehicle.epaRangeBasis]?.note ?? 'EPA range'}>
                                        <ListFigure value={epaRangeValue(vehicle, units)} unit={distanceUnit(units)} basis={epaRangeBasisMark(vehicle)} />
                                    </span>
                                    <span role="cell" className="vehicle-list-figure">
                                        {testedRangeSummary(vehicle)
                                            ? <TestedFigure vehicle={vehicle} tested={testedRangeSummary(vehicle)} units={units} onOpenTest={onOpenTest} bare />
                                            : <span className="stat-cell-empty" aria-label="not tested">—</span>}
                                    </span>
                                    <span role="cell" className="vehicle-list-tests">
                                        <TestCounts vehicle={vehicle} performanceCounts={performanceCounts} />
                                    </span>
                                    {/* The same two actions on every row: its tests,
                                        and a menu holding everything else, so no row's
                                        buttons push its figures sideways. */}
                                    <span role="cell" className="vehicle-list-actions" onClick={e => e.stopPropagation()}>
                                        <button onClick={() => onViewRuns(vehicle)} className="btn btn-primary">
                                            Tests &amp; Data →
                                        </button>
                                        <VehicleRowMenu label={vehicle.name} items={rowMenuItems(vehicle)} />
                                    </span>
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
                    {filtersActive(filters)
                            ? <p className="text-lg">No vehicles match the active filters.</p>
                            : <p className="text-lg">No vehicles yet. Click "Add Vehicle" to get started!</p>
                    }
                </div>
            )}

            {pendingOrder && (
                <div className="fixed-action-bar is-info z-40">
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
                notes={deleteNotes}
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

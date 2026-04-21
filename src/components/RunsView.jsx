import { useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { fmtSpeed, fmtTemp, fmtDistance, calcEff, effLabel as getEffLabel } from '../utils/unitConversions';
import Papa from 'papaparse';
import { parseCSV, parseCSVText } from '../utils/parseCSV';
import { dataService } from '../services/DataService';
import { useDeleteQueue } from '../hooks/useDeleteQueue';
import DeleteQueueBar from './DeleteQueueBar';
import EditVehicleForm from './EditVehicleForm';
import EditSpecsForm from './EditSpecsForm';
import ViewSpecsModal from './ViewSpecsModal';
import { RunVoteButtons } from './VoteButtons';
import { estimateChargingTimes } from '../utils/estimateChargingTimes';

// ── Data-type flag definitions ────────────────────────────────────────────────
// Each flag represents a data domain that can independently be present in a run.
// Flags are stored as an array so future types can be added without schema changes.
const DATA_FLAGS = [
    { key: 'charging', label: '⚡ Charging', pillStyle: 'bg-blue-100 text-blue-800 border-blue-300',   desc: 'Time-series charging data (charge rate, SoC)' },
    { key: 'range',    label: '📏 Range',    pillStyle: 'bg-purple-100 text-purple-800 border-purple-300', desc: 'Range/efficiency test (distance, SoC, speed, efficiency)' },
];

/** Infer the active data-type flags from a run's boolean columns. */
const inferRunFlags = (run) => {
    const flags = [];
    if (run?.has_charging ?? true)  flags.push('charging');
    if (run?.has_range    ?? false) flags.push('range');
    return flags;
};

// ── Estimate Time from Power panel ────────────────────────────────────────────
const EstimateTimePanel = ({
    vehicle, editData, editDataLoading,
    anchors, onChangeAnchors,
    shiftToZero, onShiftToZeroChange,
    preview, applying, error,
    onPreview, onApply,
}) => {
    const batteryMissing = !vehicle?.battery;
    const validAnchors   = anchors.filter(
        a => a.soc !== '' && a.timeMin !== '' && !isNaN(Number(a.soc)) && !isNaN(Number(a.timeMin))
    );
    const canPreview = !batteryMissing && validAnchors.length >= 2 && editData !== null && !editDataLoading;

    return (
        <div className="mt-2 border rounded bg-gray-50 p-3 space-y-3">
            {batteryMissing && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                    ⚠ Set the battery capacity (kWh) on this vehicle to use time estimation.
                </p>
            )}
            {editDataLoading && <p className="text-xs text-gray-400">Loading data…</p>}
            {!editDataLoading && (
                <>
                    <div>
                        <div className="grid grid-cols-[76px_96px_24px] gap-1 text-xs text-gray-500 px-1 mb-1">
                            <span>SoC (%)</span><span>Elapsed (min)</span>
                        </div>
                        <div className="space-y-1">
                            {anchors.map((a, i) => (
                                <div key={i} className="grid grid-cols-[76px_96px_24px] gap-1 items-center">
                                    <input
                                        type="number" min="0" max="100"
                                        placeholder="SoC%"
                                        value={a.soc}
                                        onChange={e => {
                                            const next = [...anchors];
                                            next[i] = { ...next[i], soc: e.target.value };
                                            onChangeAnchors(next);
                                        }}
                                        className="form-input text-xs py-1"
                                    />
                                    <input
                                        type="number" step="0.1"
                                        placeholder="minutes"
                                        value={a.timeMin}
                                        onChange={e => {
                                            const next = [...anchors];
                                            next[i] = { ...next[i], timeMin: e.target.value };
                                            onChangeAnchors(next);
                                        }}
                                        className="form-input text-xs py-1"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => onChangeAnchors(anchors.filter((_, j) => j !== i))}
                                        className="text-gray-400 hover:text-red-500 font-bold leading-none"
                                        title="Remove anchor"
                                    >✕</button>
                                </div>
                            ))}
                        </div>
                        <button
                            type="button"
                            onClick={() => onChangeAnchors([...anchors, { soc: '', timeMin: '' }])}
                            className="mt-1 text-xs text-blue-600 hover:text-blue-800"
                        >+ Add anchor</button>
                    </div>

                    <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={shiftToZero}
                            onChange={e => onShiftToZeroChange(e.target.checked)}
                        />
                        Shift times so t=0 is at the first data point
                    </label>

                    <div className="flex items-center gap-2 flex-wrap">
                        <button
                            type="button"
                            onClick={onPreview}
                            disabled={!canPreview}
                            className="btn btn-secondary disabled:opacity-50 disabled:cursor-not-allowed text-xs"
                        >Preview</button>
                        <button
                            type="button"
                            onClick={onApply}
                            disabled={!preview || applying}
                            className="btn btn-primary disabled:opacity-50 disabled:cursor-not-allowed text-xs"
                        >{applying ? 'Applying…' : 'Apply'}</button>
                        {!batteryMissing && validAnchors.length < 2 && anchors.length >= 1 && (
                            <span className="text-xs text-gray-400">Need ≥2 anchors to preview</span>
                        )}
                    </div>

                    {error && (
                        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{error}</p>
                    )}

                    {preview && !error && (
                        <div className="space-y-1">
                            {preview.warnings.length > 0 && (
                                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 space-y-0.5">
                                    {preview.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
                                </div>
                            )}
                            <div className="max-h-64 overflow-y-auto border rounded">
                                <table className="text-xs w-full">
                                    <thead className="bg-gray-100 sticky top-0">
                                        <tr>
                                            <th className="px-2 py-1 text-left font-medium">SoC %</th>
                                            <th className="px-2 py-1 text-left font-medium">kW</th>
                                            <th className="px-2 py-1 text-left font-medium">Est. time (min)</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y">
                                        {preview.points.map((p, i) => (
                                            <tr key={i}>
                                                <td className="px-2 py-0.5">{p.soc}%</td>
                                                <td className="px-2 py-0.5">{p.chargeRate}</td>
                                                <td className="px-2 py-0.5">{p.time}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <p className="text-xs text-gray-500 font-medium">
                                Apply will write {preview.points.length} time values to this run.
                            </p>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export default function RunsView({ vehicle, canCreate, canEdit, canDelete, canPublish, onAddRun, onUpdateRun, onSetDefaultRun, onDeleteRun, onMergeRunData, onReplaceRunData, onDuplicateRun, onViewChart, onToggleVehicleVisibility, onUpdateVehicle, onDuplicateVehicle, onDeleteVehicle, tags, onCreateTag, onSyncVehicleTags, onUploadVehicleImage, onUpdateVehicleSpecs, specCustomFieldSuggestions, onAddTrim, onDeleteTrim, vehicles, onCopyRunToVehicle }) {
    const { runVotes, loadRunVotes, toggleRunVote, units, manufacturers, addManufacturer, isContributor, addSpecLink, deleteSpecLink } = useAppContext();

    // ── Vehicle edit form state ───────────────────────────────────────────────
    const [showEditVehicle, setShowEditVehicle] = useState(false);
    const [showEditSpecs, setShowEditSpecs] = useState(false);
    const [showViewSpecs, setShowViewSpecs] = useState(false);
    const [vehicleFormData, setVehicleFormData] = useState({
        name: '', make: '', model: '', year: '', battery: '', range: '', manufacturer_id: null,
    });
    const [vehicleFormTags, setVehicleFormTags] = useState([]);
    const [vehicleNewTagName, setVehicleNewTagName] = useState('');
    const [vehicleImageUploading, setVehicleImageUploading] = useState(false);

    const openEditVehicle = () => {
        setVehicleFormData({
            name: vehicle.name,
            make: vehicle.make || '',
            model: vehicle.model || '',
            year: vehicle.year || '',
            battery: vehicle.battery || '',
            range: vehicle.range || '',
            manufacturer_id: vehicle.manufacturer?.id ?? null,
        });
        setVehicleFormTags(vehicle.tags || []);
        setVehicleNewTagName('');
        setShowEditVehicle(true);
    };

    const closeEditVehicle = () => {
        setShowEditVehicle(false);
        setVehicleFormTags([]);
        setVehicleNewTagName('');
    };

    const handleVehicleSubmit = async (e) => {
        e.preventDefault();
        await onUpdateVehicle(vehicle.id, vehicleFormData);
        await onSyncVehicleTags(vehicle.id, vehicleFormTags.map(t => t.id));
        closeEditVehicle();
    };

    const handleVehicleImageReady = async (blob) => {
        if (!blob) return;
        setVehicleImageUploading(true);
        await onUploadVehicleImage(blob);
        setVehicleImageUploading(false);
    };

    const vehicleAvailableTags = (tags || []).filter(t => !vehicleFormTags.some(ft => ft.id === t.id));

    const [showUpload, setShowUpload] = useState(false);
    const [uploadStep, setUploadStep] = useState('file');
    const [csvData, setCsvData] = useState(null);
    const [fieldMapping, setFieldMapping] = useState({});
    const [runMetadata, setRunMetadata] = useState({
        name: '',
        date: new Date().toISOString().split('T')[0],
        softwareVersion: '',
        conditions: '',
        dataFlags: ['charging'],
        trimId: '',
        source: '',
        startSoc: '',
        endSoc: '',
        speedMph: '',
        distanceMiles: '',
        energyKwh: '',
        temperatureF: '',
        elevationGainFt: '',
        url: '',
        chargingUrl: '',
    });
    const [editingRunId, setEditingRunId] = useState(null);
    const [editFormData, setEditFormData] = useState({});

    // ── Merge-mode state ─────────────────────────────────────────────────────
    // uploadMode: 'create' (new run) | 'merge' (patch fields into existing rows)
    const [uploadMode, setUploadMode] = useState('create');
    const [mergeTargetRun, setMergeTargetRun] = useState(null);
    // joinKey: which column links incoming rows to existing ones
    const [joinKey, setJoinKey] = useState('soc');
    const [merging, setMerging] = useState(false);

    // ── Estimation opts (import / merge step) ────────────────────────────────
    // Tracks which derived-column offers the user has accepted
    // range: null | 'epa' | 'measured'
    const [estimations, setEstimations] = useState({ range: null });

    // ── CSV paste / headerless state ──────────────────────────────────────────
    const [csvText, setCsvText]                       = useState('');
    const [noHeaders, setNoHeaders]                   = useState(false);
    const [selectedRangeTestRunId, setSelectedRangeTestRunId] = useState(null);

    // ── Inherited test link form state ────────────────────────────────────────
    const [showAddLink, setShowAddLink]     = useState(false);
    const [newLinkSpecType, setNewLinkSpecType] = useState('range_test');
    const [newLinkSourceId, setNewLinkSourceId] = useState('');
    const [newLinkScaling, setNewLinkScaling]   = useState('');
    const [newLinkNotes, setNewLinkNotes]       = useState('');
    const [linkSaving, setLinkSaving]           = useState(false);

    // ── Inline data-table state (edit mode) ──────────────────────────────────
    const [editData, setEditData]               = useState(null);   // null=not fetched, []=loaded
    const [editDataLoading, setEditDataLoading] = useState(false);
    const [editDataDirty, setEditDataDirty]     = useState(false);  // cells modified
    const [showDataTable, setShowDataTable]     = useState(false);  // expand/collapse
    const [savingData, setSavingData]           = useState(false);
    const [editCalculatedFields, setEditCalculatedFields] = useState([]); // which fields are estimated
    const [editCalcKwh, setEditCalcKwh]         = useState(null);   // kWh derived from data_points in edit mode
    const [sortField, setSortField]             = useState(null);   // active sort column key
    const [sortDir, setSortDir]                 = useState('asc');  // 'asc' | 'desc'

    // ── Estimate-time-from-power panel state ──────────────────────────────────
    const [showEstimatePanel, setShowEstimatePanel] = useState(false);
    const [estimateAnchors, setEstimateAnchors]     = useState([]);   // [{soc:'', timeMin:''}]
    const [estimateShift, setEstimateShift]         = useState(false);
    const [estimatePreview, setEstimatePreview]     = useState(null); // null | {points, warnings}
    const [estimateApplying, setEstimateApplying]   = useState(false);
    const [estimateError, setEstimateError]         = useState('');

    // ── Per-card lazy kWh check (card view, not edit mode) ───────────────────
    // { [runId]: { kwh: number|null, loading: bool } }
    const [calcKwhByRun, setCalcKwhByRun]       = useState({});
    const [duplicatingRunId, setDuplicatingRunId] = useState(null);
    const [duplicatingVehicle, setDuplicatingVehicle] = useState(false);
    const [exportingRunId, setExportingRunId]     = useState(null);
    const [copyToRun, setCopyToRun]               = useState(null);  // run being copied to another vehicle
    const [copyingToVehicleId, setCopyingToVehicleId] = useState('');

    const {
        pendingDeletes, committedDeletes, undoState, secondsLeft,
        queueDelete, restoreItem, clearQueue, commitDeletes, undoDelete,
    } = useDeleteQueue(onDeleteRun);

    // ── Helpers ──────────────────────────────────────────────────────────────

    const resetUploadState = () => {
        setShowUpload(false);
        setUploadStep('file');
        setCsvData(null);
        setFieldMapping({});
        setRunMetadata({ name: '', date: new Date().toISOString().split('T')[0], softwareVersion: '', conditions: '', dataFlags: ['charging'], source: '', startSoc: '', endSoc: '', speedMph: '', distanceMiles: '', energyKwh: '', temperatureF: '', elevationGainFt: '', url: '', chargingUrl: '' });
        setUploadMode('create');
        setMergeTargetRun(null);
        setEstimations({ range: null });
        setJoinKey('soc');
        setMerging(false);
        setCsvText('');
        setNoHeaders(false);
    };

    // ── File upload ───────────────────────────────────────────────────────────

    const autoMapHeaders = (headers) => {
        const autoMapping = {};
        headers.forEach(header => {
            const lower = String(header).toLowerCase();
            if (lower.includes('soc') || lower.includes('state of charge')) autoMapping.soc = header;
            if (lower.includes('charge') && lower.includes('rate')) autoMapping.chargeRate = header;
            if (lower.includes('time')) autoMapping.time = header;
            if (lower.includes('range')) autoMapping.range = header;
            if (lower.includes('temp')) autoMapping.temperature = header;
            if (lower.includes('frame')) autoMapping.frame = header;
        });
        return autoMapping;
    };

    const handleFileUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setCsvText(''); // clear any pasted text
        try {
            const result = await parseCSV(file, { noHeaders });
            setCsvData(result);
            setFieldMapping(noHeaders ? {} : autoMapHeaders(result.meta.fields));
            setUploadStep('mapping');
        } catch (error) {
            alert('Error parsing CSV: ' + error.message);
        }
    };

    const handleCsvTextPaste = async (text) => {
        setCsvText(text);
        if (!text.trim()) {
            setCsvData(null);
            setFieldMapping({});
            setUploadStep('file');
            return;
        }
        try {
            const result = await parseCSVText(text, { noHeaders });
            if (result.data.length > 0) {
                setCsvData(result);
                setFieldMapping(noHeaders ? {} : autoMapHeaders(result.meta.fields));
                setUploadStep('mapping');
            }
        } catch (error) {
            alert('Error parsing CSV text: ' + error.message);
        }
    };

    // ── Create-mode import ────────────────────────────────────────────────────

    const handleSaveRecord = () => {
        const { dataFlags, ...metaRest } = runMetadata;
        const run = {
            ...metaRest,
            hasCharging: dataFlags.includes('charging'),
            hasRange:    dataFlags.includes('range'),
            data: [],
            uploadDate: new Date().toISOString()
        };
        onAddRun(run);
        resetUploadState();
    };

    // Sort data points by a field, toggling direction on repeated clicks.
    // Actually reorders editData so the new order is persisted on save.
    const handleSortByField = (field) => {
        const newDir = sortField === field && sortDir === 'asc' ? 'desc' : 'asc';
        setSortField(field);
        setSortDir(newDir);
        setEditData(prev => {
            if (!prev) return prev;
            return [...prev].sort((a, b) => {
                const aVal = a[field] ?? (newDir === 'asc' ? Infinity : -Infinity);
                const bVal = b[field] ?? (newDir === 'asc' ? Infinity : -Infinity);
                return newDir === 'asc' ? aVal - bVal : bVal - aVal;
            });
        });
        setEditDataDirty(true);
    };

    // Sort an array of data-point objects by time (primary) then soc (secondary).
    // Used automatically on import to fix out-of-order CSV data.
    const sortPointsByTime = (points) =>
        [...points].sort((a, b) => {
            const tA = a.time ?? Infinity, tB = b.time ?? Infinity;
            if (tA !== tB) return tA - tB;
            return (a.soc ?? Infinity) - (b.soc ?? Infinity);
        });

    const handleImport = () => {
        if (!csvData) return;

        let transformedData = csvData.data.map(row => {
            const newRow = {};
            Object.keys(fieldMapping).forEach(key => {
                if (fieldMapping[key]) {
                    newRow[key] = row[fieldMapping[key]];
                }
            });
            return newRow;
        });

        // Sort by time → soc so out-of-order CSV files don't create jumbled charts
        transformedData = sortPointsByTime(transformedData);

        // Apply opted-in estimations
        const calculatedFields = [];
        if (estimations.range) {
            const ratedRange = estimations.range === 'measured' ? effectiveRangeFromTest : vehicle.range;
            if (ratedRange) {
                transformedData = transformedData.map(row => ({
                    ...row,
                    range: row.range != null ? row.range
                        : roundField((parseFloat(row.soc) / 100) * ratedRange, 1),
                }));
                calculatedFields.push('range');
            }
        }

        const { dataFlags, ...metaRest } = runMetadata;
        const run = {
            ...metaRest,
            hasCharging: dataFlags.includes('charging'),
            hasRange:    dataFlags.includes('range'),
            data: transformedData,
            fieldMapping,
            calculated_fields: calculatedFields,
            uploadDate: new Date().toISOString()
        };

        onAddRun(run);
        resetUploadState();
    };

    // ── Merge-mode import ─────────────────────────────────────────────────────

    const handleMerge = async () => {
        if (!csvData || !mergeTargetRun) return;

        let transformedData = csvData.data.map(row => {
            const newRow = {};
            Object.keys(fieldMapping).forEach(key => {
                if (fieldMapping[key]) {
                    newRow[key] = row[fieldMapping[key]];
                }
            });
            return newRow;
        });

        // Apply opted-in estimations
        if (estimations.range) {
            const ratedRange = estimations.range === 'measured' ? effectiveRangeFromTest : vehicle.range;
            if (ratedRange) {
                transformedData = transformedData.map(row => ({
                    ...row,
                    range: row.range != null ? row.range
                        : roundField((parseFloat(row.soc) / 100) * ratedRange, 1),
                }));
                // Flag range as calculated on the target run
                const current = mergeTargetRun?.calculated_fields || [];
                if (!current.includes('range')) {
                    onUpdateRun(mergeTargetRun.id, { ...mergeTargetRun, calculated_fields: [...current, 'range'] });
                }
            }
        }

        // Determine the effective join key: auto-select when only one is mapped
        const effectiveJoinKey = canJoinBySoc && !canJoinByTime ? 'soc'
                               : !canJoinBySoc && canJoinByTime ? 'time'
                               : joinKey; // user-chosen when both are available

        setMerging(true);
        try {
            const result = await onMergeRunData(mergeTargetRun.id, transformedData, effectiveJoinKey);
            resetUploadState();
            if (result) {
                alert(`Merge complete: ${result.updated} rows updated, ${result.inserted} new rows inserted.`);
            }
        } catch {
            setMerging(false); // leave the panel open so the user can retry
        }
    };

    // ── Edit handlers ─────────────────────────────────────────────────────────

    const handleEditRun = (run) => {
        setEditingRunId(run.id);
        setEditFormData({
            name: run.name,
            date: run.date,
            softwareVersion: run.softwareVersion || run.software_version || '',
            conditions: run.conditions || '',
            dataFlags: inferRunFlags(run),
            trimId: run.trim_id ?? '',
            source: run.source || '',
            startSoc: run.start_soc ?? '',
            endSoc: run.end_soc ?? '',
            speedMph: run.speed_mph ?? '',
            distanceMiles: run.distance_miles ?? '',
            energyKwh: run.energy_kwh ?? '',
            temperatureF: run.temperature_f ?? '',
            elevationGainFt: run.elevation_gain_ft ?? '',
            url: run.url || '',
            chargingUrl: run.charging_url || '',
        });
        setEditCalculatedFields(run.calculated_fields || []);
    };

    const handleSaveEdit = async (runId) => {
        setSavingData(true);
        try {
            // Convert dataFlags → boolean columns and drop the flags field
            const { dataFlags, ...formRest } = editFormData;
            await onUpdateRun(runId, {
                ...formRest,
                hasCharging: dataFlags.includes('charging'),
                hasRange:    dataFlags.includes('range'),
                calculated_fields: editCalculatedFields,
            });
            // Save table data only if the editor made changes
            if (editDataDirty && canEdit(vehicle) && editData !== null) {
                await onReplaceRunData(runId, editData.map((row, i) => ({ ...row, frame: i })));
            }
            // Close the form only on success
            setEditingRunId(null);
            setEditFormData({});
            setEditData(null);
            setEditDataDirty(false);
            setShowDataTable(false);
            setEditCalcKwh(null);
            setShowEstimatePanel(false);
            setEstimateAnchors([]);
            setEstimatePreview(null);
            setEstimateError('');
        } catch (err) {
            alert(`Save failed: ${err?.message ?? err}`);
        } finally {
            setSavingData(false);
        }
    };

    const handleCancelEdit = () => {
        setEditingRunId(null);
        setEditFormData({});
        setEditCalculatedFields([]);
        setEditData(null);
        setEditDataDirty(false);
        setShowDataTable(false);
        setEditCalcKwh(null);
        setShowEstimatePanel(false);
        setEstimateAnchors([]);
        setEstimatePreview(null);
        setEstimateError('');
    };

    // ── Update data (merge mode entry) ────────────────────────────────────────

    const handleUpdateData = (run) => {
        setMergeTargetRun(run);
        setUploadMode('merge');
        setShowUpload(true);
        setUploadStep('file');
        setCsvData(null);
        setFieldMapping({});
    };

    // ── Data table helpers (edit mode) ───────────────────────────────────────

    const handleToggleDataTable = async (runId) => {
        if (!showDataTable && editData === null) {
            // First expand: lazy-load the data points
            setShowDataTable(true);
            setEditDataLoading(true);
            try {
                const data = await dataService.getRunData(runId);
                setEditData(data);
                setSortField(null);
                setSortDir('asc');
                // Auto-calculate kWh for charging runs that have time + chargeRate
                setEditCalcKwh(calcKwhFromPoints(data));
            } catch (err) {
                console.error('Error loading run data:', err);
                setEditData([]);
            } finally {
                setEditDataLoading(false);
            }
        } else {
            setShowDataTable(s => !s);
        }
    };

    const handleEditDataCell = (rowIdx, field, value) => {
        const parsed = value === '' ? null : parseFloat(value);
        setEditData(prev => prev.map((row, i) =>
            i === rowIdx ? { ...row, [field]: isNaN(parsed) ? null : parsed } : row
        ));
        setEditDataDirty(true);
    };

    const handleAddDataRow = () => {
        setEditData(prev => [...prev, { soc: null, chargeRate: null, time: null, range: null, temperature: null }]);
        setEditDataDirty(true);
    };

    const handleDeleteDataRow = (rowIdx) => {
        setEditData(prev => prev.filter((_, i) => i !== rowIdx));
        setEditDataDirty(true);
    };

    const handleClearColumn = (field) => {
        setEditData(prev => prev.map(row => ({ ...row, [field]: null })));
        setEditCalculatedFields(prev => prev.filter(f => f !== field));
        setEditDataDirty(true);
    };

    // Fill null range values from SoC × effective range from the selected test run.
    const handleEstimateRangeInEdit = () => {
        const ratedRange = effectiveRangeFromTest;
        if (!editData || !ratedRange) return;
        setEditData(prev => prev.map(row => ({
            ...row,
            range: row.range != null ? row.range
                : (row.soc != null ? Math.round((row.soc / 100) * ratedRange * 10) / 10 : null),
        })));
        setEditCalculatedFields(prev => prev.includes('range') ? prev : [...prev, 'range']);
        setEditDataDirty(true);
    };

    // ── Estimate time from power ──────────────────────────────────────────────

    const handleToggleEstimatePanel = async (runId) => {
        if (showEstimatePanel) {
            setShowEstimatePanel(false);
            return;
        }
        // Seed anchors from whatever time values are already in the data
        const seedAnchors = (data) => {
            const fromData = (data || [])
                .filter(p => p.soc != null && p.time != null)
                .sort((a, b) => a.soc - b.soc)
                .map(p => ({ soc: String(p.soc), timeMin: String(p.time) }));
            setEstimateAnchors(
                fromData.length >= 2 ? fromData : [{ soc: '', timeMin: '' }, { soc: '', timeMin: '' }]
            );
        };

        if (editData !== null) {
            seedAnchors(editData);
        } else {
            // Load data (shared with data-table state)
            setEditDataLoading(true);
            try {
                const data = await dataService.getRunData(runId);
                setEditData(data);
                setSortField(null);
                setSortDir('asc');
                setEditCalcKwh(calcKwhFromPoints(data));
                seedAnchors(data);
            } catch (err) {
                console.error('Error loading run data for time estimation:', err);
                setEditData([]);
                seedAnchors([]);
            } finally {
                setEditDataLoading(false);
            }
        }
        setEstimatePreview(null);
        setEstimateError('');
        setShowEstimatePanel(true);
    };

    const handleEstimatePreview = () => {
        setEstimateError('');
        setEstimatePreview(null);
        try {
            const result = estimateChargingTimes({
                dataPoints:  editData,
                batteryKwh:  vehicle.battery,
                anchors:     estimateAnchors,
                shiftToZero: estimateShift,
            });
            setEstimatePreview(result);
        } catch (err) {
            setEstimateError(err.message);
        }
    };

    const handleEstimateApply = async (run) => {
        if (!estimatePreview) return;
        setEstimateApplying(true);
        try {
            // Strip chargeRate — only write the time column (chargeRate is display-only in preview)
            const timePoints = estimatePreview.points.map(({ soc, time }) => ({ soc, time }));
            await onMergeRunData(run.id, timePoints, 'soc');
            // Mark time as a calculated (estimated) field
            const updated = editCalculatedFields.includes('time')
                ? editCalculatedFields
                : [...editCalculatedFields, 'time'];
            setEditCalculatedFields(updated);
            onUpdateRun(run.id, { calculated_fields: updated });
            // Patch local editData so the data table reflects the new values
            if (editData) {
                const socToTime = Object.fromEntries(estimatePreview.points.map(p => [p.soc, p.time]));
                setEditData(prev => prev.map(row =>
                    row.soc != null && socToTime[row.soc] !== undefined
                        ? { ...row, time: socToTime[row.soc] }
                        : row
                ));
            }
            setEstimatePreview(null);
            setEstimateError('');
        } catch (err) {
            setEstimateError('Failed to apply: ' + err.message);
        } finally {
            setEstimateApplying(false);
        }
    };

    // ── Join key logic (merge mode only) ─────────────────────────────────────
    const canJoinBySoc  = uploadMode === 'merge' && !!fieldMapping.soc;
    const canJoinByTime = uploadMode === 'merge' && !!fieldMapping.time;
    // Show radio selector only when the user has a real choice
    const showJoinSelector  = canJoinBySoc && canJoinByTime;
    // Disable confirm when there's no key to join on at all
    const missingJoinKey    = uploadMode === 'merge' && !canJoinBySoc && !canJoinByTime;

    // ── Derived-column offer logic ────────────────────────────────────────────
    // Range test runs available for measured-range estimation
    const rangeTestRuns = (vehicle?.runs ?? [])
        .filter(r => r.has_range && r.start_soc != null && r.end_soc != null
            && r.distance_miles > 0 && (r.start_soc - r.end_soc) > 0)
        .sort((a, b) => new Date(b.date) - new Date(a.date));
    const selectedRangeTestRun = rangeTestRuns.find(r => r.id === selectedRangeTestRunId) ?? rangeTestRuns[0] ?? null;
    const effectiveRangeFromTest = selectedRangeTestRun
        ? Math.round(selectedRangeTestRun.distance_miles * 100 / (selectedRangeTestRun.start_soc - selectedRangeTestRun.end_soc))
        : null;
    const offerRangeEstimateTest = !!fieldMapping.soc && !fieldMapping.range && rangeTestRuns.length > 0;

    // ── Tiny rounding helper (mirrors DataService.roundField, used for estimations) ──
    const roundField = (v, dp) => (v == null || isNaN(Number(v))) ? null : Math.round(Number(v) * 10 ** dp) / 10 ** dp;

    // ── kWh calculator from data_points ──────────────────────────────────────
    // Trapezoidal integration of chargeRate (kW) over time.
    // Time-unit auto-detection: if max time_value > 300 assume seconds, else minutes.
    // Returns rounded kWh, or null if insufficient data.
    const calcKwhFromPoints = (points) => {
        const pts = points.filter(p => p.chargeRate != null && p.time != null);
        if (pts.length < 2) return null;
        const sorted = [...pts].sort((a, b) => a.time - b.time);
        const maxTime = sorted[sorted.length - 1].time;
        const toHours = maxTime > 300 ? 1 / 3600 : 1 / 60;
        let kwh = 0;
        for (let i = 1; i < sorted.length; i++) {
            const dt = (sorted[i].time - sorted[i - 1].time) * toHours;
            const avgKw = (sorted[i].chargeRate + sorted[i - 1].chargeRate) / 2;
            if (dt > 0 && avgKw >= 0) kwh += avgKw * dt;
        }
        return kwh < 0.1 ? null : Math.round(kwh * 10) / 10;
    };

    // ── On-demand kWh comparison for card view (non-edit) ────────────────────
    const handleCheckKwh = async (run) => {
        setCalcKwhByRun(prev => ({ ...prev, [run.id]: { loading: true } }));
        try {
            const data = await dataService.getRunData(run.id);
            const kwh = calcKwhFromPoints(data);
            setCalcKwhByRun(prev => ({ ...prev, [run.id]: { kwh, loading: false } }));
        } catch {
            setCalcKwhByRun(prev => ({ ...prev, [run.id]: { kwh: null, loading: false, error: true } }));
        }
    };

    // ── Duplicate run ─────────────────────────────────────────────────────────
    const handleDuplicateRun = async (run) => {
        setDuplicatingRunId(run.id);
        try {
            await onDuplicateRun(run.id);
        } finally {
            setDuplicatingRunId(null);
        }
    };

    // ── Copy run to another vehicle ───────────────────────────────────────────
    const handleCopyToConfirm = async () => {
        if (!copyToRun || !copyingToVehicleId) return;
        await onCopyRunToVehicle(copyToRun, Number(copyingToVehicleId));
        setCopyToRun(null);
        setCopyingToVehicleId('');
    };

    // Vehicles the current user can edit, excluding the current vehicle
    const copyTargetVehicles = (vehicles || []).filter(v =>
        v.id !== vehicle.id && canEdit(v)
    );

    // ── Export run data to CSV ────────────────────────────────────────────────
    const handleExportCsv = async (run) => {
        setExportingRunId(run.id);
        try {
            const points = await dataService.getRunData(run.id);
            const csv = Papa.unparse(points.map(p => ({
                frame:       p.frame,
                soc:         p.soc,
                charge_rate: p.chargeRate,
                time:        p.time,
                range:       p.range,
                temperature: p.temperature,
            })));
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${run.name.replace(/[^a-z0-9]/gi, '_')}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        } finally {
            setExportingRunId(null);
        }
    };

    // ── Field tag metadata (ordered for display) ─────────────────────────────
    const FIELD_META = [
        { key: 'soc',         label: 'SoC',   title: 'State of Charge (%)' },
        { key: 'chargeRate',  label: 'kW',    title: 'Charge Rate (kW)' },
        { key: 'time',        label: 'Time',  title: 'Time' },
        { key: 'range',       label: 'Range', title: 'Range' },
        { key: 'temperature', label: 'Temp',  title: 'Temperature' },
    ];

    // ── Derived state ─────────────────────────────────────────────────────────

    const availableFields  = csvData?.meta.fields || [];
    const allDisplayRuns   = (vehicle.runs || []).filter(r => !committedDeletes.has(r.id));
    const displayRuns      = allDisplayRuns.filter(r => !r._inherited);
    const inheritedRuns    = allDisplayRuns.filter(r => r._inherited);
    const barVisible       = pendingDeletes.size > 0 || !!undoState;

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div className={barVisible ? 'pb-20' : ''}>
            {/* Vehicle summary header */}
            <div className="card py-3 px-4 flex items-center gap-4 mb-6">
                <div className="list-thumbnail">
                    {vehicle.image_url
                        ? <img src={vehicle.image_url} alt={vehicle.name} className="w-full h-full object-cover" />
                        : <span>🚗</span>
                    }
                </div>
                <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-lg leading-tight">{vehicle.name}</h3>
                    <p className="text-gray-500 text-sm">{vehicle.make} {vehicle.model} {vehicle.year}</p>
                    <div className="text-sm text-gray-600 mt-0.5 flex flex-wrap gap-x-3">
                        {vehicle.battery && <span>Battery: {vehicle.battery} kWh</span>}
                        {vehicle.range && <span>Range: {vehicle.range} mi</span>}
                    </div>
                </div>
                <div className="flex flex-col gap-1 flex-shrink-0 items-stretch w-28">
                    {(() => {
                        const isPublic = vehicle.visibility === 'public';
                        const base = 'w-full flex items-center justify-center gap-1 text-xs font-semibold px-2 py-1 rounded-full border transition';
                        return canPublish() ? (
                            <button
                                onClick={() => onToggleVehicleVisibility(vehicle.id, isPublic ? 'private' : 'public')}
                                className={`${base} ${isPublic ? 'bg-green-100 text-green-700 border-green-300 hover:bg-green-200' : 'bg-gray-100 text-gray-500 border-gray-300 hover:bg-gray-200'}`}
                            >
                                {isPublic ? '🌐 Public' : '🔒 Private'}
                            </button>
                        ) : (
                            <span className={`${base} ${isPublic ? 'bg-green-100 text-green-700 border-green-300' : 'bg-gray-100 text-gray-500 border-gray-300'}`}>
                                {isPublic ? '🌐 Public' : '🔒 Private'}
                            </span>
                        );
                    })()}
                    {canEdit(vehicle) && (
                        <button onClick={openEditVehicle} className="px-3 py-1 rounded-md text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition">
                            Edit
                        </button>
                    )}
                    {canEdit(vehicle) ? (
                        <button onClick={() => setShowEditSpecs(true)} className="px-3 py-1 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition">
                            Specs
                        </button>
                    ) : vehicle.specs && Object.keys(vehicle.specs).length > 0 && (
                        <button onClick={() => setShowViewSpecs(true)} className="px-3 py-1 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition">
                            Specs
                        </button>
                    )}
                    {canEdit(vehicle) && (
                        <button
                            onClick={async () => { setDuplicatingVehicle(true); await onDuplicateVehicle(vehicle.id); setDuplicatingVehicle(false); }}
                            disabled={duplicatingVehicle}
                            className="px-3 py-1 rounded-md text-xs font-medium bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition disabled:opacity-50 flex items-center gap-1"
                        >
                            {duplicatingVehicle ? <><span className="inline-block w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"/>Copying…</> : '⧉ Copy'}
                        </button>
                    )}
                    {canDelete(vehicle) && (
                        <button
                            onClick={() => { if (window.confirm(`Delete "${vehicle.name}" and all its tests?`)) onDeleteVehicle(vehicle.id); }}
                            className="px-3 py-1 rounded-md text-xs font-medium bg-red-50 text-red-600 hover:bg-red-100 transition"
                        >
                            Delete
                        </button>
                    )}
                </div>
            </div>

            <div className="runs-view-header">
                <div>
                    <h2 className="page-title">{vehicle.name} - Tests &amp; Data</h2>
                    <p className="text-gray-600">Manage charging test data for this vehicle</p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => {
                            if (showUpload && uploadMode === 'create') {
                                resetUploadState();
                            } else {
                                setUploadMode('create');
                                setMergeTargetRun(null);
                                setShowUpload(true);
                                setUploadStep('file');
                                setCsvData(null);
                                setFieldMapping({});
                            }
                        }}
                        className="btn btn-primary"
                    >
                        {showUpload && uploadMode === 'create' ? 'Cancel' : '+ Add new record'}
                    </button>
                    {allDisplayRuns.length > 0 && (
                        <button
                            onClick={onViewChart}
                            className="btn btn-primary"
                        >
                            View Charts
                        </button>
                    )}
                </div>
            </div>

            {showUpload && (
                <div className="card mb-6">
                    {/* ── Merge-mode banner ── */}
                    {uploadMode === 'merge' && mergeTargetRun && (
                        <div className="merge-target-banner">
                            <div>
                                <span className="text-sm font-semibold text-blue-800">Adding data to: </span>
                                <span className="text-sm text-blue-700">{mergeTargetRun.name}</span>
                            </div>
                            <button onClick={resetUploadState} className="text-blue-500 hover:text-blue-700 text-sm">
                                Cancel
                            </button>
                        </div>
                    )}

                    {uploadStep === 'file' && (
                        <div>
                            <h3 className="section-title mb-4">
                                {uploadMode === 'merge' ? 'Upload Additional Data' : 'Add new record'}
                            </h3>
                            <div className="space-y-4">
                                {/* Only show metadata inputs in create mode */}
                                {uploadMode === 'create' && (
                                    <>
                                        {/* Data-type flags — multi-select, at least one must remain active */}
                                        <div>
                                            <p className="text-xs text-gray-500 mb-1">Data types (select all that apply)</p>
                                            <div className="data-type-flags">
                                                {DATA_FLAGS.map(({ key, label, pillStyle, desc }) => {
                                                    const active = runMetadata.dataFlags.includes(key);
                                                    return (
                                                        <button
                                                            key={key}
                                                            type="button"
                                                            title={desc}
                                                            onClick={() => setRunMetadata(m => {
                                                                const next = active
                                                                    ? m.dataFlags.filter(f => f !== key)
                                                                    : [...m.dataFlags, key];
                                                                return { ...m, dataFlags: next.length ? next : m.dataFlags };
                                                            })}
                                                            className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${active ? pillStyle : 'bg-gray-100 text-gray-400 border-gray-200 hover:border-gray-300'}`}
                                                        >
                                                            {label}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>

                                        {/* Core metadata */}
                                        <input
                                            placeholder="Name (e.g., Highway Test - Winter 2024)"
                                            value={runMetadata.name}
                                            onChange={(e) => setRunMetadata({...runMetadata, name: e.target.value})}
                                            className="form-input w-full"
                                            required
                                        />
                                        <input
                                            type="date"
                                            value={runMetadata.date}
                                            onChange={(e) => setRunMetadata({...runMetadata, date: e.target.value})}
                                            className="form-input w-full"
                                        />
                                        <input
                                            placeholder="Software Version (e.g., 2024.1.5)"
                                            value={runMetadata.softwareVersion}
                                            onChange={(e) => setRunMetadata({...runMetadata, softwareVersion: e.target.value})}
                                            className="form-input w-full"
                                        />
                                        <input
                                            placeholder="Notes (e.g., 20°F, highway speeds)"
                                            value={runMetadata.conditions}
                                            onChange={(e) => setRunMetadata({...runMetadata, conditions: e.target.value})}
                                            className="form-input w-full"
                                        />

                                        {/* Trim selector */}
                                        {vehicle?.trims?.length > 0 && (
                                            <div>
                                                <label className="text-sm font-medium text-gray-700">Trim / Configuration</label>
                                                <select
                                                    value={runMetadata.trimId}
                                                    onChange={(e) => setRunMetadata({...runMetadata, trimId: e.target.value})}
                                                    className="form-input w-full mt-1"
                                                >
                                                    <option value="">— Select trim (optional) —</option>
                                                    {vehicle.trims.map(t => (
                                                        <option key={t.id} value={t.id}>
                                                            {t.name}{t.wheel_size ? ` · ${t.wheel_size}` : ''}{t.tire_size ? ` / ${t.tire_size}` : ''}
                                                        </option>
                                                    ))}
                                                </select>
                                                {runMetadata.trimId && (() => {
                                                    const t = vehicle.trims.find(x => String(x.id) === String(runMetadata.trimId));
                                                    return t ? (
                                                        <p className="text-xs text-gray-500 mt-1">
                                                            {[t.wheel_size, t.tire_size, t.epa_range_miles != null && `EPA ${t.epa_range_miles} mi`].filter(Boolean).join(' · ')}
                                                        </p>
                                                    ) : null;
                                                })()}
                                            </div>
                                        )}

                                        {/* Charging energy field (create mode) */}
                                        {runMetadata.dataFlags.includes('charging') && (
                                            <div className="data-subpanel p-3">
                                                <p className="text-sm font-semibold text-gray-700 mb-2">Charging Energy <span className="font-normal text-gray-400">(optional)</span></p>
                                                <input
                                                    type="number"
                                                    placeholder="Energy added (kWh)"
                                                    title="Energy measured at charger or vehicle — energy in"
                                                    value={runMetadata.energyKwh}
                                                    onChange={(e) => setRunMetadata({...runMetadata, energyKwh: e.target.value})}
                                                    className="form-input w-full"
                                                />
                                                <p className="text-xs text-gray-400 mt-1">
                                                    Energy measured at charger or vehicle — <em>energy in</em>
                                                </p>
                                                <input
                                                    type="url"
                                                    placeholder="Charging source URL (optional)"
                                                    value={runMetadata.chargingUrl}
                                                    onChange={(e) => setRunMetadata({...runMetadata, chargingUrl: e.target.value})}
                                                    className="form-input w-full mt-2"
                                                />
                                            </div>
                                        )}

                                        {/* Range test fields */}
                                        {runMetadata.dataFlags.includes('range') && (
                                            <div className="data-subpanel p-4 space-y-3">
                                                <p className="text-sm font-semibold text-gray-700">Range Test Details</p>
                                                <div className="form-grid gap-3">
                                                    <input
                                                        placeholder="Source (e.g., Out of Spec)"
                                                        value={runMetadata.source}
                                                        onChange={(e) => setRunMetadata({...runMetadata, source: e.target.value})}
                                                        className="form-input col-span-2"
                                                    />
                                                    <input
                                                        type="number"
                                                        placeholder="Start SoC (%)"
                                                        value={runMetadata.startSoc}
                                                        onChange={(e) => setRunMetadata({...runMetadata, startSoc: e.target.value})}
                                                        className="form-input"
                                                        min="0" max="100"
                                                    />
                                                    <input
                                                        type="number"
                                                        placeholder="End SoC (%)"
                                                        value={runMetadata.endSoc}
                                                        onChange={(e) => setRunMetadata({...runMetadata, endSoc: e.target.value})}
                                                        className="form-input"
                                                        min="0" max="100"
                                                    />
                                                    <input
                                                        type="number"
                                                        placeholder="Speed (mph)"
                                                        value={runMetadata.speedMph}
                                                        onChange={(e) => setRunMetadata({...runMetadata, speedMph: e.target.value})}
                                                        className="form-input"
                                                    />
                                                    <input
                                                        type="number"
                                                        placeholder="Distance (miles)"
                                                        value={runMetadata.distanceMiles}
                                                        onChange={(e) => setRunMetadata({...runMetadata, distanceMiles: e.target.value})}
                                                        className="form-input"
                                                    />
                                                    <input
                                                        type="number"
                                                        placeholder="Energy consumed (kWh)"
                                                        title="Energy consumed on the drive — energy out"
                                                        value={runMetadata.energyKwh}
                                                        onChange={(e) => setRunMetadata({...runMetadata, energyKwh: e.target.value})}
                                                        className="form-input"
                                                    />
                                                    <input
                                                        type="number"
                                                        placeholder="Ambient temp (°F)"
                                                        value={runMetadata.temperatureF}
                                                        onChange={(e) => setRunMetadata({...runMetadata, temperatureF: e.target.value})}
                                                        className="form-input"
                                                    />
                                                    <input
                                                        type="number"
                                                        placeholder="Elevation gain (ft)"
                                                        value={runMetadata.elevationGainFt}
                                                        onChange={(e) => setRunMetadata({...runMetadata, elevationGainFt: e.target.value})}
                                                        className="form-input col-span-2"
                                                    />
                                                    <input
                                                        type="url"
                                                        placeholder="Source URL"
                                                        value={runMetadata.url}
                                                        onChange={(e) => setRunMetadata({...runMetadata, url: e.target.value})}
                                                        className="form-input col-span-2"
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </>
                                )}
                                <div>
                                    <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer mb-2">
                                        <input
                                            type="checkbox"
                                            checked={noHeaders}
                                            onChange={e => {
                                                setNoHeaders(e.target.checked);
                                                setCsvData(null);
                                                setCsvText('');
                                                setFieldMapping({});
                                                setUploadStep('file');
                                            }}
                                            className="rounded"
                                        />
                                        CSV has no header row (use column numbers)
                                    </label>
                                    <div className="csv-drop-zone">
                                        <label className="cursor-pointer">
                                            <span className="text-blue-600 font-medium">Click to upload CSV file</span>
                                            <span className="block text-xs text-gray-400 mt-1">Optional — attach data points to this record</span>
                                            <input
                                                type="file"
                                                accept=".csv"
                                                className="hidden"
                                                onChange={handleFileUpload}
                                            />
                                        </label>
                                    </div>
                                    <div className="mt-3">
                                        <p className="text-xs text-gray-400 mb-1">Or paste CSV text directly:</p>
                                        <textarea
                                            rows={4}
                                            placeholder={"soc,chargeRate,time\n50,100,0\n80,75,15\n…"}
                                            value={csvText}
                                            onChange={e => handleCsvTextPaste(e.target.value)}
                                            className="form-input w-full text-xs font-mono resize-y"
                                        />
                                    </div>
                                </div>
                                {uploadMode === 'create' && (
                                    <div className="form-actions">
                                        <button
                                            onClick={handleSaveRecord}
                                            disabled={!runMetadata.name}
                                            className="btn btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            Save record
                                        </button>
                                        <button onClick={resetUploadState} className="btn btn-secondary">
                                            Cancel
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {uploadStep === 'mapping' && (
                        <div>
                            <h3 className="section-title mb-4">Map CSV Fields</h3>
                            <p className="text-gray-600 mb-4">Match your CSV columns to standard fields. We've auto-detected some for you.</p>

                            {/* In create mode, allow editing metadata here too */}
                            {uploadMode === 'create' && (
                                <div className="mb-6 p-4 bg-gray-50 rounded">
                                    <h4 className="font-semibold mb-3">Test Metadata</h4>
                                    <div className="space-y-3">
                                        <input
                                            placeholder="Name (e.g., Highway Test - Winter 2024)"
                                            value={runMetadata.name}
                                            onChange={(e) => setRunMetadata({...runMetadata, name: e.target.value})}
                                            className="form-input w-full"
                                            required
                                        />
                                        <input
                                            type="date"
                                            value={runMetadata.date}
                                            onChange={(e) => setRunMetadata({...runMetadata, date: e.target.value})}
                                            className="form-input w-full"
                                        />
                                        <input
                                            placeholder="Software Version (e.g., 2024.1.5)"
                                            value={runMetadata.softwareVersion}
                                            onChange={(e) => setRunMetadata({...runMetadata, softwareVersion: e.target.value})}
                                            className="form-input w-full"
                                        />
                                        <input
                                            placeholder="Notes (e.g., 20°F, highway speeds)"
                                            value={runMetadata.conditions}
                                            onChange={(e) => setRunMetadata({...runMetadata, conditions: e.target.value})}
                                            className="form-input w-full"
                                        />
                                    </div>
                                </div>
                            )}

                            <h4 className="font-semibold mb-3">Field Mapping</h4>
                            <div className="space-y-3">
                                {['soc', 'chargeRate', 'time', 'range', 'temperature', 'frame'].map(field => (
                                    <div key={field} className="field-mapping-row">
                                        <label className="w-40 font-medium capitalize">{field.replace(/([A-Z])/g, ' $1')}:</label>
                                        <select
                                            value={fieldMapping[field] || ''}
                                            onChange={(e) => setFieldMapping({...fieldMapping, [field]: e.target.value})}
                                            className="form-input flex-1"
                                        >
                                            <option value="">-- Not mapped --</option>
                                            {availableFields.map((f, i) => (
                                                <option key={f} value={f}>
                                                    {noHeaders && f.startsWith('col_') ? `Column ${i + 1}` : f}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                ))}
                            </div>

                            {/* ── Derived-column offers ── */}
                            {offerRangeEstimateTest && (
                                <div className="mt-5 space-y-3">
                                    {/* Measured range from test data */}
                                    {offerRangeEstimateTest && (
                                        <div className={`estimation-panel ${estimations.range === 'measured' ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
                                            <div className="flex-1 min-w-0">
                                                <p className={`text-sm font-semibold ${estimations.range === 'measured' ? 'text-green-800' : 'text-amber-800'}`}>
                                                    {estimations.range === 'measured' ? '✓ Range will be estimated (test data)' : '📏 Estimate from measured range test'}
                                                </p>
                                                {rangeTestRuns.length > 1 && (
                                                    <select
                                                        value={selectedRangeTestRunId ?? rangeTestRuns[0]?.id ?? ''}
                                                        onChange={e => setSelectedRangeTestRunId(Number(e.target.value))}
                                                        onClick={e => e.stopPropagation()}
                                                        className="mt-1 border p-1 rounded text-xs w-full max-w-xs"
                                                    >
                                                        {rangeTestRuns.map(r => {
                                                            const eff = Math.round(r.distance_miles * 100 / (r.start_soc - r.end_soc));
                                                            return <option key={r.id} value={r.id}>{r.name} — {eff} mi effective</option>;
                                                        })}
                                                    </select>
                                                )}
                                                <p className={`text-xs mt-0.5 ${estimations.range === 'measured' ? 'text-green-700' : 'text-amber-700'}`}>
                                                    {estimations.range === 'measured'
                                                        ? `range = SoC% × ${effectiveRangeFromTest} mi (${selectedRangeTestRun?.name})`
                                                        : `${selectedRangeTestRun?.name}: ${selectedRangeTestRun?.distance_miles} mi @ ${selectedRangeTestRun?.start_soc}→${selectedRangeTestRun?.end_soc}% SoC → ${effectiveRangeFromTest} mi effective`}
                                                </p>
                                            </div>
                                            <button
                                                onClick={() => setEstimations(prev => ({ ...prev, range: prev.range === 'measured' ? null : 'measured' }))}
                                                className={`shrink-0 text-xs px-3 py-1 rounded border transition-colors ${
                                                    estimations.range === 'measured'
                                                        ? 'bg-white text-green-700 border-green-300 hover:bg-green-100'
                                                        : 'bg-amber-600 text-white border-amber-600 hover:bg-amber-700'
                                                }`}
                                            >
                                                {estimations.range === 'measured' ? 'Undo' : 'Use test data'}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Join key selector — merge mode only */}
                            {uploadMode === 'merge' && (
                                <div className={`join-key-panel ${missingJoinKey ? 'bg-red-50 border-red-200' : showJoinSelector ? 'bg-yellow-50 border-yellow-200' : 'bg-green-50 border-green-200'}`}>
                                    {missingJoinKey ? (
                                        <p className="text-sm font-semibold text-red-700">
                                            ⚠ Map at least one of <strong>SoC</strong> or <strong>Time</strong> — it's needed to link incoming rows to existing ones.
                                        </p>
                                    ) : showJoinSelector ? (
                                        <>
                                            <p className="text-sm font-semibold text-yellow-800 mb-2">
                                                Both SoC and Time are mapped — which should be used to link rows?
                                            </p>
                                            <div className="flex gap-6">
                                                <label className="flex items-center gap-2 cursor-pointer text-sm">
                                                    <input type="radio" name="joinKey" value="soc" checked={joinKey === 'soc'} onChange={() => setJoinKey('soc')} />
                                                    <span className="font-medium">SoC</span>
                                                    <span className="text-gray-500">(charging curves, SoC-based data)</span>
                                                </label>
                                                <label className="flex items-center gap-2 cursor-pointer text-sm">
                                                    <input type="radio" name="joinKey" value="time" checked={joinKey === 'time'} onChange={() => setJoinKey('time')} />
                                                    <span className="font-medium">Time</span>
                                                    <span className="text-gray-500">(time-series, e.g. Time+Power → Time+SoC)</span>
                                                </label>
                                            </div>
                                        </>
                                    ) : (
                                        <p className="text-sm text-green-800">
                                            ✓ Rows will be linked by <strong>{canJoinBySoc ? 'SoC' : 'Time'}</strong>.
                                        </p>
                                    )}
                                </div>
                            )}

                            <div className="form-actions mt-6">
                                <button
                                    onClick={() => setUploadStep('file')}
                                    className="btn btn-secondary"
                                >
                                    Back
                                </button>
                                {uploadMode === 'create' ? (
                                    <button
                                        onClick={handleImport}
                                        className="btn btn-primary"
                                    >
                                        Import Run
                                    </button>
                                ) : (
                                    <button
                                        onClick={handleMerge}
                                        disabled={merging || missingJoinKey}
                                        className="btn btn-primary disabled:opacity-60 disabled:cursor-not-allowed"
                                    >
                                        {merging ? 'Merging…' : 'Merge into Run'}
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}

            <div className="space-y-4">
                {displayRuns.map(run => {
                  // Ensure vote data is loaded for this run (no-op if already loaded)
                  if (!runVotes[run.id]) loadRunVotes([run.id]);
                  const votes = runVotes[run.id] ?? { vouch: 0, flag: 0, myVote: null };
                  const isPending = pendingDeletes.has(run.id);
                  return (
                    <div
                        key={run.id}
                        className={`card${isPending ? ' opacity-60 border-2 border-red-200' : ''}`}
                    >
                        {editingRunId === run.id ? (
                            <div>
                                <h3 className="section-title mb-4">Edit Record</h3>
                                <div className="space-y-3">
                                    {/* Data-type flags — multi-select, at least one must remain active */}
                                    <div>
                                        <p className="text-xs text-gray-500 mb-1">Data types (select all that apply)</p>
                                        <div className="data-type-flags">
                                            {DATA_FLAGS.map(({ key, label, pillStyle, desc }) => {
                                                const active = (editFormData.dataFlags || ['charging']).includes(key);
                                                return (
                                                    <button
                                                        key={key}
                                                        type="button"
                                                        title={desc}
                                                        onClick={() => setEditFormData(f => {
                                                            const cur = f.dataFlags || ['charging'];
                                                            const next = active
                                                                ? cur.filter(x => x !== key)
                                                                : [...cur, key];
                                                            return { ...f, dataFlags: next.length ? next : cur };
                                                        })}
                                                        className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${active ? pillStyle : 'bg-gray-100 text-gray-400 border-gray-200 hover:border-gray-300'}`}
                                                    >
                                                        {label}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                    <input
                                        placeholder="Name"
                                        value={editFormData.name}
                                        onChange={(e) => setEditFormData({...editFormData, name: e.target.value})}
                                        className="form-input w-full"
                                    />
                                    <input
                                        type="date"
                                        value={editFormData.date}
                                        onChange={(e) => setEditFormData({...editFormData, date: e.target.value})}
                                        className="form-input w-full"
                                    />
                                    <input
                                        placeholder="Software Version"
                                        value={editFormData.softwareVersion}
                                        onChange={(e) => setEditFormData({...editFormData, softwareVersion: e.target.value})}
                                        className="form-input w-full"
                                    />
                                    <input
                                        placeholder="Notes"
                                        value={editFormData.conditions}
                                        onChange={(e) => setEditFormData({...editFormData, conditions: e.target.value})}
                                        className="form-input w-full"
                                    />
                                    {/* Trim selector (edit mode) */}
                                    {vehicle?.trims?.length > 0 && (
                                        <div>
                                            <label className="text-sm font-medium text-gray-700">Trim / Configuration</label>
                                            <select
                                                value={editFormData.trimId ?? ''}
                                                onChange={(e) => setEditFormData({...editFormData, trimId: e.target.value})}
                                                className="form-input w-full mt-1"
                                            >
                                                <option value="">— Select trim (optional) —</option>
                                                {vehicle.trims.map(t => (
                                                    <option key={t.id} value={t.id}>
                                                        {t.name}{t.wheel_size ? ` · ${t.wheel_size}` : ''}{t.tire_size ? ` / ${t.tire_size}` : ''}
                                                    </option>
                                                ))}
                                            </select>
                                            {editFormData.trimId && (() => {
                                                const t = vehicle.trims.find(x => String(x.id) === String(editFormData.trimId));
                                                return t ? (
                                                    <p className="text-xs text-gray-500 mt-1">
                                                        {[t.wheel_size, t.tire_size, t.epa_range_miles != null && `EPA ${t.epa_range_miles} mi`].filter(Boolean).join(' · ')}
                                                    </p>
                                                ) : null;
                                            })()}
                                        </div>
                                    )}
                                    {/* Charging energy field — shows energy_kwh for charging runs */}
                                    {(editFormData.dataFlags || ['charging']).includes('charging') && (
                                        <div className="data-subpanel p-3">
                                            <p className="text-sm font-semibold text-gray-700 mb-2">Charging Energy</p>
                                            <input
                                                type="number"
                                                placeholder="Energy added (kWh)"
                                                value={editFormData.energyKwh}
                                                onChange={(e) => setEditFormData({...editFormData, energyKwh: e.target.value})}
                                                className="form-input w-full"
                                            />
                                            <p className="text-xs text-gray-400 mt-1">
                                                Energy measured at charger or vehicle — <em>energy in</em> (not equal to energy used driving due to charging losses)
                                            </p>
                                            <input
                                                type="url"
                                                placeholder="Charging source URL (optional)"
                                                value={editFormData.chargingUrl ?? ''}
                                                onChange={(e) => setEditFormData({...editFormData, chargingUrl: e.target.value})}
                                                className="form-input w-full mt-2"
                                            />
                                        </div>
                                    )}

                                    {/* Estimate Time from Power — charging runs with SoC+kW data */}
                                    {canEdit(vehicle) && (editFormData.dataFlags || ['charging']).includes('charging') && (
                                        <div>
                                            <button
                                                type="button"
                                                onClick={() => handleToggleEstimatePanel(run.id)}
                                                className="text-sm text-gray-600 hover:text-gray-800 flex items-center gap-1 mt-1"
                                            >
                                                <span className="font-semibold">
                                                    {showEstimatePanel ? '▴ Estimate time from power' : '▾ Estimate time from power'}
                                                </span>
                                            </button>
                                            {showEstimatePanel && (
                                                <EstimateTimePanel
                                                    vehicle={vehicle}
                                                    editData={editData}
                                                    editDataLoading={editDataLoading}
                                                    anchors={estimateAnchors}
                                                    onChangeAnchors={setEstimateAnchors}
                                                    shiftToZero={estimateShift}
                                                    onShiftToZeroChange={setEstimateShift}
                                                    preview={estimatePreview}
                                                    applying={estimateApplying}
                                                    error={estimateError}
                                                    onPreview={handleEstimatePreview}
                                                    onApply={() => handleEstimateApply(run)}
                                                />
                                            )}
                                        </div>
                                    )}

                                    {/* Range test fields */}
                                    {(editFormData.dataFlags || ['charging']).includes('range') && (
                                        <div className="data-subpanel p-4 space-y-3">
                                            <p className="text-sm font-semibold text-gray-700">Range Test Details</p>
                                            <div className="form-grid gap-3">
                                                <input
                                                    placeholder="Source (e.g., Out of Spec)"
                                                    value={editFormData.source}
                                                    onChange={(e) => setEditFormData({...editFormData, source: e.target.value})}
                                                    className="form-input col-span-2"
                                                />
                                                <input
                                                    type="number"
                                                    placeholder="Start SoC (%)"
                                                    value={editFormData.startSoc}
                                                    onChange={(e) => setEditFormData({...editFormData, startSoc: e.target.value})}
                                                    className="form-input"
                                                    min="0" max="100"
                                                />
                                                <input
                                                    type="number"
                                                    placeholder="End SoC (%)"
                                                    value={editFormData.endSoc}
                                                    onChange={(e) => setEditFormData({...editFormData, endSoc: e.target.value})}
                                                    className="form-input"
                                                    min="0" max="100"
                                                />
                                                <input
                                                    type="number"
                                                    placeholder="Speed (mph)"
                                                    value={editFormData.speedMph}
                                                    onChange={(e) => setEditFormData({...editFormData, speedMph: e.target.value})}
                                                    className="form-input"
                                                />
                                                <input
                                                    type="number"
                                                    placeholder="Distance (miles)"
                                                    value={editFormData.distanceMiles}
                                                    onChange={(e) => setEditFormData({...editFormData, distanceMiles: e.target.value})}
                                                    className="form-input"
                                                />
                                                <input
                                                    type="number"
                                                    placeholder="Energy consumed (kWh)"
                                                    title="Energy consumed on the drive — energy out"
                                                    value={editFormData.energyKwh}
                                                    onChange={(e) => setEditFormData({...editFormData, energyKwh: e.target.value})}
                                                    className="form-input"
                                                />
                                                <input
                                                    type="number"
                                                    placeholder="Ambient temp (°F)"
                                                    value={editFormData.temperatureF}
                                                    onChange={(e) => setEditFormData({...editFormData, temperatureF: e.target.value})}
                                                    className="form-input"
                                                />
                                                <input
                                                    type="number"
                                                    placeholder="Elevation gain (ft)"
                                                    value={editFormData.elevationGainFt}
                                                    onChange={(e) => setEditFormData({...editFormData, elevationGainFt: e.target.value})}
                                                    className="form-input col-span-2"
                                                />
                                                <input
                                                    type="url"
                                                    placeholder="Source URL"
                                                    value={editFormData.url}
                                                    onChange={(e) => setEditFormData({...editFormData, url: e.target.value})}
                                                    className="form-input col-span-2"
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <div className="form-actions mt-4">
                                    <button
                                        onClick={() => handleSaveEdit(run.id)}
                                        disabled={savingData}
                                        className="btn btn-primary disabled:opacity-60 disabled:cursor-not-allowed"
                                    >
                                        {savingData ? 'Saving…' : 'Save Changes'}
                                    </button>
                                    <button
                                        onClick={handleCancelEdit}
                                        disabled={savingData}
                                        className="btn btn-secondary disabled:opacity-60"
                                    >
                                        Cancel
                                    </button>
                                </div>

                                {/* ── Data table toggle ── */}
                                <div className="mt-4 border-t pt-3">
                                    <button
                                        onClick={() => handleToggleDataTable(run.id)}
                                        className="text-sm text-gray-600 hover:text-gray-800 flex items-center gap-1"
                                    >
                                        <span className="font-semibold">{showDataTable ? '▴ Hide data' : '▾ Show data'}</span>
                                        {editData !== null && !editDataLoading && (
                                            <span className="text-xs text-gray-400">({editData.length} rows)</span>
                                        )}
                                        {editDataDirty && (
                                            <span className="ml-1 text-xs text-orange-500 font-medium">● unsaved changes</span>
                                        )}
                                    </button>

                                    {showDataTable && (
                                        <div className="mt-3">
                                            {/* Range estimation offer — shown when range is absent but SoC exists */}
                                            {canEdit(vehicle) && !editDataLoading && editData !== null &&
                                             editData.some(r => r.soc != null) &&
                                             editData.every(r => r.range == null) && (
                                                <div className="mb-3 p-3 rounded-lg border bg-blue-50 border-blue-200">
                                                    <p className="text-xs text-blue-800 font-semibold mb-2">ℹ No range data — estimate from SoC%:</p>
                                                    <div className="flex flex-wrap gap-2">
                                                        {effectiveRangeFromTest && (
                                                            <button
                                                                onClick={() => handleEstimateRangeInEdit()}
                                                                className="text-xs px-3 py-1 rounded border bg-amber-600 text-white border-amber-600 hover:bg-amber-700 transition-colors"
                                                                title={`From: ${selectedRangeTestRun?.name}`}
                                                            >
                                                                Measured ({effectiveRangeFromTest} mi effective)
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                            {/* kWh comparison — charging runs only, once data is loaded */}
                                            {!editDataLoading && editCalcKwh != null && (editFormData.dataFlags || ['charging']).includes('charging') && (() => {
                                                const manual = editFormData.energyKwh !== '' ? parseFloat(editFormData.energyKwh) : NaN;
                                                const hasManual = !isNaN(manual) && manual > 0;
                                                const pct = hasManual
                                                    ? Math.abs(manual - editCalcKwh) / Math.max(manual, editCalcKwh) * 100
                                                    : null;
                                                return (
                                                    <div className={`mb-3 p-3 rounded-lg border flex flex-wrap items-center gap-3 ${pct != null && pct > 5 ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}>
                                                        <span className="text-xs text-gray-700">
                                                            ⚡ <strong>Data points → {editCalcKwh} kWh</strong>
                                                            {hasManual && <span className="text-gray-500"> (entered: {manual} kWh)</span>}
                                                        </span>
                                                        {pct != null && pct > 5 && (
                                                            <span className="text-xs bg-amber-100 text-amber-800 border border-amber-300 px-2 py-0.5 rounded-full font-medium">
                                                                ⚠️ {pct.toFixed(1)}% mismatch
                                                            </span>
                                                        )}
                                                        {pct != null && pct <= 5 && (
                                                            <span className="text-xs bg-green-100 text-green-800 border border-green-300 px-2 py-0.5 rounded-full font-medium">
                                                                ✓ within 5%
                                                            </span>
                                                        )}
                                                        {!hasManual && (
                                                            <span className="text-xs text-gray-400">Enter energy (kWh) above to compare</span>
                                                        )}
                                                    </div>
                                                );
                                            })()}
                                            {editDataLoading ? (
                                                <p className="text-sm text-gray-500 py-4 text-center">Loading…</p>
                                            ) : (
                                                <>
                                                    <div className="overflow-auto rounded border" style={{ maxHeight: 360 }}>
                                                        <table className="w-full text-xs border-collapse">
                                                            <thead className="bg-gray-50 sticky top-0 z-10 border-b">
                                                                <tr>
                                                                    <th className="px-2 py-1.5 text-left text-gray-500 font-medium w-8">#</th>
                                                                    {[['soc','SoC (%)'],['chargeRate','kW'],['time','Time'],['range','Range'],['temperature','Temp']].map(([field, label]) => {
                                                                        const isEst      = editCalculatedFields.includes(field);
                                                                        const isActive   = sortField === field;
                                                                        const indicator  = isActive ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
                                                                        return (
                                                                        <th key={field} className="px-2 py-1.5 text-left text-gray-500 font-medium">
                                                                            <div className="flex flex-col gap-0.5">
                                                                                <button
                                                                                    onClick={() => handleSortByField(field)}
                                                                                    title={`Sort by ${label}`}
                                                                                    className={`text-left hover:text-gray-800 transition-colors ${isActive ? 'text-blue-600 font-semibold' : ''}`}
                                                                                >
                                                                                    {label}{indicator}
                                                                                </button>
                                                                                <div className="flex items-center gap-1">
                                                                                    <button
                                                                                        onClick={() => setEditCalculatedFields(prev =>
                                                                                            isEst
                                                                                                ? prev.filter(f => f !== field)
                                                                                                : [...prev, field]
                                                                                        )}
                                                                                        title={isEst ? 'Estimated — click to mark as actual' : 'Actual — click to mark as estimated'}
                                                                                        className={`text-[10px] font-normal rounded px-1 leading-tight w-fit transition-colors ${
                                                                                            isEst
                                                                                                ? 'text-amber-600 bg-amber-50 border border-amber-200 hover:bg-amber-100'
                                                                                                : 'text-green-700 bg-green-50 border border-green-200 hover:bg-green-100'
                                                                                        }`}
                                                                                    >
                                                                                        {isEst ? '~est' : 'act'}
                                                                                    </button>
                                                                                    {canEdit(vehicle) && editData?.some(r => r[field] != null) && (
                                                                                        <button
                                                                                            onClick={() => handleClearColumn(field)}
                                                                                            title={`Clear all ${label} values`}
                                                                                            className="text-[10px] font-normal rounded px-1 leading-tight w-fit text-gray-400 border border-transparent hover:text-red-500 hover:bg-red-50 hover:border-red-200 transition-colors"
                                                                                        >
                                                                                            ×clr
                                                                                        </button>
                                                                                    )}
                                                                                </div>
                                                                            </div>
                                                                        </th>
                                                                        );
                                                                    })}
                                                                    {canEdit(vehicle) && <th className="w-6"></th>}
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {(editData || []).map((row, i) => (
                                                                    <tr key={i} className={`border-t ${i % 2 !== 0 ? 'bg-gray-50/50' : ''}`}>
                                                                        <td className="px-2 py-0.5 text-gray-400 select-none">{i + 1}</td>
                                                                        {['soc','chargeRate','time','range','temperature'].map(field => (
                                                                            <td key={field} className="px-1 py-0.5">
                                                                                <input
                                                                                    type="number"
                                                                                    disabled={!canEdit(vehicle)}
                                                                                    value={row[field] ?? ''}
                                                                                    onChange={e => handleEditDataCell(i, field, e.target.value)}
                                                                                    placeholder="—"
                                                                                    className={`w-full text-xs p-0.5 rounded outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${
                                                                                        canEdit(vehicle)
                                                                                            ? 'bg-transparent hover:bg-white focus:bg-white focus:ring-1 focus:ring-blue-300'
                                                                                            : 'bg-transparent text-gray-600 cursor-default'
                                                                                    }`}
                                                                                />
                                                                            </td>
                                                                        ))}
                                                                        {canEdit(vehicle) && (
                                                                            <td className="px-1 text-center">
                                                                                <button
                                                                                    onClick={() => handleDeleteDataRow(i)}
                                                                                    className="text-gray-300 hover:text-red-500 leading-none"
                                                                                    title="Remove row"
                                                                                >×</button>
                                                                            </td>
                                                                        )}
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                    {canEdit(vehicle) && (
                                                        <button
                                                            onClick={handleAddDataRow}
                                                            className="mt-2 text-xs text-blue-600 hover:text-blue-800"
                                                        >
                                                            + Add row
                                                        </button>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="run-card-header">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <h3 className="section-title">
                                            {run.name}
                                            {run.url && (
                                                <a href={run.url} target="_blank" rel="noopener noreferrer"
                                                    title="Range test source"
                                                    onClick={e => e.stopPropagation()}
                                                    className="text-blue-400 hover:text-blue-600 transition-colors ml-1 text-sm font-normal">
                                                    ↗
                                                </a>
                                            )}
                                            {run.charging_url && (
                                                <a href={run.charging_url} target="_blank" rel="noopener noreferrer"
                                                    title="Charging test source"
                                                    onClick={e => e.stopPropagation()}
                                                    className="text-blue-400 hover:text-blue-600 transition-colors ml-1 text-sm font-normal">
                                                    ↗
                                                </a>
                                            )}
                                        </h3>
                                        {/* Data-type flag pills — one per active data domain */}
                                        {inferRunFlags(run).map(key => {
                                            const flag = DATA_FLAGS.find(f => f.key === key);
                                            if (!flag) return null;
                                            return (
                                                <span key={key} title={flag.desc}
                                                    className={`text-xs px-2 py-0.5 rounded-full font-medium border ${flag.pillStyle}`}>
                                                    {flag.label}
                                                </span>
                                            );
                                        })}
                                        {run.isDefault && (
                                            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded font-semibold" style={{backgroundColor: 'var(--color-primary-light)', color: 'var(--color-primary-text)'}}>
                                                Default
                                            </span>
                                        )}
                                    </div>
                                    <div className="run-meta">
                                        <p>Date: {run.date}</p>
                                        {(run.softwareVersion || run.software_version) && <p>Software: {run.softwareVersion || run.software_version}</p>}
                                        {run.conditions && <p>Notes: {run.conditions}</p>}
                                        {/* Range data section — shown whenever the run has range data (with or without the range flag) */}
                                        {(inferRunFlags(run).includes('range') || run.distance_miles != null) && (
                                            <div className="run-stat-badges">
                                                {run.source && <span className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded">{run.source}</span>}
                                                {run.speed_mph != null
                                                    ? <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{fmtSpeed(run.speed_mph, units)}</span>
                                                    : <span className="text-xs bg-amber-50 text-amber-600 px-2 py-0.5 rounded border border-amber-200" title="Set Speed (mph) in the run's metadata for accurate Road Trip efficiency">70 mph (assumed)</span>
                                                }
                                                {run.distance_miles != null && <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded border border-green-200">{fmtDistance(run.distance_miles, units)}</span>}
                                                {run.energy_kwh != null && (
                                                    <span
                                                        title="Energy consumed on the drive — energy out (measured at vehicle)"
                                                        className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded border border-blue-200"
                                                    >
                                                        {run.energy_kwh} kWh <span className="opacity-60 text-[10px]">out</span>
                                                    </span>
                                                )}
                                                {run.energy_kwh != null && run.distance_miles != null && (
                                                    <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded border border-blue-200">
                                                        {calcEff(run.distance_miles, run.energy_kwh, 'mi_kwh', units)} {getEffLabel('mi_kwh', units)}
                                                    </span>
                                                )}
                                                {run.temperature_f != null && <span className="text-xs bg-orange-50 text-orange-700 px-2 py-0.5 rounded border border-orange-200">{fmtTemp(run.temperature_f, units)}</span>}
                                                {run.start_soc != null && run.end_soc != null && <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">SoC {run.start_soc}→{run.end_soc}%</span>}
                                                {run.url && <a href={run.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline px-2 py-0.5 rounded">Source ↗</a>}
                                            </div>
                                        )}
                                        {/* Charging data section — shown whenever the run has time-series data */}
                                        {inferRunFlags(run).includes('charging') && (
                                            <div className="run-stat-badges items-center">
                                                <span className="text-sm">Data Points: {run.dataPointCount ?? run.data?.length ?? 0}</span>
                                                {/* energy_kwh for charging = energy in (measured at charger/vehicle) */}
                                                {run.energy_kwh != null && !inferRunFlags(run).includes('range') && (
                                                    <span
                                                        title="Energy added during this charging session — energy in (measured at charger or vehicle)"
                                                        className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded border border-blue-200"
                                                    >
                                                        {run.energy_kwh} kWh <span className="opacity-60 text-[10px]">in</span>
                                                    </span>
                                                )}
                                                {run.charging_url && <a href={run.charging_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline px-2 py-0.5 rounded">Source ↗</a>}
                                                {/* Lazy kWh compare button — only when energy_kwh is set and data points exist */}
                                                {run.energy_kwh != null && (run.dataPointCount ?? 0) > 1 && (() => {
                                                    const check = calcKwhByRun[run.id];
                                                    if (!check) return (
                                                        <button
                                                            onClick={() => handleCheckKwh(run)}
                                                            className="text-xs text-gray-400 hover:text-gray-600 border border-gray-200 rounded px-1.5 py-0.5 transition-colors"
                                                            title="Calculate kWh from data points and compare to entered value"
                                                        >
                                                            Compare ↔
                                                        </button>
                                                    );
                                                    if (check.loading) return <span className="text-xs text-gray-400">Calculating…</span>;
                                                    if (check.error || check.kwh == null) return <span className="text-xs text-gray-400">—</span>;
                                                    const pct = Math.abs(run.energy_kwh - check.kwh) / Math.max(run.energy_kwh, check.kwh) * 100;
                                                    return (
                                                        <span className={`text-xs px-2 py-0.5 rounded border font-medium ${pct > 5 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-green-50 text-green-700 border-green-200'}`}
                                                            title={`Calculated from data points: ${check.kwh} kWh`}
                                                        >
                                                            {pct > 5 ? '⚠️ ' : '✓ '}data: {check.kwh} kWh ({pct.toFixed(1)}%)
                                                        </span>
                                                    );
                                                })()}
                                            </div>
                                        )}
                                    </div>
                                    {/* Field tags — populated fields; amber = estimated, blue = measured */}
                                    {(() => {
                                        const fields = run.populated_fields || [];
                                        const calcFields = run.calculated_fields || [];
                                        if (fields.length === 0) return null;
                                        return (
                                            <div className="flex flex-wrap gap-1 mt-2">
                                                {FIELD_META.filter(f => fields.includes(f.key)).map(f => {
                                                    const isCalc = calcFields.includes(f.key);
                                                    return (
                                                        <span
                                                            key={f.key}
                                                            title={isCalc ? `${f.title} (estimated from rated range)` : f.title}
                                                            className={`px-2 py-0.5 text-xs rounded-full font-medium border ${
                                                                isCalc
                                                                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                                                                    : 'bg-blue-50 text-blue-700 border-blue-200'
                                                            }`}
                                                        >
                                                            {isCalc ? `~${f.label}` : f.label}
                                                        </span>
                                                    );
                                                })}
                                            </div>
                                        );
                                    })()}
                                    <div className="inline-row mt-3">
                                        <span className="text-sm text-gray-600">Plot Color:</span>
                                        <input
                                            type="color"
                                            value={run.color || '#3b82f6'}
                                            onChange={(e) => {
                                                onUpdateRun(run.id, { color: e.target.value });
                                            }}
                                            className="w-10 h-7 border-0 rounded cursor-pointer"
                                            title="Change color"
                                        />
                                        <input
                                            type="text"
                                            value={run.color || '#3b82f6'}
                                            onChange={(e) => {
                                                const value = e.target.value;
                                                onUpdateRun(run.id, { color: value });
                                            }}
                                            onBlur={(e) => {
                                                const value = e.target.value;
                                                if (!/^#[0-9A-Fa-f]{6}$/.test(value)) {
                                                    onUpdateRun(run.id, { color: run.color || '#3b82f6' });
                                                }
                                            }}
                                            className="w-24 px-2 py-1 border rounded text-sm font-mono"
                                            placeholder="#3b82f6"
                                            maxLength={7}
                                        />
                                    </div>
                                </div>
                                <div className="run-actions">
                                    <RunVoteButtons
                                        vouch={votes.vouch}
                                        flag={votes.flag}
                                        myVote={votes.myVote}
                                        onVote={(voteType) => toggleRunVote(run.id, voteType)}
                                    />
                                    {!run.isDefault && (
                                        <button
                                            onClick={() => onSetDefaultRun(run.id)}
                                            className="btn btn-secondary text-sm"
                                        >
                                            Set as Default
                                        </button>
                                    )}
                                    {canEdit(vehicle) && (
                                        <button
                                            onClick={() => handleUpdateData(run)}
                                            className="btn btn-secondary text-sm"
                                        >
                                            Upload additional data
                                        </button>
                                    )}
                                    <button
                                        onClick={() => handleExportCsv(run)}
                                        disabled={exportingRunId === run.id}
                                        title="Download test data as CSV"
                                        className="btn btn-secondary text-sm disabled:opacity-50"
                                    >
                                        {exportingRunId === run.id ? '…' : '↓ CSV'}
                                    </button>
                                    {canEdit(vehicle) && (
                                        <button
                                            onClick={() => handleDuplicateRun(run)}
                                            disabled={duplicatingRunId !== null}
                                            title="Duplicate this test and its data"
                                            className="btn btn-secondary text-sm disabled:opacity-50"
                                        >
                                            {duplicatingRunId === run.id ? '…' : '⧉ Copy'}
                                        </button>
                                    )}
                                    {canEdit(vehicle) && copyTargetVehicles.length > 0 && (
                                        <button
                                            onClick={() => { setCopyToRun(run); setCopyingToVehicleId(''); }}
                                            title="Copy this test to another vehicle"
                                            className="btn btn-secondary text-sm"
                                        >
                                            Copy to…
                                        </button>
                                    )}
                                    <button
                                        onClick={() => handleEditRun(run)}
                                        className="btn btn-edit"
                                    >
                                        Edit
                                    </button>
                                    <button
                                        onClick={() => isPending ? restoreItem(run.id) : queueDelete(run.id)}
                                        className={`btn text-sm ${isPending ? 'bg-orange-100 text-orange-700 hover:bg-orange-200 border-0 rounded-md px-3 py-1 font-medium' : 'btn-danger'}`}
                                    >
                                        {isPending ? '↩ Restore' : 'Delete'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                  );
                })}
            </div>

            {displayRuns.length === 0 && !showUpload && inheritedRuns.length === 0 && (
                <div className="empty-state">
                    <p className="text-lg">No tests yet. Add a record to get started!</p>
                </div>
            )}

            {/* ── Inherited Tests ───────────────────────────────────────────── */}
            {(inheritedRuns.length > 0 || (isContributor && canEdit(vehicle))) && (
                <div className="mt-6">
                    <div className="flex items-center gap-3 mb-3">
                        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
                            Inherited Tests
                        </h3>
                        {isContributor && canEdit(vehicle) && !showAddLink && (
                            <button
                                onClick={() => setShowAddLink(true)}
                                className="text-xs px-2 py-1 rounded bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition"
                            >
                                + Add Inherited Link
                            </button>
                        )}
                    </div>

                    {/* Existing inherited runs */}
                    {inheritedRuns.length > 0 && (
                        <div className="space-y-2 mb-3">
                            {inheritedRuns.map(run => {
                                const srcName = run._sourceVehicleName || `Vehicle #${run._sourceVehicleId}`;
                                const sf = run._scalingFactor;
                                const specLabel = run.has_range ? 'Range Test' : 'Charging Curve';
                                return (
                                    <div key={run.id} className="card border border-dashed border-gray-300 bg-gray-50 flex items-center gap-3 px-4 py-3">
                                        <span className="spec-link-type-badge flex-shrink-0">{specLabel}</span>
                                        <span className="text-sm text-gray-700 flex-1 min-w-0 truncate">
                                            Inherited from: <span className="font-medium">{srcName}</span>
                                        </span>
                                        {sf !== 1 && sf != null && (
                                            <span className="text-xs font-mono text-gray-500 flex-shrink-0">×{sf}</span>
                                        )}
                                        <span className="text-xs bg-amber-100 text-amber-700 border border-amber-300 rounded-full px-2 py-0.5 flex-shrink-0">
                                            Estimated
                                        </span>
                                        <button
                                            onClick={() => onViewChart && onViewChart()}
                                            className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 transition flex-shrink-0"
                                        >
                                            View Chart →
                                        </button>
                                        {isContributor && canEdit(vehicle) && (
                                            <button
                                                onClick={() => deleteSpecLink(run._specLinkId)}
                                                className="text-xs text-gray-400 hover:text-red-500 transition flex-shrink-0"
                                            >
                                                Remove
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Add link form */}
                    {showAddLink && (() => {
                        // Only show vehicles that have runs of the selected spec type
                        const hasRelevantRuns = (v) => newLinkSpecType === 'range_test'
                            ? v.runs?.some(r => !r._inherited && (r.has_range ?? false))
                            : v.runs?.some(r => !r._inherited && (r.has_charging ?? true));
                        // Exclude current vehicle and any already-linked source for this type
                        const alreadyLinkedIds = new Set(
                            (vehicle.spec_links || [])
                                .filter(l => l.spec_type === newLinkSpecType)
                                .map(l => Number(l.source_vehicle_id))
                        );
                        const sourceVehicles = (vehicles || [])
                            .filter(v => Number(v.id) !== Number(vehicle.id) && hasRelevantRuns(v) && !alreadyLinkedIds.has(Number(v.id)))
                            .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

                        const suggestEpaRatio = () => {
                            const src = (vehicles || []).find(v => Number(v.id) === parseInt(newLinkSourceId, 10));
                            if (!src) return;
                            const srcRange = parseFloat(src.range);
                            const tgtRange = parseFloat(vehicle.range);
                            if (srcRange && tgtRange) setNewLinkScaling((tgtRange / srcRange).toFixed(3));
                        };

                        const handleAdd = async () => {
                            if (!newLinkSourceId) return;
                            setLinkSaving(true);
                            try {
                                await addSpecLink({
                                    targetVehicleId: vehicle.id,
                                    sourceVehicleId: parseInt(newLinkSourceId, 10),
                                    specType: newLinkSpecType,
                                    scalingFactor: newLinkScaling ? parseFloat(newLinkScaling) : null,
                                    notes: newLinkNotes.trim() || null,
                                });
                                setNewLinkSourceId('');
                                setNewLinkScaling('');
                                setNewLinkNotes('');
                                setShowAddLink(false);
                            } finally {
                                setLinkSaving(false);
                            }
                        };

                        return (
                            <div className="spec-link-add-form">
                                <div className="flex gap-2 flex-wrap">
                                    <select
                                        value={newLinkSpecType}
                                        onChange={e => { setNewLinkSpecType(e.target.value); setNewLinkSourceId(''); }}
                                        className="form-input text-sm"
                                    >
                                        <option value="range_test">Range Test</option>
                                        <option value="charging_curve">Charging Curve</option>
                                    </select>
                                    <select
                                        value={newLinkSourceId}
                                        onChange={e => setNewLinkSourceId(e.target.value)}
                                        className="form-input text-sm flex-1 min-w-48"
                                    >
                                        <option value="">Source vehicle…</option>
                                        {sourceVehicles.map(v => (
                                            <option key={v.id} value={v.id}>{v.name}</option>
                                        ))}
                                    </select>
                                </div>
                                {sourceVehicles.length === 0 && (
                                    <p className="text-xs text-gray-400 mt-1">
                                        No other vehicles have {newLinkSpecType === 'range_test' ? 'range test' : 'charging curve'} data.
                                    </p>
                                )}
                                <div className="flex gap-2 mt-2 flex-wrap items-center">
                                    <input
                                        type="number"
                                        placeholder="Scaling factor (blank = 1.0)"
                                        value={newLinkScaling}
                                        onChange={e => setNewLinkScaling(e.target.value)}
                                        step="0.001"
                                        min="0.001"
                                        className="form-input text-sm w-52"
                                    />
                                    <button
                                        type="button"
                                        onClick={suggestEpaRatio}
                                        disabled={!newLinkSourceId}
                                        className="btn btn-secondary text-xs whitespace-nowrap disabled:opacity-40"
                                        title="Auto-fill from EPA range ratio (target ÷ source)"
                                    >
                                        Suggest from EPA
                                    </button>
                                    <input
                                        type="text"
                                        placeholder="Notes (optional)"
                                        value={newLinkNotes}
                                        onChange={e => setNewLinkNotes(e.target.value)}
                                        className="form-input text-sm flex-1 min-w-40"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleAdd}
                                        disabled={!newLinkSourceId || linkSaving}
                                        className="btn btn-primary text-sm disabled:opacity-40"
                                    >
                                        {linkSaving ? 'Adding…' : 'Add Link'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setShowAddLink(false)}
                                        className="btn btn-secondary text-sm"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        );
                    })()}
                </div>
            )}

            <DeleteQueueBar
                pendingCount={pendingDeletes.size}
                onClearQueue={clearQueue}
                onCommit={commitDeletes}
                undoState={undoState}
                secondsLeft={secondsLeft}
                onUndo={undoDelete}
                noun="test"
            />

            {/* Edit Specs modal (contributors/owners) */}
            {showEditSpecs && (
                <EditSpecsForm
                    vehicle={vehicle}
                    specCustomFieldSuggestions={specCustomFieldSuggestions}
                    onSave={onUpdateVehicleSpecs}
                    onClose={() => setShowEditSpecs(false)}
                />
            )}

            {/* View Specs modal (read-only, all users) */}
            {showViewSpecs && (
                <ViewSpecsModal
                    vehicle={vehicle}
                    onClose={() => setShowViewSpecs(false)}
                />
            )}

            {/* Edit vehicle modal */}
            {showEditVehicle && (
                <div className="modal-overlay" onClick={closeEditVehicle}>
                    <div className="modal-panel rounded-xl shadow-2xl max-w-xl w-full mx-4" onClick={e => e.stopPropagation()}>
                        <EditVehicleForm
                            formData={vehicleFormData}
                            onFormChange={setVehicleFormData}
                            editingId={vehicle.id}
                            formTags={vehicleFormTags}
                            onAddTag={(tag) => { if (!vehicleFormTags.some(t => t.id === tag.id)) setVehicleFormTags(prev => [...prev, tag]); }}
                            onRemoveTag={(tagId) => setVehicleFormTags(prev => prev.filter(t => t.id !== tagId))}
                            newTagName={vehicleNewTagName}
                            onNewTagNameChange={setVehicleNewTagName}
                            onCreateTag={async () => {
                                const trimmed = vehicleNewTagName.trim();
                                if (!trimmed) return;
                                const existing = (tags || []).find(t => t.name.toLowerCase() === trimmed.toLowerCase());
                                const tag = existing || await onCreateTag(trimmed);
                                if (tag && !vehicleFormTags.some(t => t.id === tag.id)) setVehicleFormTags(prev => [...prev, tag]);
                                setVehicleNewTagName('');
                            }}
                            tags={tags || []}
                            availableTagsForForm={vehicleAvailableTags}
                            editingVehicle={vehicle}
                            trims={vehicle.trims || []}
                            onAddTrim={(trimData) => onAddTrim(vehicle.id, trimData)}
                            onRemoveTrim={(trimId) => onDeleteTrim(vehicle.id, trimId)}
                            imageUploading={vehicleImageUploading}
                            onImageReady={handleVehicleImageReady}
                            onSubmit={handleVehicleSubmit}
                            onCancel={closeEditVehicle}
                            manufacturers={manufacturers}
                            onAddManufacturer={addManufacturer}
                        />
                    </div>
                </div>
            )}

            {/* Copy to vehicle modal */}
            {copyToRun && (
                <div className="modal-overlay">
                    <div className="copy-to-modal-panel">
                        <div className="modal-header px-5 py-4 border-b">
                            <h3 className="font-semibold text-base">Copy test to another vehicle</h3>
                            <p className="text-xs text-gray-500 mt-0.5">"{copyToRun.name}" will be copied as an independent run</p>
                        </div>
                        <div className="px-5 py-4">
                            <label className="block text-sm font-medium mb-2">Select destination vehicle</label>
                            <select
                                value={copyingToVehicleId}
                                onChange={e => setCopyingToVehicleId(e.target.value)}
                                className="form-input w-full"
                            >
                                <option value="" disabled>Choose a vehicle…</option>
                                {copyTargetVehicles.map(v => (
                                    <option key={v.id} value={v.id}>{v.name}</option>
                                ))}
                            </select>
                        </div>
                        <div className="px-5 py-4 border-t flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => { setCopyToRun(null); setCopyingToVehicleId(''); }}
                                className="btn btn-secondary text-sm"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleCopyToConfirm}
                                disabled={!copyingToVehicleId}
                                className="btn btn-primary text-sm disabled:opacity-40"
                            >
                                Copy test
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

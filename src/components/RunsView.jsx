import { useState } from 'react';
import { parseCSV, parseCSVText } from '../utils/parseCSV';
import { dataService } from '../services/DataService';
import { useDeleteQueue } from '../hooks/useDeleteQueue';
import DeleteQueueBar from './DeleteQueueBar';

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

export default function RunsView({ vehicle, isOwner, onAddRun, onUpdateRun, onSetDefaultRun, onDeleteRun, onMergeRunData, onReplaceRunData, onViewChart }) {
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

    // ── Per-card lazy kWh check (card view, not edit mode) ───────────────────
    // { [runId]: { kwh: number|null, loading: bool } }
    const [calcKwhByRun, setCalcKwhByRun]       = useState({});

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
            onUpdateRun(runId, {
                ...formRest,
                hasCharging: dataFlags.includes('charging'),
                hasRange:    dataFlags.includes('range'),
                calculated_fields: editCalculatedFields,
            });
            // Save table data only if the owner made changes
            if (editDataDirty && isOwner && editData !== null) {
                await onReplaceRunData(runId, editData.map((row, i) => ({ ...row, frame: i })));
            }
        } finally {
            setSavingData(false);
            setEditingRunId(null);
            setEditFormData({});
            setEditData(null);
            setEditDataDirty(false);
            setShowDataTable(false);
            setEditCalcKwh(null);
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

    // Fill null range values from SoC × rated range (or measured test range) for the currently-loaded edit table.
    // source: 'epa' (default) | 'measured'
    const handleEstimateRangeInEdit = (source = 'epa') => {
        const ratedRange = source === 'measured' && effectiveRangeFromTest
            ? effectiveRangeFromTest
            : vehicle?.range;
        if (!editData || !ratedRange) return;
        setEditData(prev => prev.map(row => ({
            ...row,
            range: row.range != null ? row.range
                : (row.soc != null ? Math.round((row.soc / 100) * ratedRange * 10) / 10 : null),
        })));
        setEditCalculatedFields(prev => prev.includes('range') ? prev : [...prev, 'range']);
        setEditDataDirty(true);
    };

    // ── Join key logic (merge mode only) ─────────────────────────────────────
    const canJoinBySoc  = uploadMode === 'merge' && !!fieldMapping.soc;
    const canJoinByTime = uploadMode === 'merge' && !!fieldMapping.time;
    // Show radio selector only when the user has a real choice
    const showJoinSelector  = canJoinBySoc && canJoinByTime;
    // Disable confirm when there's no key to join on at all
    const missingJoinKey    = uploadMode === 'merge' && !canJoinBySoc && !canJoinByTime;

    // ── Derived-column offer logic ────────────────────────────────────────────
    // Range can be estimated when: SoC is mapped, Range is NOT mapped, and vehicle has a rated range
    const offerRangeEstimate = !!fieldMapping.soc && !fieldMapping.range && !!vehicle?.range;

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

    // ── Field tag metadata (ordered for display) ─────────────────────────────
    const FIELD_META = [
        { key: 'soc',         label: 'SoC',   title: 'State of Charge (%)' },
        { key: 'chargeRate',  label: 'kW',    title: 'Charge Rate (kW)' },
        { key: 'time',        label: 'Time',  title: 'Time' },
        { key: 'range',       label: 'Range', title: 'Range' },
        { key: 'temperature', label: 'Temp',  title: 'Temperature' },
    ];

    // ── Derived state ─────────────────────────────────────────────────────────

    const availableFields = csvData?.meta.fields || [];
    const displayRuns     = (vehicle.runs || []).filter(r => !committedDeletes.has(r.id));
    const barVisible      = pendingDeletes.size > 0 || !!undoState;

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div className={barVisible ? 'pb-20' : ''}>
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h2 className="text-2xl font-bold">{vehicle.name} - Test Runs</h2>
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
                    {vehicle.runs?.length > 0 && (
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
                        <div className="mb-4 px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between">
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
                            <h3 className="text-lg font-bold mb-4">
                                {uploadMode === 'merge' ? 'Upload Additional Data' : 'Add new record'}
                            </h3>
                            <div className="space-y-4">
                                {/* Only show metadata inputs in create mode */}
                                {uploadMode === 'create' && (
                                    <>
                                        {/* Data-type flags — multi-select, at least one must remain active */}
                                        <div>
                                            <p className="text-xs text-gray-500 mb-1">Data types (select all that apply)</p>
                                            <div className="flex gap-2 flex-wrap">
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
                                            className="border p-2 rounded w-full"
                                            required
                                        />
                                        <input
                                            type="date"
                                            value={runMetadata.date}
                                            onChange={(e) => setRunMetadata({...runMetadata, date: e.target.value})}
                                            className="border p-2 rounded w-full"
                                        />
                                        <input
                                            placeholder="Software Version (e.g., 2024.1.5)"
                                            value={runMetadata.softwareVersion}
                                            onChange={(e) => setRunMetadata({...runMetadata, softwareVersion: e.target.value})}
                                            className="border p-2 rounded w-full"
                                        />
                                        <input
                                            placeholder="Notes (e.g., 20°F, highway speeds)"
                                            value={runMetadata.conditions}
                                            onChange={(e) => setRunMetadata({...runMetadata, conditions: e.target.value})}
                                            className="border p-2 rounded w-full"
                                        />

                                        {/* Charging energy field (create mode) */}
                                        {runMetadata.dataFlags.includes('charging') && (
                                            <div className="border rounded-lg p-3 bg-gray-50">
                                                <p className="text-sm font-semibold text-gray-700 mb-2">Charging Energy <span className="font-normal text-gray-400">(optional)</span></p>
                                                <input
                                                    type="number"
                                                    placeholder="Energy added (kWh)"
                                                    title="Energy measured at charger or vehicle — energy in"
                                                    value={runMetadata.energyKwh}
                                                    onChange={(e) => setRunMetadata({...runMetadata, energyKwh: e.target.value})}
                                                    className="border p-2 rounded w-full"
                                                />
                                                <p className="text-xs text-gray-400 mt-1">
                                                    Energy measured at charger or vehicle — <em>energy in</em>
                                                </p>
                                                <input
                                                    type="url"
                                                    placeholder="Charging source URL (optional)"
                                                    value={runMetadata.chargingUrl}
                                                    onChange={(e) => setRunMetadata({...runMetadata, chargingUrl: e.target.value})}
                                                    className="border p-2 rounded w-full mt-2"
                                                />
                                            </div>
                                        )}

                                        {/* Range test fields */}
                                        {runMetadata.dataFlags.includes('range') && (
                                            <div className="border rounded-lg p-4 space-y-3 bg-gray-50">
                                                <p className="text-sm font-semibold text-gray-700">Range Test Details</p>
                                                <div className="grid grid-cols-2 gap-3">
                                                    <input
                                                        placeholder="Source (e.g., Out of Spec)"
                                                        value={runMetadata.source}
                                                        onChange={(e) => setRunMetadata({...runMetadata, source: e.target.value})}
                                                        className="border p-2 rounded col-span-2"
                                                    />
                                                    <input
                                                        type="number"
                                                        placeholder="Start SoC (%)"
                                                        value={runMetadata.startSoc}
                                                        onChange={(e) => setRunMetadata({...runMetadata, startSoc: e.target.value})}
                                                        className="border p-2 rounded"
                                                        min="0" max="100"
                                                    />
                                                    <input
                                                        type="number"
                                                        placeholder="End SoC (%)"
                                                        value={runMetadata.endSoc}
                                                        onChange={(e) => setRunMetadata({...runMetadata, endSoc: e.target.value})}
                                                        className="border p-2 rounded"
                                                        min="0" max="100"
                                                    />
                                                    <input
                                                        type="number"
                                                        placeholder="Speed (mph)"
                                                        value={runMetadata.speedMph}
                                                        onChange={(e) => setRunMetadata({...runMetadata, speedMph: e.target.value})}
                                                        className="border p-2 rounded"
                                                    />
                                                    <input
                                                        type="number"
                                                        placeholder="Distance (miles)"
                                                        value={runMetadata.distanceMiles}
                                                        onChange={(e) => setRunMetadata({...runMetadata, distanceMiles: e.target.value})}
                                                        className="border p-2 rounded"
                                                    />
                                                    <input
                                                        type="number"
                                                        placeholder="Energy consumed (kWh)"
                                                        title="Energy consumed on the drive — energy out"
                                                        value={runMetadata.energyKwh}
                                                        onChange={(e) => setRunMetadata({...runMetadata, energyKwh: e.target.value})}
                                                        className="border p-2 rounded"
                                                    />
                                                    <input
                                                        type="number"
                                                        placeholder="Ambient temp (°F)"
                                                        value={runMetadata.temperatureF}
                                                        onChange={(e) => setRunMetadata({...runMetadata, temperatureF: e.target.value})}
                                                        className="border p-2 rounded"
                                                    />
                                                    <input
                                                        type="number"
                                                        placeholder="Elevation gain (ft)"
                                                        value={runMetadata.elevationGainFt}
                                                        onChange={(e) => setRunMetadata({...runMetadata, elevationGainFt: e.target.value})}
                                                        className="border p-2 rounded col-span-2"
                                                    />
                                                    <input
                                                        type="url"
                                                        placeholder="Source URL"
                                                        value={runMetadata.url}
                                                        onChange={(e) => setRunMetadata({...runMetadata, url: e.target.value})}
                                                        className="border p-2 rounded col-span-2"
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
                                    <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
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
                                            className="border p-2 rounded w-full text-xs font-mono resize-y"
                                        />
                                    </div>
                                </div>
                                {uploadMode === 'create' && (
                                    <div className="flex gap-2">
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
                            <h3 className="text-lg font-bold mb-4">Map CSV Fields</h3>
                            <p className="text-gray-600 mb-4">Match your CSV columns to standard fields. We've auto-detected some for you.</p>

                            {/* In create mode, allow editing metadata here too */}
                            {uploadMode === 'create' && (
                                <div className="mb-6 p-4 bg-gray-50 rounded">
                                    <h4 className="font-semibold mb-3">Run Metadata</h4>
                                    <div className="space-y-3">
                                        <input
                                            placeholder="Name (e.g., Highway Test - Winter 2024)"
                                            value={runMetadata.name}
                                            onChange={(e) => setRunMetadata({...runMetadata, name: e.target.value})}
                                            className="border p-2 rounded w-full"
                                            required
                                        />
                                        <input
                                            type="date"
                                            value={runMetadata.date}
                                            onChange={(e) => setRunMetadata({...runMetadata, date: e.target.value})}
                                            className="border p-2 rounded w-full"
                                        />
                                        <input
                                            placeholder="Software Version (e.g., 2024.1.5)"
                                            value={runMetadata.softwareVersion}
                                            onChange={(e) => setRunMetadata({...runMetadata, softwareVersion: e.target.value})}
                                            className="border p-2 rounded w-full"
                                        />
                                        <input
                                            placeholder="Notes (e.g., 20°F, highway speeds)"
                                            value={runMetadata.conditions}
                                            onChange={(e) => setRunMetadata({...runMetadata, conditions: e.target.value})}
                                            className="border p-2 rounded w-full"
                                        />
                                    </div>
                                </div>
                            )}

                            <h4 className="font-semibold mb-3">Field Mapping</h4>
                            <div className="space-y-3">
                                {['soc', 'chargeRate', 'time', 'range', 'temperature', 'frame'].map(field => (
                                    <div key={field} className="flex items-center gap-4">
                                        <label className="w-40 font-medium capitalize">{field.replace(/([A-Z])/g, ' $1')}:</label>
                                        <select
                                            value={fieldMapping[field] || ''}
                                            onChange={(e) => setFieldMapping({...fieldMapping, [field]: e.target.value})}
                                            className="border p-2 rounded flex-1"
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
                            {(offerRangeEstimate || offerRangeEstimateTest) && (
                                <div className="mt-5 space-y-3">
                                    {/* Option 1: EPA rated range */}
                                    {offerRangeEstimate && (
                                        <div className={`p-4 rounded-lg border flex items-start justify-between gap-4 ${estimations.range === 'epa' ? 'bg-green-50 border-green-200' : 'bg-blue-50 border-blue-200'}`}>
                                            <div>
                                                <p className={`text-sm font-semibold ${estimations.range === 'epa' ? 'text-green-800' : 'text-blue-800'}`}>
                                                    {estimations.range === 'epa' ? '✓ Range will be estimated (EPA)' : 'ℹ No Range column mapped'}
                                                </p>
                                                <p className={`text-xs mt-0.5 ${estimations.range === 'epa' ? 'text-green-700' : 'text-blue-700'}`}>
                                                    {estimations.range === 'epa'
                                                        ? `range = SoC% × ${vehicle.range} mi (EPA rated)`
                                                        : `Estimate from EPA rated range (${vehicle.range} mi × SoC%)?`}
                                                </p>
                                            </div>
                                            <button
                                                onClick={() => setEstimations(prev => ({ ...prev, range: prev.range === 'epa' ? null : 'epa' }))}
                                                className={`shrink-0 text-xs px-3 py-1 rounded border transition-colors ${
                                                    estimations.range === 'epa'
                                                        ? 'bg-white text-green-700 border-green-300 hover:bg-green-100'
                                                        : 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
                                                }`}
                                            >
                                                {estimations.range === 'epa' ? 'Undo' : 'Use EPA range'}
                                            </button>
                                        </div>
                                    )}

                                    {/* Option 2: Measured range from test data */}
                                    {offerRangeEstimateTest && (
                                        <div className={`p-4 rounded-lg border flex items-start justify-between gap-4 ${estimations.range === 'measured' ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
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
                                <div className={`mt-5 p-4 rounded-lg border ${missingJoinKey ? 'bg-red-50 border-red-200' : showJoinSelector ? 'bg-yellow-50 border-yellow-200' : 'bg-green-50 border-green-200'}`}>
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

                            <div className="mt-6 flex gap-2">
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
                  const isPending = pendingDeletes.has(run.id);
                  return (
                    <div
                        key={run.id}
                        className={`card${isPending ? ' opacity-60 border-2 border-red-200' : ''}`}
                    >
                        {editingRunId === run.id ? (
                            <div>
                                <h3 className="text-lg font-bold mb-4">Edit Record</h3>
                                <div className="space-y-3">
                                    {/* Data-type flags — multi-select, at least one must remain active */}
                                    <div>
                                        <p className="text-xs text-gray-500 mb-1">Data types (select all that apply)</p>
                                        <div className="flex gap-2 flex-wrap">
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
                                        className="border p-2 rounded w-full"
                                    />
                                    <input
                                        type="date"
                                        value={editFormData.date}
                                        onChange={(e) => setEditFormData({...editFormData, date: e.target.value})}
                                        className="border p-2 rounded w-full"
                                    />
                                    <input
                                        placeholder="Software Version"
                                        value={editFormData.softwareVersion}
                                        onChange={(e) => setEditFormData({...editFormData, softwareVersion: e.target.value})}
                                        className="border p-2 rounded w-full"
                                    />
                                    <input
                                        placeholder="Notes"
                                        value={editFormData.conditions}
                                        onChange={(e) => setEditFormData({...editFormData, conditions: e.target.value})}
                                        className="border p-2 rounded w-full"
                                    />
                                    {/* Charging energy field — shows energy_kwh for charging runs */}
                                    {(editFormData.dataFlags || ['charging']).includes('charging') && (
                                        <div className="border rounded-lg p-3 bg-gray-50">
                                            <p className="text-sm font-semibold text-gray-700 mb-2">Charging Energy</p>
                                            <input
                                                type="number"
                                                placeholder="Energy added (kWh)"
                                                value={editFormData.energyKwh}
                                                onChange={(e) => setEditFormData({...editFormData, energyKwh: e.target.value})}
                                                className="border p-2 rounded w-full"
                                            />
                                            <p className="text-xs text-gray-400 mt-1">
                                                Energy measured at charger or vehicle — <em>energy in</em> (not equal to energy used driving due to charging losses)
                                            </p>
                                            <input
                                                type="url"
                                                placeholder="Charging source URL (optional)"
                                                value={editFormData.chargingUrl ?? ''}
                                                onChange={(e) => setEditFormData({...editFormData, chargingUrl: e.target.value})}
                                                className="border p-2 rounded w-full mt-2"
                                            />
                                        </div>
                                    )}

                                    {/* Range test fields */}
                                    {(editFormData.dataFlags || ['charging']).includes('range') && (
                                        <div className="border rounded-lg p-4 space-y-3 bg-gray-50">
                                            <p className="text-sm font-semibold text-gray-700">Range Test Details</p>
                                            <div className="grid grid-cols-2 gap-3">
                                                <input
                                                    placeholder="Source (e.g., Out of Spec)"
                                                    value={editFormData.source}
                                                    onChange={(e) => setEditFormData({...editFormData, source: e.target.value})}
                                                    className="border p-2 rounded col-span-2"
                                                />
                                                <input
                                                    type="number"
                                                    placeholder="Start SoC (%)"
                                                    value={editFormData.startSoc}
                                                    onChange={(e) => setEditFormData({...editFormData, startSoc: e.target.value})}
                                                    className="border p-2 rounded"
                                                    min="0" max="100"
                                                />
                                                <input
                                                    type="number"
                                                    placeholder="End SoC (%)"
                                                    value={editFormData.endSoc}
                                                    onChange={(e) => setEditFormData({...editFormData, endSoc: e.target.value})}
                                                    className="border p-2 rounded"
                                                    min="0" max="100"
                                                />
                                                <input
                                                    type="number"
                                                    placeholder="Speed (mph)"
                                                    value={editFormData.speedMph}
                                                    onChange={(e) => setEditFormData({...editFormData, speedMph: e.target.value})}
                                                    className="border p-2 rounded"
                                                />
                                                <input
                                                    type="number"
                                                    placeholder="Distance (miles)"
                                                    value={editFormData.distanceMiles}
                                                    onChange={(e) => setEditFormData({...editFormData, distanceMiles: e.target.value})}
                                                    className="border p-2 rounded"
                                                />
                                                <input
                                                    type="number"
                                                    placeholder="Energy consumed (kWh)"
                                                    title="Energy consumed on the drive — energy out"
                                                    value={editFormData.energyKwh}
                                                    onChange={(e) => setEditFormData({...editFormData, energyKwh: e.target.value})}
                                                    className="border p-2 rounded"
                                                />
                                                <input
                                                    type="number"
                                                    placeholder="Ambient temp (°F)"
                                                    value={editFormData.temperatureF}
                                                    onChange={(e) => setEditFormData({...editFormData, temperatureF: e.target.value})}
                                                    className="border p-2 rounded"
                                                />
                                                <input
                                                    type="number"
                                                    placeholder="Elevation gain (ft)"
                                                    value={editFormData.elevationGainFt}
                                                    onChange={(e) => setEditFormData({...editFormData, elevationGainFt: e.target.value})}
                                                    className="border p-2 rounded col-span-2"
                                                />
                                                <input
                                                    type="url"
                                                    placeholder="Source URL"
                                                    value={editFormData.url}
                                                    onChange={(e) => setEditFormData({...editFormData, url: e.target.value})}
                                                    className="border p-2 rounded col-span-2"
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <div className="flex gap-2 mt-4">
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
                                            {isOwner && !editDataLoading && editData !== null &&
                                             editData.some(r => r.soc != null) &&
                                             editData.every(r => r.range == null) && (
                                                <div className="mb-3 p-3 rounded-lg border bg-blue-50 border-blue-200">
                                                    <p className="text-xs text-blue-800 font-semibold mb-2">ℹ No range data — estimate from SoC%:</p>
                                                    <div className="flex flex-wrap gap-2">
                                                        {vehicle?.range && (
                                                            <button
                                                                onClick={() => handleEstimateRangeInEdit('epa')}
                                                                className="text-xs px-3 py-1 rounded border bg-blue-600 text-white border-blue-600 hover:bg-blue-700 transition-colors"
                                                            >
                                                                EPA rated ({vehicle.range} mi)
                                                            </button>
                                                        )}
                                                        {effectiveRangeFromTest && (
                                                            <button
                                                                onClick={() => handleEstimateRangeInEdit('measured')}
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
                                                                                    {isOwner && editData?.some(r => r[field] != null) && (
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
                                                                    {isOwner && <th className="w-6"></th>}
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
                                                                                    disabled={!isOwner}
                                                                                    value={row[field] ?? ''}
                                                                                    onChange={e => handleEditDataCell(i, field, e.target.value)}
                                                                                    placeholder="—"
                                                                                    className={`w-full text-xs p-0.5 rounded outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${
                                                                                        isOwner
                                                                                            ? 'bg-transparent hover:bg-white focus:bg-white focus:ring-1 focus:ring-blue-300'
                                                                                            : 'bg-transparent text-gray-600 cursor-default'
                                                                                    }`}
                                                                                />
                                                                            </td>
                                                                        ))}
                                                                        {isOwner && (
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
                                                    {isOwner && (
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
                            <div className="flex justify-between items-start">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <h3 className="text-lg font-bold">{run.name}</h3>
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
                                    <div className="text-sm text-gray-600 mt-2 space-y-1">
                                        <p>Date: {run.date}</p>
                                        {(run.softwareVersion || run.software_version) && <p>Software: {run.softwareVersion || run.software_version}</p>}
                                        {run.conditions && <p>Notes: {run.conditions}</p>}
                                        {/* Range data section — shown whenever the run has range data */}
                                        {inferRunFlags(run).includes('range') && (
                                            <div className="flex flex-wrap gap-1.5 mt-1">
                                                {run.source && <span className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded">{run.source}</span>}
                                                {run.speed_mph != null && <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{run.speed_mph} mph</span>}
                                                {run.distance_miles != null && <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded border border-green-200">{run.distance_miles} mi</span>}
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
                                                        {Math.round(run.distance_miles / run.energy_kwh * 100) / 100} mi/kWh
                                                    </span>
                                                )}
                                                {run.temperature_f != null && <span className="text-xs bg-orange-50 text-orange-700 px-2 py-0.5 rounded border border-orange-200">{run.temperature_f}°F</span>}
                                                {run.start_soc != null && run.end_soc != null && <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">SoC {run.start_soc}→{run.end_soc}%</span>}
                                                {run.url && <a href={run.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline px-2 py-0.5 rounded">Source ↗</a>}
                                            </div>
                                        )}
                                        {/* Charging data section — shown whenever the run has time-series data */}
                                        {inferRunFlags(run).includes('charging') && (
                                            <div className="flex flex-wrap gap-1.5 mt-1 items-center">
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
                                    <div className="flex items-center gap-2 mt-3">
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
                                <div className="flex gap-2 flex-wrap justify-end">
                                    {!run.isDefault && (
                                        <button
                                            onClick={() => onSetDefaultRun(run.id)}
                                            className="btn btn-secondary text-sm"
                                        >
                                            Set as Default
                                        </button>
                                    )}
                                    {isOwner && (
                                        <button
                                            onClick={() => handleUpdateData(run)}
                                            className="btn btn-secondary text-sm"
                                        >
                                            Upload additional data
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

            {vehicle.runs?.length === 0 && !showUpload && (
                <div className="text-center py-12 text-gray-500">
                    <p className="text-lg">No test runs yet. Add a record to get started!</p>
                </div>
            )}

            <DeleteQueueBar
                pendingCount={pendingDeletes.size}
                onClearQueue={clearQueue}
                onCommit={commitDeletes}
                undoState={undoState}
                secondsLeft={secondsLeft}
                onUndo={undoDelete}
                noun="run"
            />
        </div>
    );
}

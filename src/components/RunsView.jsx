import { useState } from 'react';
import { parseCSV } from '../utils/parseCSV';
import { dataService } from '../services/DataService';
import { useDeleteQueue } from '../hooks/useDeleteQueue';
import DeleteQueueBar from './DeleteQueueBar';

export default function RunsView({ vehicle, isOwner, onAddRun, onUpdateRun, onSetDefaultRun, onDeleteRun, onMergeRunData, onReplaceRunData, onViewChart }) {
    const [showUpload, setShowUpload] = useState(false);
    const [uploadStep, setUploadStep] = useState('file');
    const [csvData, setCsvData] = useState(null);
    const [fieldMapping, setFieldMapping] = useState({});
    const [runMetadata, setRunMetadata] = useState({
        name: '',
        date: new Date().toISOString().split('T')[0],
        softwareVersion: '',
        conditions: ''
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

    // ── Inline data-table state (edit mode) ──────────────────────────────────
    const [editData, setEditData]               = useState(null);   // null=not fetched, []=loaded
    const [editDataLoading, setEditDataLoading] = useState(false);
    const [editDataDirty, setEditDataDirty]     = useState(false);  // cells modified
    const [showDataTable, setShowDataTable]     = useState(false);  // expand/collapse
    const [savingData, setSavingData]           = useState(false);

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
        setRunMetadata({ name: '', date: new Date().toISOString().split('T')[0], softwareVersion: '', conditions: '' });
        setUploadMode('create');
        setMergeTargetRun(null);
        setJoinKey('soc');
        setMerging(false);
    };

    // ── File upload ───────────────────────────────────────────────────────────

    const handleFileUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const result = await parseCSV(file);
            setCsvData(result);

            const headers = result.meta.fields;
            const autoMapping = {};

            headers.forEach(header => {
                const lower = header.toLowerCase();
                if (lower.includes('soc') || lower.includes('state of charge')) autoMapping.soc = header;
                if (lower.includes('charge') && lower.includes('rate')) autoMapping.chargeRate = header;
                if (lower.includes('time')) autoMapping.time = header;
                if (lower.includes('range')) autoMapping.range = header;
                if (lower.includes('temp')) autoMapping.temperature = header;
                if (lower.includes('frame')) autoMapping.frame = header;
            });

            setFieldMapping(autoMapping);
            setUploadStep('mapping');
        } catch (error) {
            alert('Error parsing CSV: ' + error.message);
        }
    };

    // ── Create-mode import ────────────────────────────────────────────────────

    const handleImport = () => {
        if (!csvData) return;

        const transformedData = csvData.data.map(row => {
            const newRow = {};
            Object.keys(fieldMapping).forEach(key => {
                if (fieldMapping[key]) {
                    newRow[key] = row[fieldMapping[key]];
                }
            });
            return newRow;
        });

        const run = {
            ...runMetadata,
            data: transformedData,
            fieldMapping,
            uploadDate: new Date().toISOString()
        };

        onAddRun(run);
        resetUploadState();
    };

    // ── Merge-mode import ─────────────────────────────────────────────────────

    const handleMerge = async () => {
        if (!csvData || !mergeTargetRun) return;

        const transformedData = csvData.data.map(row => {
            const newRow = {};
            Object.keys(fieldMapping).forEach(key => {
                if (fieldMapping[key]) {
                    newRow[key] = row[fieldMapping[key]];
                }
            });
            return newRow;
        });

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
            softwareVersion: run.softwareVersion || '',
            conditions: run.conditions || ''
        });
    };

    const handleSaveEdit = async (runId) => {
        setSavingData(true);
        try {
            // Always save metadata
            onUpdateRun(runId, editFormData);
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
        }
    };

    const handleCancelEdit = () => {
        setEditingRunId(null);
        setEditFormData({});
        setEditData(null);
        setEditDataDirty(false);
        setShowDataTable(false);
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

    // ── Join key logic (merge mode only) ─────────────────────────────────────
    const canJoinBySoc  = uploadMode === 'merge' && !!fieldMapping.soc;
    const canJoinByTime = uploadMode === 'merge' && !!fieldMapping.time;
    // Show radio selector only when the user has a real choice
    const showJoinSelector  = canJoinBySoc && canJoinByTime;
    // Disable confirm when there's no key to join on at all
    const missingJoinKey    = uploadMode === 'merge' && !canJoinBySoc && !canJoinByTime;

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
                        {showUpload && uploadMode === 'create' ? 'Cancel' : '+ Upload CSV'}
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
                                {uploadMode === 'merge' ? 'Upload Additional Data' : 'Upload Test Run Data'}
                            </h3>
                            <div className="space-y-4">
                                {/* Only show metadata inputs in create mode */}
                                {uploadMode === 'create' && (
                                    <>
                                        <input
                                            placeholder="Run Name (e.g., Highway Test - Winter 2024)"
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
                                            placeholder="Conditions (e.g., 20°F, highway speeds)"
                                            value={runMetadata.conditions}
                                            onChange={(e) => setRunMetadata({...runMetadata, conditions: e.target.value})}
                                            className="border p-2 rounded w-full"
                                        />
                                    </>
                                )}
                                <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
                                    <label className="cursor-pointer">
                                        <span className="text-blue-600 font-medium">Click to upload CSV file</span>
                                        <input
                                            type="file"
                                            accept=".csv"
                                            className="hidden"
                                            onChange={handleFileUpload}
                                        />
                                    </label>
                                </div>
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
                                            placeholder="Run Name (e.g., Highway Test - Winter 2024)"
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
                                            placeholder="Conditions (e.g., 20°F, highway speeds)"
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
                                            {availableFields.map(f => (
                                                <option key={f} value={f}>{f}</option>
                                            ))}
                                        </select>
                                    </div>
                                ))}
                            </div>

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
                                <h3 className="text-lg font-bold mb-4">Edit Run</h3>
                                <div className="space-y-3">
                                    <input
                                        placeholder="Run Name"
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
                                        placeholder="Conditions"
                                        value={editFormData.conditions}
                                        onChange={(e) => setEditFormData({...editFormData, conditions: e.target.value})}
                                        className="border p-2 rounded w-full"
                                    />
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
                                        <span>{showDataTable ? '▴ Hide data' : '▾ Show data'}</span>
                                        {editData !== null && !editDataLoading && (
                                            <span className="text-xs text-gray-400">({editData.length} rows)</span>
                                        )}
                                        {editDataDirty && (
                                            <span className="ml-1 text-xs text-orange-500 font-medium">● unsaved changes</span>
                                        )}
                                    </button>

                                    {showDataTable && (
                                        <div className="mt-3">
                                            {editDataLoading ? (
                                                <p className="text-sm text-gray-500 py-4 text-center">Loading…</p>
                                            ) : (
                                                <>
                                                    <div className="overflow-auto rounded border" style={{ maxHeight: 360 }}>
                                                        <table className="w-full text-xs border-collapse">
                                                            <thead className="bg-gray-50 sticky top-0 z-10 border-b">
                                                                <tr>
                                                                    <th className="px-2 py-1.5 text-left text-gray-500 font-medium w-8">#</th>
                                                                    {[['soc','SoC (%)'],['chargeRate','kW'],['time','Time'],['range','Range'],['temperature','Temp']].map(([,label]) => (
                                                                        <th key={label} className="px-2 py-1.5 text-left text-gray-500 font-medium">{label}</th>
                                                                    ))}
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
                                                                                    className={`w-full text-xs p-0.5 rounded outline-none ${
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
                                    <div className="flex items-center gap-2">
                                        <h3 className="text-lg font-bold">{run.name}</h3>
                                        {run.isDefault && (
                                            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded font-semibold" style={{backgroundColor: 'var(--color-primary-light)', color: 'var(--color-primary-text)'}}>
                                                Default
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-sm text-gray-600 mt-2 space-y-1">
                                        <p>Date: {run.date}</p>
                                        {run.softwareVersion && <p>Software: {run.softwareVersion}</p>}
                                        {run.conditions && <p>Conditions: {run.conditions}</p>}
                                        <p>Data Points: {run.dataPointCount ?? run.data?.length ?? 0}</p>
                                    </div>
                                    {/* Field tags — which data columns are populated */}
                                    {(() => {
                                        const fields = run.populated_fields || [];
                                        if (fields.length === 0) return null;
                                        return (
                                            <div className="flex flex-wrap gap-1 mt-2">
                                                {FIELD_META.filter(f => fields.includes(f.key)).map(f => (
                                                    <span
                                                        key={f.key}
                                                        title={f.title}
                                                        className="px-2 py-0.5 text-xs rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-medium"
                                                    >
                                                        {f.label}
                                                    </span>
                                                ))}
                                            </div>
                                        );
                                    })()}
                                    <div className="flex items-center gap-2 mt-3">
                                        <span className="text-sm text-gray-600">Plot Color:</span>
                                        <div
                                            className="w-6 h-6 rounded border border-gray-300"
                                            style={{backgroundColor: run.color || '#3b82f6'}}
                                        ></div>
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
                                            Update data…
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
                    <p className="text-lg">No test runs yet. Upload a CSV to get started!</p>
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

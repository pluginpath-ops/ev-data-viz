import { useState } from 'react';
import { parseCSV } from '../utils/parseCSV';
import { useDeleteQueue } from '../hooks/useDeleteQueue';
import DeleteQueueBar from './DeleteQueueBar';

export default function RunsView({ vehicle, isOwner, onAddRun, onUpdateRun, onSetDefaultRun, onDeleteRun, onMergeRunData, onViewChart }) {
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
    // uploadMode: 'create' (new run) | 'merge' (append data to existing run)
    const [uploadMode, setUploadMode] = useState('create');
    const [mergeTargetRun, setMergeTargetRun] = useState(null);
    const [merging, setMerging] = useState(false);

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

        setMerging(true);
        try {
            const result = await onMergeRunData(mergeTargetRun.id, transformedData);
            resetUploadState();
            if (result) {
                alert(`Data appended successfully: ${result.inserted} new rows added.`);
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

    const handleSaveEdit = (runId) => {
        onUpdateRun(runId, editFormData);
        setEditingRunId(null);
        setEditFormData({});
    };

    const handleCancelEdit = () => {
        setEditingRunId(null);
        setEditFormData({});
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
                                        disabled={merging}
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
                                        className="btn btn-primary"
                                    >
                                        Save Changes
                                    </button>
                                    <button
                                        onClick={handleCancelEdit}
                                        className="btn btn-secondary"
                                    >
                                        Cancel
                                    </button>
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

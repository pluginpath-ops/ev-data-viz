import { useState, useRef } from 'react';
import { parseEpaTestCarSheet, summariseEpaGroups } from '../utils/parseEpaTestCarSheet';

/**
 * Admin-only modal for importing EPA Test Car List data.
 *
 * Workflow:
 *  1. Upload a pre-filtered EPA testcar TSV
 *  2. Parser groups rows → one record per test group
 *  3. User optionally links each test group to a vehicle via a pick list
 *  4. "Import" upserts epa_test_groups + creates epa_vehicle_mappings
 */
export default function EpaImportModal({ vehicles, onImport, onClose }) {
    const [step, setStep]           = useState('upload'); // 'upload' | 'map' | 'done'
    const [parsed, setParsed]       = useState([]);
    const [fileName, setFileName]   = useState('');
    // Set of test_group_ids to include in the import (all checked by default)
    const [selected, setSelected]   = useState(new Set());
    // Map: test_group_id → vehicle id (string) for the link
    const [linkMap, setLinkMap]     = useState({});
    const [importing, setImporting] = useState(false);
    const [result, setResult]       = useState(null);
    const [error, setError]         = useState(null);
    const [dragOver, setDragOver]   = useState(false);
    const fileRef = useRef();

    // ── File handling ─────────────────────────────────────────────────────────

    const processFile = (file) => {
        if (!file) return;
        setFileName(file.name);
        const reader = new FileReader();
        reader.onload = (e) => {
            const groups = parseEpaTestCarSheet(e.target.result, file.name);
            setParsed(groups);
            setSelected(new Set(groups.map(g => g.test_group_id)));
            setLinkMap({});
            setError(null);
            setStep('map');
        };
        reader.onerror = () => setError('Could not read file.');
        reader.readAsText(file);
    };

    const handleFilePick   = (e) => processFile(e.target.files[0]);
    const handleDrop       = (e) => { e.preventDefault(); setDragOver(false); processFile(e.dataTransfer.files[0]); };
    const handleDragOver   = (e) => { e.preventDefault(); setDragOver(true); };
    const handleDragLeave  = () => setDragOver(false);

    // ── Pick-list helpers ─────────────────────────────────────────────────────

    const toggleAll = (checked) =>
        setSelected(checked ? new Set(parsed.map(g => g.test_group_id)) : new Set());

    const toggleOne = (id, checked) =>
        setSelected(prev => { const s = new Set(prev); checked ? s.add(id) : s.delete(id); return s; });

    const setVehicleLink = (testGroupId, vehicleId) =>
        setLinkMap(prev => ({ ...prev, [testGroupId]: vehicleId }));

    // ── Import ────────────────────────────────────────────────────────────────
    // Parsed groups carry private _coefficientSet / _has* helpers; the service
    // (bulkUpsertEpaTestGroups) strips them and writes the coefficient set.

    const handleImport = async () => {
        const toImport = parsed.filter(g => selected.has(g.test_group_id));
        const mappings = Object.entries(linkMap)
            .filter(([tgid, vid]) => selected.has(tgid) && vid)
            .map(([testGroupId, vehicleId]) => ({ vehicleId: parseInt(vehicleId, 10), testGroupId }));

        setImporting(true);
        setError(null);
        try {
            const res = await onImport(toImport, mappings);
            setResult(res);
            setStep('done');
        } catch (e) {
            setError(e.message);
        } finally {
            setImporting(false);
        }
    };

    // ── Derived state ─────────────────────────────────────────────────────────

    const summary = parsed.length ? summariseEpaGroups(parsed) : null;
    const selectedCount = selected.size;
    const linkedCount   = Object.entries(linkMap).filter(([tgid, vid]) => selected.has(tgid) && vid).length;

    // Vehicles sorted for the dropdown
    const sortedVehicles = [...vehicles].sort((a, b) => a.name.localeCompare(b.name));

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="modal-panel" style={{ maxWidth: '900px', width: '96vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>

                {/* Header */}
                <div className="modal-header flex items-center justify-between">
                    <div>
                        <h2 className="text-lg font-semibold">Import EPA Test Car Data</h2>
                        <p className="text-sm text-muted mt-0.5">
                            Upload a pre-filtered EPA testcar sheet (TSV) to add road-load coefficients.
                        </p>
                    </div>
                    <button onClick={onClose} className="text-faint hover:text-secondary text-2xl leading-none ml-4">&times;</button>
                </div>

                {/* Body — scrollable */}
                <div className="overflow-y-auto flex-1 p-6">

                    {/* ── Step 1: Upload ─────────────────────────────────── */}
                    {step === 'upload' && (
                        <div className="flex flex-col items-center">
                            <div
                                className={`w-full border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition
                                    ${dragOver ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20' : 'border-[var(--color-border)] hover:border-indigo-400'}`}
                                onClick={() => fileRef.current?.click()}
                                onDrop={handleDrop}
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                            >
                                <div className="text-4xl mb-3">📂</div>
                                <p className="font-medium text-secondary">Drop the EPA testcar TSV here, or click to browse</p>
                                <p className="text-sm text-faint mt-1">Accepts .csv (Excel) or .txt / .tsv (tab-separated) · Pre-filter to your vehicles of interest</p>
                                <input ref={fileRef} type="file" accept=".txt,.tsv,.csv" className="hidden" onChange={handleFilePick} />
                            </div>
                            {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

                            <div className="mt-6 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg text-sm text-amber-800 dark:text-amber-300 max-w-lg">
                                <p className="font-semibold mb-1">How to prepare the file</p>
                                <ol className="list-decimal list-inside space-y-1 text-xs">
                                    <li>Download the EPA Test Car List (testcar_yymmdd.txt) from <span className="font-mono">epa.gov</span></li>
                                    <li>Open in Excel and filter to the manufacturers and models you care about</li>
                                    <li>Save As → CSV (.csv) or Tab-delimited text (.txt / .tsv)</li>
                                    <li>Upload here — the app will group rows by test group and show a pick list</li>
                                </ol>
                            </div>
                        </div>
                    )}

                    {/* ── Step 2: Map to vehicles ─────────────────────────── */}
                    {step === 'map' && summary && (
                        <>
                            {/* Summary banner */}
                            <div className="flex flex-wrap gap-4 mb-4 p-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700 rounded-lg text-sm">
                                <span><strong>{summary.total}</strong> test group{summary.total !== 1 ? 's' : ''} found</span>
                                {summary.yearMin && <span>MY {summary.yearMin}{summary.yearMax !== summary.yearMin ? `–${summary.yearMax}` : ''}</span>}
                                <span>{summary.makes.join(', ')}</span>
                                <span className="text-faint">·</span>
                                <span>{summary.withCoeffs} with A/B/C coefficients</span>
                                <span>{summary.withMpge} with combined MPGe</span>
                                <span className="text-faint">·</span>
                                <span>File: <span className="font-mono text-xs">{fileName}</span></span>
                                {summary.isMasterList && (
                                    <span className="text-amber-700 dark:text-amber-400 font-medium">
                                        ⚠ Master Emissions List — per-cycle kWh/100mi not available; coefficients only
                                    </span>
                                )}
                            </div>

                            {error && (
                                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">⚠️ {error}</div>
                            )}

                            {/* Table */}
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                    <thead>
                                        <tr className="border-b text-left">
                                            <th className="pb-2 pr-2">
                                                <input type="checkbox"
                                                    checked={selectedCount === parsed.length && parsed.length > 0}
                                                    onChange={e => toggleAll(e.target.checked)}
                                                />
                                            </th>
                                            <th className="pb-2 pr-3 text-muted font-semibold whitespace-nowrap">Test Group</th>
                                            <th className="pb-2 pr-3 text-muted font-semibold whitespace-nowrap">Year · Make · Carline</th>
                                            <th className="pb-2 pr-3 text-muted font-semibold whitespace-nowrap">Drive / ETW</th>
                                            <th className="pb-2 pr-3 text-muted font-semibold whitespace-nowrap">A / B / C</th>
                                            <th className="pb-2 pr-3 text-muted font-semibold whitespace-nowrap">Combined MPGe</th>
                                            <th className="pb-2 text-muted font-semibold">Link to Vehicle</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y">
                                        {parsed.map(g => {
                                            const isSelected = selected.has(g.test_group_id);
                                            const linkedVid  = linkMap[g.test_group_id] || '';
                                            // Coefficients live on the primary set; prefer set, fall back to target.
                                            const cs = g._coefficientSet || {};
                                            const a = cs.set_a ?? cs.target_a;
                                            const b = cs.set_b ?? cs.target_b;
                                            const c = cs.set_c ?? cs.target_c;
                                            return (
                                                <tr key={g.test_group_id} className={`transition ${isSelected ? '' : 'opacity-40'}`}>
                                                    <td className="py-2 pr-2">
                                                        <input type="checkbox" checked={isSelected}
                                                            onChange={e => toggleOne(g.test_group_id, e.target.checked)} />
                                                    </td>
                                                    <td className="py-2 pr-3 font-mono text-secondary whitespace-nowrap">
                                                        {g.test_group_id}
                                                    </td>
                                                    <td className="py-2 pr-3">
                                                        <span className="font-medium">{g.model_year}</span>
                                                        <span className="text-faint mx-1">·</span>
                                                        <span>{g.make}</span>
                                                        <div className="text-muted mt-0.5 max-w-[200px] truncate" title={g.epa_carline_name}>
                                                            {g.epa_carline_name}
                                                        </div>
                                                    </td>
                                                    <td className="py-2 pr-3 whitespace-nowrap">
                                                        <div>{g.drive ?? '—'}</div>
                                                        <div className="text-faint">{cs.equiv_test_weight_lbs != null ? `${cs.equiv_test_weight_lbs.toLocaleString()} lbs` : '—'}</div>
                                                    </td>
                                                    <td className="py-2 pr-3 font-mono whitespace-nowrap">
                                                        {a != null ? (
                                                            <div>
                                                                <span className={cs.set_a != null ? '' : 'text-faint'}>{a?.toFixed(2)}</span>
                                                                <span className="text-faint mx-1">/</span>
                                                                <span className={cs.set_b != null ? '' : 'text-faint'}>{b?.toFixed(4)}</span>
                                                                <span className="text-faint mx-1">/</span>
                                                                <span className={cs.set_c != null ? '' : 'text-faint'}>{c?.toFixed(5)}</span>
                                                            </div>
                                                        ) : <span className="text-faint">—</span>}
                                                        {cs.set_a == null && a != null && (
                                                            <div className="text-amber-500 text-[10px]">target only</div>
                                                        )}
                                                    </td>
                                                    <td className="py-2 pr-3 whitespace-nowrap">
                                                        {g.label_combined_mpge != null ? (
                                                            <span>{g.label_combined_mpge.toFixed(1)} MPGe</span>
                                                        ) : g.label_hwy_mpge != null ? (
                                                            <span title="Highway-only (proc 84); no combined MCT test in file">
                                                                {g.label_hwy_mpge.toFixed(1)} MPGe
                                                                <span className="text-faint ml-1 text-[10px]">hwy</span>
                                                            </span>
                                                        ) : (
                                                            <span className="text-faint">—</span>
                                                        )}
                                                    </td>
                                                    <td className="py-2">
                                                        <select
                                                            value={linkedVid}
                                                            onChange={e => setVehicleLink(g.test_group_id, e.target.value)}
                                                            disabled={!isSelected}
                                                            className="form-input w-52"
                                                        >
                                                            <option value="">— Not linked —</option>
                                                            {sortedVehicles.map(v => (
                                                                <option key={v.id} value={v.id}>{v.name}</option>
                                                            ))}
                                                        </select>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}

                    {/* ── Step 3: Done ─────────────────────────────────────── */}
                    {step === 'done' && result && (
                        <div className="flex flex-col items-center py-8 text-center">
                            <div className="text-5xl mb-4">✅</div>
                            <p className="text-lg font-semibold mb-2">Import complete</p>
                            <p className="text-secondary">
                                <strong>{result.testGroupsCount}</strong> test group{result.testGroupsCount !== 1 ? 's' : ''} upserted
                                {result.mappingsCount > 0 && <>, <strong>{result.mappingsCount}</strong> vehicle link{result.mappingsCount !== 1 ? 's' : ''} created</>}
                            </p>
                            <p className="text-sm text-faint mt-2">
                                Vehicles with new EPA data will show a dashed curve on the EPA Curves chart tab.
                                Confidence is set to "likely" — update it to "verified" via the vehicle edit form if confirmed.
                            </p>
                        </div>
                    )}

                </div>

                {/* Footer */}
                <div className="modal-footer flex justify-between items-center">
                    <div className="text-sm text-muted">
                        {step === 'map' && (
                            <span>
                                {selectedCount} of {parsed.length} selected
                                {linkedCount > 0 && ` · ${linkedCount} linked to vehicles`}
                            </span>
                        )}
                    </div>
                    <div className="flex gap-2">
                        {step === 'map' && (
                            <button
                                type="button"
                                onClick={() => setStep('upload')}
                                className="btn btn-secondary text-sm"
                                disabled={importing}
                            >
                                ← Back
                            </button>
                        )}
                        {step === 'upload' && (
                            <button type="button" onClick={onClose} className="btn btn-secondary text-sm">Cancel</button>
                        )}
                        {step === 'map' && (
                            <button
                                type="button"
                                onClick={handleImport}
                                disabled={importing || selectedCount === 0}
                                className="btn btn-primary text-sm disabled:opacity-40"
                            >
                                {importing ? 'Importing…' : `Import ${selectedCount} test group${selectedCount !== 1 ? 's' : ''}${linkedCount > 0 ? ` + ${linkedCount} link${linkedCount !== 1 ? 's' : ''}` : ''}`}
                            </button>
                        )}
                        {step === 'done' && (
                            <button type="button" onClick={onClose} className="btn btn-primary text-sm">Done</button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

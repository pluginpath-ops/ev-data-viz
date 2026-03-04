import { useState, useRef } from 'react';
import { parseTableauCSV, fuzzyScore } from '../utils/parseTableauCSV';

const FUZZY_THRESHOLD = 0.4; // pre-select match if word overlap ≥ 40%

export default function ImportTableauModal({ vehicles, onImport, onClose }) {
    const [step, setStep] = useState('upload'); // 'upload' | 'mapping' | 'importing' | 'done'
    const [sessions, setSessions] = useState([]);
    const [parseError, setParseError] = useState('');
    const [vehicleMap, setVehicleMap] = useState({}); // { rawVehicle: vehicleId | '' }
    const [result, setResult] = useState(null);
    const [importing, setImporting] = useState(false);
    const fileRef = useRef();

    // ── Step 1: parse ────────────────────────────────────────────────────────

    const handleFile = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setParseError('');
        try {
            const parsed = await parseTableauCSV(file);
            if (parsed.length === 0) {
                setParseError('No valid sessions found in this file. Check that the Vehicle column is present and data columns are numbered 0–100.');
                return;
            }
            setSessions(parsed);

            // Build initial vehicleMap with fuzzy pre-selections
            const uniqueRaw = [...new Set(parsed.map(s => s.rawVehicle))];
            const initialMap = {};
            for (const raw of uniqueRaw) {
                const parsedName = parsed.find(s => s.rawVehicle === raw)?.vehicleName || raw;
                // Score against each existing vehicle name
                let bestId = '';
                let bestScore = 0;
                for (const v of vehicles) {
                    const score = fuzzyScore(parsedName, v.name || '');
                    if (score > bestScore) {
                        bestScore = score;
                        bestId = v.id;
                    }
                }
                initialMap[raw] = bestScore >= FUZZY_THRESHOLD ? bestId : '';
            }
            setVehicleMap(initialMap);
            setStep('mapping');
        } catch (err) {
            setParseError('Error parsing file: ' + err.message);
        }
    };

    // ── Step 2: mapping ──────────────────────────────────────────────────────

    const uniqueVehicles = [...new Set(sessions.map(s => s.rawVehicle))].map(raw => {
        const s = sessions.find(x => x.rawVehicle === raw);
        const count = sessions.filter(x => x.rawVehicle === raw).length;
        return { raw, year: s.year, vehicleName: s.vehicleName, count };
    });

    const handleMapChange = (raw, vehicleId) => {
        setVehicleMap(prev => ({ ...prev, [raw]: vehicleId }));
    };

    // ── Step 3: import ───────────────────────────────────────────────────────

    const handleImport = async () => {
        setImporting(true);
        setStep('importing');
        try {
            // Convert '' (create new) to null for DataService
            const resolvedMap = {};
            for (const [raw, id] of Object.entries(vehicleMap)) {
                resolvedMap[raw] = id || null;
            }
            const res = await onImport(sessions, resolvedMap);
            setResult(res);
            setStep('done');
        } catch (err) {
            setParseError('Import failed: ' + err.message);
            setStep('mapping');
        } finally {
            setImporting(false);
        }
    };

    // ── Summary counts ───────────────────────────────────────────────────────

    const syntheticCount = sessions.filter(s => s.synthetic).length;
    const realCount = sessions.length - syntheticCount;
    const newVehicleCount = Object.values(vehicleMap).filter(id => !id).length;

    // ────────────────────────────────────────────────────────────────────────

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">

                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b">
                    <div>
                        <h2 className="text-xl font-bold">Import Tableau CSV</h2>
                        <p className="text-sm text-gray-500 mt-0.5">
                            {step === 'upload' && 'Select an exported Tableau charging curve CSV'}
                            {step === 'mapping' && `${sessions.length} sessions found — map vehicles below`}
                            {step === 'importing' && 'Importing…'}
                            {step === 'done' && 'Import complete'}
                        </p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
                </div>

                {/* Body */}
                <div className="overflow-y-auto flex-1 px-6 py-5">

                    {/* ── UPLOAD STEP ── */}
                    {step === 'upload' && (
                        <div className="flex flex-col items-center justify-center py-12 gap-4">
                            <div className="text-5xl">📂</div>
                            <p className="text-gray-600 text-center max-w-sm">
                                Export your Tableau workbook as <strong>CSV</strong> and upload it here.
                                Columns should include <em>Date of charging test</em>, <em>Optimized</em>,
                                <em>Vehicle</em>, and numeric SoC columns (0–100).
                            </p>
                            <label className="btn btn-primary cursor-pointer">
                                Choose CSV file
                                <input
                                    ref={fileRef}
                                    type="file"
                                    accept=".csv"
                                    className="hidden"
                                    onChange={handleFile}
                                />
                            </label>
                            {parseError && <p className="text-red-600 text-sm text-center">{parseError}</p>}
                        </div>
                    )}

                    {/* ── MAPPING STEP ── */}
                    {step === 'mapping' && (
                        <div>
                            {/* Summary pills */}
                            <div className="flex flex-wrap gap-2 mb-5">
                                <span className="px-3 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                                    {sessions.length} total sessions
                                </span>
                                {realCount > 0 && (
                                    <span className="px-3 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700">
                                        {realCount} real sessions
                                    </span>
                                )}
                                {syntheticCount > 0 && (
                                    <span className="px-3 py-1 rounded-full text-xs font-medium bg-purple-50 text-purple-700">
                                        {syntheticCount} synthetic
                                    </span>
                                )}
                                {newVehicleCount > 0 && (
                                    <span className="px-3 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
                                        {newVehicleCount} new vehicle{newVehicleCount !== 1 ? 's' : ''} will be created
                                    </span>
                                )}
                            </div>

                            {/* Vehicle mapping table */}
                            <p className="text-sm font-medium text-gray-700 mb-2">
                                Match each CSV vehicle to an existing vehicle, or create a new one:
                            </p>
                            <div className="border rounded-lg overflow-hidden">
                                <table className="w-full text-sm">
                                    <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                                        <tr>
                                            <th className="text-left px-4 py-2">CSV Vehicle</th>
                                            <th className="text-center px-3 py-2 w-16">Runs</th>
                                            <th className="text-left px-4 py-2">Map to</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y">
                                        {uniqueVehicles.map(({ raw, year, vehicleName, count }) => (
                                            <tr key={raw} className="hover:bg-gray-50">
                                                <td className="px-4 py-2.5">
                                                    <p className="font-medium">{vehicleName}</p>
                                                    {year && <p className="text-gray-400 text-xs">{year}</p>}
                                                </td>
                                                <td className="px-3 py-2.5 text-center text-gray-500">{count}</td>
                                                <td className="px-4 py-2.5">
                                                    <select
                                                        value={vehicleMap[raw] || ''}
                                                        onChange={e => handleMapChange(raw, e.target.value)}
                                                        className="border rounded p-1.5 text-sm w-full"
                                                    >
                                                        <option value="">✦ Create new vehicle</option>
                                                        {vehicles.map(v => (
                                                            <option key={v.id} value={v.id}>{v.name}{v.year ? ` (${v.year})` : ''}</option>
                                                        ))}
                                                    </select>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {parseError && <p className="text-red-600 text-sm mt-3">{parseError}</p>}
                        </div>
                    )}

                    {/* ── IMPORTING STEP ── */}
                    {step === 'importing' && (
                        <div className="flex flex-col items-center justify-center py-16 gap-4">
                            <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
                            <p className="text-gray-600">Importing {sessions.length} sessions…</p>
                            <p className="text-xs text-gray-400">This may take a moment for large datasets</p>
                        </div>
                    )}

                    {/* ── DONE STEP ── */}
                    {step === 'done' && result && (
                        <div className="flex flex-col items-center justify-center py-12 gap-3">
                            <div className="text-5xl">✅</div>
                            <h3 className="text-lg font-bold">Import complete</h3>
                            <div className="flex flex-wrap gap-2 justify-center mt-1">
                                {result.vehiclesCreated > 0 && (
                                    <span className="px-3 py-1 rounded-full text-sm font-medium bg-green-50 text-green-700">
                                        {result.vehiclesCreated} vehicle{result.vehiclesCreated !== 1 ? 's' : ''} created
                                    </span>
                                )}
                                <span className="px-3 py-1 rounded-full text-sm font-medium bg-blue-50 text-blue-700">
                                    {result.runsImported} run{result.runsImported !== 1 ? 's' : ''} imported
                                </span>
                                <span className="px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-600">
                                    {result.pointsImported.toLocaleString()} data points
                                </span>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t flex justify-end gap-2">
                    {step === 'upload' && (
                        <button onClick={onClose} className="btn btn-secondary">Cancel</button>
                    )}
                    {step === 'mapping' && (
                        <>
                            <button onClick={() => setStep('upload')} className="btn btn-secondary">Back</button>
                            <button onClick={handleImport} className="btn btn-primary">
                                Import {sessions.length} sessions
                            </button>
                        </>
                    )}
                    {step === 'done' && (
                        <button onClick={onClose} className="btn btn-primary">Done</button>
                    )}
                </div>
            </div>
        </div>
    );
}

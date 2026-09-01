import { useState } from 'react';
import { parseTableauCSV, fuzzyScore } from '../utils/parseTableauCSV';

const FUZZY_THRESHOLD = 0.4;

/** Normalize dates to YYYY-MM-DD for comparison (handles M/D/YYYY from CSV and ISO from DB) */
function normalizeDate(d) {
    if (!d) return '';
    const mdy = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
    return String(d).slice(0, 10);
}

export default function ImportTableauModal({ vehicles, onImport, onClose }) {
    const [step, setStep]               = useState('upload');
    const [sessions, setSessions]       = useState([]);
    const [parseError, setParseError]   = useState('');
    const [vehicleMap, setVehicleMap]   = useState({});   // { rawVehicle: vehicleId|'' }
    const [skipSet, setSkipSet]         = useState(new Set()); // rawVehicle strings to skip
    const [globalPrefix, setGlobalPrefix] = useState('');
    const [sessionNames, setSessionNames] = useState({});  // { sessionIdx: base name string }
    const [result, setResult]           = useState(null);
    const [importing, setImporting]     = useState(false);

    // ── Step 1: parse ────────────────────────────────────────────────────────

    const handleFile = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setParseError('');
        try {
            const parsed = await parseTableauCSV(file);
            if (parsed.length === 0) {
                setParseError('No valid sessions found. Check that the Vehicle column is present and SoC columns are numbered 0–100.');
                return;
            }
            setSessions(parsed);

            // Initialise per-session editable names
            const names = {};
            parsed.forEach((s, i) => { names[i] = s.runName; });
            setSessionNames(names);

            // Fuzzy pre-select vehicle mapping
            const uniqueRaw = [...new Set(parsed.map(s => s.rawVehicle))];
            const map = {};
            for (const raw of uniqueRaw) {
                const parsedName = parsed.find(s => s.rawVehicle === raw)?.vehicleName || raw;
                let bestId = '', bestScore = 0;
                for (const v of vehicles) {
                    const score = fuzzyScore(parsedName, v.name || '');
                    if (score > bestScore) { bestScore = score; bestId = v.id; }
                }
                map[raw] = bestScore >= FUZZY_THRESHOLD ? bestId : '';
            }
            setVehicleMap(map);
            setSkipSet(new Set());
            setGlobalPrefix('');
            setStep('mapping');
        } catch (err) {
            setParseError('Error parsing file: ' + err.message);
        }
    };

    // ── Helpers ──────────────────────────────────────────────────────────────

    const toggleSkip = (raw) => {
        setSkipSet(prev => {
            const next = new Set(prev);
            next.has(raw) ? next.delete(raw) : next.add(raw);
            return next;
        });
    };

    const handleMapChange = (raw, vehicleId) => {
        setVehicleMap(prev => ({ ...prev, [raw]: vehicleId }));
    };

    const handleNameChange = (idx, value) => {
        setSessionNames(prev => ({ ...prev, [idx]: value }));
    };

    const finalName = (idx) => `${globalPrefix}${sessionNames[idx] ?? ''}`;

    // Unique vehicles with their sessions grouped
    const uniqueVehicles = [...new Set(sessions.map(s => s.rawVehicle))].map(raw => {
        const s = sessions.find(x => x.rawVehicle === raw);
        const vehicleSessions = sessions
            .map((x, i) => ({ ...x, idx: i }))
            .filter(x => x.rawVehicle === raw);
        return { raw, year: s.year, vehicleName: s.vehicleName, vehicleSessions };
    });

    // ── Step 2: import ───────────────────────────────────────────────────────

    const handleImport = async () => {
        setImporting(true);
        setStep('importing');
        try {
            // Build final sessions with overridden names, excluding skipped vehicles
            const toImport = sessions
                .map((s, i) => ({ ...s, runName: finalName(i) }))
                .filter(s => !skipSet.has(s.rawVehicle));

            const resolvedMap = {};
            for (const [raw, id] of Object.entries(vehicleMap)) {
                resolvedMap[raw] = id || null;
            }

            const res = await onImport(toImport, resolvedMap);
            setResult(res);
            setStep('done');
        } catch (err) {
            // A "NetworkError" / "Failed to fetch" with a 502 usually means the
            // Supabase project is paused (free tier) or experiencing an outage.
            const isNetworkError = err.message?.toLowerCase().includes('networkerror')
                || err.message?.toLowerCase().includes('failed to fetch')
                || err.message?.toLowerCase().includes('load failed');
            const detail = isNetworkError
                ? 'Network error — your Supabase project may be paused. Visit app.supabase.com, restore the project, then try again.'
                : err.message;
            console.error('[ImportTableau] Import error:', err);
            setParseError('Import failed: ' + detail);
            setStep('mapping');
        } finally {
            setImporting(false);
        }
    };

    // Summary counts (excluding skipped)
    const activeSessions   = sessions.filter(s => !skipSet.has(s.rawVehicle));
    const syntheticCount   = activeSessions.filter(s => s.synthetic).length;
    const realCount        = activeSessions.length - syntheticCount;
    const newVehicleCount  = uniqueVehicles.filter(
        ({ raw }) => !skipSet.has(raw) && !vehicleMap[raw]
    ).length;

    // ────────────────────────────────────────────────────────────────────────

    return (
        <div className="modal-overlay p-4">
            <div className="modal-panel rounded-xl shadow-2xl max-w-5xl max-h-[90vh] flex flex-col">

                {/* Header */}
                <div className="modal-header px-6 py-4 border-b flex-shrink-0">
                    <div>
                        <h2 className="text-xl font-bold">Import Tableau CSV</h2>
                        <p className="text-sm text-muted mt-0.5">
                            {step === 'upload'    && 'Select an exported Tableau charging curve CSV'}
                            {step === 'mapping'   && `${sessions.length} sessions found — review and map below`}
                            {step === 'importing' && 'Importing…'}
                            {step === 'done'      && 'Import complete'}
                        </p>
                    </div>
                    <button onClick={onClose} className="text-faint hover:text-secondary text-2xl leading-none">&times;</button>
                </div>

                {/* Body */}
                <div className="modal-body">

                    {/* ── UPLOAD STEP ── */}
                    {step === 'upload' && (
                        <div className="flex flex-col items-center justify-center py-12 gap-4">
                            <div className="text-5xl">📂</div>
                            <p className="text-secondary text-center max-w-sm">
                                Export your Tableau workbook as <strong>CSV</strong> and upload it here.
                                Columns should include <em>Date of charging test</em>, <em>Optimized</em>,
                                <em>Vehicle</em>, and numeric SoC columns (0–100).
                            </p>
                            <label className="btn btn-primary cursor-pointer">
                                Choose CSV file
                                <input type="file" accept=".csv" className="hidden" onChange={handleFile} />
                            </label>
                            {parseError && <p className="text-red-600 text-sm text-center">{parseError}</p>}
                        </div>
                    )}

                    {/* ── MAPPING STEP ── */}
                    {step === 'mapping' && (
                        <div className="space-y-4">

                            {/* Summary pills */}
                            <div className="flex flex-wrap gap-2">
                                <span className="px-3 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                                    {activeSessions.length} active sessions
                                </span>
                                {realCount > 0 && (
                                    <span className="px-3 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700">
                                        {realCount} real
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

                            {/* Skip All / Include All */}
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setSkipSet(new Set(uniqueVehicles.map(v => v.raw)))}
                                    className="px-3 py-1 rounded text-xs font-medium bg-[var(--color-surface-sunken)] text-secondary hover:bg-[var(--color-surface-muted)] transition"
                                >
                                    Skip all
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setSkipSet(new Set())}
                                    className="px-3 py-1 rounded text-xs font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 transition"
                                >
                                    Include all
                                </button>
                            </div>

                            {/* Global prefix */}
                            <div className="flex items-center gap-3 p-3 bg-[var(--color-surface-muted)] rounded-lg border">
                                <label className="text-sm font-medium text-secondary whitespace-nowrap">
                                    Run name prefix:
                                </label>
                                <input
                                    type="text"
                                    value={globalPrefix}
                                    onChange={e => setGlobalPrefix(e.target.value)}
                                    placeholder="e.g. 2026 Batch — (optional)"
                                    className="form-input py-1 text-sm flex-1"
                                />
                            </div>

                            {/* Per-vehicle panels */}
                            {uniqueVehicles.map(({ raw, year, vehicleName, vehicleSessions }) => {
                                const skipped       = skipSet.has(raw);
                                const mappedId      = vehicleMap[raw] || '';
                                const mappedVehicle = mappedId ? vehicles.find(v => v.id === mappedId) : null;
                                const existingRuns  = mappedVehicle?.runs || [];
                                // Dates of sessions for this vehicle (normalised) for clash detection
                                const sessionDates  = new Set(vehicleSessions.map(s => normalizeDate(s.date)));

                                return (
                                    <div
                                        key={raw}
                                        className={`import-vehicle-panel ${skipped ? 'opacity-50' : ''}`}
                                    >
                                        {/* Vehicle header */}
                                        <div className="import-vehicle-header">
                                            <button
                                                type="button"
                                                onClick={() => toggleSkip(raw)}
                                                title={skipped ? 'Include this vehicle' : 'Skip this vehicle'}
                                                className={`flex-shrink-0 px-2 py-0.5 rounded text-xs font-medium border transition ${
                                                    skipped
                                                        ? 'bg-[var(--color-surface-muted)] text-muted border-[var(--color-border)]'
                                                        : 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100'
                                                }`}
                                            >
                                                {skipped ? 'Skipped' : 'Skip'}
                                            </button>
                                            <div className="flex-1 min-w-0">
                                                <span className="font-semibold">{vehicleName}</span>
                                                {year && <span className="text-faint text-sm ml-1">({year})</span>}
                                                <span className="text-faint text-xs ml-2">
                                                    {vehicleSessions.length} session{vehicleSessions.length !== 1 ? 's' : ''}
                                                </span>
                                            </div>
                                            {/* Map to dropdown */}
                                            <select
                                                value={mappedId}
                                                onChange={e => handleMapChange(raw, e.target.value)}
                                                disabled={skipped}
                                                className="border rounded p-1 text-sm max-w-[200px]"
                                            >
                                                <option value="">✦ Create new vehicle</option>
                                                {vehicles.map(v => (
                                                    <option key={v.id} value={v.id}>
                                                        {v.name}{v.year ? ` (${v.year})` : ''}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        {/* Sessions list */}
                                        {!skipped && (
                                            <div className="divide-y">
                                                {vehicleSessions.map(({ idx, date, synthetic }) => (
                                                    <div key={idx} className="import-session-row">
                                                        <input
                                                            type="text"
                                                            value={sessionNames[idx] ?? ''}
                                                            onChange={e => handleNameChange(idx, e.target.value)}
                                                            className="form-input py-1 text-sm flex-1"
                                                        />
                                                        <span className="text-xs text-faint whitespace-nowrap flex-shrink-0">
                                                            {date}
                                                        </span>
                                                        {synthetic && (
                                                            <span className="px-1.5 py-0.5 rounded text-xs bg-purple-50 text-purple-600 flex-shrink-0">
                                                                synthetic
                                                            </span>
                                                        )}
                                                        {globalPrefix && (
                                                            <span className="text-xs text-faint italic flex-shrink-0 hidden lg:block" title="Final run name">
                                                                → {finalName(idx)}
                                                            </span>
                                                        )}
                                                    </div>
                                                ))}

                                                {/* Existing runs in mapped vehicle */}
                                                {existingRuns.length > 0 && (
                                                    <div className="px-4 py-2 bg-[var(--color-surface-muted)]">
                                                        <p className="text-xs text-faint font-medium mb-1">
                                                            Existing runs in "{mappedVehicle.name}":
                                                        </p>
                                                        <ul className="space-y-0.5">
                                                            {existingRuns.map(run => {
                                                                const clash = sessionDates.has(normalizeDate(run.date));
                                                                return (
                                                                    <li
                                                                        key={run.id}
                                                                        className={`text-xs ${clash ? 'font-bold text-red-600' : 'text-muted'}`}
                                                                    >
                                                                        {clash ? '⚠ ' : '• '}{run.name}
                                                                        {run.date && <span className="ml-1 font-normal opacity-70">({run.date})</span>}
                                                                    </li>
                                                                );
                                                            })}
                                                        </ul>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}

                            {parseError && <p className="text-red-600 text-sm">{parseError}</p>}
                        </div>
                    )}

                    {/* ── IMPORTING STEP ── */}
                    {step === 'importing' && (
                        <div className="flex flex-col items-center justify-center py-16 gap-4">
                            <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
                            <p className="text-secondary">Importing {activeSessions.length} sessions…</p>
                            <p className="text-xs text-faint">This may take a moment for large datasets</p>
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
                                {result.runsSkipped > 0 && (
                                    <span className="px-3 py-1 rounded-full text-sm font-medium bg-yellow-50 text-yellow-700">
                                        {result.runsSkipped} duplicate{result.runsSkipped !== 1 ? 's' : ''} skipped
                                    </span>
                                )}
                                <span className="px-3 py-1 rounded-full text-sm font-medium bg-[var(--color-surface-sunken)] text-secondary">
                                    {result.pointsImported.toLocaleString()} data points
                                </span>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="modal-footer">
                    {step === 'upload' && (
                        <button onClick={onClose} className="btn btn-secondary">Cancel</button>
                    )}
                    {step === 'mapping' && (
                        <>
                            <button onClick={() => setStep('upload')} className="btn btn-secondary">Back</button>
                            <button
                                onClick={handleImport}
                                disabled={activeSessions.length === 0}
                                className="btn btn-primary disabled:opacity-50"
                            >
                                Import {activeSessions.length} session{activeSessions.length !== 1 ? 's' : ''}
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

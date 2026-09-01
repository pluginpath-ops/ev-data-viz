/**
 * Import a GPS performance-testing CSV as one session for a vehicle.
 *
 * Parses in the browser and shows what was found before writing anything — the
 * file format is transposed (one column per run) and easy to mistake for a
 * different export, so a preview is the cheapest way to catch a wrong file
 * before it becomes a session with eight bogus runs in it.
 */
import { useState } from 'react';
import { parsePerformanceCSV } from '../utils/parsePerformanceCSV';
import { useAppContext } from '../context/AppContext';

export default function PerformanceImportModal({ vehicle, onImport, onMerge, onClose }) {
    const { findMatchingPerformanceRuns } = useAppContext();
    const [parsed, setParsed]     = useState(null);
    const [fileName, setFileName] = useState(null);
    const [testType, setTestType] = useState('accel');
    const [sourceName, setSourceName] = useState('');
    const [sourceUrl, setSourceUrl] = useState('');
    const [busy, setBusy]         = useState(false);
    const [error, setError]       = useState(null);
    // Non-null when this file describes runs already stored — see below.
    const [match, setMatch]       = useState(null);

    const handleFile = async (file) => {
        if (!file) return;
        setError(null);
        setParsed(null);
        setFileName(file.name);
        setMatch(null);
        try {
            const result = await parsePerformanceCSV(file, { testType });
            setParsed(result);
            // Draggy exports one file per metric set for the SAME physical runs,
            // with identical timestamps. Importing the second as a new session
            // would duplicate every run, so look for an overlap first.
            const found = await findMatchingPerformanceRuns(vehicle.id, result.runs);
            if (found?.matched > 0) setMatch(found);
        } catch (e) {
            setError(e?.message || 'Could not parse this file.');
        }
    };

    const handleImport = async () => {
        if (!parsed) return;
        setBusy(true);
        setError(null);
        try {
            if (match) {
                await onMerge(match, parsed.runs);
            } else {
                await onImport(vehicle.id, parsed, {
                    sourceName: sourceName.trim() || null,
                    sourceUrl: sourceUrl.trim() || null,
                });
            }
            onClose();
        } catch (e) {
            setError(e?.message || 'Import failed.');
            setBusy(false);
        }
    };

    const session = parsed?.session;

    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="modal-panel rounded-xl p-5 max-w-2xl w-full max-h-[85vh] overflow-y-auto">
                <h3 className="section-title mb-1">Import performance testing data</h3>
                <p className="text-xs text-secondary mb-3">
                    For <span className="font-semibold">{vehicle?.name}</span>. Expects a GPS
                    testing export with one column per run.
                </p>

                <div className="flex flex-wrap items-end gap-3 mb-3">
                    <label className="text-xs">
                        <span className="text-secondary block mb-0.5">Test type</span>
                        <select
                            value={testType}
                            onChange={e => {
                                // Clear the match too — leaving it set with no parse
                                // means a stale overlap is carried into the next file.
                                setTestType(e.target.value);
                                setParsed(null); setFileName(null); setMatch(null);
                            }}
                            className="form-input form-input w-32"
                        >
                            <option value="accel">Acceleration</option>
                            <option value="braking">Braking</option>
                        </select>
                    </label>
                    <label className="text-xs flex-1 min-w-[10rem]">
                        <span className="text-secondary block mb-0.5">Source (optional)</span>
                        <input
                            type="text" value={sourceName}
                            onChange={e => setSourceName(e.target.value)}
                            placeholder="e.g. Out of Spec"
                            className="form-input form-input w-full"
                        />
                    </label>
                    <label className="text-xs flex-1 min-w-[12rem]">
                        <span className="text-secondary block mb-0.5">Source link (optional)</span>
                        <input
                            type="text" value={sourceUrl}
                            onChange={e => setSourceUrl(e.target.value)}
                            placeholder="https://…"
                            className="form-input form-input w-full"
                        />
                    </label>
                </div>

                {testType === 'braking' && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400 mb-2">
                        Braking exports haven’t been seen yet, so the parser is written against the
                        acceleration layout. If the import looks wrong, enter the figures by hand as
                        speed windows instead.
                    </p>
                )}

                <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={e => handleFile(e.target.files?.[0])}
                    className="form-input w-full"
                />
                {fileName && <p className="text-[11px] text-meta mt-1">{fileName}</p>}
                {error && <p className="text-xs text-red-500 mt-2">{error}</p>}

                {match && (
                    <div className="mt-3 border rounded-lg p-3 border-amber-500/40 bg-amber-500/5">
                        <div className="text-sm font-semibold text-amber-600 dark:text-amber-400 mb-1">
                            These runs are already here
                        </div>
                        <p className="text-xs text-secondary">
                            {match.matched} of {parsed?.runs.length} runs match an existing session by
                            timestamp{match.session.tested_at ? ` (${String(match.session.tested_at).replace('T', ' ')})` : ''}.
                            Testing apps export one file per metric set for the same physical runs, so
                            this will be <span className="font-semibold">added to those runs</span> rather
                            than creating a second session. Splits already present are skipped, so
                            re-importing the same file changes nothing.
                        </p>
                        {match.unmatched.length > 0 && (
                            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                                {match.unmatched.length} run(s) in this file have no match and will be
                                left out — import them separately if they belong to another session.
                            </p>
                        )}
                    </div>
                )}

                {parsed && (
                    <div className="mt-3 border rounded-lg p-3 border-[var(--color-border)]">
                        <div className="font-semibold text-sm mb-1">
                            {parsed.runs.length} run{parsed.runs.length === 1 ? '' : 's'} found
                            <span className="text-meta font-normal ml-2 text-xs">
                                {parsed.format === 'distance' ? 'distance splits' :
                                 parsed.format === 'mixed' ? 'speed + distance splits' : 'speed splits'}
                            </span>
                        </div>
                        <div className="text-xs text-secondary mb-2">
                            {session.locationName && <>{session.locationName} · </>}
                            {session.testedAt?.replace('T', ' ')}
                            {session.temperatureF != null && <> · {Math.round(session.temperatureF)}°F</>}
                            {session.windSpeedMph != null && <> · wind {session.windSpeedMph.toFixed(1)} mph</>}
                        </div>

                        <table className="w-full text-xs">
                            <thead>
                                <tr className="text-meta text-[10px] uppercase tracking-wide">
                                    <th className="text-left font-semibold py-1">Drive mode</th>
                                    <th className="text-right font-semibold py-1">
                                        {parsed.format === 'distance' ? '¼ mile' : '0–60'}
                                    </th>
                                    <th className="text-right font-semibold py-1">
                                        {parsed.format === 'distance' ? 'trap' : '0–60 (1ft)'}
                                    </th>
                                    <th className="text-right font-semibold py-1">Max g</th>
                                    <th className="text-right font-semibold py-1">Splits</th>
                                </tr>
                            </thead>
                            <tbody>
                                {parsed.runs.map(r => (
                                    <tr key={r.sequence} className="border-t border-[var(--color-border)]">
                                        <td className="py-0.5 text-secondary truncate max-w-[12rem]">{r.driveMode || '—'}</td>
                                        <td className="py-0.5 text-right font-mono">
                                            {parsed.format === 'distance'
                                                ? (r.quarterMileSec != null ? r.quarterMileSec.toFixed(3) : '—')
                                                : (r.zeroTo60Sec != null ? r.zeroTo60Sec.toFixed(3) : '—')}
                                        </td>
                                        <td className="py-0.5 text-right font-mono text-secondary">
                                            {parsed.format === 'distance'
                                                ? (r.quarterMileTrapMph != null ? `${r.quarterMileTrapMph} mph` : '—')
                                                : (r.zeroTo60RolloutSec != null ? r.zeroTo60RolloutSec.toFixed(3) : '—')}
                                        </td>
                                        <td className="py-0.5 text-right font-mono">
                                            {r.maxGForce != null ? r.maxGForce.toFixed(3) : '—'}
                                        </td>
                                        <td className="py-0.5 text-right font-mono text-meta">{r.splits.length}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        <p className="text-[10px] text-meta mt-2">
                            Splits found per run: {parsed.runs[0]?.splits.map(s => s.label).join(', ') || 'none'}
                        </p>

                        {parsed.warnings.length > 0 && (
                            <ul className="mt-2 text-[11px] text-amber-600 dark:text-amber-400 list-disc list-inside">
                                {parsed.warnings.map((w, i) => <li key={i}>{w}</li>)}
                            </ul>
                        )}
                        <p className="text-[10px] text-meta mt-2">
                            The two 0–60 columns are different conventions, not a duplicate: the first
                            starts the clock at 0 mph, the second allows the 1 ft drag-strip rollout.
                        </p>
                    </div>
                )}

                <div className="flex gap-2 mt-4">
                    <button
                        type="button" onClick={handleImport} disabled={!parsed || busy}
                        className="btn btn-primary text-sm disabled:opacity-50"
                    >
                        {busy ? 'Working…'
                            : match ? `Add splits to ${match.matched} existing run${match.matched === 1 ? '' : 's'}`
                            : `Import ${parsed?.runs.length || ''} run${parsed?.runs.length === 1 ? '' : 's'}`}
                    </button>
                    <button type="button" onClick={onClose} disabled={busy} className="btn btn-secondary text-sm">
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
}

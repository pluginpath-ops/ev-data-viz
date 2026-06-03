/**
 * EPA CSI-PDF import modal. Drag/drop a lab Certification Summary PDF; pdf.js
 * extracts the text (lazy-loaded), parseEpaCsiText builds the config records,
 * and a preview lets the curator review before committing (clean-replace upsert).
 *
 * Two modes via `targetVehicle`:
 *   • absent  → Admin bulk import (no auto-link)
 *   • present → per-vehicle: pick which config links to the current vehicle
 */
import { useState } from 'react';
import { extractPdfText } from '../utils/extractPdfText';
import { parseEpaCsiText } from '../utils/parseEpaCsiPdf';

export default function EpaPdfImportModal({ targetVehicle = null, onImport, getExistingIds, onClose }) {
    const [step, setStep]       = useState('upload'); // upload | review | done
    const [fileName, setFileName] = useState('');
    const [busy, setBusy]       = useState(false);
    const [error, setError]     = useState(null);
    const [dragOver, setDragOver] = useState(false);
    const [groups, setGroups]   = useState([]);
    const [warnings, setWarnings] = useState([]);
    const [existing, setExisting] = useState(new Set());
    const [selected, setSelected] = useState(new Set());   // test_group_ids to import
    const [linkId, setLinkId]   = useState('');            // config to link (per-vehicle mode)
    const [result, setResult]   = useState(null);

    const processFile = async (file) => {
        if (!file) return;
        setFileName(file.name);
        setBusy(true);
        setError(null);
        try {
            const items = await extractPdfText(file);
            const { groups: g, warnings: w } = parseEpaCsiText(items);
            if (!g.length) { setError(w[0] || 'No EPA configurations found in this PDF.'); setBusy(false); return; }
            const ids = g.map(x => x.test_group_id);
            let exists = [];
            try { exists = await getExistingIds(ids); } catch { /* non-fatal */ }
            setGroups(g);
            setWarnings(w);
            setExisting(new Set(exists));
            setSelected(new Set(ids));
            // Per-vehicle: default-link the config whose carline best matches the vehicle, else the first.
            if (targetVehicle) {
                const vn = (targetVehicle.name || '').toLowerCase();
                const best = g.find(x => vn && (x.epa_carline_name || '').toLowerCase().includes(vn.split(' ')[0]));
                setLinkId((best || g[0]).test_group_id);
            }
            setStep('review');
        } catch (e) {
            setError(e.message || 'Failed to read PDF.');
        } finally {
            setBusy(false);
        }
    };

    const onDrop = (e) => { e.preventDefault(); setDragOver(false); processFile(e.dataTransfer.files[0]); };
    const toggle = (id) => setSelected(p => { const s = new Set(p); s.has(id) ? s.delete(id) : s.add(id); return s; });

    const overwriteCount = [...selected].filter(id => existing.has(id)).length;

    const handleImport = async () => {
        const toImport = groups.filter(g => selected.has(g.test_group_id));
        if (!toImport.length) return;
        if (overwriteCount > 0 &&
            !window.confirm(`${overwriteCount} of these configuration(s) already exist and will be overwritten with the PDF data. Continue?`)) {
            return;
        }
        setBusy(true); setError(null);
        try {
            const res = await onImport(toImport, targetVehicle && selected.has(linkId)
                ? { linkVehicleId: targetVehicle.id, linkTestGroupId: linkId }
                : {});
            setResult(res);
            setStep('done');
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="modal-panel rounded-xl p-5"
                 style={{ maxWidth: '760px', width: '96vw', maxHeight: '90vh', overflowY: 'auto' }}
                 onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold">
                        Import EPA Lab PDF{targetVehicle ? ` → ${targetVehicle.name}` : ''}
                    </h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
                </div>

                {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">⚠️ {error}</div>}

                {step === 'upload' && (
                    <div
                        onDrop={onDrop}
                        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                        onDragLeave={() => setDragOver(false)}
                        className={`border-2 border-dashed rounded-lg p-10 text-center ${dragOver ? 'border-indigo-400 bg-indigo-50/40' : 'border-gray-300'}`}
                    >
                        <p className="text-sm text-gray-500 mb-3">
                            {busy ? 'Reading PDF…' : 'Drop an EPA Certification Summary (CSI) PDF here, or'}
                        </p>
                        <label className="btn btn-secondary text-sm cursor-pointer">
                            Choose PDF
                            <input type="file" accept=".pdf" className="hidden"
                                onChange={e => processFile(e.target.files[0])} />
                        </label>
                        <p className="text-xs text-gray-400 mt-3">Parsed entirely in your browser — nothing is uploaded.</p>
                    </div>
                )}

                {step === 'review' && (
                    <>
                        <p className="text-sm text-gray-500 mb-2">
                            <span className="font-medium">{fileName}</span> — {groups.length} configuration(s) found.
                        </p>
                        <div className="max-h-80 overflow-y-auto border rounded-lg">
                            <table className="w-full text-xs">
                                <thead className="bg-gray-50 dark:bg-slate-800 sticky top-0">
                                    <tr className="text-left text-gray-500">
                                        <th className="p-2"></th>
                                        {targetVehicle && <th className="p-2">Link</th>}
                                        <th className="p-2">Config ID</th>
                                        <th className="p-2">Make · Carline</th>
                                        <th className="p-2">Coeff / Tests / Phases</th>
                                        <th className="p-2">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {groups.map(g => {
                                        const id = g.test_group_id;
                                        const phaseCount = g.tests.reduce((n, t) => n + t.phases.length, 0);
                                        return (
                                            <tr key={id} className={selected.has(id) ? '' : 'opacity-40'}>
                                                <td className="p-2"><input type="checkbox" checked={selected.has(id)} onChange={() => toggle(id)} /></td>
                                                {targetVehicle && (
                                                    <td className="p-2">
                                                        <input type="radio" name="linkcfg" checked={linkId === id}
                                                            disabled={!selected.has(id)} onChange={() => setLinkId(id)} />
                                                    </td>
                                                )}
                                                <td className="p-2 font-mono">{id}</td>
                                                <td className="p-2">{g.make} · <span className="text-gray-500">{g.epa_carline_name}</span></td>
                                                <td className="p-2 font-mono text-gray-500">{g.coefficient_sets.length} / {g.tests.length} / {phaseCount}</td>
                                                <td className="p-2">
                                                    {existing.has(id)
                                                        ? <span className="text-amber-600 dark:text-amber-400">⟳ overwrite</span>
                                                        : <span className="text-green-600 dark:text-green-400">＋ new</span>}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {warnings.length > 0 && (
                            <ul className="mt-2 text-xs text-amber-600 dark:text-amber-400 list-disc pl-5">
                                {warnings.map((w, i) => <li key={i}>{w}</li>)}
                            </ul>
                        )}

                        <div className="flex items-center gap-2 mt-4">
                            <span className="text-xs text-gray-500 flex-1">
                                {selected.size} selected{overwriteCount ? ` · ${overwriteCount} overwrite` : ''}
                                {targetVehicle && selected.has(linkId) ? ` · linking ${linkId} to ${targetVehicle.name}` : ''}
                            </span>
                            <button onClick={() => setStep('upload')} className="btn btn-secondary text-sm" disabled={busy}>Back</button>
                            <button onClick={handleImport} className="btn btn-primary text-sm" disabled={busy || !selected.size}>
                                {busy ? 'Importing…' : `Import ${selected.size} config(s)`}
                            </button>
                        </div>
                    </>
                )}

                {step === 'done' && (
                    <div className="text-center py-6">
                        <p className="text-2xl mb-2">✓</p>
                        <p className="text-sm">Imported {result?.count ?? selected.size} configuration(s).</p>
                        <button onClick={onClose} className="btn btn-primary text-sm mt-4">Done</button>
                    </div>
                )}
            </div>
        </div>
    );
}

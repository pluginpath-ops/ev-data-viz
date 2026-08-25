/**
 * EPA CSI-PDF import modal. Drop one or many lab Certification Summary PDFs;
 * pdf.js extracts the text (lazy-loaded), parseEpaCsiText builds the config
 * records, and a preview lets the curator review everything before committing
 * (clean-replace upsert).
 *
 * Two modes via `targetVehicle`:
 *   • absent  → Admin bulk import (no auto-link)
 *   • present → per-vehicle: pick which config links to the current vehicle
 *
 * ── Many files, read one at a time ──────────────────────────────────────────
 *
 * Files are parsed SEQUENTIALLY, not in parallel. pdf.js holds a whole document
 * in memory while it reads, and a certificate runs to thousands of text items;
 * starting twenty at once trades a few seconds for a tab that may not survive
 * the attempt. Sequential also means the progress line can name the file being
 * read, so a slow certificate looks like work rather than a hang.
 */
import { useState } from 'react';
import { extractPdfText } from '../utils/extractPdfText';
import { parseEpaCsiText } from '../utils/parseEpaCsiPdf';
import { integrityWarnings } from '../utils/epaIntegrity';

export default function EpaPdfImportModal({ targetVehicle = null, onImport, getExistingIds, onClose }) {
    const [step, setStep]       = useState('upload'); // upload | review | done
    const [files, setFiles]     = useState([]);   // [{ name, configs, error }]
    const [progress, setProgress] = useState(null); // { done, total, name }
    const [busy, setBusy]       = useState(false);
    const [error, setError]     = useState(null);
    const [dragOver, setDragOver] = useState(false);
    const [groups, setGroups]   = useState([]);
    const [warnings, setWarnings] = useState([]);
    const [existing, setExisting] = useState(new Set());
    const [selected, setSelected] = useState(new Set());   // test_group_ids to import
    const [linkIds, setLinkIds]   = useState(new Set());   // configs to link (per-vehicle mode)
    const [result, setResult]   = useState(null);

    /**
     * Read a list of PDFs, then review them together.
     *
     * One file failing does not abandon the rest: a certificate with a layout
     * the parser cannot read is recorded against its own name and the others
     * still import. A run of twenty where the third is malformed should not
     * cost the other nineteen.
     */
    const processFiles = async (fileList) => {
        const list = [...(fileList ?? [])].filter(f => f && /\.pdf$/i.test(f.name));
        if (!list.length) return;

        setBusy(true);
        setError(null);
        setProgress({ done: 0, total: list.length, name: list[0].name });

        const allGroups = [];
        const allWarnings = [];
        const statuses = [];
        const seen = new Map();   // test_group_id → the file that claimed it

        for (const [i, file] of list.entries()) {
            setProgress({ done: i, total: list.length, name: file.name });
            try {
                const items = await extractPdfText(file);
                const { groups: g, warnings: w } = parseEpaCsiText(items);
                if (!g.length) {
                    statuses.push({ name: file.name, configs: 0, error: w[0] || 'No EPA configurations found.' });
                    continue;
                }

                const kept = [];
                for (const grp of g) {
                    // The same configuration in two files is a real situation —
                    // a re-issued certificate, a V2 of the same PDF. Keeping the
                    // first and naming the loser is predictable; letting the
                    // last silently win is not, because which file is "last"
                    // depends on the order the picker happened to hand them over.
                    if (seen.has(grp.test_group_id)) {
                        allWarnings.push(`${file.name}: ${grp.test_group_id} also appears in ${seen.get(grp.test_group_id)} — keeping the first.`);
                        continue;
                    }
                    seen.set(grp.test_group_id, file.name);
                    // Provenance, which nothing was setting before: the column
                    // exists and importEpaGroupFull writes it, but the modal
                    // never supplied a name, so every imported group recorded
                    // null for the file it came from.
                    kept.push({ ...grp, source_file: file.name });
                }
                allGroups.push(...kept);
                allWarnings.push(...w.map(x => list.length > 1 ? `${file.name}: ${x}` : x));
                // Is what we just read internally possible? A bulk load of every
                // MY2026 certification wrote 2-5 kWh packs and 1% charging
                // efficiencies, and none of it surfaced — a nonsensical figure
                // imported exactly as quietly as a sound one. Cheapest place to
                // say so is here, beside the file it came from, while the
                // curator can still choose not to import it.
                for (const grp of kept) {
                    allWarnings.push(...integrityWarnings(grp)
                        .map(x => list.length > 1 ? `${file.name}: ${x}` : x));
                }
                statuses.push({ name: file.name, configs: kept.length, error: null });
            } catch (e) {
                statuses.push({ name: file.name, configs: 0, error: e.message || 'Failed to read PDF.' });
            }
        }

        setProgress(null);
        setFiles(statuses);

        if (!allGroups.length) {
            setError(statuses.find(s2 => s2.error)?.error || 'No EPA configurations found in these PDFs.');
            setBusy(false);
            return;
        }

        const ids = allGroups.map(x => x.test_group_id);
        let exists = [];
        try { exists = await getExistingIds(ids); } catch { /* non-fatal */ }

        setGroups(allGroups);
        setWarnings(allWarnings);
        setExisting(new Set(exists));
        setSelected(new Set(ids));
        if (targetVehicle) {
            const vn = (targetVehicle.name || '').toLowerCase();
            const best = allGroups.find(x => vn && (x.epa_carline_name || '').toLowerCase().includes(vn.split(' ')[0]));
            setLinkIds(new Set([(best || allGroups[0]).test_group_id]));
        }
        setStep('review');
        setBusy(false);
    };

    const onDrop = (e) => { e.preventDefault(); setDragOver(false); processFiles(e.dataTransfer.files); };

    // Import-select toggle; deselecting also drops any link.
    const toggle = (id) => {
        const willSelect = !selected.has(id);
        setSelected(p => { const s = new Set(p); willSelect ? s.add(id) : s.delete(id); return s; });
        if (!willSelect) setLinkIds(p => { const s = new Set(p); s.delete(id); return s; });
    };
    // Link toggle (per-vehicle); linking forces the row to be imported.
    const toggleLink = (id) => {
        const willLink = !linkIds.has(id);
        setLinkIds(p => { const s = new Set(p); willLink ? s.add(id) : s.delete(id); return s; });
        if (willLink) setSelected(p => new Set(p).add(id));
    };
    const allIds = groups.map(g => g.test_group_id);
    const allSelected = allIds.length > 0 && allIds.every(id => selected.has(id));
    const allLinked   = allIds.length > 0 && allIds.every(id => linkIds.has(id));
    const toggleAllSelect = () => {
        if (allSelected) { setSelected(new Set()); setLinkIds(new Set()); }
        else setSelected(new Set(allIds));
    };
    const toggleAllLink = () => {
        if (allLinked) setLinkIds(new Set());
        else { setLinkIds(new Set(allIds)); setSelected(new Set(allIds)); }
    };

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
            const res = await onImport(toImport, targetVehicle
                ? { linkVehicleId: targetVehicle.id, linkTestGroupIds: [...linkIds].filter(id => selected.has(id)) }
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
                    <button onClick={onClose} className="text-faint hover:text-secondary text-xl leading-none">×</button>
                </div>

                {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">⚠️ {error}</div>}

                {step === 'upload' && (
                    <div
                        onDrop={onDrop}
                        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                        onDragLeave={() => setDragOver(false)}
                        className={`border-2 border-dashed rounded-lg p-10 text-center ${dragOver ? 'border-indigo-400 bg-indigo-50/40' : 'border-[var(--color-border)]'}`}
                    >
                        <p className="text-sm text-muted mb-3">
                            {progress
                                ? `Reading ${progress.done + 1} of ${progress.total}: ${progress.name}`
                                : busy
                                    ? 'Reading…'
                                    : 'Drop EPA Certification Summary (CSI) PDFs here — one or many — or'}
                        </p>
                        <label className="btn btn-secondary text-sm cursor-pointer">
                            Choose PDFs
                            {/* `multiple`, and the picker returns a FileList that
                                is read one at a time — see processFiles. */}
                            <input type="file" accept=".pdf" multiple className="hidden"
                                onChange={e => processFiles(e.target.files)} />
                        </label>
                        <p className="text-xs text-faint mt-3">Parsed entirely in your browser — nothing is uploaded.</p>
                    </div>
                )}

                {step === 'review' && (
                    <>
                        <p className="text-sm text-muted mb-2">
                            {files.length === 1
                                ? <><span className="font-medium">{files[0].name}</span> — {groups.length} configuration(s) found.</>
                                : <>{files.length} files — {groups.length} configuration(s) found.</>}
                        </p>

                        {/* Per-file outcome, so a file that yielded nothing is
                            visible as a named failure rather than as configs
                            that quietly never appeared. */}
                        {files.length > 1 && (
                            <div className="pdf-file-list">
                                {files.map(f => (
                                    <div key={f.name} className={`pdf-file-row ${f.error ? 'failed' : ''}`}>
                                        <span className="truncate">{f.name}</span>
                                        <span className="text-caption text-faint shrink-0">
                                            {f.error ? f.error : `${f.configs} config${f.configs === 1 ? '' : 's'}`}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                        <div className="max-h-80 overflow-y-auto border rounded-lg">
                            <table className="w-full text-xs">
                                <thead className="bg-[var(--color-surface-muted)] sticky top-0">
                                    <tr className="text-left text-muted">
                                        <th className="p-2" title="Select all / none">
                                            <input type="checkbox" checked={allSelected} onChange={toggleAllSelect} />
                                        </th>
                                        {targetVehicle && (
                                            <th className="p-2">
                                                <input type="checkbox" checked={allLinked} onChange={toggleAllLink} title="Link all / none" />
                                                <span className="ml-1">Link</span>
                                            </th>
                                        )}
                                        <th className="p-2">Config ID</th>
                                        <th className="p-2">Make · Carline</th>
                                        <th className="p-2">Coeff / Tests / Phases</th>
                                        {/* Certificate-wide, so every configuration from one PDF
                                            shows the same count — the table describes what the
                                            CERTIFICATE covers, not one configuration. */}
                                        <th className="p-2">Covered models</th>
                                        {files.length > 1 && <th className="p-2">File</th>}
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
                                                        <input type="checkbox" checked={linkIds.has(id)}
                                                            onChange={() => toggleLink(id)} />
                                                    </td>
                                                )}
                                                <td className="p-2 font-mono">{id}</td>
                                                <td className="p-2">{g.make} · <span className="text-muted">{g.epa_carline_name}</span></td>
                                                <td className="p-2 font-mono text-muted">{g.coefficient_sets.length} / {g.tests.length} / {phaseCount}</td>
                                                <td className="p-2 font-mono text-muted">
                                                    {g.covered_models?.length
                                                        ? `${new Set(g.covered_models.map(c => c.carline_name)).size} (${g.covered_models.length} rows)`
                                                        : '—'}
                                                    {/* The manufacturer's own note is the other thing
                                                        this import newly captures, and the only place
                                                        some wheel variants are stated at all. */}
                                                    {g.tests.some(t => t.mfr_test_vehicle_comments) && (
                                                        <span className="text-faint"> · note</span>
                                                    )}
                                                </td>
                                                {files.length > 1 && (
                                                    <td className="p-2 text-faint truncate" style={{ maxWidth: '11rem' }} title={g.source_file}>{g.source_file}</td>
                                                )}
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
                            <span className="text-xs text-muted flex-1">
                                {selected.size} selected{overwriteCount ? ` · ${overwriteCount} overwrite` : ''}
                                {targetVehicle && linkIds.size ? ` · linking ${linkIds.size} to ${targetVehicle.name}` : ''}
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
                        <p className="text-sm">
                            Imported {result?.count ?? selected.size} configuration(s)
                            {files.length > 1 && ` from ${files.filter(f => f.configs > 0).length} of ${files.length} files`}.
                        </p>
                        <button onClick={onClose} className="btn btn-primary text-sm mt-4">Done</button>
                    </div>
                )}
            </div>
        </div>
    );
}

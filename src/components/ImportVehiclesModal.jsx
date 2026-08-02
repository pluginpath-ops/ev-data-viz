/**
 * Bulk vehicle import modal — drop a CSV or JSON file to create vehicles and fill
 * in their specs in one pass.
 *
 * Flow: upload → review (a per-row plan you can tick through) → done.
 * Parsing and planning are pure utils (parseVehicleImport / vehicleImportPlan);
 * this component is presentation plus the apply call.
 *
 * Merge policy is fill-blanks — existing values are never overwritten, so the
 * same file can be re-uploaded after it grows more columns.
 */
import { Fragment, useMemo, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { parseVehicleImportText } from '../utils/parseVehicleImport';
import {
    buildImportPlan, selectPlanRows, fieldPathLabel,
    buildCsvTemplate, buildJsonTemplate,
} from '../utils/vehicleImportPlan';

const ACTION_STYLES = {
    create: { label: '＋ new',    className: 'import-badge-create' },
    update: { label: '✎ fill',    className: 'import-badge-update' },
    skip:   { label: '– nothing', className: 'import-badge-skip' },
    error:  { label: '⚠ error',   className: 'import-badge-error' },
};

function downloadText(filename, text, mime) {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

/** Expanded detail for one planned row: what gets written, what is left alone. */
function RowDetail({ row }) {
    const coreWrites = Object.entries(row.coreWrites);
    return (
        <div className="import-row-detail">
            {row.manufacturerName && (
                <p>Brand: <span className="font-medium">{row.manufacturerName}</span>
                    {row.manufacturerIsNew && <span className="text-amber-600 dark:text-amber-400"> (new)</span>}</p>
            )}
            {row.inherit && <p>Inherits specs from <span className="font-medium">{row.inheritRef}</span></p>}
            {row.tagNames.length > 0 && <p>Tags added: {row.tagNames.join(', ')}</p>}

            {(coreWrites.length > 0 || row.specWrites.length > 0) && (
                <>
                    <p className="font-medium mt-1">Writes</p>
                    <ul className="import-detail-list">
                        {coreWrites.map(([key, value]) => (
                            <li key={key}>{key} → <span className="font-mono">{String(value)}</span></li>
                        ))}
                        {row.specWrites.map(w => (
                            <li key={w.path}>
                                {fieldPathLabel(w.path)} → <span className="font-mono">{String(w.value)}</span>
                            </li>
                        ))}
                    </ul>
                </>
            )}

            {row.specSkips.length > 0 && (
                <>
                    <p className="font-medium mt-1">Kept (already set)</p>
                    <ul className="import-detail-list text-faint">
                        {row.specSkips.map(s => (
                            <li key={s.path}>
                                {fieldPathLabel(s.path)} — keeping <span className="font-mono">{String(s.current)}</span>,
                                ignoring <span className="font-mono">{String(s.value)}</span>
                            </li>
                        ))}
                    </ul>
                </>
            )}

            {row.errors.map((e, i) => <p key={`e${i}`} className="text-red-600 dark:text-red-400">⚠ {e}</p>)}
            {row.warnings.map((w, i) => <p key={`w${i}`} className="text-amber-600 dark:text-amber-400">{w}</p>)}
        </div>
    );
}

export default function ImportVehiclesModal({ onClose }) {
    const { vehicles, manufacturers, tags, importVehicles } = useAppContext();

    const [step, setStep]         = useState('upload'); // upload | review | done
    const [fileName, setFileName] = useState('');
    const [parsed, setParsed]     = useState(null);
    const [plan, setPlan]         = useState(null);
    const [selected, setSelected] = useState(new Set());
    const [expanded, setExpanded] = useState(new Set());
    const [dragOver, setDragOver] = useState(false);
    const [busy, setBusy]         = useState(false);
    const [error, setError]       = useState(null);
    const [result, setResult]     = useState(null);
    const [showHelp, setShowHelp] = useState(false);

    const processFile = async (file) => {
        if (!file) return;
        setBusy(true);
        setError(null);
        setFileName(file.name);
        try {
            const text = await file.text();
            const parsedFile = parseVehicleImportText(text, file.name);
            if (parsedFile.fileError) { setError(parsedFile.fileError); return; }
            if (parsedFile.rows.length === 0) { setError('No vehicle rows found in this file.'); return; }

            const built = buildImportPlan(parsedFile.rows, { vehicles, manufacturers, tags });
            setParsed(parsedFile);
            setPlan(built);
            setSelected(new Set(
                built.rows.flatMap((r, i) => (r.action === 'create' || r.action === 'update') ? [i] : [])
            ));
            setExpanded(new Set());
            setStep('review');
        } catch (e) {
            setError(e.message || 'Could not read that file.');
        } finally {
            setBusy(false);
        }
    };

    const toggleRow = (i) => setSelected(prev => {
        const next = new Set(prev);
        next.has(i) ? next.delete(i) : next.add(i);
        return next;
    });

    const toggleExpanded = (i) => setExpanded(prev => {
        const next = new Set(prev);
        next.has(i) ? next.delete(i) : next.add(i);
        return next;
    });

    const selectablePlanRows = plan
        ? plan.rows.flatMap((r, i) => (r.action === 'create' || r.action === 'update') ? [i] : [])
        : [];
    const allSelected = selectablePlanRows.length > 0 && selectablePlanRows.every(i => selected.has(i));

    const applyPlan = useMemo(
        () => (plan ? selectPlanRows(plan, selected) : null),
        [plan, selected],
    );

    const handleApply = async () => {
        if (!applyPlan) return;
        setBusy(true);
        setError(null);
        try {
            const res = await importVehicles(applyPlan);
            setResult(res);
            setStep('done');
        } catch (e) {
            setError(e.message || 'Import failed.');
        } finally {
            setBusy(false);
        }
    };

    const summary = applyPlan?.summary;
    const canApply = !!summary && (summary.creates + summary.updates) > 0;

    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div
                className="modal-panel rounded-xl p-5"
                style={{ maxWidth: '900px', width: '96vw', maxHeight: '90vh', overflowY: 'auto' }}
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between mb-4">
                    <h3 className="section-title mb-0">Bulk Import Vehicles</h3>
                    <button onClick={onClose} className="text-faint hover:text-secondary text-xl leading-none" aria-label="Close">×</button>
                </div>

                {error && (
                    <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">⚠️ {error}</div>
                )}

                {step === 'upload' && (
                    <>
                        <div
                            onDrop={e => { e.preventDefault(); setDragOver(false); processFile(e.dataTransfer.files[0]); }}
                            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                            onDragLeave={() => setDragOver(false)}
                            className={`border-2 border-dashed rounded-lg p-10 text-center ${dragOver ? 'border-indigo-400 bg-indigo-50/40' : 'border-[var(--color-border)]'}`}
                        >
                            <p className="text-body text-muted mb-3">
                                {busy ? 'Reading file…' : 'Drop a CSV or JSON file here, or'}
                            </p>
                            <label className="btn btn-secondary text-sm cursor-pointer">
                                Choose file
                                <input
                                    type="file"
                                    accept=".csv,.json,.txt,text/csv,application/json"
                                    className="hidden"
                                    onChange={e => { processFile(e.target.files[0]); e.target.value = ''; }}
                                />
                            </label>
                            <p className="text-hint mt-3">Parsed in your browser — nothing is uploaded until you confirm.</p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 mt-4">
                            <span className="text-label">Templates:</span>
                            <button
                                className="btn btn-secondary text-sm"
                                onClick={() => downloadText('evbench-vehicles-template.csv', buildCsvTemplate(), 'text/csv')}
                            >
                                CSV
                            </button>
                            <button
                                className="btn btn-secondary text-sm"
                                onClick={() => downloadText('evbench-vehicles-template.json', buildJsonTemplate(), 'application/json')}
                            >
                                JSON
                            </button>
                            <button className="btn btn-secondary text-sm ml-auto" onClick={() => setShowHelp(v => !v)}>
                                {showHelp ? 'Hide' : 'What can the file contain?'}
                            </button>
                        </div>

                        {showHelp && (
                            <div className="notice-info mt-3 text-body">
                                <p className="mb-2">
                                    One row (or JSON object) per vehicle or trim. Column names are matched loosely —
                                    use the field key, the qualified path, or the label shown in Compare Specs.
                                </p>
                                <ul className="import-detail-list">
                                    <li><span className="font-mono">name</span> — required; the display name, also used to match an existing vehicle</li>
                                    <li><span className="font-mono">manufacturer</span> / <span className="font-mono">make</span>, <span className="font-mono">model</span>, <span className="font-mono">trim</span>, <span className="font-mono">year</span>, <span className="font-mono">battery</span>, <span className="font-mono">range</span></li>
                                    <li><span className="font-mono">tags</span> — comma-separated; missing tags are created</li>
                                    <li><span className="font-mono">inherits_from</span> — another vehicle's name or id (may be a row in this same file)</li>
                                    <li><span className="font-mono">powertrain.horsepower_hp</span> — any spec as <span className="font-mono">category.field</span>, or just <span className="font-mono">horsepower_hp</span></li>
                                    <li><span className="font-mono">powertrain._custom.gear_ratio</span> — free-form custom fields</li>
                                    <li>JSON may also nest specs under <span className="font-mono">specs: {'{'} category: {'{'} field: value {'}}'}</span></li>
                                </ul>
                                <p className="mt-2 text-hint">
                                    Values already set on a vehicle are never overwritten — an import only fills blanks.
                                </p>
                            </div>
                        )}
                    </>
                )}

                {step === 'review' && plan && (
                    <>
                        <p className="text-body text-muted mb-2">
                            <span className="font-medium">{fileName}</span> · {parsed.format.toUpperCase()} ·{' '}
                            {plan.summary.total} row(s)
                        </p>

                        <div className="import-summary-row">
                            <span className="import-badge-create">{summary.creates} to create</span>
                            <span className="import-badge-update">{summary.updates} to fill in</span>
                            {plan.summary.skips > 0 && <span className="import-badge-skip">{plan.summary.skips} already complete</span>}
                            {plan.summary.errors > 0 && <span className="import-badge-error">{plan.summary.errors} with errors</span>}
                        </div>

                        {(summary.newManufacturers.length > 0 || summary.newTags.length > 0) && (
                            <p className="text-hint mt-2">
                                Will also create
                                {summary.newManufacturers.length > 0 && <> brand(s): <span className="font-medium">{summary.newManufacturers.join(', ')}</span></>}
                                {summary.newManufacturers.length > 0 && summary.newTags.length > 0 && ' and'}
                                {summary.newTags.length > 0 && <> tag(s): <span className="font-medium">{summary.newTags.join(', ')}</span></>}
                            </p>
                        )}

                        {parsed.columnIssues.length > 0 && (
                            <ul className="mt-2 text-caption text-amber-600 dark:text-amber-400 list-disc pl-5">
                                {parsed.columnIssues.map((issue, i) => (
                                    <li key={i}>
                                        {issue.kind === 'ambiguous'
                                            ? `Column "${issue.header}" is ambiguous (${issue.candidates.join(', ')}) — ignored. Qualify it as category.field.`
                                            : `Column "${issue.header}" matched no known field — ignored.`}
                                    </li>
                                ))}
                            </ul>
                        )}

                        <div className="import-table-container mt-3">
                            <table className="w-full text-caption">
                                <thead className="bg-[var(--color-surface-muted)] sticky top-0">
                                    <tr className="text-left text-muted">
                                        <th className="p-2 w-8">
                                            <input
                                                type="checkbox"
                                                checked={allSelected}
                                                onChange={() => setSelected(allSelected ? new Set() : new Set(selectablePlanRows))}
                                                title="Select all / none"
                                            />
                                        </th>
                                        <th className="p-2">Vehicle</th>
                                        <th className="p-2">Action</th>
                                        <th className="p-2">Matched by</th>
                                        <th className="p-2">Fills</th>
                                        <th className="p-2 w-8"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {plan.rows.map((row, i) => {
                                        const selectable = row.action === 'create' || row.action === 'update';
                                        const isSelected = selected.has(i);
                                        const style = ACTION_STYLES[row.action];
                                        const fills = Object.keys(row.coreWrites).length + row.specWrites.length;
                                        return (
                                            <Fragment key={i}>
                                                <tr className={selectable && isSelected ? '' : 'opacity-50'}>
                                                    <td className="p-2">
                                                        <input
                                                            type="checkbox"
                                                            checked={isSelected}
                                                            disabled={!selectable}
                                                            onChange={() => toggleRow(i)}
                                                        />
                                                    </td>
                                                    <td className="p-2">{row.label}</td>
                                                    <td className="p-2"><span className={style.className}>{style.label}</span></td>
                                                    <td className="p-2 text-muted">{row.matchedBy ?? '—'}</td>
                                                    <td className="p-2 font-mono">
                                                        {fills || '—'}
                                                        {row.tagNames.length > 0 && <span className="text-muted"> +{row.tagNames.length} tag</span>}
                                                    </td>
                                                    <td className="p-2">
                                                        <button
                                                            onClick={() => toggleExpanded(i)}
                                                            className="text-faint hover:text-secondary"
                                                            title="Show details"
                                                        >
                                                            {expanded.has(i) ? '▾' : '▸'}
                                                        </button>
                                                    </td>
                                                </tr>
                                                {expanded.has(i) && (
                                                    <tr>
                                                        <td colSpan={6} className="p-0"><RowDetail row={row} /></td>
                                                    </tr>
                                                )}
                                            </Fragment>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        <div className="flex items-center gap-2 mt-4">
                            <span className="text-hint flex-1">
                                {summary.fieldWrites > 0
                                    ? 'Only blank fields are filled — existing values stay as they are.'
                                    : 'Nothing selected to write.'}
                            </span>
                            <button onClick={() => { setStep('upload'); setPlan(null); setError(null); }} className="btn btn-secondary text-sm" disabled={busy}>
                                Back
                            </button>
                            <button onClick={handleApply} className="btn btn-primary text-sm" disabled={busy || !canApply}>
                                {busy ? 'Importing…' : `Import ${summary.creates + summary.updates} vehicle(s)`}
                            </button>
                        </div>
                    </>
                )}

                {step === 'done' && result && (
                    <div className="py-4 text-center">
                        <p className="text-2xl mb-2">✓</p>
                        <p className="text-body">
                            {result.created} vehicle(s) created · {result.updated} updated.
                        </p>
                        {result.failures.length > 0 && (
                            <ul className="mt-3 text-caption text-red-600 dark:text-red-400 list-disc pl-5 text-left">
                                {result.failures.map((f, i) => <li key={i}>{f.label}: {f.message}</li>)}
                            </ul>
                        )}
                        <div className="flex justify-center gap-2 mt-4">
                            <button
                                onClick={() => { setStep('upload'); setPlan(null); setResult(null); setFileName(''); }}
                                className="btn btn-secondary text-sm"
                            >
                                Import another file
                            </button>
                            <button onClick={onClose} className="btn btn-primary text-sm">Done</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

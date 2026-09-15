/**
 * Admin → Published Results: import many results at once (#327).
 *
 * Paste blocks each opened by `## vehicle | source | link | trim`, or load a CSV
 * or JSON file. Every row is planned before anything is written — its vehicle,
 * source, rollout basis, figures, and whether the same result is already in —
 * and each of those can be corrected on the row. See utils/publishedResultsBatch.js.
 */
import { useMemo, useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { vehicleLabel } from '../../utils/specHelpers';
import { summaryFieldLabel } from '../../utils/performanceSummaryFields';
import { ROLLOUT_BASES } from '../../utils/sources';
import {
    readBatch, planRow, rowWrite, BATCH_EXAMPLE, buildResultsCsvTemplate, buildResultsJsonTemplate,
} from '../../utils/publishedResultsBatch';
import { downloadText } from '../../utils/downloadText';

const BASIS_FROM = {
    chosen:   'chosen here',
    footnote: 'from the block’s footnote',
    source:   'the source’s default',
    default:  'no footnote: rollout assumed',
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A row's figures, briefly: "0–60 (1ft) 4 s · ¼ mile 12.4 s · 1 speed window". */
function figuresText(row) {
    const parts = Object.entries(row.fields)
        .filter(([key]) => key !== 'notes')
        .map(([key, value]) => {
            const f = summaryFieldLabel(key);
            return `${f.label} ${value}${f.unit ? ` ${f.unit}` : ''}`;
        });
    if (row.intervals.length) parts.push(plural(row.intervals.length, 'speed window'));
    return parts.join(' · ');
}

export default function ResultsBatchImport({ sources, sourcesAvailable, existing, onImported }) {
    const { vehicles, importPublishedResults, ensureSourceId } = useAppContext();
    const [input, setInput]       = useState('');
    const [fileName, setFileName] = useState('');
    const [chosen, setChosen]     = useState({});   // line → { vehicleId, sourceId, basis, action }
    const [busy, setBusy]         = useState(false);
    const [result, setResult]     = useState(null);

    const batch = useMemo(() => readBatch(input, fileName), [input, fileName]);
    const rows = useMemo(
        () => batch.items.map(item => planRow(item, { vehicles, sources, existing, chosen: chosen[item.line] ?? {} })),
        [batch, vehicles, sources, existing, chosen],
    );
    const vehicleOptions = useMemo(
        () => [...vehicles].sort((a, b) => vehicleLabel(a).localeCompare(vehicleLabel(b))),
        [vehicles],
    );

    const count = (action) => rows.filter(r => r.action === action).length;
    const toWrite = rows.filter(r => r.action === 'create' || r.action === 'update');

    // New text is a new batch: choices made against the old lines no longer
    // point at the same rows.
    const replaceInput = (text, name = '') => {
        setInput(text);
        setFileName(name);
        setChosen({});
        setResult(null);
    };
    const choose = (line, patch) => setChosen(prev => ({ ...prev, [line]: { ...prev[line], ...patch } }));

    const readFile = async (file) => {
        if (file) replaceInput(await file.text(), file.name);
    };

    const importRows = async () => {
        setBusy(true);
        setResult(null);
        try {
            // One new source per name, however many rows name it.
            const newIds = new Map();
            const newNames = [...new Set(toWrite.filter(r => !r.source && r.newSourceName).map(r => r.newSourceName))];
            for (const name of newNames) newIds.set(name.toLowerCase(), await ensureSourceId({ newName: name }));

            const outcome = await importPublishedResults(toWrite.map(r => ({
                line: r.line,
                updateId: r.action === 'update' ? r.duplicate.id : null,
                write: rowWrite(
                    r,
                    r.source?.id ?? newIds.get(r.newSourceName?.toLowerCase()) ?? null,
                    { replacing: r.action === 'update' },
                ),
            })));
            setResult(outcome);
            // Imported rows now plan as duplicates, so they read as skipped
            // rather than inviting a second import.
            setChosen({});
            onImported(newNames.length > 0);
        } catch (e) {
            setResult({ created: 0, updated: 0, failures: [{ line: null, message: e.message }] });
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="card p-4">
            <h3 className="section-title mb-1">Import published results</h3>
            <p className="text-note mb-3">
                Paste results from any number of vehicles and sources, each opened by a header
                line — <span className="font-mono">## vehicle | source | link | trim</span> — or load a
                CSV or JSON file. Each row shows what it matched before anything is written. A result
                already imported from the same source and link is skipped unless you choose to
                update it.
            </p>

            <div className="flex flex-wrap items-center gap-2 mb-2">
                <label className="btn btn-secondary text-sm">
                    Load CSV or JSON
                    <input type="file" accept=".csv,.json,text/csv,application/json" hidden onChange={e => readFile(e.target.files?.[0])} />
                </label>
                <button type="button" className="btn btn-secondary text-sm" onClick={() => downloadText('evbench-results-template.csv', buildResultsCsvTemplate(), 'text/csv')}>
                    CSV template
                </button>
                <button type="button" className="btn btn-secondary text-sm" onClick={() => downloadText('evbench-results-template.json', buildResultsJsonTemplate(), 'application/json')}>
                    JSON template
                </button>
                {fileName && <span className="text-meta">{fileName}</span>}
            </div>

            <textarea
                className="form-input w-full font-mono"
                rows={10}
                value={input}
                placeholder={BATCH_EXAMPLE}
                onChange={e => replaceInput(e.target.value)}
            />

            {batch.issues.map((issue, i) => <p key={i} className="text-note mt-1">{issue}</p>)}
            {!sourcesAvailable && (
                <p className="text-note mt-1">Importing needs the source list, which arrives with migration 068.</p>
            )}

            {rows.length > 0 && (
                <>
                    <p className="text-meta mt-3 mb-1">
                        {plural(rows.length, 'result')} read · {count('create')} to create · {count('update')} to
                        update · {count('skip')} skipped · {count('blocked')} blocked
                    </p>
                    <div className="import-table-container">
                        <table className="w-full text-meta">
                            <thead>
                                <tr className="text-left text-secondary">
                                    <th className="p-2">Line</th>
                                    <th className="p-2">Vehicle</th>
                                    <th className="p-2">Source</th>
                                    <th className="p-2">Rollout basis</th>
                                    <th className="p-2">Figures</th>
                                    <th className="p-2">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {rows.map(row => (
                                    <tr key={row.line} className={`import-row align-top ${row.action === 'skip' || row.action === 'blocked' ? 'opacity-50' : ''}`}>
                                        <td className="p-2 font-mono">{row.line}</td>
                                        <td className="p-2">
                                            <select
                                                className="form-input w-full"
                                                value={row.vehicle?.id ?? ''}
                                                onChange={e => choose(row.line, { vehicleId: e.target.value ? Number(e.target.value) : null })}
                                            >
                                                <option value="">— choose —</option>
                                                {vehicleOptions.map(v => <option key={v.id} value={v.id}>{vehicleLabel(v)}</option>)}
                                            </select>
                                            {row.vehicleText && <span className="block">as written: {row.vehicleText}</span>}
                                            {!row.vehicle && row.problems[0] && <span className="block import-note-warn">{row.problems[0]}</span>}
                                        </td>
                                        <td className="p-2">
                                            <select
                                                className="form-input w-full"
                                                value={row.source ? String(row.source.id) : ''}
                                                onChange={e => choose(row.line, { sourceId: e.target.value ? Number(e.target.value) : null })}
                                            >
                                                <option value="">{row.newSourceName ? `New: ${row.newSourceName}` : '— none —'}</option>
                                                {sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                            </select>
                                            {row.sourceBy && !['name', 'chosen'].includes(row.sourceBy) && (
                                                <span className="block">
                                                    by {row.sourceBy}{row.sourceText ? ` (“${row.sourceText}”)` : ''}
                                                </span>
                                            )}
                                        </td>
                                        <td className="p-2">
                                            {row.rollout ? (
                                                <>
                                                    <select
                                                        className="form-input"
                                                        value={row.rollout.basis}
                                                        onChange={e => choose(row.line, { basis: e.target.value })}
                                                    >
                                                        {ROLLOUT_BASES.map(b => <option key={b.key} value={b.key} title={b.note}>{b.label}</option>)}
                                                    </select>
                                                    <span className="block">{BASIS_FROM[row.rollout.from]}</span>
                                                    {row.footnote && <span className="block font-mono truncate" title={row.footnote}>“{row.footnote}”</span>}
                                                </>
                                            ) : '—'}
                                        </td>
                                        <td className="p-2">
                                            <span className="text-secondary">{figuresText(row) || '—'}</span>
                                            {row.unmatched.length > 0 && (
                                                <span className="block" title={row.unmatched.join('\n')}>
                                                    {plural(row.unmatched.length, 'line')} not recognized
                                                </span>
                                            )}
                                            {/* The parser's "no rollout footnote" warning points at a
                                                basis picker below; here the picker is on this row and
                                                already says the basis was assumed. */}
                                            {row.warnings.filter(w => !/^No rollout footnote/.test(w.message)).map((w, i) => (
                                                <span key={i} className={`block ${w.level === 'error' ? 'import-note-warn' : 'import-note-info'}`}>{w.message}</span>
                                            ))}
                                        </td>
                                        <td className="p-2">
                                            {row.action === 'blocked' ? (
                                                <span className="import-note-warn">{row.problems.join(' ')}</span>
                                            ) : (
                                                <>
                                                    <select
                                                        className="form-input"
                                                        value={row.action}
                                                        onChange={e => choose(row.line, { action: e.target.value })}
                                                    >
                                                        {row.duplicate
                                                            ? <option value="update">Update existing</option>
                                                            : <option value="create">Create</option>}
                                                        <option value="skip">Skip</option>
                                                    </select>
                                                    {row.duplicate && <span className="block">Already imported from this source and link.</span>}
                                                </>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="flex items-center gap-2 mt-3">
                        <span className="text-note flex-1">
                            {toWrite.length ? `${plural(toWrite.length, 'result')} will be written.` : 'Nothing selected to write.'}
                        </span>
                        <button
                            type="button"
                            className="btn btn-primary text-sm"
                            disabled={busy || !toWrite.length || !sourcesAvailable}
                            onClick={importRows}
                        >
                            {busy ? 'Importing…' : `Import ${plural(toWrite.length, 'result')}`}
                        </button>
                    </div>
                </>
            )}

            {result && (
                <div className={`note-panel ${result.failures.length ? 'is-danger' : 'is-info'} mt-3`}>
                    Created {result.created}, updated {result.updated}.
                    {result.failures.map((f, i) => (
                        <span key={i} className="block">{f.line != null ? `Line ${f.line}: ` : ''}{f.message}</span>
                    ))}
                </div>
            )}
        </div>
    );
}

import { useState, useEffect, useRef } from 'react';
import { useAppContext } from '../../context/AppContext';
import { parseFeGuide } from '../../utils/parseFeGuide';
import { PLAUSIBILITY_MESSAGES } from '../../utils/feGuidePlausibility';

/**
 * Admin card: bulk-import an EPA Fuel Economy Guide export (#206, phase 2).
 *
 * The guide is the published-label side of the EPA picture, and the source of
 * `label_range_published` — which the A1 audit found set on 7 of 87 linked test
 * groups, and without which the `computed >= labeled` gate cannot run.
 *
 * This stages rows only. Nothing is written to `epa_test_groups` here: no key
 * joins the two automatically (the guide's smog test group matches 1 of our 87,
 * and is not unique per configuration), so attaching a guide row to a group is a
 * separate curator step. Most staged rows will never be linked, and that is the
 * point — a vehicle added next month finds its label already here.
 *
 * Parsing happens in the browser before anything is sent, so the file's problems
 * are reported against the file rather than as database errors.
 */
export default function FeGuideImport() {
    const { importFeGuide, getFeGuideSummary } = useAppContext();

    const [parsing, setParsing]   = useState(false);
    const [importing, setImporting] = useState(false);
    const [parsed, setParsed]     = useState(null);   // { rows, skipped, warnings, missingColumns, fileName }
    const [result, setResult]     = useState(null);
    const [error, setError]       = useState(null);
    const [summary, setSummary]   = useState(null);
    const [dragging, setDragging] = useState(false);
    const inputRef = useRef(null);

    useEffect(() => {
        let cancelled = false;
        getFeGuideSummary()
            .then(s => { if (!cancelled) setSummary(s); })
            .catch(() => { /* summary is informational; its absence is not an error */ });
        return () => { cancelled = true; };
    }, [getFeGuideSummary, result]);

    async function handleFile(file) {
        if (!file) return;
        setError(null);
        setResult(null);
        setParsed(null);
        setParsing(true);
        try {
            const text = await file.text();
            const out = parseFeGuide(text);
            setParsed({ ...out, fileName: file.name });
            if (out.missingColumns.length) {
                setError(
                    `This file is missing ${out.missingColumns.length} required column(s), so nothing was read. ` +
                    `Is it a Fuel Economy Guide export?`,
                );
            } else if (!out.rows.length) {
                setError('No electric-vehicle rows found. The guide covers every fuel; only EVs are imported.');
            }
        } catch (e) {
            setError('Could not read the file: ' + e.message);
        } finally {
            setParsing(false);
        }
    }

    async function handleImport() {
        if (!parsed?.rows?.length) return;
        setImporting(true);
        setError(null);
        try {
            setResult(await importFeGuide(parsed.rows, parsed.fileName));
        } catch (e) {
            setError(e.message);
        } finally {
            setImporting(false);
        }
    }

    const onDrop = (e) => {
        e.preventDefault();
        setDragging(false);
        handleFile(e.dataTransfer.files?.[0]);
    };

    return (
        <div className="card">
            <h3 className="text-lg font-semibold mb-1">Fuel Economy Guide import</h3>
            <p className="text-sm text-secondary mb-4">
                EPA publishes one guide per model year. Staged here as published-label
                candidates; attaching one to a test group is a separate step.
            </p>

            <div
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                onClick={() => inputRef.current?.click()}
                className={`fe-dropzone ${dragging ? 'fe-dropzone-active' : ''}`}
            >
                <input
                    ref={inputRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={e => handleFile(e.target.files?.[0])}
                />
                <span className="text-sm text-secondary">
                    {parsing ? 'Reading…' : 'Drop a guide CSV here, or click to choose'}
                </span>
                <span className="text-xs text-meta">Exported from the EPA Fuel Economy Guide</span>
            </div>

            {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

            {parsed?.missingColumns?.length > 0 && (
                <ul className="mt-2 text-xs text-red-500 list-disc pl-5">
                    {parsed.missingColumns.map(c => <li key={c}>{c}</li>)}
                </ul>
            )}

            {/* Survivable absences. Named because the alternative is discovering
                a column of nulls weeks later. */}
            {parsed?.warnings?.length > 0 && (
                <div className="mt-3">
                    <p className="text-xs font-medium" style={{ color: 'var(--color-warning)' }}>
                        {parsed.warnings.length} column(s) not found — those values will be empty:
                    </p>
                    <ul className="text-xs text-secondary list-disc pl-5 mt-1">
                        {parsed.warnings.map(w => <li key={w}>{w}</li>)}
                    </ul>
                </div>
            )}

            {/* Rows that WILL import but whose published figures look wrong.
                Named rather than counted, and never dropped: these are EPA's
                own records, so the curator needs to know which one to distrust
                before linking it, not discover a 26-mile highway range later
                through a derivation that quietly used it. */}
            {parsed?.flagged?.length > 0 && (
                <div className="mt-3">
                    <p className="text-xs font-medium" style={{ color: 'var(--color-warning)' }}>
                        {parsed.flagged.length} row(s) import with implausible figures:
                    </p>
                    <ul className="text-xs text-secondary list-disc pl-5 mt-1">
                        {parsed.flagged.map(f => (
                            <li key={`${f.modelYear}|${f.division}|${f.carline}`}>
                                {f.modelYear} {f.division} {f.carline}
                                {f.flags.map(code => (
                                    <span key={code} className="block text-meta">
                                        {PLAUSIBILITY_MESSAGES[code] ?? code}
                                    </span>
                                ))}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {parsed?.rows?.length > 0 && !result && (
                <div className="mt-4">
                    <div className="fe-stat-row">
                        <Stat label="Configurations" value={parsed.rows.length} strong />
                        <Stat label="Non-EV rows skipped" value={parsed.skipped.nonEv} />
                        {/* Every config appears twice, once per unit. Shown because a
                            count matching the config count is the sign it parsed right. */}
                        <Stat label="Duplicate-unit rows" value={parsed.skipped.duplicateUnit} />
                        {parsed.skipped.unusable > 0 && (
                            <Stat label="Unusable" value={parsed.skipped.unusable} />
                        )}
                        {parsed.flagged?.length > 0 && (
                            <Stat label="Flagged" value={parsed.flagged.length} />
                        )}
                    </div>
                    <button
                        onClick={handleImport}
                        disabled={importing}
                        className="btn btn-primary mt-3 disabled:opacity-60"
                    >
                        {importing ? 'Importing…' : `Import ${parsed.rows.length} configurations`}
                    </button>
                </div>
            )}

            {result && (
                <div className="fe-stat-row mt-4">
                    <Stat label="New" value={result.imported} strong />
                    <Stat label="Updated" value={result.updated} />
                    {result.failed > 0 && <Stat label="Failed" value={result.failed} />}
                </div>
            )}
            {result?.errors?.length > 0 && (
                <ul className="mt-2 text-xs text-red-500 list-disc pl-5">
                    {result.errors.map(e => <li key={e}>{e}</li>)}
                </ul>
            )}

            {summary?.length > 0 && (
                <div className="mt-5 pt-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
                    <p className="text-xs font-medium text-secondary mb-2">Already staged</p>
                    <table className="fe-summary-table">
                        <thead>
                            <tr><th>Model year</th><th>Configurations</th><th>Makes</th></tr>
                        </thead>
                        <tbody>
                            {summary.map(y => (
                                <tr key={y.modelYear}>
                                    <td>{y.modelYear}</td>
                                    <td className="font-mono">{y.rows}</td>
                                    <td className="font-mono">{y.divisions}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

function Stat({ label, value, strong }) {
    return (
        <span className="fe-stat">
            <span className={`fe-stat-value ${strong ? 'fe-stat-value-strong' : ''}`}>{value}</span>
            <span className="text-xs text-secondary">{label}</span>
        </span>
    );
}

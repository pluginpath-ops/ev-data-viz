/**
 * Paste a published test-result block and import it as one published result.
 *
 * Entering a block by hand is a dozen fields typed off one page. Pasting it is
 * one action — but the parse is shown in full before anything is written,
 * because a silently-wrong figure here is worse than a slow one: it looks
 * identical to a figure someone checked.
 *
 * The rollout basis is the reason this is a modal and not a paste-into-the-form
 * shortcut. The two 0–60 conventions differ by about 0.3 s, they are not
 * interchangeable, and outlets have changed which one they print. So the block's
 * own footnote sets the default and a human confirms it before the write.
 */
import { useState, useMemo } from 'react';
import { parsePublishedResults, buildSummaryPayload, describeInterval } from '../utils/parsePublishedResults';
import { summaryFieldLabel } from '../utils/performanceSummaryFields';

const PLACEHOLDER = `60 mph: 3.9 sec
100 mph: 9.1 sec
1/4-Mile: 12.3 sec @ 115 mph
Results above omit 1-ft rollout of 0.3 sec.
Rolling Start, 5-60 mph: 4.1 sec
Top Gear, 30-50 mph: 1.5 sec
Top Speed (gov ltd): 127 mph
Braking, 70-0 mph: 174 ft
Roadholding, 300-ft Skidpad: 0.88 g`;

export default function PastePublishedResultsModal({ vehicle, onImport, onClose }) {
    const [text, setText]             = useState('');
    const [sourceName, setSourceName] = useState('');
    const [trimLabel, setTrimLabel]   = useState('');
    const [sourceUrl, setSourceUrl]   = useState('');
    const [basis, setBasis]           = useState(null);   // null = follow the footnote
    const [busy, setBusy]             = useState(false);
    const [error, setError]           = useState(null);

    const parsed = useMemo(
        () => (text.trim() ? parsePublishedResults(text) : null),
        [text],
    );

    // What the footnote's verb applies to is the TIME TAKEN TO ROLL THE FIRST
    // FOOT, not the rollout as a feature of the test. So:
    //   "omits 1-ft rollout of 0.3 sec"    → that 0.3 s is NOT in the printed
    //                                        number → it's the quicker
    //                                        drag-strip figure → 'rollout'
    //   "includes 1-ft rollout of 0.3 sec" → the clock ran through that first
    //                                        foot → standing start → 'none'
    // Read the other way round this silently files every figure in the wrong
    // column, which is the whole reason this screen exists.
    const footnoteBasis = parsed?.rollout?.stated === 'omit' ? 'rollout'
        : parsed?.rollout?.stated === 'include' ? 'none'
        : null;
    // Falls back to the rollout convention, which is what published road-test
    // figures now use — the footnote still wins when the block has one.
    const effectiveBasis = basis ?? footnoteBasis ?? 'rollout';

    const payload = useMemo(
        () => (parsed ? buildSummaryPayload(parsed, { rolloutBasis: effectiveBasis }) : null),
        [parsed, effectiveBasis],
    );

    const errors = parsed?.warnings.filter(w => w.level === 'error') ?? [];
    const warns  = parsed?.warnings.filter(w => w.level === 'warn')  ?? [];
    const hasAnything = payload && (Object.keys(payload.fields).length > 0 || payload.intervals.length > 0);

    // The rollout allowance the block itself quotes, used only to show what the
    // other reading would imply. Never written — a computed figure in a column
    // is indistinguishable from a reported one afterwards.
    const allowance = parsed?.rollout?.seconds ?? 0.3;
    const printedSixty = parsed?.accelWindows.find(w => w.unit === 'mph' && w.toSpeed === 60)?.seconds ?? null;

    const handleImport = async () => {
        if (!payload) return;
        setBusy(true);
        setError(null);
        try {
            await onImport({
                fields: {
                    ...payload.fields,
                    vehicle_id: vehicle.id,
                    source_name: sourceName.trim() || null,
                    trim_label: trimLabel.trim() || null,
                    source_url: sourceUrl.trim() || null,
                },
                intervals: payload.intervals,
            });
            onClose();
        } catch (e) {
            setError(e?.message || 'Import failed.');
            setBusy(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="modal-panel rounded-xl p-5 max-w-2xl w-full max-h-[85vh] overflow-y-auto">
                <h3 className="section-title mb-1">Paste published results</h3>
                <p className="text-xs text-secondary mb-3">
                    For <span className="font-semibold">{vehicle?.name}</span>. Paste a result
                    block from a road test — one figure per line. Nothing is saved until you
                    confirm what was read.
                </p>

                <textarea
                    value={text}
                    onChange={e => setText(e.target.value)}
                    placeholder={PLACEHOLDER}
                    rows={9}
                    autoFocus
                    className="form-input w-full font-mono"
                />

                {parsed && (
                    <div className="mt-3 border rounded-lg p-3 border-[var(--color-border)]">
                        <div className="font-semibold text-sm mb-2">
                            {parsed.matched} line{parsed.matched === 1 ? '' : 's'} read
                            {parsed.unmatched.length > 0 && (
                                <span className="text-meta font-normal ml-2 text-xs">
                                    {parsed.unmatched.length} ignored
                                </span>
                            )}
                        </div>

                        {hasAnything ? (
                            <>
                                {Object.keys(payload.fields).filter(k => k !== 'notes').length > 0 && (
                                    <table className="w-full text-xs mb-2">
                                        <tbody>
                                            {Object.entries(payload.fields)
                                                .filter(([k]) => k !== 'notes')
                                                .map(([key, value]) => {
                                                    const fld = summaryFieldLabel(key);
                                                    const isRolloutField = key === 'zero_to_60_rollout_sec' || key === 'zero_to_60_sec';
                                                    return (
                                                        <tr key={key} className="border-b border-[var(--color-border)] last:border-0">
                                                            <td className="py-0.5 pr-2 text-secondary">
                                                                {fld.label}
                                                                {isRolloutField && (
                                                                    <span className="text-meta ml-1 text-[10px]">
                                                                        ← rollout basis
                                                                    </span>
                                                                )}
                                                            </td>
                                                            <td className="py-0.5 text-right font-mono">
                                                                {value} <span className="text-meta">{fld.unit}</span>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                        </tbody>
                                    </table>
                                )}

                                {payload.intervals.length > 0 && (
                                    <>
                                        <div className="text-meta text-[10px] uppercase tracking-wide mb-1 font-semibold">
                                            Speed windows
                                        </div>
                                        <table className="w-full text-xs mb-2">
                                            <tbody>
                                                {payload.intervals.map((row, i) => {
                                                    const d = describeInterval(row);
                                                    return (
                                                        <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                                                            <td className="py-0.5 pr-2 text-secondary">{d.window}</td>
                                                            <td className="py-0.5 pr-2 capitalize text-meta">{d.kind}</td>
                                                            <td className="py-0.5 text-right font-mono">{d.value}</td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </>
                                )}
                            </>
                        ) : (
                            <p className="text-xs text-secondary">Nothing usable found yet.</p>
                        )}

                        {parsed.unmatched.length > 0 && (
                            <details className="mt-1">
                                <summary className="text-[11px] text-meta cursor-pointer hover:text-secondary">
                                    {parsed.unmatched.length} line{parsed.unmatched.length === 1 ? '' : 's'} not
                                    recognised (won’t be imported)
                                </summary>
                                <ul className="mt-1 text-[11px] text-meta font-mono list-none">
                                    {parsed.unmatched.map((l, i) => <li key={i} className="truncate">{l}</li>)}
                                </ul>
                            </details>
                        )}

                        {errors.length > 0 && (
                            <ul className="mt-2 text-[11px] text-red-600 dark:text-red-400 list-disc list-inside">
                                {errors.map((w, i) => <li key={i}>{w.message}</li>)}
                            </ul>
                        )}
                        {warns.length > 0 && (
                            <ul className="mt-2 text-[11px] text-amber-600 dark:text-amber-400 list-disc list-inside">
                                {warns.map((w, i) => <li key={i}>{w.message}</li>)}
                            </ul>
                        )}
                    </div>
                )}

                {/* ── Rollout basis ───────────────────────────────────────────
                    Shown whenever there is a 0–60 to place. Both readings are
                    spelled out with the actual numbers, because "omit"/"include"
                    in a footnote is exactly the wording people read backwards. */}
                {printedSixty != null && (
                    <div className="mt-3 border rounded-lg p-3 border-[var(--color-border)]">
                        <div className="text-xs font-semibold mb-1">
                            Rollout basis — check before importing
                        </div>
                        {parsed.rollout?.raw ? (
                            <p className="text-[11px] text-secondary mb-2">
                                This block says: <span className="font-mono">“{parsed.rollout.raw}”</span>
                            </p>
                        ) : (
                            <p className="text-[11px] text-amber-600 dark:text-amber-400 mb-2">
                                No footnote in this block. Defaulted to the rollout convention, which
                                is what published road-test figures now use — check the source’s own
                                wording.
                            </p>
                        )}

                        {[
                            {
                                key: 'rollout',
                                title: `${printedSixty} s omits the time to roll the first foot`,
                                detail: `Drag-strip convention. Saved to “0–60 (1ft)”. Implies a standing start of about ${(printedSixty + allowance).toFixed(1)} s.`,
                            },
                            {
                                key: 'none',
                                title: `${printedSixty} s includes the time to roll the first foot`,
                                detail: `Standing start, clock from 0 mph. Saved to “0–60 mph”. Implies a rollout time of about ${(printedSixty - allowance).toFixed(1)} s.`,
                            },
                        ].map(opt => (
                            <label key={opt.key} className="flex items-start gap-2 text-xs py-1 cursor-pointer">
                                <input
                                    type="radio" name="rollout-basis" className="mt-0.5"
                                    checked={effectiveBasis === opt.key}
                                    onChange={() => setBasis(opt.key)}
                                />
                                <span>
                                    <span className="font-medium">{opt.title}</span>
                                    {footnoteBasis === opt.key && (
                                        <span className="text-meta ml-1 text-[10px]">(this block’s footnote)</span>
                                    )}
                                    <span className="block text-meta text-[11px]">{opt.detail}</span>
                                </span>
                            </label>
                        ))}
                        <p className="text-[10px] text-meta mt-1">
                            Only the figure the source printed is saved. The implied one is shown to
                            make the choice concrete — it isn’t written, since a computed number in
                            that column couldn’t later be told apart from a reported one.
                        </p>
                    </div>
                )}

                {/* ── Attribution ─────────────────────────────────────────── */}
                <div className="flex flex-wrap items-end gap-3 mt-3">
                    <label className="text-xs">
                        <span className="text-secondary block mb-0.5">Source</span>
                        <input
                            type="text" value={sourceName}
                            onChange={e => setSourceName(e.target.value)}
                            placeholder="e.g. Car and Driver"
                            className="form-input w-44"
                        />
                    </label>
                    <label className="text-xs">
                        <span className="text-secondary block mb-0.5">Trim / config</span>
                        <input
                            type="text" value={trimLabel}
                            onChange={e => setTrimLabel(e.target.value)}
                            placeholder="e.g. Dual Standard LFP"
                            className="form-input w-44"
                        />
                    </label>
                    <label className="text-xs flex-1 min-w-[12rem]">
                        <span className="text-secondary block mb-0.5">Source link</span>
                        <input
                            type="url" value={sourceUrl}
                            onChange={e => setSourceUrl(e.target.value)}
                            placeholder="https://…"
                            className="form-input w-full"
                        />
                    </label>
                </div>

                {error && <p className="text-xs text-red-500 mt-2">{error}</p>}

                <div className="flex gap-2 mt-4">
                    <button
                        type="button" onClick={handleImport}
                        disabled={busy || !hasAnything}
                        className="btn btn-primary text-sm py-1.5 px-4 disabled:opacity-40"
                        title={!hasAnything ? 'Paste a result block first' : undefined}
                    >
                        {busy ? 'Importing…' : 'Import result'}
                    </button>
                    <button
                        type="button" onClick={onClose} disabled={busy}
                        className="btn btn-secondary text-sm py-1.5 px-4"
                    >
                        Cancel
                    </button>
                </div>

                {errors.length > 0 && (
                    <p className="text-[11px] text-secondary mt-2">
                        The flagged figure will be imported as written — fix it on the result card
                        afterwards, or correct the paste above and re-read it.
                    </p>
                )}
            </div>
        </div>
    );
}

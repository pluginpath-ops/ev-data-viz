import { useMemo, useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { isCurrentSummary, CHARGE_SUMMARY_VERSION } from '../../utils/chargeWindows';
import { isInheritedRunId } from '../../utils/runUtils';

const REASONS = {
    'no time':  'have no time column — SoC and power only',
    'no power': 'have no power column',
};

/**
 * Admin → Data checks: charging summaries (#346).
 *
 * Every write of a session's points summarizes it, so this is a catch-up: for
 * sessions from before migration 071, and for every session when the
 * calculation's version is bumped. It also says which sessions can never be
 * summarized as they stand, which is curation work, not a bug.
 *
 * Runs in the browser, as the signed-in curator, under the same RLS as any
 * other run write.
 */
export default function ChargeSummaryMaintenance() {
    const { vehicles, backfillChargeSummaries } = useAppContext();
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState(null);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);

    const { stale, unsummarizable, total } = useMemo(() => {
        const sessions = (vehicles ?? []).flatMap(v => v.runs ?? [])
            .filter(r => r.kind === 'charging' && !isInheritedRunId(r.id));
        const reasons = {};
        for (const r of sessions) {
            const reason = isCurrentSummary(r.charge_summary) ? r.charge_summary.reason : null;
            if (reason) reasons[reason] = (reasons[reason] ?? 0) + 1;
        }
        return {
            total: sessions.length,
            stale: sessions.filter(r => !isCurrentSummary(r.charge_summary)).length,
            unsummarizable: reasons,
        };
    }, [vehicles]);

    async function run(all) {
        setRunning(true);
        setResult(null);
        setError(null);
        try {
            setResult(await backfillChargeSummaries({ all, onProgress: setProgress }));
        } catch (e) {
            setError(e.message);
        } finally {
            setRunning(false);
            setProgress(null);
        }
    }

    return (
        <div className="flex flex-col gap-2">
            <p className="text-note">
                Charging summaries — each session’s best 5, 10 and 15-minute average charge rate,
                which the vehicle table’s charging columns read.{' '}
                {stale
                    ? `${stale} of ${total} charging sessions have none, or one from before calculation version ${CHARGE_SUMMARY_VERSION}.`
                    : `All ${total} charging sessions are summarized (calculation version ${CHARGE_SUMMARY_VERSION}).`}
            </p>
            {Object.entries(unsummarizable).map(([reason, n]) => (
                <p key={reason} className="text-note">
                    {n} {n === 1 ? 'session' : 'sessions'} {REASONS[reason] ?? `cannot be summarized (${reason})`}.
                </p>
            ))}
            <div className="flex items-center gap-2">
                <button type="button" className="btn btn-secondary text-sm" onClick={() => run(false)} disabled={running || !stale}>
                    {running ? 'Summarizing…' : `Summarize ${stale || 'missing'}`}
                </button>
                <button type="button" className="btn btn-secondary text-sm" onClick={() => run(true)} disabled={running}>
                    Recompute all
                </button>
                {progress && <span className="text-meta">{progress.done} / {progress.total}</span>}
            </div>
            {result && (
                <p className="text-note">
                    Wrote {result.written} of {result.checked} charging sessions
                    {result.failed ? `; ${result.failed} failed — see the console` : ''}.
                </p>
            )}
            {error && <p className="note-panel is-danger">{error}</p>}
        </div>
    );
}

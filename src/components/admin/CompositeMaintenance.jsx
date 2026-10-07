import { useMemo, useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { mayHaveComposite, staleComposites, COMPOSITE_VERSION } from '../../utils/compositeCurve';
import { isCompositeRun } from '../../utils/runUtils';

/**
 * Admin → Data checks: composite curves (#313, migration 077).
 *
 * Every write to a charging test rebuilds its vehicle's composites, so this is
 * the catch-up: the first fill after migration 077, and every vehicle after
 * COMPOSITE_VERSION is bumped. It cannot say in advance how many composites
 * the rebuild will make — a charger class's split can rest on inference over
 * the points — so it counts vehicles that could have one.
 *
 * Runs in the browser, as the signed-in curator, under the same RLS as any
 * other run write.
 */
export default function CompositeMaintenance() {
    const { vehicles, rebuildAllComposites } = useAppContext();
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState(null);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);

    const { candidates, built, stale } = useMemo(() => {
        const list = vehicles ?? [];
        return {
            candidates: list.filter(mayHaveComposite).length,
            built: list.flatMap(v => (v.runs ?? []).filter(isCompositeRun)).length,
            stale: list.reduce((n, v) => n + staleComposites(v).length, 0),
        };
    }, [vehicles]);

    async function run(all) {
        setRunning(true);
        setResult(null);
        setError(null);
        try {
            setResult(await rebuildAllComposites({ all, onProgress: setProgress }));
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
                Composite curves — each vehicle’s charging tests averaged into one curve per charger class,
                which every chart takes as the vehicle’s default unless a test is marked default.{' '}
                {candidates} {candidates === 1 ? 'vehicle has' : 'vehicles have'} two or more charging tests;{' '}
                {built} composite {built === 1 ? 'curve is' : 'curves are'} stored
                {stale ? `, ${stale} out of date (a test changed, or built before method version ${COMPOSITE_VERSION})` : ''}.
            </p>
            <div className="flex items-center gap-2">
                <button type="button" className="btn btn-secondary text-sm" onClick={() => run(false)} disabled={running}
                    title="Vehicles with an out-of-date composite, or none stored yet">
                    {running ? 'Rebuilding…' : 'Rebuild what needs it'}
                </button>
                <button type="button" className="btn btn-secondary text-sm" onClick={() => run(true)} disabled={running}>
                    Rebuild all
                </button>
                {progress && <span className="text-meta">{progress.done} / {progress.total}</span>}
            </div>
            {result && (
                <p className="text-note">
                    Rebuilt {result.rebuilt} of {result.checked} vehicles
                    {result.failed ? `; ${result.failed} failed — see the console` : ''}.
                </p>
            )}
            {error && <p className="note-panel is-danger">{error}</p>}
        </div>
    );
}

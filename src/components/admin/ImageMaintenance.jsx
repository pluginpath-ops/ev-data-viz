import { useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { THUMB_MAX } from '../../utils/imageRenditions';

/**
 * Admin card: generate the card-sized rendition for vehicle images uploaded
 * before migration 051.
 *
 * A one-time catch-up, not a routine chore — every upload since has written both
 * renditions itself. It stays in the UI because it is idempotent (it only looks
 * at rows where image_thumb_url is null) and because a vehicle imported with a
 * bare image_url would otherwise have no way to get one.
 *
 * This runs in the browser rather than as a script so it uses the signed-in
 * admin's session and stays subject to the same RLS as every other write.
 */
export default function ImageMaintenance() {
    const { backfillVehicleThumbnails } = useAppContext();
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState(null);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);

    async function handleRun() {
        setRunning(true);
        setResult(null);
        setError(null);
        setProgress({ done: 0, total: 0, label: '' });
        try {
            const outcome = await backfillVehicleThumbnails((done, total, label) =>
                setProgress({ done, total, label }));
            setResult(outcome);
        } catch (e) {
            setError(e.message);
        } finally {
            setRunning(false);
            setProgress(null);
        }
    }

    return (
        <div className="card p-5">
            <h3 className="section-title">Vehicle image thumbnails</h3>
            <p className="text-sm text-secondary mt-0.5 mb-3">
                Vehicle images are stored twice: the full-resolution original, and a{' '}
                {THUMB_MAX.width}×{THUMB_MAX.height} rendition that is what the cards and lists
                actually display. Images uploaded before this split have only the original, so
                the grid falls back to sending the full file. Run this once to generate the
                missing thumbnails — originals are left untouched.
            </p>

            <button className="btn btn-secondary text-sm" onClick={handleRun} disabled={running}>
                {running ? 'Generating…' : '🖼 Generate missing thumbnails'}
            </button>

            {progress && progress.total > 0 && (
                <p className="text-sm text-secondary mt-3">
                    {progress.done} / {progress.total}
                    {progress.label ? ` — ${progress.label}` : ''}
                </p>
            )}

            {result && (
                <div className="text-sm mt-3">
                    <p className="text-secondary">
                        {result.updated === 0 && result.failures.length === 0
                            ? 'Nothing to do — every vehicle image already has a thumbnail.'
                            : `Generated ${result.updated} thumbnail${result.updated === 1 ? '' : 's'}.`}
                    </p>
                    {result.failures.length > 0 && (
                        <ul className="mt-2 space-y-0.5 text-red-700 dark:text-red-400">
                            {result.failures.map(f => (
                                <li key={f.id}>{f.name || `#${f.id}`}: {f.error}</li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            {error && (
                <p className="text-sm mt-3 text-red-700 dark:text-red-400">⚠️ {error}</p>
            )}
        </div>
    );
}

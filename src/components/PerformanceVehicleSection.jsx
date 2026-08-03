/**
 * Performance testing section — shown in the Tests & Data (RunsView) panel,
 * alongside the EPA section.
 *
 * Two independent layers, deliberately kept visually separate:
 *   • Test sessions — detail data imported from a GPS testing export, with
 *     every individual run and its conditions.
 *   • Published results — published figures from a source, often the ONLY data
 *     available for a car (a 0-60 and a video link, no CSV behind it). This is
 *     the normal case, not a degraded one.
 *
 * Measured values are derived from the sessions at read time and shown in their
 * own panel, so a measured number is never confused with a published claim.
 */
import { useState, useEffect, useRef } from 'react';
import { useAppContext } from '../context/AppContext';
import InfoIcon from './InfoIcon';
import TestedResults from './performance/TestedResults';
import PerformanceSessionCard from './performance/PerformanceSessionCard';
import PerformanceSummaryCard from './performance/PerformanceSummaryCard';
import PerformanceImportModal from './PerformanceImportModal';

const SECTION_HELP =
    'Independently-tested acceleration and braking results. Separate from the ' +
    'Performance specs on the vehicle record, which are manufacturer claims and ' +
    'published road-test figures rather than measurements taken here.';

export default function PerformanceVehicleSection({ vehicle, canEdit }) {
    const {
        getPerformanceSessions,
        getPerformanceSummaries,
        importPerformanceSession,
        savePerformanceSession,
        deletePerformanceSession,
        savePerformanceSummary,
        deletePerformanceSummary,
        savePerformanceInterval,
        deletePerformanceInterval,
    } = useAppContext();

    const [sessions, setSessions] = useState([]);
    // `loaded`, not `loading`: starting from "not yet loaded" means the empty
    // state can never flash before the first fetch has had a chance to run.
    const [loaded, setLoaded]     = useState(false);
    const [reloadToken, setReloadToken] = useState(0);
    const [showImport, setShowImport] = useState(false);
    const [addingResult, setAddingResult] = useState(false);
    const [newSource, setNewSource] = useState('');
    const [newTrim, setNewTrim]     = useState('');
    const [creating, setCreating]   = useState(false);

    // Summaries are fetched here rather than read off the vehicle record:
    // getVehicles() deliberately does NOT embed them, because a nested select
    // against a table that doesn't exist yet fails the whole vehicles query and
    // blanks the app (see the note in DataService.getVehicles).
    const [summaries, setSummaries] = useState([]);

    // AppContext rebuilds its value object every render, so every function it
    // hands out is a new identity each time. Depending on one directly would
    // re-fire this effect on every context render — refetching constantly and
    // flickering the panel. Read it through a ref so the effect depends only on
    // what actually changes: the vehicle, and an explicit reload.
    const fetchersRef = useRef(null);
    fetchersRef.current = { getPerformanceSessions, getPerformanceSummaries };

    useEffect(() => {
        if (!vehicle?.id) { setSessions([]); setSummaries([]); setLoaded(true); return; }
        // Guards against a slow response for a previous vehicle landing after a
        // faster one for the vehicle now on screen.
        let cancelled = false;
        setLoaded(false);
        (async () => {
            try {
                const [s, sum] = await Promise.all([
                    fetchersRef.current.getPerformanceSessions(vehicle.id),
                    fetchersRef.current.getPerformanceSummaries(vehicle.id),
                ]);
                if (!cancelled) { setSessions(s); setSummaries(sum); }
            } finally {
                if (!cancelled) setLoaded(true);
            }
        })();
        return () => { cancelled = true; };
    }, [vehicle?.id, reloadToken]);

    /** Re-run the fetch effect. Every mutation below routes through this, since
     *  this component owns the sessions and summaries lists. */
    const reload = () => setReloadToken(t => t + 1);

    const handleImport = async (vehicleId, parsed, meta) => {
        await importPerformanceSession(vehicleId, parsed, meta);
        reload();
    };

    const handleSaveSession = async (row) => {
        await savePerformanceSession(row);
        reload();
    };

    const handleDeleteSession = async (id) => {
        await deletePerformanceSession(id);
        reload();
    };

    const handleAddResult = async () => {
        setCreating(true);
        try {
            await savePerformanceSummary({
                vehicle_id: vehicle.id,
                source_name: newSource.trim() || null,
                trim_label: newTrim.trim() || null,
            });
            setNewSource('');
            setNewTrim('');
            setAddingResult(false);
            reload();
        } finally {
            setCreating(false);
        }
    };

    /** Commit a card's buffered edits in one write. */
    const saveSummaryFields = async (id, fields) => {
        await savePerformanceSummary({ id, ...fields });
        reload();
    };

    const handleDeleteSummary = async (id) => {
        await deletePerformanceSummary(id);
        reload();
    };

    const handleSaveInterval = async (row) => {
        await savePerformanceInterval(row);
        reload();
    };

    const handleDeleteInterval = async (id) => {
        await deletePerformanceInterval(id);
        reload();
    };

    return (
        <div className="mt-6">
            <div className="flex items-center justify-between gap-2 mb-3">
                <h3 className="section-title">
                    Performance Testing
                    <InfoIcon text={SECTION_HELP} position="right" className="ml-1" />
                </h3>
            </div>

            <TestedResults sessions={sessions} summaries={summaries} />

            {/* ── Test sessions ─────────────────────────────────────────── */}
            <div className="text-faint text-[10px] uppercase tracking-wide mb-1 font-semibold">
                Test sessions
            </div>
            {!loaded ? (
                <p className="text-sm text-muted mb-2">Loading…</p>
            ) : sessions.length === 0 ? (
                <p className="text-sm text-muted mb-2">
                    No testing sessions yet.
                    {canEdit && ' Import a GPS testing export below, or just add a reported result.'}
                </p>
            ) : (
                sessions.map(s => (
                    <PerformanceSessionCard
                        key={s.id}
                        session={s}
                        canEdit={canEdit}
                        onDelete={handleDeleteSession}
                        onSave={handleSaveSession}
                    />
                ))
            )}

            {canEdit && (
                <button
                    type="button"
                    onClick={() => setShowImport(true)}
                    className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                    📄 Import testing CSV
                </button>
            )}

            {/* ── Published results ──────────────────────────────────────── */}
            <div className="text-faint text-[10px] uppercase tracking-wide mt-4 mb-1 font-semibold">
                Published results
            </div>
            {summaries.length === 0 ? (
                <p className="text-sm text-muted mb-2">
                    No published figures recorded. Add one for any source that tested this car without sharing full data.
                </p>
            ) : (
                summaries.map(s => (
                    <PerformanceSummaryCard
                        key={s.id}
                        summary={s}
                        canEdit={canEdit}
                        onSaveFields={saveSummaryFields}
                        onDelete={handleDeleteSummary}
                        onSaveInterval={handleSaveInterval}
                        onDeleteInterval={handleDeleteInterval}
                    />
                ))
            )}

            {canEdit && !addingResult && (
                <button
                    type="button"
                    onClick={() => setAddingResult(true)}
                    className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                    + Add reported result
                </button>
            )}

            {canEdit && addingResult && (
                <div className="border rounded-lg p-3 border-[var(--color-border)]">
                    <div className="flex flex-wrap items-end gap-2">
                        <label className="text-xs">
                            <span className="text-muted block mb-0.5">Source</span>
                            <input
                                type="text" autoFocus value={newSource}
                                onChange={e => setNewSource(e.target.value)}
                                placeholder="e.g. Out of Spec"
                                className="form-input text-xs py-1 w-44"
                            />
                        </label>
                        <label className="text-xs">
                            <span className="text-muted block mb-0.5">Trim / config</span>
                            <input
                                type="text" value={newTrim}
                                onChange={e => setNewTrim(e.target.value)}
                                placeholder="e.g. Dual Standard LFP"
                                className="form-input text-xs py-1 w-48"
                            />
                        </label>
                    </div>
                    <p className="text-[10px] text-faint mt-1">
                        Creates an empty result — fill in whichever figures the source actually
                        reports. Several sources can report the same car.
                    </p>
                    <div className="flex gap-2 mt-2">
                        <button type="button" onClick={handleAddResult} disabled={creating}
                            className="btn btn-primary text-xs py-1 px-3 disabled:opacity-50">
                            {creating ? 'Adding…' : 'Add'}
                        </button>
                        <button type="button" onClick={() => setAddingResult(false)} disabled={creating}
                            className="btn btn-secondary text-xs py-1 px-3">
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {showImport && (
                <PerformanceImportModal
                    vehicle={vehicle}
                    onImport={handleImport}
                    onClose={() => setShowImport(false)}
                />
            )}
        </div>
    );
}

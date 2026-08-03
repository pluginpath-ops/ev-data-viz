/**
 * Performance testing section — shown in the Tests & Data (RunsView) panel,
 * alongside the EPA section.
 *
 * Two independent layers, deliberately kept visually separate:
 *   • Test sessions — detail data imported from a GPS testing export, with
 *     every individual run and its conditions.
 *   • Reported results — published figures from a source, often the ONLY data
 *     available for a car (a 0-60 and a video link, no CSV behind it). This is
 *     the normal case, not a degraded one.
 *
 * Measured values are derived from the sessions at read time and shown in their
 * own panel, so a measured number is never confused with a published claim.
 */
import { useState, useEffect, useCallback } from 'react';
import { useAppContext } from '../context/AppContext';
import InfoIcon from './InfoIcon';
import MeasuredValues from './performance/MeasuredValues';
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
        importPerformanceSession,
        deletePerformanceSession,
        savePerformanceSummary,
        deletePerformanceSummary,
        savePerformanceInterval,
        deletePerformanceInterval,
    } = useAppContext();

    const [sessions, setSessions] = useState([]);
    const [loading, setLoading]   = useState(false);
    const [showImport, setShowImport] = useState(false);
    const [addingResult, setAddingResult] = useState(false);
    const [newSource, setNewSource] = useState('');
    const [newTrim, setNewTrim]     = useState('');
    const [creating, setCreating]   = useState(false);

    // Summaries ride along on the vehicle record (they feed the comparison
    // charts); sessions are fetched per vehicle since they're only needed here.
    const summaries = vehicle?.performance_summaries ?? [];

    const loadSessions = useCallback(async () => {
        if (!vehicle?.id) return;
        setLoading(true);
        try {
            setSessions(await getPerformanceSessions(vehicle.id));
        } finally {
            setLoading(false);
        }
    }, [vehicle?.id, getPerformanceSessions]);

    useEffect(() => { loadSessions(); }, [loadSessions]);

    const handleImport = async (vehicleId, parsed, meta) => {
        await importPerformanceSession(vehicleId, parsed, meta);
        await loadSessions();
    };

    const handleDeleteSession = async (id) => {
        await deletePerformanceSession(id);
        await loadSessions();
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
        } finally {
            setCreating(false);
        }
    };

    const saveSummaryField = (id, field, value) =>
        savePerformanceSummary({ id, [field]: value });

    return (
        <div className="mt-6">
            <div className="flex items-center justify-between gap-2 mb-3">
                <h3 className="section-title">
                    Performance Testing
                    <InfoIcon text={SECTION_HELP} position="right" className="ml-1" />
                </h3>
            </div>

            <MeasuredValues vehicle={vehicle} sessions={sessions} summaries={summaries} />

            {/* ── Test sessions ─────────────────────────────────────────── */}
            <div className="text-faint text-[10px] uppercase tracking-wide mb-1 font-semibold">
                Test sessions
            </div>
            {loading && sessions.length === 0 ? (
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

            {/* ── Reported results ──────────────────────────────────────── */}
            <div className="text-faint text-[10px] uppercase tracking-wide mt-4 mb-1 font-semibold">
                Reported results
            </div>
            {summaries.length === 0 ? (
                <p className="text-sm text-muted mb-2">
                    No published figures recorded.
                </p>
            ) : (
                summaries.map(s => (
                    <PerformanceSummaryCard
                        key={s.id}
                        summary={s}
                        canEdit={canEdit}
                        onSaveField={saveSummaryField}
                        onDelete={deletePerformanceSummary}
                        onSaveInterval={savePerformanceInterval}
                        onDeleteInterval={deletePerformanceInterval}
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

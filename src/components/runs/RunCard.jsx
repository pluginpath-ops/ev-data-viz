import SessionControl from '../SessionControl';
import RunSpecRows from '../RunSpecRows';
import { RunVoteButtons } from '../VoteButtons';
import RunSourceLinks from '../RunSourceLinks';
import { RunKindPill, FIELD_META, inferRunFlags } from './runDisplay';
import { filterChargingRuns, defaultChargingRun } from '../../utils/runUtils';

/**
 * One test, as it is read rather than edited (#235, re-skin phase 8 step 1).
 *
 * Lifted out of `RunsView` unchanged. That file is 3,158 lines with no run-card
 * component in it, which is the reason the re-skin's plan makes this its own
 * commit: restyling a card you cannot point at means editing markup 28 levels
 * deep inside three nested maps and hoping the diff says what you meant.
 *
 * Nothing here is redesigned. Every class, every handler and every condition is
 * the one that was there — the point of this step is that the NEXT one has
 * somewhere to happen.
 *
 * ── About the prop list ─────────────────────────────────────────────────────
 *
 * It is long, and deliberately not tidied. Twenty-odd props is what the card
 * was actually reading out of its enclosing scope, and collapsing them into
 * grouped objects here would hide the measurement rather than report it: this
 * is the seam, and its width is the finding. Narrowing it is a design decision
 * and belongs in the restyle, not in a refactor that is meant to change
 * nothing.
 */

/**
 * Curator's default charging test for a range test (migration 045).
 *
 * A chart-session pairing lives only in the URL, so it is reproducible only by
 * whoever holds the link. This is the published answer: what a visitor arriving
 * without one sees. Leaving it on Auto keeps the vehicle-wide default, which is
 * the right choice for most range tests — this exists for the range test that
 * needs a different curve than its siblings.
 */
function PairedChargingControl({ run, vehicle, onSet }) {
    const chargingRuns = filterChargingRuns(vehicle.runs);
    if (chargingRuns.length === 0) return null;

    const auto = defaultChargingRun(vehicle);
    const isCurated = run.paired_charging_run_id != null;

    return (
        <div className="flex items-center gap-2 text-sm mt-1">
            <span className="text-label shrink-0">Charging pair:</span>
            <select
                value={run.paired_charging_run_id ?? ''}
                onChange={e => onSet(e.target.value || null)}
                className="form-input form-input"
            >
                <option value="">Auto{auto ? ` — ${auto.name}` : ''}</option>
                {chargingRuns.map(r => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                ))}
            </select>
            {isCurated && (
                <span className="text-xs text-indigo-500" title="Published pairing — everyone sees this, not just someone with a shared link">
                    curated
                </span>
            )}
        </div>
    );
}

export default function RunCard({
    run, votes, isPending,
    vehicle, vehicles, units, socRange, testSessions, copyTargetVehicles,
    calcKwhByRun,
    canEdit, canCreate, isContributor,
    openMenuRunId, setOpenMenuRunId, exportingRunId, duplicatingRunId,
    toggleRunVote, setRunsSession, createTestSession, updateTestSession,
    deleteTestSession, setPairedChargingRun, clearDefaultRun, onSetDefaultRun,
    handleEditRun, restoreItem, queueDelete, handleExportCsv, handleDuplicateRun,
    setCopyToRun, setCopyingToVehicleId, handleUpdateData, onUpdateRun,
    handleCheckKwh,
}) {
    return (
        <div className="run-card-header">
            <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                    <RunKindPill run={run} />
                    <h3 className="section-title">
                        {run.name}
                        {run.isHidden && (
                            <span
                                title="Hidden from regular viewers — only admins/contributors can see this test"
                                className="ml-1 badge-hidden"
                            >
                                Hidden
                            </span>
                        )}
                        <RunSourceLinks run={run} className="text-sm font-normal" />
                    </h3>
                    {/* The session heading already carries the
                        date for a grouped run; repeating it puts
                        the same fact on screen twice. */}
                    {run.date && run.session_id == null && (
                        <span className="text-sm text-meta">{run.date}</span>
                    )}
                    <RunVoteButtons
                        vouch={votes.vouch}
                        flag={votes.flag}
                        myVote={votes.myVote}
                        onVote={(voteType) => toggleRunVote(run.id, voteType)}
                    />
                </div>
                <div className="run-meta">
                    <RunSpecRows
                        run={run}
                        units={units}
                        socRange={socRange}
                        fieldMeta={FIELD_META}
                        calcKwhByRun={calcKwhByRun}
                        onCheckKwh={handleCheckKwh}
                    />
                    {canEdit(vehicle) && (
                        <SessionControl
                            run={run}
                            vehicle={vehicle}
                            vehicles={vehicles}
                            sessions={testSessions}
                            onAssign={sessionId => setRunsSession([run.id], sessionId)}
                            onCreate={createTestSession}
                            onUpdate={updateTestSession}
                            onDelete={deleteTestSession}
                        />
                    )}
                    {(inferRunFlags(run).includes('range') || run.distance_miles != null) && canEdit(vehicle) && (
                        <PairedChargingControl
                            run={run}
                            vehicle={vehicle}
                            onSet={chargingId => setPairedChargingRun(vehicle.id, run.id, chargingId)}
                        />
                    )}
                </div>
            </div>
            <div className="run-actions">
                <div className="run-actions-row">
                    {/* Set Default — ghost text, green on hover, pale blue + × when active */}
                    <button
                        onClick={() => run.isDefault ? clearDefaultRun(vehicle.id, run.id) : onSetDefaultRun(run.id)}
                        title={!canCreate ? 'Sign in to save changes' : run.isDefault ? 'Click to clear default' : 'Set as default for charts'}
                        className={`btn btn-toggle${run.isDefault ? ' active' : ''}`
                            + (!canCreate ? ' opacity-50 cursor-not-allowed' : '')}
                    >
                        {run.isDefault
                            ? <>Default <span className="btn-toggle-clear">×</span></>
                            : 'Set Default'}
                    </button>
                    {canEdit(vehicle) && (
                        <button onClick={() => handleEditRun(run)} className="btn btn-edit text-sm">Edit</button>
                    )}
                    <button
                        onClick={() => isPending ? restoreItem(run.id) : queueDelete(run.id)}
                        title={!canCreate && !isPending ? 'Sign in to save changes' : undefined}
                        className={`btn text-sm ${isPending ? 'btn-restore' : 'btn-danger'}${!canCreate && !isPending ? ' opacity-50 cursor-not-allowed' : ''}`}
                    >
                        {isPending ? '↩ Restore' : 'Delete'}
                    </button>
                    {/* More ▾ overflow menu */}
                    <div className="relative">
                        <button
                            onClick={() => setOpenMenuRunId(openMenuRunId === run.id ? null : run.id)}
                            className="btn btn-primary text-sm"
                        >More ▾</button>
                        {openMenuRunId === run.id && (
                            <>
                                <div className="fixed inset-0 z-10" onClick={() => setOpenMenuRunId(null)} />
                                <div className="dropdown-menu w-52 z-20">
                                    <button
                                        onClick={() => { handleExportCsv(run); setOpenMenuRunId(null); }}
                                        disabled={exportingRunId === run.id}
                                        className="dropdown-item w-full text-left disabled:opacity-50"
                                    >
                                        {exportingRunId === run.id ? '↓ Exporting…' : '↓ Download CSV'}
                                    </button>
                                    {canEdit(vehicle) && (
                                        <button
                                            onClick={() => { handleDuplicateRun(run); setOpenMenuRunId(null); }}
                                            disabled={duplicatingRunId !== null}
                                            className="dropdown-item w-full text-left disabled:opacity-50"
                                        >
                                            {duplicatingRunId === run.id ? '⧉ Copying…' : '⧉ Copy'}
                                        </button>
                                    )}
                                    {canEdit(vehicle) && copyTargetVehicles.length > 0 && (
                                        <button
                                            onClick={() => { setCopyToRun(run); setCopyingToVehicleId(''); setOpenMenuRunId(null); }}
                                            className="dropdown-item w-full text-left"
                                        >
                                            ↪ Copy to…
                                        </button>
                                    )}
                                    {canEdit(vehicle) && (
                                        <button
                                            onClick={() => { handleUpdateData(run); setOpenMenuRunId(null); }}
                                            className="dropdown-item w-full text-left"
                                        >
                                            ↑ Upload additional data
                                        </button>
                                    )}
                                    {isContributor && (
                                        <button
                                            onClick={() => { onUpdateRun(run.id, { isHidden: !run.isHidden }); setOpenMenuRunId(null); }}
                                            title={run.isHidden ? 'Make this test visible to all viewers' : 'Hide this test from regular viewers'}
                                            className="dropdown-item w-full text-left"
                                        >
                                            {run.isHidden ? '◎ Unhide from viewers' : '⊘ Hide from viewers'}
                                        </button>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                </div>
                {/* Color picker — lower right */}
                <div className="run-actions-row">
                    <label className="flex items-center gap-1 text-xs text-meta cursor-pointer">
                        <input
                            type="color"
                            value={run.color || '#3b82f6'}
                            onChange={e => onUpdateRun(run.id, { color: e.target.value })}
                            className="w-7 h-5 border-0 rounded cursor-pointer shrink-0"
                            title="Change plot color"
                        />
                        <input
                            type="text"
                            value={run.color || '#3b82f6'}
                            onChange={e => onUpdateRun(run.id, { color: e.target.value })}
                            onBlur={e => { if (!/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) onUpdateRun(run.id, { color: run.color || '#3b82f6' }); }}
                            className="form-input w-20 .5 font-mono text-secondary"
                            placeholder="#3b82f6"
                            maxLength={7}
                        />
                    </label>
                </div>
            </div>
        </div>
    );
}

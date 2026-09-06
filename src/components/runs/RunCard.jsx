import SessionControl from '../SessionControl';
import RunSpecRows from '../RunSpecRows';
import { RunVoteButtons } from '../VoteButtons';
import RunSourceLinks from '../RunSourceLinks';
import { RunKindPill, FIELD_META, inferRunFlags } from './runDisplay';
import { filterChargingRuns, defaultChargingRun, runKindFrom } from '../../utils/runUtils';

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
 *
 * ── Treatment A, the bordered footer (handoff 7b) ───────────────────────────
 *
 * It sat in the run's meta block, inline with the measured figures, wearing a
 * bare `Charging pair:` label and a form select — so a curator's editorial
 * choice looked exactly like a reading off the dynamometer. It is a footer
 * under the bands now, OUTSIDE the grid, so it cannot be mistaken for measured
 * data.
 *
 * Orange because it is the same "this is the live pairing" signal the chart
 * already uses for its Y2 axis, and this is the one control on the card that
 * changes what another screen plots.
 *
 * The handoff offered two louder and quieter alternatives — a slot in the
 * identity line, and a fourth band on an accented rail. The identity line
 * costs header room and crowds the vote and action controls at narrower
 * widths; the fourth band puts an editorial control in the grid this change
 * exists to keep it out of.
 */
function PairedChargingControl({ run, vehicle, onSet }) {
    const chargingRuns = filterChargingRuns(vehicle.runs);
    if (chargingRuns.length === 0) return null;

    const auto = defaultChargingRun(vehicle);
    const isCurated = run.paired_charging_run_id != null;

    return (
        <div className={`run-pair${isCurated ? ' is-curated' : ''}`}>
            <span className="run-pair-label">Charging pair</span>
            <select
                value={run.paired_charging_run_id ?? ''}
                onChange={e => onSet(e.target.value || null)}
                aria-label="Charging test paired with this range test"
                className="form-input run-pair-select"
            >
                <option value="">Auto{auto ? ` — ${auto.name}` : ''}</option>
                {chargingRuns.map(r => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                ))}
            </select>
            {/* Auto is not a weaker version of a pairing, it is a different
                one: the vehicle-wide default, which moves when that default
                moves. Saying which is on is the point of the strip. */}
            <span className="run-pair-state">
                {isCurated
                    ? 'published for this test'
                    : 'follows the vehicle default'}
            </span>
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
    const kindLabel = runKindFrom(run) === 'range' ? 'range' : 'charging';
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
                </div>
                {/* Under the bands, not in them — see PairedChargingControl. */}
                {(inferRunFlags(run).includes('range') || run.distance_miles != null) && canEdit(vehicle) && (
                    <PairedChargingControl
                        run={run}
                        vehicle={vehicle}
                        onSet={chargingId => setPairedChargingRun(vehicle.id, run.id, chargingId)}
                    />
                )}
            </div>
            <div className="run-actions">
                <div className="run-actions-row">
                    {/* Says WHICH default. A vehicle carries one default
                        charging test AND one default range test — the service
                        has scoped them per kind since migration 046 — but the
                        button said a bare "Default", so setting one looked like
                        it must have unset the other. The star is the state; the
                        kind is the fact that was missing. */}
                    <button
                        onClick={() => run.isDefault ? clearDefaultRun(vehicle.id, run.id) : onSetDefaultRun(run.id)}
                        title={!canCreate
                            ? 'Sign in to save changes'
                            : run.isDefault
                                ? `Click to clear — this vehicle would then have no default ${kindLabel} test`
                                : `Set as this vehicle's default ${kindLabel} test for charts`}
                        className={`btn btn-toggle${run.isDefault ? ' active' : ''}`
                            + (!canCreate ? ' opacity-50 cursor-not-allowed' : '')}
                    >
                        {run.isDefault
                            ? <>★ Default {kindLabel} <span className="btn-toggle-clear">×</span></>
                            : '☆ Set default'}
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

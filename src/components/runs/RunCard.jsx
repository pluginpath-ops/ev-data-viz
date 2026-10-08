import SessionControl from '../SessionControl';
import RunSpecRows from '../RunSpecRows';
import { RunVoteButtons } from '../VoteButtons';
import RunSourceLinks from '../RunSourceLinks';
import RunListingBadges from './RunListingBadges';
import RunCurationToggle from './RunCurationToggle';
import { isUnlisted, isExcluded, hasQualityOverride } from '../../utils/runListing';
import { sessionFor } from '../../utils/testSessions';
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
    canEdit, isContributor,
    exportingRunId, duplicatingRunId,
    toggleRunVote, setRunsSession, createTestSession, updateTestSession,
    deleteTestSession, setPairedChargingRun, clearDefaultRun, onSetDefaultRun,
    handleEditRun, restoreItem, queueDelete, handleExportCsv, handleDuplicateRun,
    setCopyToRun, setCopyingToVehicleId, handleUpdateData, onUpdateRun,
    handleCheckKwh,
}) {
    const kindLabel = runKindFrom(run) === 'range' ? 'range' : 'charging';
    return (
        <div>
            {/* The identity line runs the card's full width, Edit and Delete
                at its right end, so the action column below starts level with
                the bands rather than with the title (.run-card-body). */}
            <div className="flex items-center gap-2 flex-wrap">
                <RunKindPill run={run} />
                <h3 className="section-title">
                    {run.name}
                    <RunSourceLinks run={run} className="text-sm font-normal" />
                </h3>
                <RunListingBadges run={run} session={sessionFor(testSessions, run)} withToggles={isContributor} />
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
                {/* Top right, on the title's line: the card's own verbs, apart
                    from the column of what it says about the test. Curators
                    only, like the column below — see .run-actions there. */}
                {canEdit(vehicle) && (
                    <div className="run-edit-actions ml-auto">
                        <button onClick={() => handleEditRun(run)} className="btn btn-edit text-sm">Edit</button>
                        <button
                            onClick={() => isPending ? restoreItem(run.id) : queueDelete(run.id)}
                            className={`btn text-sm ${isPending ? 'btn-restore' : 'btn-danger'}`}
                        >
                            {isPending ? '↩ Restore' : 'Delete'}
                        </button>
                    </div>
                )}
            </div>
            <div className="run-card-body">
                <div className="flex-1 min-w-0">
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
                {/* One column, two groups — where the test stands, and what can
                    be done with its data; Edit and Delete sit on the title's
                    line above. It was one row of four buttons with everything
                    else in a More menu, which left the column empty below the
                    row and the curator's decisions out of sight until opened.

                    Curators only, the whole column. It used to show to anyone,
                    signed out included, with Set default and Delete drawn
                    disabled — left over from a plan for viewers to hold their
                    own data, which is shelved. A viewer has nothing to do
                    here, and a disabled button reads as a broken one. */}
                {canEdit(vehicle) && (
                    <div className="run-actions">
                        <div className="run-curation-grid">
                            {/* Says WHICH default. A vehicle carries one default
                                charging test AND one default range test — the service
                                has scoped them per kind since migration 046 — but the
                                button said a bare "Default", so setting one looked like
                                it must have unset the other. The star is the state; the
                                kind is the fact that was missing. */}
                            <button
                                onClick={() => run.isDefault ? clearDefaultRun(vehicle.id, run.id) : onSetDefaultRun(run.id)}
                                title={run.isDefault
                                    ? `Click to clear — this vehicle would then have no default ${kindLabel} test`
                                    : `Set as this vehicle's default ${kindLabel} test for charts`}
                                className={`btn btn-toggle run-curation-toggle${run.isDefault ? ' active' : ''}`}
                            >
                                {run.isDefault
                                    ? <>★ Default {kindLabel} <span className="btn-toggle-clear">×</span></>
                                    : '☆ Set default'}
                            </button>
                            {/* Two questions, two toggles (#394): whether viewers see
                                it, and whether it counts. */}
                            {isContributor && (
                                <RunCurationToggle
                                    isSet={isUnlisted(run)}
                                    glyph="⊘" action="Unlist" state="Unlisted"
                                    onClick={() => onUpdateRun(run.id, { isHidden: !isUnlisted(run) })}
                                    title={isUnlisted(run)
                                        ? "Unlisted: kept out of viewers' lists and charts. It still counts in the statistics unless it is excluded. Click to list it."
                                        : "Keep this test out of viewers' lists and charts. It still counts in the statistics unless excluded."}
                                />
                            )}
                            {isContributor && (
                                <RunCurationToggle
                                    isSet={isExcluded(run)}
                                    glyph="⊖" action="Exclude" state="Excluded"
                                    onClick={() => onUpdateRun(run.id, { isExcluded: !isExcluded(run) })}
                                    title={isExcluded(run)
                                        ? 'Excluded: left out of the statistics — composite curves, test spreads and best charge windows. Click to include it.'
                                        : 'Leave this test out of the statistics: composite curves, test spreads and best charge windows'}
                                />
                            )}
                            {/* Range tests only: both checks it overrides are range
                                checks (runListing). */}
                            {isContributor && kindLabel === 'range' && (
                                <RunCurationToggle
                                    isSet={hasQualityOverride(run)}
                                    glyph="⚑" action="Override checks" state="Checks overridden"
                                    onClick={() => onUpdateRun(run.id, { qualityOverride: !hasQualityOverride(run) })}
                                    title={hasQualityOverride(run)
                                        ? 'Quality checks overridden: this test counts in the range spread although it saw only part of the pack, and in the pool without its speed or temperature. Missing data and exclusion still apply. Click to let the automatic checks decide again.'
                                        : 'Count this test in the range spread although it saw only part of the pack, and in the pool without its speed or temperature. Missing data and exclusion still apply.'}
                                />
                            )}
                        </div>
                        <div className="run-data-actions">
                            <button
                                onClick={() => handleExportCsv(run)}
                                disabled={exportingRunId === run.id}
                                title="Download this test's data points as CSV"
                                className="btn btn-toggle disabled:opacity-50"
                            >
                                {exportingRunId === run.id ? '↓ Exporting…' : '↓ CSV'}
                            </button>
                            <button
                                onClick={() => handleDuplicateRun(run)}
                                disabled={duplicatingRunId !== null}
                                title="Make a copy of this test on this vehicle"
                                className="btn btn-toggle disabled:opacity-50"
                            >
                                {duplicatingRunId === run.id ? '⧉ Copying…' : '⧉ Copy'}
                            </button>
                            {copyTargetVehicles.length > 0 && (
                                <button
                                    onClick={() => { setCopyToRun(run); setCopyingToVehicleId(''); }}
                                    title="Copy this test to another vehicle"
                                    className="btn btn-toggle"
                                >
                                    ↪ Copy to…
                                </button>
                            )}
                            <button
                                onClick={() => handleUpdateData(run)}
                                title="Upload additional data points to this test"
                                className="btn btn-toggle"
                            >
                                ↑ Upload
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

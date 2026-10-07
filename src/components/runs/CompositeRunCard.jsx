import InfoIcon from '../InfoIcon';
import { compositeExplainer, compositeNote, staleComposites } from '../../utils/compositeCurve';
import { isUnlisted } from '../../utils/runListing';
import RunListingBadges from './RunListingBadges';

/**
 * A vehicle's composite curve in Tests & Data (#313): the stored mean of its
 * charging tests (migration 077), shown among the tests so a curator can make
 * it the vehicle's default — or prefer the 400 V one — the way they would a
 * test.
 *
 * A card of its own rather than a RunCard branch, because almost nothing on a
 * test's card applies: no source, date, votes or session (it was not one
 * session), and no Edit, Delete, Copy or Upload — its points are computed,
 * and rebuilt whenever one of the tests behind it changes. What remains is
 * what it is, what it was drawn from, the default toggle, and hiding.
 */
export default function CompositeRunCard({
    run, vehicle, units, canEdit, canCreate, isContributor,
    clearDefaultRun, onSetDefaultRun, onUpdateRun, onRebuild,
}) {
    const note = compositeNote(run.composite, units);
    const stale = staleComposites(vehicle).some(r => r.id === run.id);
    // How many of the tests behind it are listed, and how many come from the
    // pool (#394) — the same "listed/unlisted" pair the vehicle card shows.
    const unlistedIds = new Set([...(vehicle.runs || []), ...(vehicle.pooledRuns || [])]
        .filter(isUnlisted).map(r => String(r.id)));
    const built = run.composite?.tests ?? [];
    const pooled = built.filter(t => unlistedIds.has(String(t.runId))).length;
    return (
        <div className="run-card-header">
            <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="section-title">
                        <span className="run-name-derived">{run.name}</span>
                        <InfoIcon className="run-source-info" title={run.name} text={compositeExplainer(run.composite, units)} />
                    </h3>
                    <RunListingBadges run={run} />
                    {stale && (
                        <span className="badge-status is-warning" title="One of the tests behind it has changed since it was built, or the method has. Rebuild to bring it up to date.">
                            out of date
                        </span>
                    )}
                </div>
                {built.length > 0 && (
                    <p className="run-meta text-meta"
                        title={pooled ? `${built.length - pooled} listed tests, and ${pooled} unlisted tests from the pool that still count` : undefined}>
                        Built from <span className="test-count-n">{built.length - pooled}</span>
                        {pooled > 0 && <span className="test-count-pool">/{pooled}</span>} {built.length === 1 ? 'test' : 'tests'}
                        {pooled > 0 && ' (listed/unlisted)'}
                    </p>
                )}
                {note && <p className="run-meta text-meta">{note}</p>}
            </div>
            <div className="run-actions">
                <div className="run-actions-row">
                    <button
                        onClick={() => run.isDefault ? clearDefaultRun(vehicle.id, run.id) : onSetDefaultRun(run.id)}
                        title={!canCreate
                            ? 'Sign in to save changes'
                            : run.isDefault
                                ? 'Click to clear — the vehicle then falls back to its own composite curve, else its newest test'
                                : "Set as this vehicle's default charging curve for charts"}
                        className={`btn btn-toggle${run.isDefault ? ' active' : ''}`
                            + (!canCreate ? ' opacity-50 cursor-not-allowed' : '')}
                    >
                        {run.isDefault
                            ? <>★ Default charging <span className="btn-toggle-clear">×</span></>
                            : '☆ Set default'}
                    </button>
                    {canEdit(vehicle) && (
                        <button onClick={() => onRebuild(vehicle.id)} className="btn text-sm"
                            title="Rebuild this vehicle's composite curves from its tests now. It happens on its own whenever a test changes.">
                            ↻ Rebuild
                        </button>
                    )}
                    {isContributor && (
                        <button
                            onClick={() => onUpdateRun(run.id, { isHidden: !isUnlisted(run) })}
                            title={isUnlisted(run) ? 'Show this composite to viewers in the lists and charts' : "Keep this composite out of viewers' lists and charts"}
                            className="btn text-sm"
                        >
                            {isUnlisted(run) ? '◎ List' : '⊘ Unlist'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

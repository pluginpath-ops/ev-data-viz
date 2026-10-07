import InfoIcon from '../InfoIcon';
import { compositeExplainer, compositeNote, staleComposites } from '../../utils/compositeCurve';

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
    return (
        <div className="run-card-header">
            <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="section-title">
                        <span className="run-name-derived">{run.name}</span>
                        {run.isHidden && (
                            <span title="Hidden from regular viewers — only admins/contributors can see it" className="ml-1 badge-hidden">
                                Hidden
                            </span>
                        )}
                        <InfoIcon className="run-source-info" title={run.name} text={compositeExplainer(run.composite, units)} />
                    </h3>
                    {stale && (
                        <span className="badge-status is-warning" title="One of the tests behind it has changed since it was built, or the method has. Rebuild to bring it up to date.">
                            out of date
                        </span>
                    )}
                </div>
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
                            onClick={() => onUpdateRun(run.id, { isHidden: !run.isHidden })}
                            title={run.isHidden ? 'Make this composite visible to all viewers' : 'Hide this composite from regular viewers'}
                            className="btn text-sm"
                        >
                            {run.isHidden ? '◎ Unhide' : '⊘ Hide'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

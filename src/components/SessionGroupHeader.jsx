import { sessionLabel, vehiclesInSession, runsInSession } from '../utils/testSessions';
import VehicleLink from './VehicleLink';

/**
 * The band above the runs of one session in a vehicle's Tests & Data list.
 *
 * A vehicle's runs used to be a flat pile in which nothing said that two of them
 * were the same outing — which is the whole reason sessions exist. Grouping puts
 * the charging half and the range half of one test event next to each other
 * under a heading that names it.
 *
 * It reports the runs from OTHER vehicles too. A four-car side-by-side is eight
 * runs of which this vehicle owns two, and the other six are the context that
 * makes the comparison trustworthy — invisible from this page otherwise.
 */
export default function SessionGroupHeader({
    session, vehicle, vehicles, runsHere, collapsed, onToggle, onEdit, onViewVehicle,
}) {
    // Ungrouped runs get a plain divider — a heading would imply they belong to
    // something, and "no session" is an absence, not a group.
    if (!session) {
        return (
            <div className="session-group-header is-unassigned">
                <button onClick={onToggle} className="session-group-toggle" title={collapsed ? 'Expand' : 'Collapse'}>
                    <span className={`session-group-chevron${collapsed ? '' : ' is-open'}`}>▶</span>
                    <span className="text-secondary">No session</span>
                </button>
                <span className="text-xs text-meta">
                    {runsHere} run{runsHere === 1 ? '' : 's'}
                </span>
            </div>
        );
    }

    const total = runsInSession(vehicles, session.id).length;
    const cars  = vehiclesInSession(vehicles, session.id);
    const others = cars.filter(v => String(v.id) !== String(vehicle.id));

    return (
        <div className="session-group-header">
            <button onClick={onToggle} className="session-group-toggle" title={collapsed ? 'Expand' : 'Collapse'}>
                <span className={`session-group-chevron${collapsed ? '' : ' is-open'}`}>▶</span>
                <span className="font-semibold">{sessionLabel(session)}</span>
            </button>

            <span className="text-xs text-secondary">
                {runsHere} here
                {total > runsHere && ` · ${total} in session`}
            </span>

            {/* The other cars are links: a side-by-side is only worth recording
                because the runs are comparable, and the natural next move on
                seeing "with R2" is to go and look at the R2's half. */}
            {others.length > 0 && (
                <span className="text-xs text-secondary">
                    with{' '}
                    {others.map((v, i) => (
                        <span key={v.id}>
                            {i > 0 && ', '}
                            <VehicleLink vehicle={v} onView={onViewVehicle} />
                        </span>
                    ))}
                </span>
            )}

            {session.location_name && <span className="text-xs text-meta">· {session.location_name}</span>}
            {session.temperature_f != null && <span className="text-xs text-meta">· {session.temperature_f}°F</span>}

            {session.url && (
                <a
                    href={session.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-500 hover:underline"
                    onClick={e => e.stopPropagation()}
                    title={session.url}
                >
                    source ↗
                </a>
            )}

            {onEdit && (
                <button onClick={onEdit} className="session-group-edit" title="Edit session">
                    ✎ Edit
                </button>
            )}
        </div>
    );
}

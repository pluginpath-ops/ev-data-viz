/**
 * One source in a vehicle's stack: the slim card above the vehicle,
 * saying only enough to recognise it — year and friendly name (model +
 * trim), battery and EPA range.
 * The full card is what the fanned-out stack shows.
 *
 * Rendered inside the stack's one trigger button, so it is phrasing content
 * (spans), not a control of its own.
 */
import LineageIcon from './LineageIcon';
import UnlistedNote from './UnlistedNote';
import { distanceValue, distanceUnit } from '../../utils/unitConversions';

export function RolodexCard({ vehicle, role, units, selected = false }) {
    const range = vehicle.epaRangeMi ? distanceValue(vehicle.epaRangeMi, units) : null;
    return (
        <span className={`rolodex-card${selected ? ' is-selected' : ''}`}>
            <LineageIcon role={role} />
            <span className="rolodex-card-swatch" style={{ backgroundColor: vehicle.color }} aria-hidden="true" />
            <span className="rolodex-card-name">
                {[vehicle.year, vehicle.name].filter(Boolean).join(' · ')}
            </span>
            <UnlistedNote vehicle={vehicle} />
            <span className="rolodex-card-figures">
                {vehicle.socWindowKwh != null && <>{vehicle.socWindowKwh}<span className="stat-cell-unit"> kWh</span></>}
                {vehicle.socWindowKwh != null && range != null && ' · '}
                {range != null && <>{range}<span className="stat-cell-unit"> {distanceUnit(units)}</span></>}
            </span>
        </span>
    );
}

/** A stretch of sources the filters removed, as one rolodex card. */
export function RolodexGap({ count }) {
    return (
        <span className="rolodex-card is-gap">
            <span aria-hidden="true">⋯</span>
            <span className="rolodex-card-name">{count} filtered out</span>
        </span>
    );
}

/** The sources past the cap, as one rolodex card. */
export function RolodexMore({ count }) {
    return (
        <span className="rolodex-card is-gap">
            <span aria-hidden="true">+</span>
            <span className="rolodex-card-name">{count} more up the lineage</span>
        </span>
    );
}

/**
 * Sources this reader is not shown because they are unlisted: named only as
 * "Unlisted record", never opened. The lineage carries on past them.
 */
export function RolodexUnlisted({ count }) {
    return (
        <span className="rolodex-card is-gap" title="Unlisted vehicles are not shown here">
            <span aria-hidden="true">⋯</span>
            <span className="rolodex-card-name">{count > 1 ? `${count} unlisted records` : 'Unlisted record'}</span>
        </span>
    );
}

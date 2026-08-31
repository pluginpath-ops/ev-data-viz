import { vehicleLabel } from '../utils/specHelpers';

/**
 * A vehicle's name, as a link to that vehicle's Tests & Data.
 *
 * Extracted from SessionGroupHeader (#275), which had the only copy. The
 * inherited-tests list names a source vehicle in exactly the same way and for
 * exactly the same reason — you are looking at a record that belongs somewhere
 * else, and the natural next move is to go and look at it there — so the two
 * should not be two different-looking pieces of text.
 *
 * ── Degrades to plain text ──────────────────────────────────────────────────
 *
 * Renders a span when there is nothing to navigate to: no handler, or a vehicle
 * that is not in the list this session loaded. A link that looks like a link and
 * does nothing is worse than a name, and an inherited run can outlive the
 * visibility of the vehicle it came from — the run row carries the source's name
 * whether or not the source itself is on hand.
 */
export default function VehicleLink({ vehicle, name, onView, className = '', title }) {
    // `name` wins when given, because how much of a name to show is the
    // CALLER's question and the two callers answer it differently. The session
    // band is an inline "with A, B, C" where the full label would swamp the
    // line; "Inherited from:" is a labelled field on its own line, and it has
    // always shown `vehicleLabel` — the disambiguated form that separates two
    // cars of the same model. Defaulting to the short form here quietly
    // demoted "2025-2026 R1S · Dual Max" to "R1S".
    const label = name ?? (vehicle ? (vehicle.model || vehicle.name) : null);

    if (!onView || !vehicle) {
        return <span className={className}>{label}</span>;
    }

    return (
        <button
            type="button"
            onClick={() => onView(vehicle)}
            className={`vehicle-link ${className}`.trim()}
            title={title ?? `View ${vehicleLabel(vehicle)} tests & data`}
        >
            {label}
        </button>
    );
}

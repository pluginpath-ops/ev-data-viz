/**
 * "Battery revision" beside a vehicle whose pack differs from its source's
 * (migration 086): the edge in a lineage where charging tests stop coming down.
 * Nothing for an origin, which has no source to differ from.
 */
export default function BatteryRevisionNote({ vehicle }) {
    if (!vehicle?.battery_revision || vehicle.spec_source_vehicle_id == null) return null;
    return (
        <span
            className="battery-revision-note"
            title="Its pack differs from its source's in chemistry or construction, so it takes no charging tests from above. Its own variants inherit from it."
        >
            Battery revision
        </span>
    );
}

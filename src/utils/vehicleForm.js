/**
 * The shape `EditVehicleForm` edits, in one place.
 *
 * It was written out six times — an empty literal and a from-vehicle literal in
 * each of VehiclesView and RunsView, plus two more resets — and the copies had
 * already drifted apart in how they spelled a missing value. Adding the vehicle
 * colour (#308) would have been a seventh and eighth edit, with the failure mode
 * that a form missing the field does not error: it sends `color: undefined`,
 * `updateVehicle` skips the key, and the write silently does nothing.
 *
 * `null` for colour rather than `''`: the column is nullable and null means "the
 * palette chooses", so the form's empty state and the database's are the same
 * value rather than two things that have to be mapped between.
 */
export const EMPTY_VEHICLE_FORM = {
    name: '', make: '', model: '', trim: '', year: '',
    battery: '', range: '', manufacturer_id: null, color: null,
};

/**
 * A vehicle in the form's shape. Text fields fall back to '' because they are
 * bound to controlled inputs, where undefined silently switches the input to
 * uncontrolled and React warns once, halfway through a typing session.
 */
export function vehicleFormFrom(vehicle) {
    return {
        name:   vehicle.name,
        make:   vehicle.make  || '',
        model:  vehicle.model || '',
        trim:   vehicle.trim  || '',
        year:   vehicle.year  || '',
        battery: vehicle.battery || '',
        range:   vehicle.range   || '',
        manufacturer_id: vehicle.manufacturer?.id ?? null,
        color:  vehicle.color ?? null,
    };
}

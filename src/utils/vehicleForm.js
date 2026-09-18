/**
 * The shape `EditVehicleForm` edits, in one place.
 *
 * It was written out six times — an empty literal and a from-vehicle literal in
 * each of VehiclesView and RunsView, plus two more resets — and the copies had
 * already drifted apart in how they spelled a missing value. Adding the vehicle
 * color (#308) would have been a seventh and eighth edit, with the failure mode
 * that a form missing the field does not error: it sends `color: undefined`,
 * `updateVehicle` skips the key, and the write silently does nothing.
 *
 * `null` for color rather than `''`: the column is nullable and null means "the
 * palette chooses", so the form's empty state and the database's are the same
 * value rather than two things that have to be mapped between. `image_focal_y`
 * is null for the same reason and reads the same way -- null means centered.
 */
export const EMPTY_VEHICLE_FORM = {
    name: '', make: '', model: '', trim: '', year: '',
    battery: '', range: '', manufacturer_id: null, color: null,
    image_focal_y: null,
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
        // The joined object when the vehicle came from getVehicles, the bare id
        // when it is a row just inserted (Copy, ＋ Variant hand the form the
        // insert's return, which has no join). Reading only the object showed
        // "— Manufacturer —" for those, and saving wrote null over the id.
        manufacturer_id: vehicle.manufacturer?.id ?? vehicle.manufacturer_id ?? null,
        // The vehicle's OWN color. A variant's resolved color is its source's,
        // and seeding the form with it would save it as the variant's own the
        // first time the form was submitted, cutting the pointer.
        color:  vehicle.own ? vehicle.own.color : (vehicle.color ?? null),
        // Its own, for the same reason as the color: a variant showing its
        // source's photo shows the source's focal point too, and seeding the
        // form with that would save it onto the variant -- which would then
        // hold a number framing a picture it does not own (#340).
        image_focal_y: vehicle.own ? vehicle.own.image_focal_y : (vehicle.image_focal_y ?? null),
    };
}

/**
 * Whether a vehicle appears in the lists: the grid, List, Lineage, the
 * pickers and every chart. The vehicle form of what runListing.js does for
 * tests (#394), and the same word: **unlisted**.
 *
 * `vehicles.visibility` was access control until migration 085 ('private'
 * rows could not be read). Every row is readable now, and the flag only keeps
 * a vehicle out of the lists: 'public' is listed, 'private' is unlisted — see
 * docs/vocabulary.md, Deferred renames.
 *
 * An unlisted vehicle is still in the fleet: a variant inherits from it, and
 * a lineage passes through it ("Unlisted record"). It is listed for curators
 * and for the account that created it.
 *
 * Pure module: no data access, no React.
 */
export const isListedVehicle = (vehicle) => vehicle?.visibility == null || vehicle.visibility === 'public';

/** Is this vehicle in the lists for this reader? */
export function listedFor(vehicle, { isContributor = false, userId = null } = {}) {
    return isContributor
        || isListedVehicle(vehicle)
        || (userId != null && vehicle?.user_id === userId);
}

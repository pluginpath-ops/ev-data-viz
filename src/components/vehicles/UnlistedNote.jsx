/**
 * Says a vehicle is unlisted (vehicleListing.js), where it appears in another
 * vehicle's lineage: a rolodex card, a Lineage row.
 *
 * Only a reader the vehicle is listed for — a curator, or the account that
 * created it — sees it there by name; everyone else gets "Unlisted record".
 * It is loud on purpose: a curator scanning a lineage must not mistake a
 * vehicle visitors are not shown for one they are.
 */
import { isListedVehicle } from '../../utils/vehicleListing';

export default function UnlistedNote({ vehicle }) {
    if (!vehicle || isListedVehicle(vehicle)) return null;
    return <span className="unlisted-note" title="Visitors are not shown this vehicle">Unlisted</span>;
}

/**
 * A vehicle's photograph, as content rather than as wallpaper.
 *
 * The card used to paint the image across its whole background and then bury it
 * under an 80% wash, because anything less made the text on top unreadable — so
 * the photo was simultaneously the largest thing on the card and impossible to
 * look at. Here it is a band with a bottom-up scrim: the picture is legible at
 * the top, the scrim carries the name at the bottom, and the card's own content
 * starts below it on a clean surface.
 *
 * The no-image case is a designed state, not an absence. A flat panel with the
 * make set large reads as deliberate; an empty box reads as broken, and a good
 * share of the fleet has no photograph.
 *
 * Shared by the card and the list row, which want the same asset at two very
 * different sizes — `displayImageUrl` already serves a 800×450 thumbnail for
 * both, so the only difference is the box.
 */
import { displayImageUrl } from '../../utils/imageRenditions';

export default function VehicleMedia({ vehicle, height = 104, className = '', children }) {
    const url = displayImageUrl(vehicle);
    // The make, not the name: a fallback panel identifies the thing at a glance,
    // and "Rivian" does that where "R1S Dual Large" is only the label already
    // printed underneath it.
    const fallback = (vehicle.make || vehicle.manufacturer?.name || '—').toUpperCase();

    return (
        <div
            className={`vehicle-media${url ? '' : ' is-empty'} ${className}`}
            style={{ height }}
        >
            {url
                ? <div className="vehicle-media-image" style={{ backgroundImage: `url(${url})` }} />
                : <span className="vehicle-media-fallback">{fallback}</span>}
            <div className="vehicle-media-scrim" />
            {children}
        </div>
    );
}

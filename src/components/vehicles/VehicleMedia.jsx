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
 *
 * ── The focal point (#340) ──────────────────────────────────────────────────
 *
 * The band is wider than it is tall and fills with `cover`, so it shows a
 * horizontal WINDOW of the 16:9 photo and cuts the rest. `image_focal_y` says
 * which window: null (the whole fleet until someone moves one) is centered and
 * draws exactly the pixels it always did. `utils/cardBand` owns the arithmetic
 * and the band's own measurements, because the crop step's preview has to draw
 * the same window and a second copy of 140 and 36 would drift.
 *
 * The list row gets the same treatment deliberately, even though at 92×54 the
 * photo overflows SIDEWAYS rather than vertically and the focal point cannot
 * move anything. Applying it anyway costs nothing and means the photo has one
 * framing wherever it is drawn, rather than a rule that quietly stops holding
 * the next time a box is resized.
 */
import { displayImageUrl } from '../../utils/imageRenditions';
import { CARD_BAND_OVERLAP, photoPosition } from '../../utils/cardBand';

export default function VehicleMedia({ vehicle, height = 104, className = '', children }) {
    const url = displayImageUrl(vehicle);
    // The make, not the name: a fallback panel identifies the thing at a glance,
    // and "Rivian" does that where "R1S Dual Large" is only the label already
    // printed underneath it.
    const fallback = (vehicle.make || vehicle.manufacturer?.name || '—').toUpperCase();

    return (
        <div
            className={`vehicle-media${url ? '' : ' is-empty'} ${className}`}
            // The overlap is published rather than written into index.css so
            // the band's geometry has ONE home — see utils/cardBand. Harmless
            // on the boxes that are not card bands: nothing else reads it.
            style={{ height, '--card-band-overlap': `${CARD_BAND_OVERLAP}px` }}
        >
            {url
                ? <div
                    className="vehicle-media-image"
                    style={{
                        backgroundImage: `url(${url})`,
                        backgroundPosition: photoPosition(vehicle.image_focal_y),
                    }}
                />
                : <span className="vehicle-media-fallback">{fallback}</span>}
            <div className="vehicle-media-scrim" />
            {children}
        </div>
    );
}

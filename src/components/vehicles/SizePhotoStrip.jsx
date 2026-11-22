/**
 * A vehicle's size photos, side by side, for the views the Curation filter asks
 * for ("Side photo", "Front photo", "Rear photo"). A curator filtering on them
 * wants to see the photos, not just that they exist. Shown on the card and the
 * List row only while one of those checks is included; otherwise nothing.
 *
 * The photo is the vehicle's own or its model line's, as the Size chart draws it
 * (`vehicle.size_photos`). A view the vehicle lacks is left out, not blanked:
 * with "any" matching, a vehicle may pass on one view of the three.
 */
export default function SizePhotoStrip({ vehicle, views }) {
    const photos = views.map(view => [view, vehicle.size_photos?.[view]]).filter(([, p]) => p?.image_url);
    if (!photos.length) return null;
    return (
        <span className="size-photo-strip">
            {photos.map(([view, photo]) => (
                <img
                    key={view}
                    className="size-photo-preview"
                    src={photo.image_url}
                    alt={`${vehicle.name}, ${view} view`}
                    title={`${view[0].toUpperCase()}${view.slice(1)} photo`}
                    loading="lazy"
                    decoding="async"
                />
            ))}
        </span>
    );
}

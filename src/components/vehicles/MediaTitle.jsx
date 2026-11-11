/**
 * The name over a vehicle's photo, on the media band's scrim.
 *
 * The band is dark in BOTH themes (owner, 2026-11-11): white on near-black
 * reads over any photograph, and a photo checked once is checked everywhere.
 * So the title is a dark-themed island: `data-theme="dark"` makes the tokens
 * under it resolve to their dark values whatever the page is in. The scrim and
 * the no-photo panel in VehicleMedia carry the same mark.
 *
 * The mark is on these pieces and not on the whole band, because the band also
 * holds a curator's color picker, whose popover belongs to the page's theme.
 */
export default function MediaTitle({ children }) {
    return <div className="vehicle-media-title" data-theme="dark">{children}</div>;
}

/**
 * The Size chart's stand-ins and outlines.
 *
 * Every figure here is a display-time stand-in for a spec a vehicle does not
 * have. The chart marks whatever it drew from one as estimated; none of them
 * is ever stored. Lengths are inches, like the specs.
 */

/** The six points the side view can line vehicles up on, in the order the sidebar lists them. */
export const SIZE_ANCHORS = [
    { key: 'front',           label: 'Front bumper' },
    { key: 'frontAxle',       label: 'Front axle' },
    { key: 'wheelbaseCenter', label: 'Wheelbase center' },
    { key: 'lengthCenter',    label: 'Length center' },
    { key: 'rearAxle',        label: 'Rear axle' },
    { key: 'rear',            label: 'Rear bumper' },
];
export const DEFAULT_SIZE_ANCHOR = 'front';

export const SIZE_VIEWS = [
    { key: 'side',  label: 'Side' },
    { key: 'front', label: 'Front' },
];
export const DEFAULT_SIZE_VIEW = 'side';

/** What a vehicle is drawn as: its size photo when it has one, or always the outline. */
export const SIZE_DRAWS = [
    { key: 'photos', label: 'Photos' },
    { key: 'outlines', label: 'Outlines' },
];
export const DEFAULT_SIZE_DRAW = 'photos';

/** The outline drawn when a vehicle has no body style. */
export const FALLBACK_BODY_STYLE = 'Crossover';

/** Ground clearance, when none is recorded. */
export const FALLBACK_GROUND_CLEARANCE_IN = 6;

/** Wheel rim to tread, added to the wheel size when the tire size can't be read. */
export const FALLBACK_SIDEWALLS_IN = 9;

/** Tread width, when the tire size can't be read. */
export const FALLBACK_TIRE_WIDTH_IN = 9.5;

/** Track as a share of body width, when no track is recorded. */
export const FALLBACK_TRACK_SHARE = 0.86;

/** Body width as a share of width with mirrors, when only that is recorded. */
export const FALLBACK_BODY_WIDTH_SHARE = 0.9;

/**
 * How far a size photo's marks may read from the specs before Data Checks
 * lists it (and the editor colors the figure). Height gets more room: the roof
 * line is softer to place than an axle, and roof rails count or don't.
 */
export const SIZE_PHOTO_WHEELBASE_PCT = 3;
export const SIZE_PHOTO_HEIGHT_PCT = 4;

/**
 * Each body style's outline, as shares of the vehicle's own figures, so the
 * shape stretches to any size and the wheel arches land on the real axles.
 *
 *   noseH, hoodH, tailH, deckH   heights, as a share of overall height:
 *                                 front face top, base of the windshield,
 *                                 base of the rear glass, rear face top
 *   cowl, roofF, roofR           along the wheelbase from the front axle (0)
 *                                 to the rear axle (1): base of the windshield,
 *                                 front and back of the roof
 *   tail                         along the rear overhang (0 = rear axle,
 *                                 1 = rear bumper): base of the rear glass
 *   frontShare                   the front overhang's share of both overhangs,
 *                                 used only when the front overhang is unknown
 *   bedH                         pickups: bed rail height (a share of height)
 */
export const BODY_SHAPES = {
    Sedan:     { noseH: 0.42, hoodH: 0.64, cowl: 0.28, roofF: 0.52, roofR: 0.86, tail: 0.55, tailH: 0.74, deckH: 0.72, frontShare: 0.46 },
    Hatchback: { noseH: 0.42, hoodH: 0.62, cowl: 0.18, roofF: 0.45, roofR: 1.02, tail: 0.85, tailH: 0.80, deckH: 0.55, frontShare: 0.52 },
    Wagon:     { noseH: 0.42, hoodH: 0.62, cowl: 0.22, roofF: 0.48, roofR: 1.15, tail: 0.92, tailH: 0.86, deckH: 0.58, frontShare: 0.45 },
    Crossover: { noseH: 0.48, hoodH: 0.66, cowl: 0.20, roofF: 0.45, roofR: 1.05, tail: 0.85, tailH: 0.85, deckH: 0.62, frontShare: 0.48 },
    SUV:       { noseH: 0.55, hoodH: 0.70, cowl: 0.20, roofF: 0.38, roofR: 1.15, tail: 0.95, tailH: 0.92, deckH: 0.62, frontShare: 0.47 },
    Pickup:    { noseH: 0.62, hoodH: 0.72, cowl: 0.25, roofF: 0.38, roofR: 0.62, tail: 1,    tailH: 0.66, deckH: 0.66, frontShare: 0.40, bedH: 0.66 },
    Van:       { noseH: 0.45, hoodH: 0.55, cowl: 0.05, roofF: 0.25, roofR: 1.20, tail: 0.97, tailH: 0.97, deckH: 0.60, frontShare: 0.45 },
};

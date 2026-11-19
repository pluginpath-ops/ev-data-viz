/**
 * A vehicle's size, read from its specs for the Size chart: every length the
 * drawing needs, which of them are stand-ins, and what is missing.
 *
 * Lengths are inches, like the specs. x runs from the front bumper (0) back to
 * the rear bumper (length); the side view draws the vehicle facing left.
 *
 * A figure the specs lack is filled with a stand-in (constants/sizeChart.js)
 * only where the drawing can still be honest about the rest — the axles placed
 * by a typical overhang split, a wheel drawn from its rim size — and its key
 * goes in `estimated`, which the chart marks. Length, height and wheelbase
 * have no stand-in: without them the side view leaves the vehicle out and
 * `missing.side` says why. The front view needs a width and the height.
 *
 * A size photo (docs/size-photos-plan.md) fills one gap: the front overhang,
 * read from its axle marks at the length spec's scale. That goes in
 * `fromPhoto`, not `estimated`. A recorded spec always wins over a photo.
 *
 * Pure module.
 */

import { parseTireSize } from './tireSize';
import { figuresFromMarks } from './sizePhotoMarks';
import {
    BODY_SHAPES, FALLBACK_BODY_STYLE, FALLBACK_GROUND_CLEARANCE_IN, FALLBACK_SIDEWALLS_IN,
    FALLBACK_TIRE_WIDTH_IN, FALLBACK_TRACK_SHARE, FALLBACK_BODY_WIDTH_SHARE,
} from '../constants/sizeChart';

const positive = (v) => {
    const n = typeof v === 'string' ? Number(v) : v;
    return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * @param {object} specs   a vehicle's effective specs (specHelpers.resolveEffectiveSpecs)
 * @param {object} [photos]  its size photos, `{ side?, front? }`
 * @returns {object} the profile; see the module note
 */
export function profileFromSpecs(specs, photos = null) {
    const dims = specs?.dimensions ?? {};
    const wheels = specs?.wheels ?? {};
    const estimated = new Set();
    const fromPhoto = new Set();

    const length = positive(dims.length_in);
    const height = positive(dims.height_in);
    const wheelbase = positive(dims.wheelbase_in);

    let bodyStyle = BODY_SHAPES[dims.body_style] ? dims.body_style : null;
    if (!bodyStyle) { bodyStyle = FALLBACK_BODY_STYLE; estimated.add('bodyStyle'); }

    // The axles. A recorded front overhang that leaves no rear overhang is
    // read as missing, not drawn (Data Checks lists it).
    const overhangs = length && wheelbase && length > wheelbase ? length - wheelbase : null;
    let frontOverhang = positive(dims.front_overhang_in);
    if (frontOverhang != null && (overhangs == null || frontOverhang >= overhangs)) frontOverhang = null;
    if (frontOverhang == null && overhangs != null && photos?.side) {
        // The photo's SPLIT of the overhangs, applied to the specs' total, so
        // front + rear always equals length − wheelbase whatever the photo's
        // small errors of scale.
        const read = figuresFromMarks('side', photos.side, { length });
        const total = (read?.frontOverhang ?? 0) + (read?.rearOverhang ?? 0);
        if (read?.frontOverhang > 0 && read?.rearOverhang > 0) {
            frontOverhang = overhangs * (read.frontOverhang / total);
            fromPhoto.add('frontOverhang');
        }
    }
    if (frontOverhang == null && overhangs != null) {
        frontOverhang = overhangs * BODY_SHAPES[bodyStyle].frontShare;
        estimated.add('frontOverhang');
    }
    const rearOverhang = overhangs != null ? overhangs - frontOverhang : null;

    let groundClearance = positive(dims.ground_clearance_in);
    if (groundClearance == null) { groundClearance = FALLBACK_GROUND_CLEARANCE_IN; estimated.add('groundClearance'); }

    const tire = parseTireSize(wheels.tire_size);
    let tireDiameter = tire?.diameterIn ?? null;
    let tireWidth = tire?.widthIn ?? null;
    const rim = tire?.rimIn ?? positive(wheels.wheel_size_in);
    if (tireDiameter == null) {
        tireDiameter = rim ? rim + FALLBACK_SIDEWALLS_IN : null;
        estimated.add('tireDiameter');
    }
    if (tireWidth == null) { tireWidth = FALLBACK_TIRE_WIDTH_IN; estimated.add('tireWidth'); }
    // No size at all: a wheel in proportion to the vehicle, never taller than
    // half of it.
    if (tireDiameter == null && height) tireDiameter = Math.min(height * 0.45, 30);

    const widthMirrors = positive(dims.width_mirrors_in);
    let width = positive(dims.width_in);
    if (width == null && widthMirrors != null) {
        width = widthMirrors * FALLBACK_BODY_WIDTH_SHARE;
        estimated.add('width');
    }
    let trackFront = positive(dims.track_front_in);
    if (trackFront == null && width != null) { trackFront = width * FALLBACK_TRACK_SHARE; estimated.add('trackFront'); }
    let trackRear = positive(dims.track_rear_in);
    if (trackRear == null && width != null) { trackRear = trackFront ?? width * FALLBACK_TRACK_SHARE; estimated.add('trackRear'); }

    const missing = {
        side: [!length && 'length', !height && 'height', !wheelbase && 'wheelbase',
            length && wheelbase && length <= wheelbase && 'a wheelbase shorter than the length'].filter(Boolean),
        front: [!width && 'width', !height && 'height'].filter(Boolean),
    };

    return {
        length, height, wheelbase, frontOverhang, rearOverhang, groundClearance,
        width, widthMirrors, trackFront, trackRear, tireDiameter, tireWidth, rim,
        bodyStyle, estimated, fromPhoto, missing,
    };
}

/**
 * Where an anchor sits along a vehicle, from its front bumper.
 *
 * @param {object} profile  from profileFromSpecs, drawable in the side view
 * @param {string} anchor   a SIZE_ANCHORS key
 * @returns {number} inches
 */
export function anchorX(profile, anchor) {
    const { length, wheelbase, frontOverhang } = profile;
    switch (anchor) {
        case 'frontAxle':       return frontOverhang;
        case 'wheelbaseCenter': return frontOverhang + wheelbase / 2;
        case 'lengthCenter':    return length / 2;
        case 'rearAxle':        return frontOverhang + wheelbase;
        case 'rear':            return length;
        default:                return 0;
    }
}

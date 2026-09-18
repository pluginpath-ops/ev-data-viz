/**
 * What a vehicle inherits beyond its specs: series color, photo and tags.
 *
 * A vehicle that inherits from another (`spec_source_vehicle_id`, "Inherit
 * from:" on the specs form) already falls back to that vehicle's specs field by
 * field, through the whole chain (`resolveEffectiveSpecs`). A variant is the
 * same car with a stated difference, so the things a reader RECOGNISES it by
 * come down the same chain:
 *
 *   color   the nearest vehicle in the chain with one set, else the palette
 *   photo   the nearest vehicle with a photo; image_url, image_thumb_url and
 *           image_focal_y travel together, so a thumbnail never pairs with
 *           another car's full image and a photo is never framed by a number
 *           that was set against a different picture (#340)
 *   tags    the vehicle's own tags if it has any, else the nearest source's.
 *           One set, overridden whole, not added up down the chain: the 2025
 *           R1T inherits from the R1S, and a sum made it an SUV as well as a
 *           Truck. A set that only adds cannot express "a variant that
 *           changes what kind of vehicle it is", and a set per variant can
 *
 * ── Pointers, not copies ────────────────────────────────────────────────────
 *
 * Nothing is written to the variant. It is resolved here, on every change to
 * the fleet, the way capacity and EPA range are (`withVehicleFigures`). So when
 * the source vehicle's photo is replaced, or its color changes, or the variant
 * is re-pointed at a different source, every variant follows on the next render
 * with nothing to keep in step.
 *
 * ── Own values stay reachable ───────────────────────────────────────────────
 *
 * The resolved values go on the usual keys (`color`, `image_url`,
 * `image_thumb_url`, `image_focal_y`, `tags`), so every card, chip and chart
 * reads the right thing without knowing inheritance exists. EDITING must not:
 * a form seeded from the resolved values would save an inherited color as the
 * variant's own the first time it was opened, cutting the pointer. Editors
 * read `own`, and `inheritedFrom` says where each resolved value came from.
 */
import { vehicleLabel } from './specHelpers';

/* One unit. The focal point is a property OF the photo -- it says which slice
   of that particular image the card's band shows -- so it can only ever be
   resolved from the same vehicle the URLs came from. Resolving it separately
   would frame one car's photo with another car's number the moment a variant
   set its own picture. */
const PHOTO_KEYS = ['image_url', 'image_thumb_url', 'image_focal_y'];

const hasColor = (v) => v?.color != null && v.color !== '';
const hasPhoto = (v) => Boolean(v?.image_url || v?.image_thumb_url);

/** A vehicle as an inheritance source: enough to name it and link to it. */
const sourceRef = (v) => ({ id: v.id, name: vehicleLabel(v) });

/**
 * The vehicles this one inherits from, nearest first.
 *
 * Stops at a missing source (deleted, or not visible to this reader) and at a
 * cycle, which the specs form prevents but old data could still hold.
 */
function inheritanceChain(vehicle, byId) {
    const chain = [];
    const seen = new Set([vehicle?.id]);
    let next = vehicle?.spec_source_vehicle_id != null ? byId.get(vehicle.spec_source_vehicle_id) : null;
    while (next && !seen.has(next.id)) {
        chain.push(next);
        seen.add(next.id);
        next = next.spec_source_vehicle_id != null ? byId.get(next.spec_source_vehicle_id) : null;
    }
    return chain;
}

/** A vehicle's own, un-inherited values: what an editor must read. */
export function ownValues(vehicle) {
    return vehicle?.own ?? {
        color: vehicle?.color ?? null,
        image_url: vehicle?.image_url ?? null,
        image_thumb_url: vehicle?.image_thumb_url ?? null,
        image_focal_y: vehicle?.image_focal_y ?? null,
        tags: vehicle?.tags ?? [],
    };
}

/**
 * The fleet with color, photo and tags resolved through inheritance.
 *
 * Adds to each vehicle:
 *   own            { color, image_url, image_thumb_url, image_focal_y, tags } as stored
 *   inheritedFrom  { color, photo, tags } — a { id, name } source for color and
 *                  photo, or null when the vehicle's own value (or none) is
 *                  shown; tags is { [tagId]: { id, name } } for inherited tags
 */
export function withInheritance(vehicles = []) {
    const byId = new Map(vehicles.map(v => [v.id, v]));
    return vehicles.map(vehicle => {
        const own = {
            color: vehicle.color ?? null,
            image_url: vehicle.image_url ?? null,
            image_thumb_url: vehicle.image_thumb_url ?? null,
            image_focal_y: vehicle.image_focal_y ?? null,
            tags: vehicle.tags ?? [],
        };
        const chain = inheritanceChain(vehicle, byId);
        if (chain.length === 0) {
            return { ...vehicle, own, inheritedFrom: { color: null, photo: null, tags: {} } };
        }

        const resolved = {};
        const inheritedFrom = { color: null, photo: null, tags: {} };

        if (!hasColor(vehicle)) {
            const source = chain.find(hasColor);
            if (source) {
                resolved.color = source.color;
                inheritedFrom.color = sourceRef(source);
            }
        }

        if (!hasPhoto(vehicle)) {
            const source = chain.find(hasPhoto);
            if (source) {
                for (const key of PHOTO_KEYS) resolved[key] = source[key] ?? null;
                inheritedFrom.photo = sourceRef(source);
            }
        }

        if (own.tags.length === 0) {
            const source = chain.find(v => (v.tags ?? []).length > 0);
            if (source) {
                resolved.tags = source.tags;
                for (const tag of source.tags) inheritedFrom.tags[tag.id] = sourceRef(source);
            }
        }

        return { ...vehicle, ...resolved, own, inheritedFrom };
    });
}

/**
 * What a new variant of `source` links to, so it shows every test the source
 * shows.
 *
 * Tests are inherited per run (`spec_links`, migrations 016 and 055), with a
 * capacity and an efficiency factor on each link. So a variant gets one link
 * per run the source shows: its own runs at factor 1 (the variant has not been
 * measured as different yet), and the runs the source itself inherits with the
 * source's factors, so the variant starts out reading exactly as its source
 * does. Hidden runs are included: hiding is a judgement about the run, and it
 * travels with the run.
 */
export function variantLinkPlan(source) {
    return (source?.runs ?? []).map(run => run._inherited
        ? {
            sourceRunId: run._realRunId,
            efficiencyFactor: run._efficiencyFactor !== 1 ? run._efficiencyFactor : null,
            capacityFactor: run._capacityFactor !== 1 ? run._capacityFactor : null,
        }
        : { sourceRunId: run.id, efficiencyFactor: null, capacityFactor: null });
}

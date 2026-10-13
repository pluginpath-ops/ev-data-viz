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
 *   platforms  each of the two platform links (#318) from the nearest vehicle
 *           with that link set, separately: a variant can keep its source's
 *           structure and change its electrics (the 2025 R1 did)
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
import { isCompositeRun } from './runUtils';

/* One unit. The focal point is a property OF the photo -- it says which slice
   of that particular image the card's band shows -- so it can only ever be
   resolved from the same vehicle the URLs came from. Resolving it separately
   would frame one car's photo with another car's number the moment a variant
   set its own picture. */
const PHOTO_KEYS = ['image_url', 'image_thumb_url', 'image_focal_y'];

/* The two platform links (#318), resolved one by one. */
const PLATFORM_KEYS = ['mechanical_platform_id', 'electrical_platform_id'];

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

/**
 * The fleet indexed for lineage questions: vehicles by id, and the ids that
 * are a source to at least one visible vehicle. Build it once per fleet and
 * pass it to `lineageRole` and `vehicleStack`.
 */
export function lineageIndex(vehicles = []) {
    const byId = new Map(vehicles.map(v => [v.id, v]));
    const sources = new Set();
    for (const v of vehicles) {
        if (v.spec_source_vehicle_id != null && byId.has(v.spec_source_vehicle_id)) {
            sources.add(v.spec_source_vehicle_id);
        }
    }
    return { byId, sources };
}

/**
 * Where a vehicle sits in its lineage, for the role icon:
 *
 *   'origin'        no source, has variants
 *   'has-variants'  has a source and variants of its own
 *   'end'           has a source, no variants
 *   null            neither: not part of a lineage
 *
 * Read over the whole fleet, unlisted vehicles included, so a variant of an
 * unlisted source is still a variant.
 */
export function lineageRole(vehicle, index) {
    const hasSource = inheritanceChain(vehicle, index.byId).length > 0;
    const hasVariants = index.sources.has(vehicle?.id);
    if (!hasSource) return hasVariants ? 'origin' : null;
    return hasVariants ? 'has-variants' : 'end';
}

/** How many rolodex cards a stack shows before the rest fold into "+N more". */
const STACK_ROLODEX_CAP = 2;

/**
 * How a source sits in a stack or a lineage tree for this reader: a vehicle
 * to show, one the filters removed ('gap'), or one this reader is not shown
 * at all because it is unlisted ('unlisted') — named only as "Unlisted
 * record", and never opened, though the lineage carries on past it.
 */
const lineageKind = (v, isShown, isVisible) =>
    !isVisible(v) ? 'unlisted' : isShown(v) ? 'vehicle' : 'gap';

/**
 * A vehicle's stack on the Cards grid: the vehicle on top, its source chain
 * above it as rolodex cards.
 *
 * `isShown(v)` says whether a source passes the current filters, and
 * `isVisible(v)` whether it is listed for this reader (unlisted vehicles are
 * listed for curators and their creator only). A run of sources that fail
 * either way is ONE entry, so a long stretch costs one rolodex card, not one
 * each. `index` is built from the whole fleet, unlisted vehicles included, so
 * the chain carries on past an unlisted source to the listed ones beyond it.
 *
 * Returns
 *   rolodex  entries to draw, furthest first (the order they sit above the
 *            card): { vehicle }, { gap: n } or { unlisted: n }, at most `cap`
 *   more     sources folded into "+N more" past the cap: every kind
 *            counted, and never 1, since a single entry past the cap is shown
 *   members  every source shown, furthest first, then the vehicle: what the
 *            fanned-out stack shows, gaps and unlisted records left out
 *
 * A vehicle with no source gets an empty stack, and draws as a card.
 */
export function vehicleStack(vehicle, index, isShown = () => true, isVisible = () => true, cap = STACK_ROLODEX_CAP) {
    const chain = inheritanceChain(vehicle, index.byId);
    const entries = [];
    for (const source of chain) {
        const kind = lineageKind(source, isShown, isVisible);
        const last = entries.at(-1);
        if (kind === 'vehicle') entries.push({ vehicle: source });
        else if (last?.[kind]) last[kind] += 1;
        else entries.push({ [kind]: 1 });
    }

    // One entry past the cap is shown, whatever it is: a "+1 more" card would
    // take the same room as the card it hides. Two or more fold into "+N
    // more", N counting every source folded, so it never reads "+1".
    const fold = entries.length > cap + 1;
    const shown = entries.slice(0, fold ? cap : entries.length);
    const more = fold
        ? entries.slice(cap).reduce((n, e) => n + (e.vehicle ? 1 : e.gap ?? e.unlisted), 0)
        : 0;

    const members = chain.filter(v => lineageKind(v, isShown, isVisible) === 'vehicle').reverse();
    return {
        rolodex: shown.reverse(),
        more,
        members: chain.length ? [...members, vehicle] : [],
    };
}

/** A vehicle's own, un-inherited values: what an editor must read. */
export function ownValues(vehicle) {
    return vehicle?.own ?? {
        color: vehicle?.color ?? null,
        image_url: vehicle?.image_url ?? null,
        image_thumb_url: vehicle?.image_thumb_url ?? null,
        image_focal_y: vehicle?.image_focal_y ?? null,
        mechanical_platform_id: vehicle?.mechanical_platform_id ?? null,
        electrical_platform_id: vehicle?.electrical_platform_id ?? null,
        tags: vehicle?.tags ?? [],
    };
}

/**
 * The fleet with color, photo and tags resolved through inheritance.
 *
 * Adds to each vehicle:
 *   own            { color, image_url, image_thumb_url, image_focal_y,
 *                    mechanical_platform_id, electrical_platform_id, tags } as stored
 *   inheritedFrom  { color, photo, mechanical_platform_id, electrical_platform_id,
 *                  tags } — a { id, name } source for each, or null when the
 *                  vehicle's own value (or none) is shown; tags is
 *                  { [tagId]: { id, name } } for inherited tags
 */
export function withInheritance(vehicles = []) {
    const byId = new Map(vehicles.map(v => [v.id, v]));
    return vehicles.map(vehicle => {
        const own = {
            color: vehicle.color ?? null,
            image_url: vehicle.image_url ?? null,
            image_thumb_url: vehicle.image_thumb_url ?? null,
            image_focal_y: vehicle.image_focal_y ?? null,
            mechanical_platform_id: vehicle.mechanical_platform_id ?? null,
            electrical_platform_id: vehicle.electrical_platform_id ?? null,
            tags: vehicle.tags ?? [],
        };
        const none = { color: null, photo: null, mechanical_platform_id: null, electrical_platform_id: null, tags: {} };
        const chain = inheritanceChain(vehicle, byId);
        if (chain.length === 0) {
            return { ...vehicle, own, inheritedFrom: none };
        }

        const resolved = {};
        const inheritedFrom = { ...none, tags: {} };

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

        for (const key of PLATFORM_KEYS) {
            if (vehicle[key] != null) continue;
            const source = chain.find(v => v[key] != null);
            if (source) {
                resolved[key] = source[key];
                inheritedFrom[key] = sourceRef(source);
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
 *
 * Stored composites are not: the variant builds its own from the tests it
 * inherits (compositeCurve.compositeEligible), and its source's beside it
 * would be the same curve twice.
 */
export function variantLinkPlan(source) {
    return (source?.runs ?? []).filter(run => !isCompositeRun(run)).map(run => run._inherited
        ? {
            sourceRunId: run._realRunId,
            efficiencyFactor: run._efficiencyFactor !== 1 ? run._efficiencyFactor : null,
            capacityFactor: run._capacityFactor !== 1 ? run._capacityFactor : null,
        }
        : { sourceRunId: run.id, efficiencyFactor: null, capacityFactor: null });
}

/**
 * The lineage tree view: every lineage with something that passes the
 * filters, from its origin down, each vehicle once.
 *
 * Unlike a stack, nothing repeats: a vehicle appears where it sits in its
 * tree. A vehicle that fails the filters is kept only as a gap on the way to
 * one that passes, so a matching variant is never hidden because its source
 * did not match; a run of failing sources in a line is one gap. A branch with
 * nothing that passes is left out entirely.
 *
 * A vehicle that is not listed for this reader (`isVisible`) is kept the same
 * way, as an "unlisted" row: never named, but the tree carries on past it, so
 * the listed variants of an unlisted source stay together under it.
 *
 * `order` is the fleet in display order (the view's sort). Trees follow the
 * position of their first passing member, and variants under a source follow
 * the same order. `vehicles` and `index` are the whole fleet.
 *
 * Returns trees: [{ root, rows }], rows in reading order, each
 * { vehicle, depth, trail, hasVariants }, { gap: n, hidden, depth, trail,
 * hasVariants } (`hidden` being the vehicles the gap stands for, furthest
 * first, so a reader can open it and see what the filters left out), or
 * { unlisted: n, depth, trail, hasVariants }.
 *
 * `trail` and `hasVariants` are what the connector lines need: trail[k] is
 * true when the row's ancestor at depth k + 1 (or, at the last place, the
 * row itself) has a later sibling, so its line carries on down past this row;
 * `hasVariants` is true when rows hang below this one.
 */
export function lineageTrees(vehicles, index, isShown = () => true, order = vehicles, isVisible = () => true) {
    const passes = v => isVisible(v) && isShown(v);
    const rank = new Map(order.map((v, i) => [v.id, i]));
    const rankOf = v => rank.get(v.id) ?? Infinity;
    const variants = new Map();
    for (const v of vehicles) {
        const src = v.spec_source_vehicle_id;
        if (src == null || !index.byId.has(src) || src === v.id) continue;
        if (!variants.has(src)) variants.set(src, []);
        variants.get(src).push(v);
    }
    for (const list of variants.values()) list.sort((a, b) => rankOf(a) - rankOf(b));

    // The earliest passing member of each subtree, or Infinity when none
    // passes; guarded against cycles like the chain walk.
    const first = new Map();
    const firstShown = (v, seen = new Set()) => {
        if (first.has(v.id)) return first.get(v.id);
        if (seen.has(v.id)) return Infinity;
        seen.add(v.id);
        let best = passes(v) ? rankOf(v) : Infinity;
        for (const c of variants.get(v.id) ?? []) best = Math.min(best, firstShown(c, seen));
        first.set(v.id, best);
        return best;
    };
    const kept = v => (variants.get(v.id) ?? []).filter(c => firstShown(c) !== Infinity);

    const walk = (v, depth, rows, seen, trail) => {
        if (seen.has(v.id)) return;
        seen.add(v.id);
        const kind = lineageKind(v, isShown, isVisible);
        let row, node = v;
        if (kind === 'vehicle') {
            row = { vehicle: v, depth, trail };
        } else {
            // Fold a single line of sources of the same kind into one row.
            const hidden = [v];
            for (;;) {
                const next = kept(node);
                if (next.length === 1 && lineageKind(next[0], isShown, isVisible) === kind && !seen.has(next[0].id)) {
                    node = next[0];
                    seen.add(node.id);
                    hidden.push(node);
                } else break;
            }
            row = kind === 'gap'
                ? { gap: hidden.length, hidden, depth, trail }
                : { unlisted: hidden.length, depth, trail };
        }
        const below = kept(node).filter(c => !seen.has(c.id));
        row.hasVariants = below.length > 0;
        rows.push(row);
        below.forEach((c, i) => walk(c, depth + 1, rows, seen, [...trail, i < below.length - 1]));
    };

    // A tree starts at an origin: a vehicle whose chain walk finds no source.
    const roots = vehicles.filter(v => inheritanceChain(v, index.byId).length === 0 && firstShown(v) !== Infinity);
    roots.sort((a, b) => firstShown(a) - firstShown(b));
    return roots.map(root => {
        const rows = [];
        walk(root, 0, rows, new Set(), []);
        return { root, rows };
    });
}

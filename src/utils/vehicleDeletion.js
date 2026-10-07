/**
 * Deleting a vehicle that other vehicles inherit from.
 *
 * A variant shows its source's specs, color, photo and tags until it sets its
 * own (vehicleInheritance.js). So deleting a source in the MIDDLE of a chain
 * cannot just cut the pointer: every variant below it would stop showing what
 * the source said, and with it everything above it — a variant that had been
 * correcting an old figure would go back to showing the old one, or to nothing.
 *
 * Instead the source's OWN values are passed down to each of its variants wherever
 * the variant has none of its own, and the variant is re-pointed at the
 * source's source. Both layers are unchanged for the variant, so what it
 * shows is identical before and after: its own value, else the deleted
 * source's, else the next one up.
 *
 * This is the client half of `delete_vehicle_passing_down()` (migration 075),
 * which does the same in one transaction. This file serves the signed-out
 * store, the preview of what a delete will do, and the state update after the
 * database call — and is the reference the SQL is held to.
 *
 * Tests are the part that cannot be passed down. They belong to the deleted
 * vehicle (`runs`), and a variant reads them through `spec_links`, which go
 * when the run does. `deletionImpact` says so before the delete.
 *
 * Pure module: no data access, no React.
 */
import { vehicleLabel } from './specHelpers';

const isBlank = v => v === null || v === undefined || v === '';

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

const hasPhoto = v => Boolean(v?.image_url || v?.image_thumb_url);

/**
 * `over` laid on `under`, a blob at a time: a field `over` has set wins, one it
 * leaves blank shows `under`'s. `false` and 0 are values. Custom fields merge by
 * key, over winning. The same rule `mergeInheritedSpecs` applies when reading.
 */
export function mergeSpecBlobs(under, over) {
    const merged = {};
    const categories = new Set([...Object.keys(under ?? {}), ...Object.keys(over ?? {})]);
    for (const cat of categories) {
        const lower = isObject(under?.[cat]) ? under[cat] : {};
        const upper = isObject(over?.[cat]) ? over[cat] : {};
        const { _custom: lowerCustom, ...lowerFields } = lower;
        const { _custom: upperCustom, ...upperFields } = upper;
        const fields = { ...lowerFields };
        for (const [key, value] of Object.entries(upperFields)) {
            if (!isBlank(value)) fields[key] = value;
        }
        merged[cat] = { ...fields, _custom: { ...(lowerCustom ?? {}), ...(upperCustom ?? {}) } };
    }
    return merged;
}

/** The vehicles that inherit directly from this one. */
export function variantsOf(vehicles, id) {
    return vehicles.filter(v => v.spec_source_vehicle_id === id);
}

const realRunIds = vehicle =>
    new Set((vehicle?.runs ?? []).filter(r => !r._inherited).map(r => Number(r.id)));

/** One variant after its source is deleted: the source's own values, filled in where it has none. */
function passDownTo(variant, source) {
    const next = { ...variant, spec_source_vehicle_id: source.spec_source_vehicle_id ?? null };

    if (!isBlank(source.specs) && Object.keys(source.specs).length > 0) {
        next.specs = mergeSpecBlobs(source.specs, variant.specs);
    }
    if (isBlank(variant.color) && !isBlank(source.color)) next.color = source.color;

    // image_url, image_thumb_url and image_focal_y are one unit: the focal point
    // frames one particular picture, so they travel together or not at all.
    if (!hasPhoto(variant) && hasPhoto(source)) {
        next.image_url = source.image_url ?? null;
        next.image_thumb_url = source.image_thumb_url ?? null;
        next.image_focal_y = source.image_focal_y ?? null;
    }
    for (const key of ['mechanical_platform_id', 'electrical_platform_id']) {
        if (variant[key] == null && source[key] != null) next[key] = source[key];
    }
    // Tags are one set, overridden whole: a variant with any of its own keeps
    // only those.
    if ((variant.tags ?? []).length === 0 && (source.tags ?? []).length > 0) next.tags = source.tags;

    return next;
}

/** A vehicle without the links and shown runs that came from tests being deleted. */
function withoutTests(vehicle, runIds) {
    if (runIds.size === 0) return vehicle;
    const links = vehicle.spec_links ?? [];
    const runs = vehicle.runs ?? [];
    const keptLinks = links.filter(l => !runIds.has(Number(l.source_run_id)));
    const keptRuns = runs.filter(r => !(r._inherited && runIds.has(Number(r._realRunId))));
    if (keptLinks.length === links.length && keptRuns.length === runs.length) return vehicle;
    return { ...vehicle, spec_links: keptLinks, runs: keptRuns };
}

/**
 * The fleet after deleting one vehicle: its variants carry what it said and
 * point at its own source, and the tests it owned stop showing anywhere.
 */
export function passDown(vehicles, id) {
    const source = vehicles.find(v => v.id === id);
    if (!source) return vehicles;
    const runIds = realRunIds(source);
    return vehicles
        .filter(v => v.id !== id)
        .map(v => withoutTests(v.spec_source_vehicle_id === id ? passDownTo(v, source) : v, runIds));
}

/**
 * What deleting these vehicles does to the ones that depend on them, in the
 * order they will be deleted, for the bar that asks first.
 *
 * Returns one entry per deleted vehicle that has something depending on it:
 *   vehicle     the one going
 *   variants    those inheriting from it that are staying
 *   newSource   what they will inherit from instead (null: they become roots)
 *   shownOn     [{ vehicle, count }] vehicles that show its tests, and how many,
 *               which stop doing so
 *
 * A variant that is itself queued is left out: it is going too.
 */
export function deletionImpact(vehicles, ids) {
    const going = new Set(ids);
    const entries = [];
    let fleet = vehicles;
    for (const id of ids) {
        const vehicle = fleet.find(v => v.id === id);
        if (!vehicle) continue;
        const runIds = realRunIds(vehicle);
        const variants = variantsOf(fleet, id).filter(v => !going.has(v.id));
        const shownOn = fleet
            .filter(v => v.id !== id && !going.has(v.id))
            .map(v => ({
                vehicle: v,
                count: (v.spec_links ?? []).filter(l => runIds.has(Number(l.source_run_id))).length,
            }))
            .filter(s => s.count > 0);
        if (variants.length > 0 || shownOn.length > 0) {
            const newSource = vehicle.spec_source_vehicle_id != null
                ? fleet.find(v => v.id === vehicle.spec_source_vehicle_id) ?? null
                : null;
            entries.push({ vehicle, variants, newSource, shownOn });
        }
        fleet = passDown(fleet, id);
    }
    return entries;
}

/** The one-line sentence per entry that the delete bar shows. */
export function impactLines(entries) {
    const names = list => list.map(v => vehicleLabel(v)).join(', ');
    return entries.flatMap(({ vehicle, variants, newSource, shownOn }) => {
        const lines = [];
        if (variants.length > 0) {
            const where = newSource ? `inherit from ${vehicleLabel(newSource)} instead` : 'stand on their own';
            lines.push(
                `${vehicleLabel(vehicle)} is the source of ${names(variants)}. `
                + `What it says is passed down to ${variants.length === 1 ? 'it' : 'them'}, which will ${where}.`
            );
        }
        if (shownOn.length > 0) {
            const total = shownOn.reduce((n, s) => n + s.count, 0);
            lines.push(
                `${total} test${total === 1 ? '' : 's'} of ${vehicleLabel(vehicle)} stop showing on `
                + `${names(shownOn.map(s => s.vehicle))}.`
            );
        }
        return lines;
    });
}

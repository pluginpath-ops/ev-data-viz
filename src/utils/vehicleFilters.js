/**
 * One filter model for Vehicles & Specs (#338): Cards, List and Table read the
 * same filters, so switching views never changes which vehicles are shown.
 *
 * It replaces two systems that disagreed. Cards and List had chip walls — tags
 * any / all / not, makes include / exclude, models, test data — and the Table
 * had dropdowns for make, year, drive and tag, include only. The owner's
 * decisions (2026-09-28, on #338):
 *
 *   - dropdowns with counts, one filter bar above every view, each active
 *     filter a removable chip beneath (VehicleFilterBar);
 *   - any value can be excluded as well as included;
 *   - tags and test data have an any / all switch; make, model, year and
 *     drive are one value per vehicle, so "all" would mean nothing there;
 *   - the filters travel in the URL, tidily.
 *
 * ── Shape ───────────────────────────────────────────────────────────────────
 *
 *   { search: '', facets: { make: { in: [], out: [], all: false }, … } }
 *
 * A facet with nothing in it may be absent. `in` narrows to vehicles with any
 * (or, with `all`, every) of its values; `out` drops vehicles with any of its.
 *
 * ── URL ─────────────────────────────────────────────────────────────────────
 *
 * The EPA guide's scheme, so the two tables read alike: one parameter per
 * facet, values comma-joined, an excluded value with a leading "-", and
 * `<param>_all=1` for the all switch:
 *
 *   ?tab=vehicles&mk=Kia,Hyundai&tg=SUV,-Truck&tg_all=1&q=ioniq
 *
 * The Table's old `vt_q`, `vt_mk`, `vt_y`, `vt_dr` and `vt_tg` are still read.
 *
 * Pure module: no data access, no React.
 */
import { resolveEffectiveSpecs } from './specHelpers';
import { DATA_CATEGORIES, hasDataCategory } from './vehicleDataCategories';

/**
 * The facets, in the order the filter bar shows them.
 *
 * `values(vehicle, ctx)` gives a vehicle's values for the facet — several for
 * tags and test data. `format(value)`, where given, is how a value reads on
 * screen; otherwise the value is its own text.
 */
export const VEHICLE_FACETS = [
    { key: 'make',  label: 'Make',  param: 'mk', legacy: 'vt_mk',
      values: (v) => [v.make || v.manufacturer?.name].filter(Boolean) },
    { key: 'model', label: 'Model', param: 'md',
      values: (v) => [v.model].filter(Boolean) },
    { key: 'year',  label: 'Year',  param: 'yr', legacy: 'vt_y',
      values: (v) => (v.year != null && v.year !== '' ? [String(v.year)] : []) },
    { key: 'drive', label: 'Drive', param: 'dr', legacy: 'vt_dr',
      // Through inheritance and the platform, as the table shows it.
      values: (v, ctx) => [ctx.specsOf(v)?.powertrain?.drive_type].filter(Boolean) },
    { key: 'tags',  label: 'Tags',  param: 'tg', legacy: 'vt_tg', anyAll: true,
      values: (v) => (v.tags ?? []).map(t => t.name).filter(Boolean) },
    // All by default: the questions worth asking of test data are "has both
    // charging and range" or "has no EPA data", not "has charging or braking".
    { key: 'data',  label: 'Test data', param: 'dt', anyAll: true, defaultAll: true,
      hint: 'which kinds of test a vehicle has',
      values: (v, ctx) => DATA_CATEGORIES.filter(c => hasDataCategory(v, c.key, ctx.performanceCounts)).map(c => c.key),
      format: (key) => DATA_CATEGORIES.find(c => c.key === key)?.label ?? key },
];
const FACET_BY_KEY = new Map(VEHICLE_FACETS.map(f => [f.key, f]));
export const vehicleFacetByKey = (key) => FACET_BY_KEY.get(key) ?? null;

export const EMPTY_VEHICLE_FILTERS = Object.freeze({ search: '', facets: Object.freeze({}) });

const EMPTY_FACET = Object.freeze({ in: [], out: [], all: false });

/** One facet's state, never undefined. */
export function facetState(filters, key) {
    return { ...EMPTY_FACET, ...(filters?.facets?.[key] ?? {}) };
}

/** Whether anything narrows the vehicles shown. */
export function filtersActive(filters) {
    if (filters?.search?.trim()) return true;
    return Object.values(filters?.facets ?? {}).some(f => f.in?.length || f.out?.length);
}

// ── Changing filters (each returns a new filters object) ─────────────────────

function withFacet(filters, key, next) {
    const facets = { ...(filters?.facets ?? {}) };
    if (!next.in.length && !next.out.length && !next.all) delete facets[key];
    else facets[key] = next;
    return { ...EMPTY_VEHICLE_FILTERS, ...filters, facets };
}

/** Include a value, or stop including it. Including clears an exclusion. */
export function toggleInclude(filters, key, value) {
    const f = facetState(filters, key);
    const on = f.in.includes(value);
    // A facet that matches all by default starts that way on its first value.
    const fresh = !f.in.length && !f.out.length;
    return withFacet(filters, key, {
        ...f,
        all: fresh && vehicleFacetByKey(key)?.defaultAll ? true : f.all,
        in: on ? f.in.filter(v => v !== value) : [...f.in, value],
        out: f.out.filter(v => v !== value),
    });
}

/** Exclude a value, or stop excluding it. Excluding clears an inclusion. */
export function toggleExclude(filters, key, value) {
    const f = facetState(filters, key);
    const on = f.out.includes(value);
    return withFacet(filters, key, {
        ...f,
        out: on ? f.out.filter(v => v !== value) : [...f.out, value],
        in: f.in.filter(v => v !== value),
    });
}

/** Match any or all of a multi-valued facet's included values. */
export function setMatchAll(filters, key, all) {
    return withFacet(filters, key, { ...facetState(filters, key), all: !!all });
}

export function clearFacet(filters, key) {
    return withFacet(filters, key, { ...EMPTY_FACET });
}

export function setSearch(filters, search) {
    return { ...EMPTY_VEHICLE_FILTERS, ...filters, search };
}

// ── Matching ─────────────────────────────────────────────────────────────────

/**
 * What the facets need beyond the vehicle: its resolved specs (drive type
 * comes through inheritance and the platform) and its performance counts.
 * Build once per render; `specsOf` caches per vehicle.
 */
export function vehicleFilterContext(vehicles = [], performanceCounts = {}) {
    const cache = new Map();
    return {
        performanceCounts,
        specsOf: (v) => {
            if (!cache.has(v.id)) cache.set(v.id, resolveEffectiveSpecs(v, vehicles));
            return cache.get(v.id);
        },
    };
}

function facetMatches(facet, state, vehicle, ctx) {
    if (!state.in.length && !state.out.length) return true;
    const values = facet.values(vehicle, ctx);
    if (state.out.some(v => values.includes(v))) return false;
    if (!state.in.length) return true;
    return state.all && facet.anyAll
        ? state.in.every(v => values.includes(v))
        : state.in.some(v => values.includes(v));
}

const haystack = (v) => [v.name, v.make, v.manufacturer?.name, v.model, v.trim, v.year, ...(v.tags ?? []).map(t => t.name)]
    .filter(x => x != null && x !== '').join(' ').toLowerCase();

/**
 * Whether a search matches a vehicle: anywhere in its name, make, model, trim,
 * year or tags — and a year inside a span, so "2023" finds a "2022-2024".
 */
export function searchMatches(vehicle, needle) {
    if (!needle) return true;
    if (haystack(vehicle).includes(needle)) return true;
    const year = Number.parseInt(needle, 10);
    const span = /^(\d{4})\s*[-–]\s*(\d{4})$/.exec(String(vehicle.year ?? ''));
    return /^\d{4}$/.test(needle) && !!span && year >= Number(span[1]) && year <= Number(span[2]);
}

/** Whether a vehicle passes every filter. */
export function vehicleMatches(vehicle, filters, ctx, { skip = null } = {}) {
    const needle = filters?.search?.trim().toLowerCase();
    if (!searchMatches(vehicle, needle)) return false;
    for (const facet of VEHICLE_FACETS) {
        if (facet.key === skip) continue;
        if (!facetMatches(facet, facetState(filters, facet.key), vehicle, ctx)) return false;
    }
    return true;
}

export function filterVehicles(vehicles = [], filters, ctx) {
    if (!filtersActive(filters)) return vehicles;
    return vehicles.filter(v => vehicleMatches(v, filters, ctx));
}

/**
 * Each facet's values and how many vehicles each would leave, computed with
 * that facet's OWN selection removed — the EPA guide's rule, so a number says
 * what clicking it would leave rather than what the fleet holds.
 *
 * @returns {{ [facetKey]: { values: string[], counts: Map<string, number> } }}
 */
export function vehicleFacetCounts(vehicles = [], filters, ctx) {
    const out = {};
    for (const facet of VEHICLE_FACETS) {
        const values = new Set();
        const counts = new Map();
        for (const v of vehicles) {
            const vals = facet.values(v, ctx);
            for (const x of vals) values.add(x);
            if (!vehicleMatches(v, filters, ctx, { skip: facet.key })) continue;
            for (const x of new Set(vals)) counts.set(x, (counts.get(x) ?? 0) + 1);
        }
        // A value someone chose stays in the menu even if no vehicle has it now.
        const st = facetState(filters, facet.key);
        for (const x of [...st.in, ...st.out]) values.add(x);
        out[facet.key] = { values: [...values], counts };
    }
    return out;
}

/**
 * Every active filter as a chip: its text and how to remove it. The search is
 * not one — it shows in its own box.
 */
export function activeFilterChips(filters) {
    const chips = [];
    for (const facet of VEHICLE_FACETS) {
        const st = facetState(filters, facet.key);
        const fmt = facet.format ?? String;
        const joiner = st.all && facet.anyAll && st.in.length > 1 ? 'all of' : null;
        for (const v of st.in) {
            chips.push({ id: `${facet.key}:in:${v}`, facet: facet.key, value: v, mode: 'in',
                text: `${fmt(v)}`, group: joiner ? `${facet.label}: ${joiner}` : null });
        }
        for (const v of st.out) {
            chips.push({ id: `${facet.key}:out:${v}`, facet: facet.key, value: v, mode: 'out', text: `not ${fmt(v)}` });
        }
    }
    return chips;
}

/** Remove one chip's filter. */
export function removeChip(filters, chip) {
    return chip.mode === 'out'
        ? toggleExclude(filters, chip.facet, chip.value)
        : toggleInclude(filters, chip.facet, chip.value);
}

// ── URL ──────────────────────────────────────────────────────────────────────

/** Every parameter the filters own, for a caller that rebuilds a query string. */
export const VEHICLE_FILTER_PARAMS = new Set([
    'q', ...VEHICLE_FACETS.flatMap(f => [f.param, `${f.param}_all`]),
]);

/** Filters → query parameters; only what is set. */
export function encodeVehicleFilters(filters) {
    const p = new URLSearchParams();
    if (filters?.search?.trim()) p.set('q', filters.search.trim());
    for (const facet of VEHICLE_FACETS) {
        const st = facetState(filters, facet.key);
        const parts = [...st.in, ...st.out.map(v => `-${v}`)];
        if (parts.length) p.set(facet.param, parts.join(','));
        if (st.all && facet.anyAll && st.in.length) p.set(`${facet.param}_all`, '1');
    }
    return p;
}

/**
 * Query string → filters. Total: whatever a URL holds, the result is a valid
 * filters object. Reads the Table's old `vt_` parameters too, so a table link
 * shared before #338 still filters.
 */
export function decodeVehicleFilters(search) {
    const p = new URLSearchParams(search ?? '');
    const facets = {};
    for (const facet of VEHICLE_FACETS) {
        const st = { in: [], out: [], all: p.get(`${facet.param}_all`) === '1' };
        for (const part of (p.get(facet.param) ?? '').split(',').map(s => s.trim()).filter(Boolean)) {
            if (part === '-') continue;   // a sign with nothing after it names no value
            if (part.startsWith('-')) st.out.push(part.slice(1));
            else st.in.push(part);
        }
        if (facet.legacy) for (const v of p.getAll(facet.legacy)) if (v && !st.in.includes(v)) st.in.push(v);
        if (st.in.length || st.out.length) facets[facet.key] = st;
    }
    return { search: p.get('q') ?? p.get('vt_q') ?? '', facets };
}

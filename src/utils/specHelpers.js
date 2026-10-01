import { SPEC_CATEGORIES, formatCustomKey } from './vehicleSpecSchema';
import { distanceLabel } from './unitConversions';
import { platformProvides } from './platforms';

// ── Vehicle display label ─────────────────────────────────────────────────────

export function vehicleLabel(v) {
    const base = v?.year ? `${v.year} ${v.name}` : (v?.name ?? '');
    return v?.trim ? `${base} · ${v.trim}` : base;
}

/**
 * Name · Year · Manufacturer · Model · Trim · Platforms, for telling similar vehicles
 * apart in a list. A part already contained in an earlier one is dropped, so
 * a vehicle named "R1S" with model "R1S" does not read "R1S · R1S".
 */
export function vehicleDetailLabel(v) {
    const parts = [];
    for (const raw of [v?.name, v?.year, v?.manufacturer?.name ?? v?.make, v?.model, v?.trim,
        v?.platforms?.mechanical?.name, v?.platforms?.electrical?.name]) {
        const part = raw == null ? '' : String(raw).trim();
        if (!part) continue;
        if (parts.some(p => p.toLowerCase().includes(part.toLowerCase()))) continue;
        parts.push(part);
    }
    return parts.join(' · ');
}

/**
 * Everything a person might type to find a vehicle: the label plus make,
 * model, manufacturer, platforms and tags. Lowercased for matching only — never shown.
 */
export function vehicleSearchText(v) {
    return [
        vehicleLabel(v), v?.make, v?.model, v?.manufacturer?.name,
        v?.platforms?.mechanical?.name, v?.platforms?.electrical?.name,
        ...(v?.tags ?? []).map(t => t?.name),
    ].filter(Boolean).join(' ').toLowerCase();
}

/**
 * The line under the name on a card's media band: what the car IS, where
 * `vehicleLabel` is what we CALL it.
 *
 * Here rather than inline in the card because the crop step previews the band
 * before there is a card to look at (#340), and two spellings of the same line
 * is how the preview starts lying about what the card will say. Fields are
 * dropped rather than left blank — a half-filled vehicle reads as "Rivian · R1S"
 * rather than as a row of separators.
 */
export function makeModelLine(v) {
    return [v?.make, v?.model, v?.trim, v?.year].filter(Boolean).join(' · ');
}

// ── Spec inheritance merge ────────────────────────────────────────────────────

/**
 * A vehicle's fully-resolved effective specs: its own value for each field,
 * else the nearest source vehicle's up the whole chain, else what its platform
 * provides (#352, platforms.js `PLATFORM_PROVIDES`).
 *
 * The platform comes LAST and only once, from the vehicle being resolved: a
 * variant that changed its electrical platform (the 2025 R1) must not show what
 * its source's platform provided. `vehicle.platforms` is attached in AppContext
 * (`withPlatforms`); a vehicle without it resolves through the chain alone.
 *
 * Returns a plain specs object (same shape as vehicle.specs).
 */
export function resolveEffectiveSpecs(vehicle, vehicles) {
    return specProvenance(vehicle, vehicles).specs;
}

/**
 * Own specs merged over every ancestor's — the chain without any platform.
 *
 * _visited: Set of vehicle IDs already seen this walk; stops infinite loops
 * caused by circular spec_source_vehicle_id references.
 */
function chainSpecs(vehicle, vehicles, _visited = new Set()) {
    if (!vehicle) return {};

    const parent = vehicle.spec_source_vehicle_id
        ? vehicles.find(v => v.id === vehicle.spec_source_vehicle_id)
        : null;

    if (!parent || _visited.has(parent.id)) {
        // No parent, or cycle detected — own specs are the effective specs.
        return vehicle.specs ?? {};
    }

    const visited = new Set([..._visited, vehicle.id]);
    const { merged } = mergeInheritedSpecs(vehicle.specs, chainSpecs(parent, vehicles, visited));
    return merged;
}

/**
 * What a vehicle shows where its own field is blank: its source chain's value,
 * else its platform's. The spec editor's hints, and the lower two tiers of
 * `specProvenance`.
 *
 * @param {Object} vehicle
 * @param {Array}  vehicles
 * @param {Object|null} [source]  the source vehicle, when it differs from the
 *        stored one — the spec editor offers a new source before it is saved
 * @returns {{ specs: Object, fromPlatform: Map<string, Object> }}
 *          `fromPlatform` maps each "category.field" the platform supplied —
 *          blank all the way up the chain — to that platform
 */
export function fallbackSpecs(vehicle, vehicles, source = sourceVehicleOf(vehicle, vehicles)) {
    const ancestors = source ? chainSpecs(source, vehicles, new Set([vehicle?.id])) : null;
    const provided = platformProvides(vehicle?.platforms);
    const { merged, inheritedKeys } = mergeInheritedSpecs(ancestors, provided.specs);
    const fromPlatform = new Map([...inheritedKeys].filter(k => provided.from.has(k)).map(k => [k, provided.from.get(k)]));
    return { specs: merged, fromPlatform };
}

/**
 * A vehicle's effective specs, with where each value that is not its own came
 * from — what every place that marks an inherited spec reads (View Specs, the
 * vehicle table's notes, Data Checks).
 *
 * @returns {{ specs: Object, source: Object|null, inheritedKeys: Set<string>, fromPlatform: Map<string, Object> }}
 *   `inheritedKeys` — "category.field" keys that came from the source vehicle;
 *   `fromPlatform`  — keys a platform provided, to the platform
 */
export function specProvenance(vehicle, vehicles = []) {
    if (!vehicle) return { specs: {}, source: null, inheritedKeys: new Set(), fromPlatform: new Map() };
    const source = sourceVehicleOf(vehicle, vehicles);
    const fallback = fallbackSpecs(vehicle, vehicles, source);
    const { merged, inheritedKeys } = mergeInheritedSpecs(vehicle.specs, fallback.specs);
    const fromPlatform = new Map();
    for (const key of [...inheritedKeys]) {
        if (!fallback.fromPlatform.has(key)) continue;
        fromPlatform.set(key, fallback.fromPlatform.get(key));
        inheritedKeys.delete(key);
    }
    return { specs: merged, source, inheritedKeys, fromPlatform };
}

/** The vehicle a vehicle's specs inherit from, or null (missing, or itself). */
function sourceVehicleOf(vehicle, vehicles = []) {
    const id = vehicle?.spec_source_vehicle_id;
    if (id == null || id === vehicle.id) return null;
    return vehicles.find(v => v.id === id) ?? null;
}

/**
 * A vehicle's battery capacity in kWh, for sizing one vehicle's pack against
 * another's (the capacity factor on an inherited test, #185).
 *
 * The resolved `socWindowKwh` (vehicleFigures.js, attached in AppContext):
 * EPA tested, else Usable, else Gross, through spec inheritance — a trim that
 * shares its parent's pack has no battery figure of its own, and the honest
 * answer there is the parent's, not "unknown".
 *
 * Returns null rather than 0 when nothing is recorded, so a caller can tell
 * "no battery figure" from a real value and decline to suggest a ratio.
 */
export function packKwh(vehicle) {
    return vehicle?.socWindowKwh > 0 ? vehicle.socWindowKwh : null;
}

/**
 * Merge own (override) specs with source (inherited) specs.
 * Returns:
 *   merged       — the effective spec object to display
 *   inheritedKeys — Set<string> of "cat.field" keys that came from the source
 *                   (i.e., own value was blank, source value was used)
 */
export function mergeInheritedSpecs(ownSpecs, sourceSpecs) {
    if (!sourceSpecs) return { merged: ownSpecs ?? {}, inheritedKeys: new Set() };

    const merged = {};
    const inheritedKeys = new Set();

    for (const cat of SPEC_CATEGORIES) {
        const own = ownSpecs?.[cat.key] ?? {};
        const src = sourceSpecs?.[cat.key] ?? {};
        merged[cat.key] = {};

        for (const field of cat.fields) {
            const ownVal = own[field.key];
            const hasOwn = ownVal !== null && ownVal !== undefined && ownVal !== '';
            if (hasOwn) {
                merged[cat.key][field.key] = ownVal;
            } else {
                const srcVal = src[field.key];
                const hasSrc = srcVal !== null && srcVal !== undefined && srcVal !== '';
                merged[cat.key][field.key] = hasSrc ? srcVal : null;
                if (hasSrc) inheritedKeys.add(`${cat.key}.${field.key}`);
            }
        }

        // Custom fields: own overrides source; inherited if only in source
        const ownCustom = own._custom ?? {};
        const srcCustom = src._custom ?? {};
        merged[cat.key]._custom = { ...srcCustom, ...ownCustom };
        for (const k of Object.keys(srcCustom)) {
            if (!ownCustom[k]) inheritedKeys.add(`${cat.key}._custom.${k}`);
        }
    }

    return { merged, inheritedKeys };
}

// ── Built-in vehicle-level fields ─────────────────────────────────────────────

export function makeVehicleFields(units) {
    return [
        { key: 'vehicle.year',    label: 'Year',                              type: 'integer' },
        // The resolved figures, not the hand-typed columns (#323, #324).
        { key: 'vehicle.socWindowKwh', label: 'Battery (kWh)',                     type: 'number'  },
        { key: 'vehicle.epaRangeMi',   label: `EPA Range (${distanceLabel(units)})`, type: 'number', unitGroup: 'distance' },
    ];
}

// ── Color palette ─────────────────────────────────────────────────────────────

/**
 * Re-exported, not declared. The eight live in colorUtils beside the palette
 * the picker offers instead of them, so "which set is this color from?" has
 * one place to be answered. Four views import PALETTE from here; the name
 * stays so they do not have to care.
 */
export { LEGACY_PALETTE as PALETTE } from './colorUtils';
import { LEGACY_PALETTE } from './colorUtils';

export function vehicleColor(vehicle, idx) {
    return vehicle.color || LEGACY_PALETTE[idx % LEGACY_PALETTE.length];
}

// ── Field group builder (drives all optgroup dropdowns) ───────────────────────

export function buildFieldGroups(vehicles, vehicleFields) {
    const catCustomKeys = {};
    for (const v of vehicles) {
        if (!v.specs) continue;
        for (const cat of SPEC_CATEGORIES) {
            const custom = v.specs[cat.key]?._custom || {};
            if (!catCustomKeys[cat.key]) catCustomKeys[cat.key] = new Set();
            for (const ck of Object.keys(custom)) catCustomKeys[cat.key].add(ck);
        }
    }

    const groups = [{ groupLabel: 'Vehicle', fields: vehicleFields }];
    for (const cat of SPEC_CATEGORIES) {
        const customKeys = [...(catCustomKeys[cat.key] || new Set())];
        const fields = [
            ...cat.fields.map(f => ({ key: `${cat.key}.${f.key}`, label: f.label, type: f.type, unitGroup: f.unitGroup })),
            ...customKeys.map(ck => ({ key: `${cat.key}._custom.${ck}`, label: formatCustomKey(ck), type: 'text' })),
        ];
        if (fields.length) groups.push({ groupLabel: cat.label, fields });
    }
    return groups;
}

// ── Field definition lookup ───────────────────────────────────────────────────

export function getFieldDef(fieldKey, vehicleFields) {
    if (fieldKey.startsWith('vehicle.')) {
        return (vehicleFields || []).find(f => f.key === fieldKey) || { type: 'number' };
    }
    const [catKey, sub] = fieldKey.split('.');
    if (sub === '_custom') return { type: 'text' };
    const cat = SPEC_CATEGORIES.find(c => c.key === catKey);
    return cat?.fields.find(f => f.key === sub) || { type: 'text' };
}

// ── Value extraction from a vehicle object ────────────────────────────────────

export function extractValue(vehicle, fieldKey) {
    if (fieldKey.startsWith('vehicle.')) return vehicle[fieldKey.split('.')[1]] ?? null;
    const [catKey, sub, customKey] = fieldKey.split('.');
    const catData = vehicle.specs?.[catKey];
    if (!catData) return null;
    if (sub === '_custom') return catData._custom?.[customKey] ?? null;
    return catData[sub] ?? null;
}

// ── Numeric / categorical / boolean mode detection ────────────────────────────

export function detectMode(vehicles, fieldKey, fieldDef) {
    if (fieldDef?.type === 'boolean') return 'boolean';
    const vals = vehicles
        .map(v => extractValue(v, fieldKey))
        .filter(v => v !== null && v !== undefined && v !== '');
    if (!vals.length) return 'numeric';
    if (vals.every(v => !isNaN(parseFloat(String(v))))) return 'numeric';
    return 'categorical';
}

// ── Numeric label formatting ──────────────────────────────────────────────────

export function formatNumericLabel(n) {
    if (n === null || n === undefined) return '—';
    return Number.isInteger(n) ? String(n) : parseFloat(n.toFixed(2)).toString();
}

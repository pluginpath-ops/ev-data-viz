import { SPEC_CATEGORIES, formatCustomKey } from './vehicleSpecSchema';
import { distanceLabel } from './unitConversions';

// ── Vehicle display label ─────────────────────────────────────────────────────

export function vehicleLabel(v) {
    const base = v?.year ? `${v.year} ${v.name}` : (v?.name ?? '');
    return v?.trim ? `${base} · ${v.trim}` : base;
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
 * Walk the full ancestor chain for a vehicle and return its fully-resolved
 * effective specs — own fields merged over all ancestors — so that grandchild
 * vehicles see values that were only set on a grandparent.
 *
 * _visited: Set of vehicle IDs already seen this walk; stops infinite loops
 * caused by circular spec_source_vehicle_id references.
 *
 * Returns a plain specs object (same shape as vehicle.specs).
 */
export function resolveEffectiveSpecs(vehicle, vehicles, _visited = new Set()) {
    if (!vehicle) return {};

    const parent = vehicle.spec_source_vehicle_id
        ? vehicles.find(v => v.id === vehicle.spec_source_vehicle_id)
        : null;

    if (!parent || _visited.has(parent.id)) {
        // No parent, or cycle detected — own specs are the effective specs.
        return vehicle.specs ?? {};
    }

    const visited = new Set([..._visited, vehicle.id]);
    const parentEffective = resolveEffectiveSpecs(parent, vehicles, visited);
    const { merged } = mergeInheritedSpecs(vehicle.specs, parentEffective);
    return merged;
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

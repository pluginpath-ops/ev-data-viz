import { SPEC_CATEGORIES, formatCustomKey } from './vehicleSpecSchema';
import { distanceLabel } from './unitConversions';

// ── Vehicle display label ─────────────────────────────────────────────────────

export function vehicleLabel(v) {
    const base = v?.year ? `${v.year} ${v.name}` : (v?.name ?? '');
    return v?.trim ? `${base} · ${v.trim}` : base;
}

// ── Spec inheritance merge ────────────────────────────────────────────────────

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
        { key: 'vehicle.battery', label: 'Battery (kWh)',                     type: 'number'  },
        { key: 'vehicle.range',   label: `EPA Range (${distanceLabel(units)})`, type: 'number', unitGroup: 'distance' },
    ];
}

// ── Color palette ─────────────────────────────────────────────────────────────

export const PALETTE = [
    '#6366f1', '#f59e0b', '#10b981', '#ef4444',
    '#3b82f6', '#a855f7', '#ec4899', '#14b8a6',
];

export function vehicleColor(vehicle, idx) {
    return vehicle.color || PALETTE[idx % PALETTE.length];
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

/**
 * Bulk vehicle import planner — diffs parsed rows (from parseVehicleImport) against
 * the vehicles already in the database and produces an executable, reviewable plan.
 *
 * Merge policy is fill-blanks: an existing non-empty value is never overwritten.
 * A row that matches an existing vehicle only writes the fields that are currently
 * empty, so the same file can be re-uploaded safely after it has been expanded.
 *
 * Pure module — the plan it returns is handed to AppContext.importVehicles() to run.
 */
import { SPEC_CATEGORIES } from './vehicleSpecSchema';
import { vehicleLabel } from './specHelpers';

const isBlank = v => v === null || v === undefined || v === '';

const lower = s => String(s ?? '').trim().toLowerCase();

// Core columns written straight to the vehicles row (manufacturer is resolved separately).
const CORE_WRITE_FIELDS = ['name', 'make', 'model', 'trim', 'year', 'battery', 'range', 'power'];

const FIELD_LABELS = new Map();
for (const cat of SPEC_CATEGORIES) {
    for (const field of cat.fields) {
        FIELD_LABELS.set(`${cat.key}.${field.key}`, `${cat.label} › ${field.label}`);
    }
}

/** Human-readable label for a written field path, for the preview table. */
export function fieldPathLabel(path) {
    return FIELD_LABELS.get(path) ?? path;
}

// ── Matching ─────────────────────────────────────────────────────────────────

/**
 * Find the existing vehicle a row refers to: explicit id wins, then an exact
 * (case-insensitive) name match, then a full make/model/trim/year match.
 * Returns { vehicle, by } or { vehicle: null }.
 */
function matchExisting(row, vehicles) {
    if (row.core.id != null) {
        const byId = vehicles.find(v => Number(v.id) === Number(row.core.id));
        return { vehicle: byId ?? null, by: byId ? 'id' : null, missingId: !byId };
    }
    if (row.core.name) {
        const byName = vehicles.find(v => lower(v.name) === lower(row.core.name));
        if (byName) return { vehicle: byName, by: 'name' };
    }
    const { make, model, trim, year } = row.core;
    const makeName = make || row.manufacturerName;
    if (makeName && model) {
        const byParts = vehicles.find(v =>
            lower(v.make) === lower(makeName) &&
            lower(v.model) === lower(model) &&
            lower(v.trim) === lower(trim) &&
            lower(v.year) === lower(year)
        );
        if (byParts) return { vehicle: byParts, by: 'make/model/trim/year' };
    }
    return { vehicle: null, by: null };
}

/**
 * Resolve an "inherits from" reference to an existing vehicle id, or to another
 * row in the same file (resolved after that row's vehicle is created).
 */
function resolveInheritRef(ref, vehicles, rowsByName) {
    const asNumber = Number(ref);
    if (Number.isFinite(asNumber) && String(asNumber) === String(ref).trim()) {
        const byId = vehicles.find(v => Number(v.id) === asNumber);
        return byId ? { vehicleId: byId.id } : { error: `No vehicle with id ${ref}` };
    }
    const key = lower(ref);
    const byName = vehicles.find(v => lower(v.name) === key || lower(vehicleLabel(v)) === key);
    if (byName) return { vehicleId: byName.id };
    if (rowsByName.has(key)) return { rowIndex: rowsByName.get(key) };
    return { error: `"${ref}" matches no existing vehicle or row in this file` };
}

// ── Spec merging ─────────────────────────────────────────────────────────────

/**
 * Merge a row's specs into a vehicle's own specs, filling blanks only.
 *
 * Returns the full merged blob (updateVehicleSpecs replaces the whole JSONB
 * column, so the caller must send everything), plus the written/skipped paths
 * for the preview.
 */
function mergeSpecs(existingSpecs, row) {
    const merged = {};
    for (const [catKey, catData] of Object.entries(existingSpecs || {})) {
        merged[catKey] = { ...catData, ...(catData?._custom ? { _custom: { ...catData._custom } } : {}) };
    }

    const written = [];
    const skipped = [];

    for (const [catKey, fields] of Object.entries(row.specs)) {
        for (const [fieldKey, value] of Object.entries(fields)) {
            const current = merged[catKey]?.[fieldKey];
            const path = `${catKey}.${fieldKey}`;
            if (isBlank(current)) {
                merged[catKey] = { ...merged[catKey], [fieldKey]: value };
                written.push({ path, value });
            } else {
                skipped.push({ path, value, current });
            }
        }
    }

    for (const [catKey, customFields] of Object.entries(row.custom)) {
        for (const [customKey, value] of Object.entries(customFields)) {
            const current = merged[catKey]?._custom?.[customKey];
            const path = `${catKey}._custom.${customKey}`;
            if (isBlank(current)) {
                merged[catKey] = {
                    ...merged[catKey],
                    _custom: { ...(merged[catKey]?._custom || {}), [customKey]: value },
                };
                written.push({ path, value });
            } else {
                skipped.push({ path, value, current });
            }
        }
    }

    return { merged, written, skipped };
}

// ── Plan builder ─────────────────────────────────────────────────────────────

/**
 * Build the import plan.
 *
 * @param {Array}  rows            parsed rows from parseVehicleImportText
 * @param {Object} ctx             { vehicles, manufacturers, tags } current app state
 * @returns {{ rows: Array, summary: Object }}
 *
 * Each planned row carries everything the executor needs:
 *   action           'create' | 'update' | 'skip' | 'error'
 *   label            display name for the preview
 *   vehicleId        matched existing vehicle (update only)
 *   coreWrites       { field: value } to write to the vehicles row
 *   mergedSpecs      full specs blob to persist (write it only if needsSpecWrite)
 *   specWrites       [{ path, value }] filled fields, for the preview
 *   specSkips        [{ path, value, current }] fields left alone
 *   manufacturerName brand to attach (existing or newly created)
 *   tagNames         tags to attach (union with the vehicle's current tags)
 *   inherit          { vehicleId } | { rowIndex } | null
 */
export function buildImportPlan(rows, { vehicles = [], manufacturers = [], tags = [] } = {}) {
    // Name → row index, so inherits_from can point at a vehicle created by this same file.
    const rowsByName = new Map();
    rows.forEach((row, i) => {
        if (row.core.name) rowsByName.set(lower(row.core.name), i);
    });

    const seenNames = new Set();
    const newManufacturers = new Map(); // lowercased name → display name
    const newTags = new Map();

    const planned = rows.map((row, i) => {
        const errors = [...row.errors];
        const warnings = [...row.warnings];

        const { vehicle: existing, by, missingId } = matchExisting(row, vehicles);
        if (missingId) errors.push(`No vehicle with id ${row.core.id}.`);

        const label = row.core.name
            || [row.core.year, row.manufacturerName || row.core.make, row.core.model, row.core.trim].filter(Boolean).join(' ')
            || (existing ? vehicleLabel(existing) : `Row ${row.index + 1}`);

        // Duplicate names inside one file would race each other on create.
        const nameKey = lower(row.core.name);
        if (nameKey) {
            if (seenNames.has(nameKey)) errors.push('Duplicate of an earlier row with the same name.');
            else seenNames.add(nameKey);
        }

        // ── Manufacturer ──
        let manufacturerName = null;
        let manufacturerIsNew = false;
        const mfgRef = row.manufacturerName || (!existing ? row.core.make : null);
        if (mfgRef) {
            const found = manufacturers.find(m => lower(m.name) === lower(mfgRef));
            // Only attach a brand when the vehicle doesn't already have one (fill-blanks).
            if (!existing || !existing.manufacturer) {
                manufacturerName = found ? found.name : mfgRef;
                manufacturerIsNew = !found;
                if (!found) newManufacturers.set(lower(mfgRef), mfgRef);
            }
        }

        // ── Core fields ──
        const coreWrites = {};
        for (const key of CORE_WRITE_FIELDS) {
            const incoming = row.core[key];
            if (isBlank(incoming)) continue;
            if (!existing || isBlank(existing[key])) coreWrites[key] = incoming;
        }
        // A brand implies the make text when the vehicle has none of its own.
        if (manufacturerName && isBlank(coreWrites.make) && (!existing || isBlank(existing.make))) {
            coreWrites.make = manufacturerName;
        }
        if (!existing && !coreWrites.name) {
            coreWrites.name = label;
        }

        // ── Specs ──
        const { merged, written, skipped } = mergeSpecs(existing?.specs, row);

        // ── Tags ──
        const currentTagNames = new Set((existing?.tags || []).map(t => lower(t.name)));
        const tagNames = row.tagNames.filter(name => !currentTagNames.has(lower(name)));
        for (const name of tagNames) {
            if (!tags.some(t => lower(t.name) === lower(name))) newTags.set(lower(name), name);
        }

        // ── Inheritance link ──
        let inherit = null;
        if (row.inheritsFrom) {
            if (existing?.spec_source_vehicle_id) {
                warnings.push(`Already inherits from another vehicle — "${row.inheritsFrom}" ignored.`);
            } else {
                const resolved = resolveInheritRef(row.inheritsFrom, vehicles, rowsByName);
                // An unusable link is reported and dropped, not fatal — the rest
                // of the row is still worth importing.
                if (resolved.error) warnings.push(`inherits_from: ${resolved.error} — link skipped.`);
                else if (resolved.rowIndex === i) warnings.push('inherits_from: a vehicle cannot inherit from itself — link skipped.');
                else inherit = resolved;
            }
        }

        const hasWork = Object.keys(coreWrites).length > 0
            || written.length > 0
            || tagNames.length > 0
            || !!manufacturerName
            || !!inherit;

        let action;
        if (errors.length) action = 'error';
        else if (!existing) action = 'create';
        else if (hasWork) action = 'update';
        else action = 'skip';

        return {
            index: row.index,
            label,
            action,
            matchedBy: by,
            vehicleId: existing?.id ?? null,
            coreWrites,
            // Always the FULL blob — updateVehicleSpecs replaces the whole JSONB
            // column, so a link-only write must still carry the existing specs.
            mergedSpecs: merged,
            needsSpecWrite: written.length > 0 || !!inherit,
            specWrites: written,
            specSkips: skipped,
            manufacturerName,
            manufacturerIsNew,
            tagNames,
            inherit,
            inheritRef: inherit ? row.inheritsFrom : null,
            fieldSkips: row.skipped,   // values that could not be read — reported, not written
            coercions: row.coercions,  // loose enum matches, shown so they can be checked
            errors,
            warnings,
        };
    });

    const summary = {
        total:    planned.length,
        creates:  planned.filter(r => r.action === 'create').length,
        updates:  planned.filter(r => r.action === 'update').length,
        skips:    planned.filter(r => r.action === 'skip').length,
        errors:   planned.filter(r => r.action === 'error').length,
        fieldWrites: planned
            .filter(r => r.action !== 'error')
            .reduce((n, r) => n + r.specWrites.length + Object.keys(r.coreWrites).length, 0),
        fieldSkips:  planned.reduce((n, r) => n + r.fieldSkips.length, 0),
        coercions:   planned.reduce((n, r) => n + r.coercions.length, 0),
        newManufacturers: [...newManufacturers.values()],
        newTags: [...newTags.values()],
    };

    return { rows: planned, summary };
}

/**
 * Narrow a plan to the rows the user ticked in the preview.
 *
 * Deselected rows are demoted to 'skip' rather than removed — inherits_from
 * references point at plan-row indexes, so the array must keep its shape.
 */
export function selectPlanRows(plan, selectedIndexes) {
    const rows = plan.rows.map((row, i) =>
        selectedIndexes.has(i) ? row : { ...row, action: 'skip' }
    );
    const kept = rows.filter(r => r.action === 'create' || r.action === 'update');
    const keptTagNames = new Set(kept.flatMap(r => r.tagNames.map(lower)));

    return {
        rows,
        summary: {
            ...plan.summary,
            creates: kept.filter(r => r.action === 'create').length,
            updates: kept.filter(r => r.action === 'update').length,
            fieldWrites: kept.reduce((n, r) => n + r.specWrites.length + Object.keys(r.coreWrites).length, 0),
            newManufacturers: [...new Set(
                kept.filter(r => r.manufacturerIsNew && r.manufacturerName).map(r => r.manufacturerName)
            )],
            newTags: plan.summary.newTags.filter(name => keptTagNames.has(lower(name))),
        },
    };
}

// ── Templates ────────────────────────────────────────────────────────────────

// Columns every template leads with, in the order a person would fill them in.
const TEMPLATE_CORE = ['name', 'manufacturer', 'model', 'trim', 'year', 'battery', 'range', 'tags', 'inherits_from'];

/** Header row + one example row covering every core column and spec field. */
export function buildCsvTemplate() {
    const specColumns = SPEC_CATEGORIES.flatMap(cat => cat.fields.map(f => `${cat.key}.${f.key}`));
    const header = [...TEMPLATE_CORE, ...specColumns];
    const example = header.map(col => {
        switch (col) {
            case 'name':          return 'Model 3 Long Range 2026';
            case 'manufacturer':  return 'Tesla';
            case 'model':         return 'Model 3';
            case 'trim':          return 'Long Range AWD';
            case 'year':          return '2026';
            case 'battery':       return '75';
            case 'range':         return '363';
            case 'tags':          return 'sedan;awd';
            case 'inherits_from': return '';
            default:              return '';
        }
    });
    return `${header.join(',')}\n${example.join(',')}\n`;
}

/** A single-vehicle JSON skeleton with every spec field present and null. */
export function buildJsonTemplate() {
    const specs = {};
    for (const cat of SPEC_CATEGORIES) {
        specs[cat.key] = Object.fromEntries(cat.fields.map(f => [f.key, null]));
    }
    return JSON.stringify([{
        name: 'Model 3 Long Range 2026',
        manufacturer: 'Tesla',
        model: 'Model 3',
        trim: 'Long Range AWD',
        year: 2026,
        battery: 75,
        range: 363,
        tags: ['sedan', 'awd'],
        inherits_from: null,
        specs,
    }], null, 2);
}

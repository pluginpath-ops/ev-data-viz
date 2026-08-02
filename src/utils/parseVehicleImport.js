/**
 * Bulk vehicle import parser — turns a CSV or JSON file into normalised rows
 * that buildImportPlan() can diff against the existing vehicle list.
 *
 * The parser is deliberately forgiving about column naming so a spreadsheet
 * assembled by hand still lands. A column may be written as:
 *   • a core vehicle field or alias      — "name", "brand", "epa range"
 *   • a qualified spec path              — "powertrain.horsepower_hp"
 *   • a bare spec field key              — "horsepower_hp"
 *   • the schema's display label         — "Horsepower (hp)", "0–60 mph (sec)"
 *   • a custom field path                — "powertrain._custom.gear_ratio"
 *
 * Values are coerced per the schema field type; anything that can't be coerced
 * becomes a row-level error rather than silently writing junk to the DB.
 *
 * Pure module — no React, no network. Everything runs in the browser.
 */
import Papa from 'papaparse';
import { SPEC_CATEGORIES, normalizeCustomKey } from './vehicleSpecSchema';

// ── Header normalisation ─────────────────────────────────────────────────────

/**
 * Fold a header/key to a comparison form: camelCase split, lowercased, non-word
 * runs collapsed to underscores, dots preserved so qualified paths survive.
 * e.g. "0–60 mph (sec)" → "0_60_mph_sec"; "vehicleName" → "vehicle_name";
 *      "Powertrain.Horsepower (hp)" → "powertrain.horsepower_hp"
 */
export function normKey(raw) {
    return String(raw ?? '')
        .trim()
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')   // camelCase → camel_Case
        .toLowerCase()
        .replace(/[^\w.]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^[._]+|[._]+$/g, '');
}

// ── Core vehicle columns ─────────────────────────────────────────────────────

// Columns stored directly on the `vehicles` row (plus the two link columns).
// First alias in each list is the canonical name used in templates.
const CORE_ALIASES = {
    id:            ['id', 'vehicle_id'],
    name:          ['name', 'vehicle', 'vehicle_name', 'display_name'],
    manufacturer:  ['manufacturer', 'brand'],
    make:          ['make'],
    model:         ['model'],
    trim:          ['trim'],
    year:          ['year', 'model_year'],
    battery:       ['battery', 'battery_kwh'],
    range:         ['range', 'epa_range', 'epa_range_mi', 'range_mi'],
    power:         ['power', 'power_kw'],
    tags:          ['tags', 'tag'],
    inherits_from: ['inherits_from', 'inherit_from', 'inherits', 'spec_source', 'spec_parent', 'parent'],
};

const CORE_INDEX = new Map();
for (const [key, aliases] of Object.entries(CORE_ALIASES)) {
    for (const alias of aliases) CORE_INDEX.set(normKey(alias), key);
}

// Core fields that must parse as a number.
const NUMERIC_CORE = new Set(['battery', 'range', 'power']);

// ── Spec column indexes (built once from the schema) ─────────────────────────

const QUALIFIED_INDEX = new Map(); // "powertrain.horsepower_hp" → entry
const BARE_INDEX      = new Map(); // "horsepower_hp"            → [entry, …]
const LABEL_INDEX     = new Map(); // "horsepower_hp" (from label) → [entry, …]

for (const cat of SPEC_CATEGORIES) {
    for (const field of cat.fields) {
        const entry = { catKey: cat.key, fieldKey: field.key, field };
        QUALIFIED_INDEX.set(normKey(`${cat.key}.${field.key}`), entry);
        for (const [index, key] of [[BARE_INDEX, field.key], [LABEL_INDEX, field.label]]) {
            const n = normKey(key);
            if (!index.has(n)) index.set(n, []);
            index.get(n).push(entry);
        }
        // Category-qualified label, e.g. "Powertrain.Horsepower (hp)"
        QUALIFIED_INDEX.set(normKey(`${cat.key}.${field.label}`), entry);
    }
}

const CATEGORY_BY_KEY = new Map(SPEC_CATEGORIES.map(c => [normKey(c.key), c]));

/**
 * Resolve a column header to a destination.
 * Returns one of:
 *   { kind: 'core',   key }
 *   { kind: 'spec',   catKey, fieldKey, field }
 *   { kind: 'custom', catKey, customKey }
 *   { kind: 'unknown' | 'ambiguous', header, candidates? }
 */
export function resolveColumn(header) {
    const n = normKey(header);
    if (!n) return { kind: 'unknown', header };

    if (CORE_INDEX.has(n)) return { kind: 'core', key: CORE_INDEX.get(n) };

    // Strip an optional "specs." prefix so exported envelopes paste in cleanly.
    const path = n.startsWith('specs.') ? n.slice('specs.'.length) : n;

    // Custom field: "<category>._custom.<key>" (also accepts "<category>.custom.<key>")
    const customMatch = path.match(/^([\w]+)\.(?:_custom|custom)\.(.+)$/);
    if (customMatch) {
        const cat = CATEGORY_BY_KEY.get(customMatch[1]);
        if (cat) return { kind: 'custom', catKey: cat.key, customKey: normalizeCustomKey(customMatch[2]) };
        return { kind: 'unknown', header };
    }

    if (QUALIFIED_INDEX.has(path)) return { kind: 'spec', ...QUALIFIED_INDEX.get(path) };

    for (const index of [BARE_INDEX, LABEL_INDEX]) {
        const hits = index.get(path);
        if (hits?.length === 1) return { kind: 'spec', ...hits[0] };
        if (hits?.length > 1) {
            return {
                kind: 'ambiguous',
                header,
                candidates: hits.map(h => `${h.catKey}.${h.fieldKey}`),
            };
        }
    }

    return { kind: 'unknown', header };
}

// ── Value coercion ───────────────────────────────────────────────────────────

const TRUE_WORDS  = new Set(['true', 'yes', 'y', '1', 'std', 'standard']);
const FALSE_WORDS = new Set(['false', 'no', 'n', '0', 'none', 'n/a', 'na']);

function coerceNumber(raw, { integer = false } = {}) {
    if (typeof raw === 'number') {
        return Number.isFinite(raw) ? { value: integer ? Math.round(raw) : raw } : { error: 'not a number' };
    }
    // Tolerate thousands separators, currency symbols, and a trailing unit.
    const cleaned = String(raw).replace(/[,$\s]/g, '').replace(/[a-z%°"']+$/i, '');
    if (cleaned === '' || !/^-?\d*\.?\d+$/.test(cleaned)) return { error: `"${raw}" is not a number` };
    const n = Number(cleaned);
    if (!Number.isFinite(n)) return { error: `"${raw}" is not a number` };
    return { value: integer ? Math.round(n) : n };
}

const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Match a value against an enum's options, tolerating values that are more
 * specific than the schema's vocabulary:
 *   "NACS (SAE J3400)"                    → NACS
 *   "Permanent Magnet Synchronous (E-GMP)" → Permanent Magnet
 *
 * An option must match at a word boundary, and exactly one option may match —
 * anything ambiguous or unrecognised is still rejected. A loose match reports
 * `coercedFrom` so the import preview can show what it decided.
 */
function matchEnumOption(raw, options) {
    const s = String(raw).trim();
    const lower = s.toLowerCase();

    const exact = options.find(o => o.toLowerCase() === lower);
    if (exact) return { value: exact };

    // Leading match: the option opens the value and ends on a word boundary.
    const prefix = options.filter(o => {
        const ol = o.toLowerCase();
        return lower.startsWith(ol) && !/[a-z0-9]/.test(lower[ol.length] ?? ' ');
    });
    if (prefix.length === 1) return { value: prefix[0], coercedFrom: s };

    // Otherwise the option may appear as a whole word anywhere in the value.
    const contained = options.filter(o =>
        new RegExp(`\\b${escapeRegExp(o.toLowerCase())}\\b`).test(lower)
    );
    if (contained.length === 1) return { value: contained[0], coercedFrom: s };

    return { error: `"${raw}" is not one of: ${options.join(', ')}` };
}

/**
 * Coerce a raw cell/JSON value for a schema field.
 * Returns { value }, { value, coercedFrom } for a loose enum match, or { error }.
 */
export function coerceValue(raw, field) {
    if (field.type === 'boolean') {
        if (typeof raw === 'boolean') return { value: raw };
        const s = String(raw).trim().toLowerCase();
        if (TRUE_WORDS.has(s))  return { value: true };
        if (FALSE_WORDS.has(s)) return { value: false };
        return { error: `"${raw}" is not Yes/No` };
    }
    if (field.type === 'enum') return matchEnumOption(raw, field.options);
    if (field.type === 'integer') return coerceNumber(raw, { integer: true });
    if (field.type === 'number')  return coerceNumber(raw);
    return { value: String(raw).trim() };
}

function isBlankCell(v) {
    return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

/** Split a tag cell ("suv, awd" or ["suv","awd"]) into a clean name list. */
function parseTagList(raw) {
    const list = Array.isArray(raw) ? raw : String(raw).split(/[,;|]/);
    return [...new Set(list.map(t => String(t).trim()).filter(Boolean))];
}

// ── Row assembly ─────────────────────────────────────────────────────────────

function emptyRow(index) {
    return {
        index,                 // 0-based position in the file (for "Row 3" messages)
        core: {},              // { name, model, year, battery, … }
        manufacturerName: null,
        specs: {},             // { [catKey]: { [fieldKey]: value } }
        custom: {},            // { [catKey]: { [customKey]: value } }
        tagNames: [],
        inheritsFrom: null,    // raw reference (id or vehicle name) — resolved later
        skipped: [],           // [{ path, reason }] values that could not be read
        coercions: [],         // [{ path, from, to }] loose enum matches, for the preview
        errors: [],            // row-fatal problems only (identity, duplicates)
        warnings: [],
    };
}

/**
 * Write one resolved column's value into the row being built.
 *
 * A value that cannot be coerced is recorded on `skipped` rather than failing
 * the row — one over-specific string shouldn't discard the other 30 good fields.
 */
function applyCell(row, target, raw) {
    if (isBlankCell(raw)) return;

    if (target.kind === 'core') {
        const { key } = target;
        if (key === 'tags') { row.tagNames = parseTagList(raw); return; }
        if (key === 'inherits_from') { row.inheritsFrom = String(raw).trim(); return; }
        if (key === 'manufacturer') { row.manufacturerName = String(raw).trim(); return; }
        if (NUMERIC_CORE.has(key)) {
            const { value, error } = coerceNumber(raw);
            if (error) row.skipped.push({ path: key, reason: error });
            else row.core[key] = value;
            return;
        }
        if (key === 'id') {
            const { value, error } = coerceNumber(raw, { integer: true });
            if (error) row.errors.push(`id: ${error}`);
            else row.core.id = value;
            return;
        }
        // name / make / model / trim / year are free text (year can be "2022-2024")
        row.core[key] = String(raw).trim();
        return;
    }

    if (target.kind === 'spec') {
        const path = `${target.catKey}.${target.fieldKey}`;
        const { value, error, coercedFrom } = coerceValue(raw, target.field);
        if (error) {
            row.skipped.push({ path, reason: error });
        } else {
            if (coercedFrom !== undefined) row.coercions.push({ path, from: coercedFrom, to: value });
            row.specs[target.catKey] = { ...row.specs[target.catKey], [target.fieldKey]: value };
        }
        return;
    }

    if (target.kind === 'custom') {
        row.custom[target.catKey] = {
            ...row.custom[target.catKey],
            [target.customKey]: String(raw).trim(),
        };
    }
}

/** True when a row carries nothing but blanks. */
function rowIsEmpty(row) {
    return Object.keys(row.core).length === 0
        && !row.manufacturerName
        && Object.keys(row.specs).length === 0
        && Object.keys(row.custom).length === 0
        && row.tagNames.length === 0
        && !row.inheritsFrom
        && row.skipped.length === 0
        && row.errors.length === 0;
}

/**
 * Build a row from a flat key→value object (a CSV record, or a JSON object's
 * top-level keys). Unknown/ambiguous headers are collected on `columnIssues`.
 */
function rowFromFlatObject(obj, index, columnIssues) {
    const row = emptyRow(index);
    for (const [header, raw] of Object.entries(obj)) {
        if (isBlankCell(raw)) continue;
        const target = resolveColumn(header);
        if (target.kind === 'unknown' || target.kind === 'ambiguous') {
            columnIssues.set(header, target);
            continue;
        }
        applyCell(row, target, raw);
    }
    return row;
}

/** Merge a nested `specs: { category: { field: value } }` object into a row. */
function applyNestedSpecs(row, specsObj, columnIssues) {
    for (const [catName, catData] of Object.entries(specsObj || {})) {
        const cat = CATEGORY_BY_KEY.get(normKey(catName));
        if (!cat || typeof catData !== 'object' || catData === null) {
            if (!cat) columnIssues.set(`specs.${catName}`, { kind: 'unknown', header: `specs.${catName}` });
            continue;
        }
        for (const [fieldName, raw] of Object.entries(catData)) {
            if (normKey(fieldName) === '_custom' || normKey(fieldName) === 'custom') {
                for (const [customKey, customVal] of Object.entries(raw || {})) {
                    if (isBlankCell(customVal)) continue;
                    applyCell(row, {
                        kind: 'custom',
                        catKey: cat.key,
                        customKey: normalizeCustomKey(customKey),
                    }, customVal);
                }
                continue;
            }
            if (isBlankCell(raw)) continue;
            const target = resolveColumn(`${cat.key}.${fieldName}`);
            if (target.kind === 'unknown' || target.kind === 'ambiguous') {
                columnIssues.set(`${cat.key}.${fieldName}`, target);
                continue;
            }
            applyCell(row, target, raw);
        }
    }
}

// ── Public entry points ──────────────────────────────────────────────────────

/**
 * Parse JSON text into rows. Accepted shapes:
 *   [ {...}, {...} ]                    — array of vehicles
 *   { vehicles: [ … ] }                 — wrapped array
 *   { name: …, specs: { … } }           — a single vehicle
 *   { vehicleName: …, specs: { … } }    — the Edit Specs export envelope
 * Each vehicle may carry specs nested under `specs`, or as flat dotted keys.
 */
function parseJsonRows(text) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (e) {
        return { rows: [], columnIssues: new Map(), fileError: `Invalid JSON — ${e.message}` };
    }

    let list;
    if (Array.isArray(parsed)) list = parsed;
    else if (Array.isArray(parsed?.vehicles)) list = parsed.vehicles;
    else if (parsed && typeof parsed === 'object') list = [parsed];
    else return { rows: [], columnIssues: new Map(), fileError: 'JSON must be a vehicle object or an array of them.' };

    const columnIssues = new Map();
    const rows = list.map((entry, i) => {
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
            const row = emptyRow(i);
            row.errors.push('Entry is not a vehicle object.');
            return row;
        }
        const { specs, ...flat } = entry;
        const row = rowFromFlatObject(flat, i, columnIssues);
        if (specs && typeof specs === 'object') applyNestedSpecs(row, specs, columnIssues);
        return row;
    });

    return { rows, columnIssues, fileError: null };
}

/** Parse CSV text into rows using the header line as column names. */
function parseCsvRows(text) {
    const result = Papa.parse(text, {
        header: true,
        skipEmptyLines: 'greedy',
        dynamicTyping: false,
        transformHeader: h => String(h).trim(),
    });

    if (!result.meta?.fields?.length) {
        return { rows: [], columnIssues: new Map(), fileError: 'CSV has no header row.' };
    }

    const columnIssues = new Map();
    const rows = result.data.map((record, i) => rowFromFlatObject(record, i, columnIssues));
    return { rows, columnIssues, fileError: null };
}

/**
 * Parse an uploaded file's text into import rows.
 *
 * @param {string} text     raw file contents
 * @param {string} fileName used (with a content sniff) to pick the format
 * @returns {{ rows, format, columnIssues: Array, fileError: string|null }}
 *          `rows` excludes entirely-blank rows; each row keeps its original
 *          file index so messages can say "Row 4".
 */
export function parseVehicleImportText(text, fileName = '') {
    const trimmed = String(text || '').trim();
    if (!trimmed) return { rows: [], format: null, columnIssues: [], fileError: 'File is empty.' };

    const looksJson = /\.json$/i.test(fileName) || trimmed.startsWith('{') || trimmed.startsWith('[');
    const format = looksJson ? 'json' : 'csv';
    const { rows, columnIssues, fileError } = looksJson ? parseJsonRows(trimmed) : parseCsvRows(trimmed);

    const kept = rows.filter(r => !rowIsEmpty(r));
    for (const row of kept) {
        if (!row.core.name && !(row.core.make || row.manufacturerName) && !row.core.model && !row.core.id) {
            row.errors.push('No name (or make + model) — cannot identify this vehicle.');
        }
    }

    return {
        rows: kept,
        format,
        columnIssues: [...columnIssues.values()],
        fileError,
    };
}

/**
 * The Cost to Drive key: every setting of the tab packed into one address
 * parameter, `cd=1.…` (docs/cost-to-drive-plan.md).
 *
 * Not meant to be read (owner, 2026-11-07): past about fifty characters an
 * address is unreadable anyway, so the settings are packed and only the
 * vehicles (`v`) stay readable beside it.
 *
 * ── The key ──────────────────────────────────────────────────────────────────
 *   <version>.<URL-safe base64 of the packed fields>
 *
 * Version 1: a varint presence mask (bit i set = field i of FIELDS_V1 follows),
 * then each present field as a varint of its slider index — (value − min) ÷
 * step for a number, 0/1 for a switch, the value's index for a choice, the
 * seven day types as a base-3 number (Monday the low digit), the planned days
 * as a 7-bit mask. A field at its version-1 default is left out, so an
 * untouched page has no key at all.
 *
 * The defaults a key leaves out are FROZEN with the version (V1_DEFAULTS), not
 * read from today's: a key shared now opens the same week after a default
 * moves. A change to the format is a new version, decoded beside this one.
 *
 * Version 2 (2026-11-07): the same fields and packing, with the two miles
 * fields stored to the mile rather than in fives, so a reader can enter 8 mi,
 * gas at $4.00 by default rather than $3.20, and a fill-up at 5 min rather than
 * 8 (V2_DEFAULTS). Keys are written as version 2; a version-1 key still reads,
 * its miles in fives (V1_STEPS) and its gas price and fill-up at version 1's
 * defaults when it left them out.
 *
 * Pure leaf: imports only the constants leaf, so the short link can carry it.
 */
import { COST_TO_DRIVE_FIELDS, DAY_TYPES } from '../constants/costToDrive';

/** The address parameter that carries the key. */
export const COST_TO_DRIVE_PARAM = 'cd';

export const COST_TO_DRIVE_KEY_VERSION = '2';

/** Version 2's fields, in order. The constants list is append-only, so this is its prefix. */
const FIELDS_V2 = COST_TO_DRIVE_FIELDS.slice(0, 33);

/** The steps version 1 stored a field in, where they differ from today's. FROZEN. */
const V1_STEPS = Object.freeze({ dailyMi: 5, longMi: 5 });

/** Version 1's fields: version 2's, with version 1's steps. */
const FIELDS_V1 = FIELDS_V2.map(f => (V1_STEPS[f.key] ? { ...f, step: V1_STEPS[f.key] } : f));

/** Version 1's defaults, frozen: what a version-1 key leaves out. */
const V1_DEFAULTS = Object.freeze({
    level: 4, plugFrom: 22, plugUntil: 7, chargeTo: 80, fullBeforeLong: true, homePrice: 0.17,
    week: 'LDLDLDO', planned: 0b1000000,
    dailyMi: 45, dailyMph: 70, dailyCity: 40, longMi: 220, longMph: 70, longCity: 15,
    detourMin: 10, stopBy: 30, capTo: 70, keepAbove: 10, startMin: 5, fastPrice: 0.48,
    season: 'winter', summerF: 75, winterF: 15, winterMonths: 4, elevationFt: 800,
    gasCity: 18, gasHwy: 24, gasPrice: 3.20, gasTank: 26, gasFillAt: 15, gasFillMin: 8,
    efficiencyFrom: 'tested', plannedHour: 17,
});

/** Version 2's defaults, frozen: version 1's with gas at $4 and a 5-minute fill-up. */
const V2_DEFAULTS = Object.freeze({ ...V1_DEFAULTS, gasPrice: 4.00, gasFillMin: 5 });

const decimalsOf = (step) => String(step).split('.')[1]?.length ?? 0;

/** One setting held to its slider; the field's default when it cannot be read. */
function normalizeField(f, raw) {
    switch (f.kind) {
    case 'bool':
        return typeof raw === 'boolean' ? raw : f.def;
    case 'enum':
        return f.values.includes(raw) ? raw : f.def;
    case 'week':
        return typeof raw === 'string' && raw.length === 7 && [...raw].every(c => DAY_TYPES.includes(c)) ? raw : f.def;
    case 'mask': {
        const n = Number(raw);
        return Number.isInteger(n) && n >= 0 && n < 128 ? n : f.def;
    }
    default: {
        const n = Number(raw);
        if (raw == null || raw === '' || !Number.isFinite(n)) return f.def;
        const held = Math.min(f.max, Math.max(f.min, Math.round((n - f.min) / f.step) * f.step + f.min));
        return Number(held.toFixed(decimalsOf(f.step)));
    }
    }
}

/** Every setting held to its slider, missing or unreadable ones defaulted. */
export function normalizeCostToDrive(settings = {}) {
    return Object.fromEntries(COST_TO_DRIVE_FIELDS.map(f => [f.key, normalizeField(f, settings?.[f.key])]));
}

/** A field's value as a whole number for the key. */
function toIndex(f, v) {
    switch (f.kind) {
    case 'bool': return v ? 1 : 0;
    case 'enum': return f.values.indexOf(v);
    case 'mask': return v;
    case 'week': return [...v].reduceRight((n, c) => n * 3 + DAY_TYPES.indexOf(c), 0);
    default: return Math.round((v - f.min) / f.step);
    }
}

/** A whole number from the key back to the field's value; undefined when out of range. */
function fromIndex(f, n) {
    switch (f.kind) {
    case 'bool': return n <= 1 ? n === 1 : undefined;
    case 'enum': return f.values[n];
    case 'mask': return n < 128 ? n : undefined;
    case 'week': {
        if (n >= 3 ** 7) return undefined;
        let s = '';
        for (let i = 0; i < 7; i++) { s += DAY_TYPES[n % 3]; n = Math.floor(n / 3); }
        return s;
    }
    default: {
        const v = Number((f.min + n * f.step).toFixed(decimalsOf(f.step)));
        return v <= f.max + 1e-9 ? v : undefined;
    }
    }
}

// Varints, seven bits a byte, low first. Arithmetic rather than bit operators:
// the presence mask has more than 31 bits.
function pushVarint(bytes, n) {
    do {
        let b = n % 128;
        n = Math.floor(n / 128);
        if (n > 0) b += 128;
        bytes.push(b);
    } while (n > 0);
}

function readVarint(bytes, at) {
    let n = 0, scale = 1;
    for (let i = at.i; i < bytes.length && i < at.i + 8; i++) {
        const b = bytes[i];
        n += (b % 128) * scale;
        scale *= 128;
        if (b < 128) { at.i = i + 1; return n; }
    }
    throw new Error('truncated');
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function toBase64Url(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
        const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
        const chars = [n >> 18, (n >> 12) & 63, (n >> 6) & 63, n & 63].map(c => B64[c]);
        out += chars.slice(0, Math.min(4, bytes.length - i + 1)).join('');
    }
    return out;
}

function fromBase64Url(text) {
    const vals = [...text].map(c => B64.indexOf(c));
    if (vals.some(v => v < 0)) throw new Error('not base64');
    const bytes = [];
    for (let i = 0; i < vals.length; i += 4) {
        const n = (vals[i] << 18) | ((vals[i + 1] ?? 0) << 12) | ((vals[i + 2] ?? 0) << 6) | (vals[i + 3] ?? 0);
        const count = Math.min(3, vals.length - i - 1);
        for (let k = 0; k < count; k++) bytes.push((n >> (16 - 8 * k)) & 255);
    }
    return bytes;
}

/**
 * The key for a set of settings, or null when every one is at its version-2
 * default (the address then carries no `cd` at all).
 */
export function encodeCostToDriveKey(settings) {
    const s = normalizeCostToDrive(settings);
    let mask = 0;
    const values = [];
    FIELDS_V2.forEach((f, i) => {
        if (s[f.key] === V2_DEFAULTS[f.key]) return;
        mask += 2 ** i;
        values.push(toIndex(f, s[f.key]));
    });
    if (mask === 0) return null;
    const bytes = [];
    pushVarint(bytes, mask);
    values.forEach(v => pushVarint(bytes, v));
    return `${COST_TO_DRIVE_KEY_VERSION}.${toBase64Url(bytes)}`;
}

/**
 * The settings a key holds. A blank key is the defaults; one that cannot be
 * read is the defaults too, with `error` saying why, so the page can tell the
 * reader their link did not carry over rather than silently show other numbers.
 *
 * @returns {{ settings: Object, error: string|null }}
 */
export function decodeCostToDriveKey(key) {
    const defaults = normalizeCostToDrive(V2_DEFAULTS);
    if (key == null || key === '') return { settings: defaults, error: null };
    const dot = String(key).indexOf('.');
    const version = dot < 0 ? '' : key.slice(0, dot);
    const [fields, frozen] = version === '1' ? [FIELDS_V1, V1_DEFAULTS] : version === '2' ? [FIELDS_V2, V2_DEFAULTS] : [];
    if (!fields) {
        return { settings: defaults, error: `This link's settings were made by a newer version of the site (key version ${version || '?'}).` };
    }
    try {
        const bytes = fromBase64Url(key.slice(dot + 1));
        const at = { i: 0 };
        const mask = readVarint(bytes, at);
        const out = { ...frozen };
        let rest = mask;
        for (let i = 0; rest > 0; i++, rest = Math.floor(rest / 2)) {
            if (rest % 2 === 0) continue;
            const f = fields[i];
            if (!f) throw new Error('unknown field');
            const v = fromIndex(f, readVarint(bytes, at));
            if (v === undefined) throw new Error(`bad ${f.key}`);
            out[f.key] = v;
        }
        if (at.i !== bytes.length) throw new Error('trailing bytes');
        return { settings: normalizeCostToDrive(out), error: null };
    } catch {
        return { settings: defaults, error: 'This link\'s Cost & Time settings could not be read, so the defaults are shown.' };
    }
}

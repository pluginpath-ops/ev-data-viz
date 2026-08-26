/**
 * Layered override store for the tunable model constants.
 *
 * Three layers, highest first:
 *
 *   local     this browser's sandbox (localStorage). Try a change without
 *             imposing it on anyone.
 *   site      what an admin published to the database (#261). This is what
 *             every other curator and every public visitor sees.
 *   default   the compiled-in value from EPA_DEFAULTS.
 *
 * Both override layers are read ONCE, at module load, by constants/epa.js — so
 * changing a knob takes a page reload. That is deliberate and worth keeping: it
 * is what lets the math modules stay plain static imports with no runtime store
 * and no re-render plumbing. The site layer preserves it by being SEEDED before
 * the app's module graph is loaded (see src/main.jsx), not fetched on demand.
 *
 * Leaf module: depends only on localStorage, so any constant module can import
 * it without circular-dependency risk.
 */
const KEY = 'evbench.constants.overrides';

let cache = null;

/**
 * The published site values. Empty until seeded, which is correct for every
 * caller that runs before the seed: a build with no database, a test, or a
 * settings fetch that failed all read the compiled defaults rather than
 * blocking on a value that may never arrive.
 */
let site = {};
let seeded = false;

function load() {
    if (cache) return cache;
    try {
        cache = JSON.parse(localStorage.getItem(KEY)) || {};
    } catch {
        cache = {};
    }
    return cache;
}

/** Resolve a constant: local override ∥ published site value ∥ default. */
export function resolve(key, defaultValue) {
    const ov = load();
    if (key in ov && ov[key] != null) return ov[key];
    if (key in site && site[key] != null) return site[key];
    return defaultValue;
}

/** Current LOCAL overrides map (copy). Empty object means "no local sandbox". */
export function getOverrides() {
    return { ...load() };
}

/** Set (or clear, when value == null) one local override. Persists immediately.
 *  Takes effect on next page reload. */
export function setOverride(key, value) {
    const ov = load();
    if (value == null) delete ov[key];
    else ov[key] = value;
    cache = ov;
    try {
        localStorage.setItem(KEY, JSON.stringify(ov));
    } catch { /* storage unavailable — keep in-memory only */ }
}

/** Drop all local overrides. Takes effect on next page reload. */
export function clearOverrides() {
    cache = {};
    try {
        localStorage.removeItem(KEY);
    } catch { /* ignore */ }
}

/**
 * Install the published site values. Call exactly once, BEFORE anything that
 * reads a constant is imported — a later call cannot reach the values
 * constants/epa.js already resolved, so it is ignored and says so.
 */
export function seedSiteConstants(values) {
    if (seeded) {
        console.warn('[constants] site values seeded twice — the second seed is ignored, ' +
                     'because constants/epa.js has already resolved from the first.');
        return;
    }
    seeded = true;
    site = values && typeof values === 'object' ? { ...values } : {};
}

/** The published site values (copy). Empty object means "all defaults". */
export function getSiteConstants() {
    return { ...site };
}

/**
 * Parse the stored `model_constants` setting into a values map.
 *
 * The setting is one JSON blob in a text column, so a hand-edited row or a
 * schema that moves on can produce something unusable. Every failure resolves
 * to "no site values", which is the safe answer: the site reads its compiled
 * defaults rather than refusing to start.
 */
export function parseSiteConstants(raw) {
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        console.warn('[constants] site model_constants is not valid JSON — using defaults.');
        return {};
    }
}

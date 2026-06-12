/**
 * Local override store for tunable constants — a developer/admin sandbox.
 *
 * Overrides live in localStorage on THIS browser only (never the DB, never other
 * users). They are read ONCE at module load by constants/epa.js, so changing a
 * knob requires a page reload to take effect — that keeps the math modules as
 * plain static imports (no runtime store, no re-render plumbing).
 *
 * Leaf module: depends only on localStorage, so any constant module can import it
 * without circular-dependency risk.
 */
const KEY = 'evbench.constants.overrides';

let cache = null;

function load() {
    if (cache) return cache;
    try {
        cache = JSON.parse(localStorage.getItem(KEY)) || {};
    } catch {
        cache = {};
    }
    return cache;
}

/** Resolve a constant: the local override if one is set, otherwise the default. */
export function resolve(key, defaultValue) {
    const ov = load();
    return key in ov && ov[key] != null ? ov[key] : defaultValue;
}

/** Current overrides map (copy). Empty object means "all defaults". */
export function getOverrides() {
    return { ...load() };
}

/** Set (or clear, when value == null) one override. Persists immediately.
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

/** Drop all overrides (reset to defaults). Takes effect on next page reload. */
export function clearOverrides() {
    cache = {};
    try {
        localStorage.removeItem(KEY);
    } catch { /* ignore */ }
}

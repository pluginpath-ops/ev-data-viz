/**
 * The site_settings table, fetched once and shared.
 *
 * Two callers need it and they need it at different moments:
 *
 *   • the constants bootstrap (src/main.jsx), BEFORE the app's module graph
 *     loads, so the published model constants can seed the resolver that
 *     constants/epa.js reads at import time;
 *   • AppContext, during its startup Promise.all, for the header image.
 *
 * One fetch serves both. The bootstrap runs first, so by the time AppContext
 * asks, this resolves from cache and adds nothing to the startup waterfall the
 * first-load pass worked to remove.
 *
 * Leaf module: imports only the Supabase client, so the bootstrap can pull it
 * in without dragging DataService — and with it constants/epa.js — into the
 * graph before the seed happens.
 */
import { getSupabase } from './supabase';

/**
 * How long first paint will wait on the settings fetch.
 *
 * The bootstrap blocks rendering, which is the price of resolving constants at
 * module load. An unreachable database must therefore degrade to the compiled
 * defaults rather than hold a blank page: every constant has a documented
 * default and the site is coherent on all of them.
 *
 * Long, because giving up EARLY is the worse failure. The query is one indexed
 * read of a two-row table — ~140ms measured against production — so anything
 * approaching this bound means the connection is broken rather than busy, and
 * a tighter bound would only buy the occasional slow visitor a page quietly
 * computing from numbers nobody chose.
 */
const BOOTSTRAP_TIMEOUT_MS = 10000;

/**
 * The site_settings key holding the published model constants — one JSON blob
 * of `{ KNOB_KEY: value }`, absent keys meaning "the compiled default". A blob
 * rather than a row per constant so a page load reads them atomically: the
 * constants are a single coherent model basis, and half a set would state
 * figures against a basis nobody chose.
 */
export const MODEL_CONSTANTS_KEY = 'model_constants';

let cached = null;
let inflight = null;

/** All site settings as a `{ key: value }` map. Cached after the first call. */
export function fetchSiteSettings() {
    if (cached) return Promise.resolve(cached);
    if (inflight) return inflight;

    const supabase = getSupabase();
    if (!supabase) {
        cached = {};
        return Promise.resolve(cached);
    }

    inflight = supabase.from('site_settings').select('*').then(({ data, error }) => {
        if (error) {
            console.warn('[siteSettings] fetch failed — using defaults:', error.message);
            // NOT cached: a transient failure should not pin the site to
            // defaults for the rest of the session.
            inflight = null;
            return {};
        }
        const settings = {};
        for (const row of data || []) settings[row.key] = row.value;
        cached = settings;
        inflight = null;
        return settings;
    });

    return inflight;
}

/** Overwrite one cached entry after a successful write, so a re-read agrees. */
export function updateCachedSetting(key, value) {
    if (!cached) cached = {};
    cached[key] = value;
}

/**
 * The settings, or `{}` if they take longer than first paint can afford.
 * Only the bootstrap should use this; everything else can await the real fetch.
 */
export function fetchSiteSettingsForBootstrap() {
    let timedOut = false;
    const settings = fetchSiteSettings();

    // If the deadline passed and the settings then turn up carrying published
    // constants, this page is computing from the compiled defaults instead —
    // coherent numbers, but not the ones the site chose. Say so. A silent
    // version of this state is the failure the whole feature exists to end.
    settings.then(s => {
        if (timedOut && s[MODEL_CONSTANTS_KEY] && s[MODEL_CONSTANTS_KEY] !== '{}') {
            console.warn('[siteSettings] published model constants arrived after the page had ' +
                         'started on the compiled defaults — reload to compute from them.');
        }
    }).catch(() => {});

    return Promise.race([
        settings,
        new Promise(resolve => setTimeout(() => {
            timedOut = true;
            console.warn('[siteSettings] no response — starting on compiled defaults.');
            resolve({});
        }, BOOTSTRAP_TIMEOUT_MS)),
    ]).catch(() => ({}));
}

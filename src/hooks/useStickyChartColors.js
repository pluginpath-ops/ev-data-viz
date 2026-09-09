import { useMemo, useRef, useState } from 'react';
import { resolveChartColors, applyColorOverrides, VEHICLE_PALETTE } from '../utils/colorUtils';

const EMPTY = {};

/**
 * Auto-assigned chart colors that stay put, plus per-session color overrides.
 *
 * resolveChartColors assigns Okabe-Ito slots across the whole set at once, so
 * adding or removing one run re-solved every other run and the chart's colors
 * shuffled underneath you. Reading a chart you had already made sense of meant
 * re-reading the legend.
 *
 * This remembers what each run was given and feeds those back in as session
 * overrides, which resolveChartColors treats as highest priority AND adds to its
 * collision list — so a newly added run picks a slot that avoids the colors
 * already on screen, and everything already plotted keeps what it had.
 *
 * ── Two kinds of color, deliberately separate ───────────────────────────────
 *
 * The picker on the vehicle form writes vehicles.color, the durable "this car is
 * always green" (#308 — it used to be runs.color, per test, which did not
 * survive hundreds of vehicles). The picker in a chart's run selector calls
 * setColorOverride here and writes NOTHING to the database — it means "recolor
 * this for now". Mixing the two would make reading a chart quietly edit stored
 * data for every visitor, and would break the reset rules below, since a stored
 * value does not reset.
 *
 * ── Resetting ────────────────────────────────────────────────────────────────
 *
 * Colors are ADDED, never reshuffled. Assignments and overrides both hold until:
 *   • the vehicle set changes  — a different comparison, so a fresh palette
 *   • the palette changes       — the explicit "redo this" gesture
 *
 * Both are keyed on a session key rather than cleared by an effect, so a stale
 * map cannot survive even for one render.
 *
 * A removed run keeps its remembered color, so toggling one off and on again
 * returns it to the same color rather than moving it to the end of the queue.
 *
 * @param {Array}   runs      the runs to color
 * @param {Object}  opts
 * @param {string}  opts.palette    VEHICLE_PALETTE, or a SERIES_PALETTES id
 * @param {string}  opts.resetKey   changes when the vehicle set changes
 * @param {Array}   [opts.vehicles] the runs' vehicles, for their curated
 *                                  colors; without it the palette assigns
 * @returns {{ colorMap: Object, setColorOverride: (runId, color) => void,
 *            setColorOverrides: (map) => void,
 *            isColorOverridden: (runId) => boolean }}
 */
export function useStickyChartColors(runs, { palette = VEHICLE_PALETTE, resetKey, vehicles = null }) {
    // A MONOTONIC generation, not a key derived from the boolean. Deriving it
    // from autoColor looked equivalent and was not: toggling off and back on
    // returned the key to its previous value, so the old overrides came back
    // into view instead of resetting. Counting flips can only go forward.
    const generation = useRef(0);
    const prevPalette = useRef(palette);
    if (prevPalette.current !== palette) {
        generation.current += 1;
        prevPalette.current = palette;
    }
    const sessionKey = `${resetKey}|${generation.current}`;

    const assigned = useRef({});               // runId → color, auto-assigned
    const assignedKey = useRef(sessionKey);
    const [overrideState, setOverrideState] = useState({ key: sessionKey, map: EMPTY });

    // Derived, not cleared: an override from a previous session key is simply
    // not read, so it can never be applied to the wrong set of runs.
    const overrides = overrideState.key === sessionKey ? overrideState.map : EMPTY;

    // A null color REMOVES the override rather than storing null, which is what
    // the picker's "Auto" means: hand this run back to the palette. Storing null
    // would leave a key that resolveChartColors reads as falsy and skips, so the
    // run would fall through to its stored color instead — the same outcome by
    // accident in manual mode, and the wrong one in auto.
    const setColorOverride = (runId, color) => {
        setOverrideState(prev => {
            const base = prev.key === sessionKey ? prev.map : EMPTY;
            // Clearing a run that has no override is a no-op, and returning the
            // same object keeps the chart from re-solving the palette for it.
            if (color == null && !(runId in base)) {
                return prev.key === sessionKey ? prev : { key: sessionKey, map: EMPTY };
            }
            return { key: sessionKey, map: applyColorOverrides(base, { [runId]: color }) };
        });
    };

    // A whole derived set at once, and the ONE reason this is not a loop over
    // setColorOverride: the picker's wider scopes recolor every series from a
    // single base, and applying that one at a time would re-render the chart
    // once per run and let a half-applied set be seen.
    const setColorOverrides = (map) => {
        // One update, not a loop over setColorOverride: clearing twenty runs one
        // at a time would re-solve the palette after each and shuffle the
        // colors it had not reached yet.
        setOverrideState(prev => ({
            key: sessionKey,
            map: applyColorOverrides(prev.key === sessionKey ? prev.map : EMPTY, map),
        }));
    };


    const colorMap = useMemo(() => {
        if (assignedKey.current !== sessionKey) {
            assigned.current = {};
            assignedKey.current = sessionKey;
        }

        // Vehicle-color mode already honours each vehicle's curated color, so
        // there is nothing to hold still — but an override still wins, since
        // the user asked for it in this session.
        const assigning = palette !== VEHICLE_PALETTE;
        const seed = assigning ? { ...assigned.current, ...overrides } : overrides;

        const resolved = resolveChartColors(runs, seed, palette, vehicles);

        // Remember, so the next call holds these in place. Idempotent: React may
        // run a memo more than once, and re-merging the same answer changes
        // nothing — unlike a mutation whose result depends on not having run yet.
        //
        // An OVERRIDE is deliberately not remembered. It arrives in the seed and
        // therefore comes back out in `resolved`, so folding it in would write
        // the hand-picked color into the auto assignments — and then clearing
        // the override would restore the run to the color it was just cleared
        // of. An assignment is what the palette chose; an override is what a
        // person chose over it, and only the first is this map's business.
        if (assigning) {
            // An overridden run is DROPPED, not merely skipped. Skipping left
            // its previous assignment sitting in the map while the resolver —
            // seeing the override — handed that same color to somebody else,
            // so two runs ended up remembered at one color. An override is
            // what a person chose over an assignment; the assignment it
            // replaced is not worth keeping, and keeping it was a duplicate
            // waiting for the override to be cleared.
            assigned.current = Object.fromEntries(
                Object.entries({ ...assigned.current, ...resolved })
                    .filter(([runId]) => !(runId in overrides)),
            );
        }
        return resolved;
    }, [runs, palette, sessionKey, overrides, vehicles]);

    return {
        colorMap,
        setColorOverride,
        setColorOverrides,
        // Whether a run is showing a hand-picked color rather than the
        // palette's. The picker reflects this rather than guessing from the
        // stored value, which answers a different question entirely.
        isColorOverridden: (runId) => runId in overrides,
    };
}

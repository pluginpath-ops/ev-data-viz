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
export function useStickyChartColors(runs, {
    palette = VEHICLE_PALETTE, handSet = false, resetKey, vehicles = null, onHandSet = null,
}) {
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

    /**
     * ── Two maps, two lifetimes, and they must not be collapsed back together ──
     *
     * `assigned` is keyed on `sessionKey`, which the generation counter bumps on
     * every palette change — so choosing a new palette genuinely re-assigns, and
     * nothing from the old one is held still.
     *
     * The PICKS are keyed on `resetKey` alone. A pick has to survive a palette
     * change, because that is the whole of the hand-set design: choosing a
     * palette PARKS your picks rather than discarding them, and selecting
     * "Hand-set" brings them back. Keyed on the session key they died with the
     * palette, and there was nothing to bring back.
     *
     * The trap this is one step away from: keying picks on a value that returns
     * to a previous state makes them reappear UNBIDDEN, which is the bug the
     * monotonic generation was introduced to fix. The difference now is that
     * `handSet` decides whether they are applied, and only a person selecting
     * "Hand-set" sets it. Surviving is not the same as being in force, and
     * keeping those two apart is what makes this safe. Collapse them and the old
     * bug comes straight back.
     *
     * They still reset together when the VEHICLE SET changes, which is right —
     * a different comparison is a different plot, and a pick names a run that
     * may not be on it any more.
     */
    const [overrideState, setOverrideState] = useState({ key: resetKey, map: EMPTY });
    const picks = overrideState.key === resetKey ? overrideState.map : EMPTY;

    // What actually reaches the chart. Parked picks are stored, not drawn — and
    // because the swatch beside a run reads this same map, a parked pick does
    // not show there either. That is the point: the swatch has to report the
    // DRAWN colour, or it recreates the chip-vs-chart disconnect the colour
    // vocabulary was written to stop.
    const overrides = handSet ? picks : EMPTY;

    // A null color REMOVES the override rather than storing null, which is what
    // the picker's "Auto" means: hand this run back to the palette. Storing null
    // would leave a key that resolveChartColors reads as falsy and skips, so the
    // run would fall through to its stored color instead — the same outcome by
    // accident in manual mode, and the wrong one in auto.
    const setColorOverride = (runId, color) => {
        // Setting a colour by hand IS the gesture that turns hand-set on; there
        // is no separate "apply my picks" step. Clearing one is not, or "Back to
        // auto" on the last pick would switch the mode on as it emptied it.
        if (color != null) onHandSet?.(true);
        setOverrideState(prev => {
            const base = prev.key === resetKey ? prev.map : EMPTY;
            // Clearing a run that has no override is a no-op, and returning the
            // same object keeps the chart from re-solving the palette for it.
            if (color == null && !(runId in base)) {
                return prev.key === resetKey ? prev : { key: resetKey, map: EMPTY };
            }
            return { key: resetKey, map: applyColorOverrides(base, { [runId]: color }) };
        });
    };

    // A whole derived set at once, and the ONE reason this is not a loop over
    // setColorOverride: the picker's wider scopes recolor every series from a
    // single base, and applying that one at a time would re-render the chart
    // once per run and let a half-applied set be seen.
    const setColorOverrides = (map) => {
        if (Object.values(map).some(c => c != null)) onHandSet?.(true);
        // One update, not a loop over setColorOverride: clearing twenty runs one
        // at a time would re-solve the palette after each and shuffle the
        // colors it had not reached yet.
        setOverrideState(prev => ({
            key: resetKey,
            map: applyColorOverrides(prev.key === resetKey ? prev.map : EMPTY, map),
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
        // How many picks are being held — in force or parked. The dropdown says
        // it out loud ("Hand-set (3)"), because a parked pick is otherwise
        // invisible: park three, work for an hour, come back and selecting
        // Hand-set repaints three series in colours you no longer remember
        // choosing. It is also what makes the option disappear at zero, so a
        // mode that would do nothing is never offered.
        handSetCount: Object.keys(picks).length,
        /**
         * The color this run holds by hand, in force or PARKED — or null.
         *
         * Deliberately not `isColorOverridden`, which answers "is a pick being
         * drawn right now?". This answers "is there a pick here at all?", and
         * the two differ exactly when a palette is selected: that is the state
         * where a run silently holds a color nothing on screen mentions. The
         * swatch wears it as a chip behind the drawn color, so which runs are
         * carrying one is visible without opening anything.
         */
        handSetColorOf: (runId) => picks[runId] ?? null,
        // Whether a run is showing a hand-picked color rather than the
        // palette's. The picker reflects this rather than guessing from the
        // stored value, which answers a different question entirely.
        isColorOverridden: (runId) => runId in overrides,
    };
}

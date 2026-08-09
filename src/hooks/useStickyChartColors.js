import { useMemo, useRef, useState } from 'react';
import { resolveChartColors } from '../utils/colorUtils';

const EMPTY = {};

/**
 * Auto-assigned chart colours that stay put, plus per-session colour overrides.
 *
 * resolveChartColors assigns Okabe-Ito slots across the whole set at once, so
 * adding or removing one run re-solved every other run and the chart's colours
 * shuffled underneath you. Reading a chart you had already made sense of meant
 * re-reading the legend.
 *
 * This remembers what each run was given and feeds those back in as session
 * overrides, which resolveChartColors treats as highest priority AND adds to its
 * collision list — so a newly added run picks a slot that avoids the colours
 * already on screen, and everything already plotted keeps what it had.
 *
 * ── Two kinds of colour, deliberately separate ───────────────────────────────
 *
 * The picker in Tests & Data writes runs.color, the durable "this run is always
 * green". The picker in a chart's run selector calls setColorOverride here and
 * writes NOTHING to the database — it means "recolour this for now". Mixing the
 * two would make reading a chart quietly edit stored data for every visitor, and
 * would break the reset rules below, since a stored value does not reset.
 *
 * ── Resetting ────────────────────────────────────────────────────────────────
 *
 * Colours are ADDED, never reshuffled. Assignments and overrides both hold until:
 *   • the vehicle set changes  — a different comparison, so a fresh palette
 *   • Auto Color is toggled     — the explicit "redo this" gesture
 *
 * Both are keyed on a session key rather than cleared by an effect, so a stale
 * map cannot survive even for one render.
 *
 * A removed run keeps its remembered colour, so toggling one off and on again
 * returns it to the same colour rather than moving it to the end of the queue.
 *
 * @param {Array}   runs      the runs to colour
 * @param {Object}  opts
 * @param {boolean} opts.autoColor  auto mode on/off
 * @param {string}  opts.resetKey   changes when the vehicle set changes
 * @returns {{ colorMap: Object, setColorOverride: (runId, color) => void }}
 */
export function useStickyChartColors(runs, { autoColor, resetKey }) {
    // A MONOTONIC generation, not a key derived from the boolean. Deriving it
    // from autoColor looked equivalent and was not: toggling off and back on
    // returned the key to its previous value, so the old overrides came back
    // into view instead of resetting. Counting flips can only go forward.
    const generation = useRef(0);
    const prevAutoColor = useRef(autoColor);
    if (prevAutoColor.current !== autoColor) {
        generation.current += 1;
        prevAutoColor.current = autoColor;
    }
    const sessionKey = `${resetKey}|${generation.current}`;

    const assigned = useRef({});               // runId → colour, auto-assigned
    const assignedKey = useRef(sessionKey);
    const [overrideState, setOverrideState] = useState({ key: sessionKey, map: EMPTY });

    // Derived, not cleared: an override from a previous session key is simply
    // not read, so it can never be applied to the wrong set of runs.
    const overrides = overrideState.key === sessionKey ? overrideState.map : EMPTY;

    const setColorOverride = (runId, color) => {
        setOverrideState(prev => ({
            key: sessionKey,
            map: { ...(prev.key === sessionKey ? prev.map : EMPTY), [runId]: color },
        }));
    };

    const colorMap = useMemo(() => {
        if (assignedKey.current !== sessionKey) {
            assigned.current = {};
            assignedKey.current = sessionKey;
        }

        // Manual mode already honours each run's own stored colour, so there is
        // nothing to hold still — but an override still wins, since the user
        // asked for it in this session.
        const mode = autoColor ? 'auto' : 'manual';
        const seed = autoColor ? { ...assigned.current, ...overrides } : overrides;

        const resolved = resolveChartColors(runs, seed, mode);

        // Remember, so the next call holds these in place. Idempotent: React may
        // run a memo more than once, and re-merging the same answer changes
        // nothing — unlike a mutation whose result depends on not having run yet.
        if (autoColor) assigned.current = { ...assigned.current, ...resolved };
        return resolved;
    }, [runs, autoColor, sessionKey, overrides]);

    return { colorMap, setColorOverride };
}

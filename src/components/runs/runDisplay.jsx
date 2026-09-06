import { runKindFrom, isRangeRun } from '../../utils/runUtils';

/**
 * The vocabulary both run cards read a test by (#235, re-skin phase 8 step 1).
 *
 * Shared rather than duplicated because there are TWO cards — the ordinary one
 * and the inherited one — and these had already drifted apart once: the
 * inherited card was the only card without a kind pill, which is precisely
 * where the kind matters most.
 */

// ── Data-type flag definitions ────────────────────────────────────────────────
// Each flag represents a data domain that can independently be present in a run.
// Flags are stored as an array so future types can be added without schema changes.
export const DATA_FLAGS = [
    { key: 'charging', label: '⚡ Charging', pillStyle: 'bg-blue-100 text-blue-800 border-blue-300',   desc: 'Time-series charging data (charge rate, SoC)' },
    { key: 'range',    label: '📏 Range',    pillStyle: 'bg-purple-100 text-purple-800 border-purple-300', desc: 'Range/efficiency test (distance, SoC, speed, efficiency)' },
];

/**
 * A run's role. Since migration 046 a run is a charging test OR a range test,
 * never both — the dual-role rows were split, and the flag pair that expressed
 * them is gone. Kept as a one-element array so the pill rendering below, which
 * was written against a list, does not have to change.
 */
export const inferRunFlags = (run) => [isRangeRun(run) ? 'range' : 'charging'];

/**
 * A run's role, as the pill that opens its title line.
 *
 * The kind is the first thing that decides how to read every number below it,
 * and on an inherited test it also decides which knobs mean anything —
 * efficiency only ever moves a distance, so on a charging link it is inert
 * while capacity is doing all the work. The inherited card was the one card
 * without this pill, which is precisely where it was most needed.
 */
export function RunKindPill({ run, className = '' }) {
    const flag = DATA_FLAGS.find(f => f.key === runKindFrom(run));
    if (!flag) return null;
    return (
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${flag.pillStyle} shrink-0 ${className}`.trim()}>
            {flag.label}
        </span>
    );
}

// ── Field tag metadata (ordered for display) ──────────────────────────────────
export const FIELD_META = [
    { key: 'soc',         label: 'SoC',   title: 'State of Charge (%)' },
    { key: 'chargeRate',  label: 'kW',    title: 'Charge Rate (kW)' },
    { key: 'time',        label: 'Time',  title: 'Time' },
    { key: 'range',       label: 'Range', title: 'Range' },
    { key: 'temperature', label: 'Temp',  title: 'Temperature' },
];

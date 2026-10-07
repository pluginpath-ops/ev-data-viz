import { DATA_CATEGORIES, vehicleDataCategories, vehiclePooledCounts } from '../../utils/vehicleDataCategories';

/**
 * How many tests of each kind a vehicle has, two to a line (#338, the list's
 * Tests column): "Charging 2  Range 6 / EPA 2  Accel 8". One
 * neutral style rather than a color per kind — a color here would have to
 * mean something, and on the list it would mean nothing the word does not
 * already say. Zeros are left out; the full name is each count's tooltip.
 *
 * "Charging 4/2": four listed tests, and in grey two unlisted ones that still
 * count in the statistics (#394, the pool). A pool alone shows "0/2".
 */
export default function TestCounts({ vehicle, performanceCounts = {} }) {
    const counts = vehicleDataCategories(vehicle, performanceCounts);
    const pooled = vehiclePooledCounts(vehicle);
    const shown = DATA_CATEGORIES.filter(c => counts[c.key] > 0 || pooled[c.key] > 0);
    if (shown.length === 0) return <span className="stat-cell-empty" aria-label="no tests">—</span>;
    return (
        <span className="test-counts">
            {shown.map(c => (
                <span key={c.key} className="test-count" title={countTitle(c, counts[c.key], pooled[c.key])}>
                    {c.short ?? c.label} <span className="test-count-n">{counts[c.key]}</span>
                    {pooled[c.key] > 0 && <span className="test-count-pool">/{pooled[c.key]}</span>}
                </span>
            ))}
        </span>
    );
}

/** "4 charging tests, and 2 unlisted that still count in the statistics". */
export function countTitle(category, n, pooled = 0) {
    const kind = category.label.toLowerCase();
    const base = `${n} ${kind} ${n === 1 ? 'test' : 'tests'}`;
    return pooled > 0 ? `${base}, and ${pooled} unlisted that still count in the statistics` : base;
}

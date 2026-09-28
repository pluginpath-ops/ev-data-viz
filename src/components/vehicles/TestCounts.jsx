import { DATA_CATEGORIES, vehicleDataCategories } from '../../utils/vehicleDataCategories';

/**
 * How many tests of each kind a vehicle has, on one line that never wraps
 * (#338, the list's Tests column): "Charging 2 · Range 6 · EPA 2". One
 * neutral style rather than a color per kind — a color here would have to
 * mean something, and on the list it would mean nothing the word does not
 * already say. Zeros are left out; the full name is each count's tooltip.
 */
export default function TestCounts({ vehicle, performanceCounts = {} }) {
    const counts = vehicleDataCategories(vehicle, performanceCounts);
    const shown = DATA_CATEGORIES.filter(c => counts[c.key] > 0);
    if (shown.length === 0) return <span className="stat-cell-empty" aria-label="no tests">—</span>;
    return (
        <span className="test-counts">
            {shown.map((c, i) => (
                <span key={c.key} className="test-count" title={`${counts[c.key]} ${c.label.toLowerCase()} ${counts[c.key] === 1 ? 'test' : 'tests'}`}>
                    {i > 0 && <span className="test-count-sep" aria-hidden="true">·</span>}
                    {c.short ?? c.label} <span className="test-count-n">{counts[c.key]}</span>
                </span>
            ))}
        </span>
    );
}

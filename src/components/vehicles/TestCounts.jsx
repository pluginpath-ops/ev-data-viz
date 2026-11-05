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
 *
 * With `onOpenSubtab` each count is a link to that kind's Tests & Data sub-tab
 * (see TestCountLink); without it, plain text.
 */
export default function TestCounts({ vehicle, performanceCounts = {}, onOpenSubtab = null }) {
    const counts = vehicleDataCategories(vehicle, performanceCounts);
    const pooled = vehiclePooledCounts(vehicle);
    const shown = DATA_CATEGORIES.filter(c => counts[c.key] > 0 || pooled[c.key] > 0);
    if (shown.length === 0) return <span className="stat-cell-empty" aria-label="no tests">—</span>;
    return (
        <span className="test-counts">
            {shown.map(c => (
                <TestCountLink key={c.key} className="test-count" category={c} vehicle={vehicle}
                    count={counts[c.key]} pooled={pooled[c.key]} onOpenSubtab={onOpenSubtab}>
                    {c.short ?? c.label} <span className="test-count-n">{counts[c.key]}</span>
                    {pooled[c.key] > 0 && <span className="test-count-pool">/{pooled[c.key]}</span>}
                </TestCountLink>
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

/**
 * One kind's count as a link into that kind's Tests & Data sub-tab. The card
 * and the list row both select on click, so the button stops the click here —
 * otherwise opening the tests would also toggle the vehicle's selection. A
 * span when there is nowhere to go (the list in a context with no navigation).
 */
export function TestCountLink({ category, vehicle, count, pooled, onOpenSubtab, className, children }) {
    const title = countTitle(category, count, pooled);
    if (!onOpenSubtab) return <span className={className} title={title}>{children}</span>;
    return (
        <button
            type="button"
            className={`${className} test-count-link`}
            title={`${title} — open`}
            onClick={e => { e.stopPropagation(); onOpenSubtab(vehicle, category.subtab); }}
        >
            {children}
        </button>
    );
}

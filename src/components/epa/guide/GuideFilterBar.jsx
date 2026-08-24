import { useMemo } from 'react';
import { EMPTY_FILTERS } from '../../../utils/feGuideBrowse';

/**
 * Faceted filters for the guide browser (#235).
 *
 * Multi-select chips rather than dropdowns: with 38 makes and 6 model years the
 * question is usually "these two against each other", and a select forces that
 * to be one at a time.
 *
 * Each facet reports how many rows it would leave, computed against the OTHER
 * filters rather than all of them — so the counts describe what clicking would
 * actually do instead of what the unfiltered corpus holds. A facet value that
 * would leave nothing is disabled rather than hidden, because a make vanishing
 * from the list reads as a bug where a greyed-out one reads as an answer.
 */
function FacetGroup({ label, hint, values, selected, onToggle, onClear, countFor, format = String }) {
    if (!values.length) return null;
    return (
        <div className="guide-facet">
            <div className="guide-facet-label">
                {label}
                {hint && <span className="text-hint ml-1">{hint}</span>}
            </div>
            <div className="guide-facet-values">
                {/* Clearing one facet took a click per selected chip, and with
                    six model years that is six. Shown only once something is
                    selected: with nothing chosen "All" is already true, and a
                    chip that does nothing is worse than no chip.

                    The Statistics tab keeps an always-visible All on its year
                    facet, deliberately — there a single year is the DEFAULT and
                    "all years" is a distinct analytic choice that double-counts
                    configurations, so it needs to be selectable rather than
                    merely reachable. */}
                {selected.length > 0 && (
                    <button
                        type="button"
                        onClick={onClear}
                        className="guide-chip"
                        title={`Clear the ${label.toLowerCase()} filter`}
                    >
                        All
                    </button>
                )}
                {values.map((v) => {
                    const on = selected.includes(v);
                    const n = countFor(v);
                    return (
                        <button
                            key={String(v)}
                            type="button"
                            onClick={() => onToggle(v)}
                            disabled={!on && n === 0}
                            className={`guide-chip ${on ? 'active' : ''}`}
                            title={`${n} configuration${n === 1 ? '' : 's'}`}
                        >
                            {format(v)}
                            <span className="guide-chip-count">{n}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

/** A min/max pair. Blank means unbounded, which is not the same as zero. */
function RangeInput({ label, unit, minKey, maxKey, filters, onChange }) {
    const set = (key) => (e) => {
        const raw = e.target.value;
        onChange({ [key]: raw === '' ? null : Number(raw) });
    };
    return (
        <div className="guide-facet">
            <div className="guide-facet-label">{label} <span className="text-hint">{unit}</span></div>
            <div className="guide-range-inputs">
                <input type="number" inputMode="numeric" placeholder="min"
                    value={filters[minKey] ?? ''} onChange={set(minKey)} className="guide-range-input" />
                <span className="text-faint">–</span>
                <input type="number" inputMode="numeric" placeholder="max"
                    value={filters[maxKey] ?? ''} onChange={set(maxKey)} className="guide-range-input" />
            </div>
        </div>
    );
}

export default function GuideFilterBar({ rows, facets, filters, onChange, onReset, filterFn, columnPicker }) {
    /**
     * Counts per facet value, each computed with that facet's own selection
     * removed. Recomputed together so one pass over the rows serves them all.
     */
    const counts = useMemo(() => {
        const forFacet = (facetKey, rowKey) => {
            const base = filterFn(rows, { ...filters, [facetKey]: [] });
            const tally = new Map();
            for (const r of base) {
                const v = r[rowKey];
                if (v == null || v === '') continue;
                tally.set(v, (tally.get(v) ?? 0) + 1);
            }
            return tally;
        };
        return {
            years:       forFacet('years', 'model_year'),
            makes:       forFacet('makes', 'brand'),
            parents:     forFacet('parents', 'parent_name'),
            bodyClasses: forFacet('bodyClasses', 'body_class'),
            drives:      forFacet('drives', 'drive_desc'),
            motorCounts: forFacet('motorCounts', 'motor_count'),
            wheelSizes:  forFacet('wheelSizes', 'wheel_size_in'),
        };
    }, [rows, filters, filterFn]);

    const toggle = (key) => (v) => {
        const cur = filters[key] ?? [];
        onChange({ [key]: cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v] });
    };
    const clear = (key) => () => onChange({ [key]: [] });

    const active = Object.entries(filters).some(([k, v]) => {
        const empty = EMPTY_FILTERS[k];
        return Array.isArray(v) ? v.length > 0 : v !== empty;
    });

    return (
        <div className="guide-filter-bar">
            <div className="guide-facet guide-facet-search">
                <div className="guide-facet-label">Search</div>
                <input
                    type="search"
                    value={filters.search}
                    onChange={e => onChange({ search: e.target.value })}
                    placeholder="Make, configuration or test group"
                    className="guide-search-input"
                />
            </div>

            <FacetGroup label="Model year" values={facets.years} selected={filters.years}
                onToggle={toggle('years')} onClear={clear('years')} countFor={v => counts.years.get(v) ?? 0} />
            {/* Not a filter, but it belongs with them: everything that changes
                what you are looking at lives in this bar. */}
            {columnPicker && <div className="guide-facet guide-facet-columns">{columnPicker}</div>}

            <FacetGroup label="Class" values={facets.bodyClasses} selected={filters.bodyClasses}
                onToggle={toggle('bodyClasses')} onClear={clear('bodyClasses')} countFor={v => counts.bodyClasses.get(v) ?? 0} />
            <FacetGroup label="Make" values={facets.makes} selected={filters.makes}
                onToggle={toggle('makes')} onClear={clear('makes')} countFor={v => counts.makes.get(v) ?? 0} />
            {/* Only rendered once a curator has set parents — an empty facet
                would be a row of nothing with a heading over it. */}
            <FacetGroup label="Parent" values={facets.parents} selected={filters.parents}
                onToggle={toggle('parents')} onClear={clear('parents')} countFor={v => counts.parents.get(v) ?? 0} />
            <FacetGroup label="Drive" values={facets.drives} selected={filters.drives}
                onToggle={toggle('drives')} onClear={clear('drives')} countFor={v => counts.drives.get(v) ?? 0} />
            <FacetGroup label="Motors" values={facets.motorCounts} selected={filters.motorCounts}
                onToggle={toggle('motorCounts')} onClear={clear('motorCounts')} countFor={v => counts.motorCounts.get(v) ?? 0} />
            {/* Named as partial, because it is: EPA has no wheel column and only
                some makers write the size into the configuration name. */}
            <FacetGroup label="Wheels" hint="where stated" values={facets.wheelSizes} selected={filters.wheelSizes}
                onToggle={toggle('wheelSizes')} onClear={clear('wheelSizes')} countFor={v => counts.wheelSizes.get(v) ?? 0}
                format={v => `${v}"`} />

            <RangeInput label="Range" unit="mi" minKey="minRange" maxKey="maxRange"
                filters={filters} onChange={onChange} />
            <RangeInput label="Combined" unit="MPGe" minKey="minMpge" maxKey="maxMpge"
                filters={filters} onChange={onChange} />

            {active && (
                <button type="button" onClick={onReset} className="btn btn-secondary guide-reset">
                    Clear filters
                </button>
            )}
        </div>
    );
}

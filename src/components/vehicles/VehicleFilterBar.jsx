import { useMemo } from 'react';
import GuideFacetMenu from '../epa/guide/GuideFacetMenu';
import {
    VEHICLE_FACETS, facetState, filtersActive, vehicleFacetCounts, activeFilterChips, removeChip,
    toggleInclude, toggleExclude, setMatchAll, clearFacet, setSearch, EMPTY_VEHICLE_FILTERS,
} from '../../utils/vehicleFilters';

/**
 * Vehicles & Specs' one filter bar (#338), above Cards, List and Table alike:
 * a search box and a dropdown per facet, each value countable, includable and
 * excludable, with tags and test data matching any or all. Beneath it, each
 * active filter as a chip that removes it.
 *
 * The EPA guide's bar in shape and in classes — the two tables change
 * together — built on the same GuideFacetMenu.
 *
 * `children` sits in the row after the facets: what else changes what the
 * reader is looking at in that view (the Table's columns, the Cards' sort).
 */
export default function VehicleFilterBar({ vehicles, filters, onChange, ctx, shownCount, children }) {
    const counts = useMemo(() => vehicleFacetCounts(vehicles, filters, ctx), [vehicles, filters, ctx]);
    const chips = activeFilterChips(filters);
    const active = filtersActive(filters);

    return (
        <div className="guide-filter-strip">
            <div className="guide-filter-row">
                <input
                    type="search"
                    value={filters.search ?? ''}
                    onChange={e => onChange(setSearch(filters, e.target.value))}
                    placeholder="Search name, make, model, trim, year…"
                    aria-label="Search vehicles"
                    className="form-input guide-search-input"
                />
                {VEHICLE_FACETS.map(f => {
                    const st = facetState(filters, f.key);
                    return (
                        <GuideFacetMenu
                            key={f.key}
                            label={f.label}
                            hint={f.hint}
                            format={f.format}
                            unit="vehicle"
                            values={counts[f.key].values}
                            selected={st.in}
                            excluded={st.out}
                            countFor={v => counts[f.key].counts.get(v) ?? 0}
                            onToggle={v => onChange(toggleInclude(filters, f.key, v))}
                            onExclude={v => onChange(toggleExclude(filters, f.key, v))}
                            all={st.all}
                            onAllChange={f.anyAll ? (all => onChange(setMatchAll(filters, f.key, all))) : null}
                            onClear={() => onChange(clearFacet(filters, f.key))}
                        />
                    );
                })}
                {children}
                <div className="guide-filter-tally">
                    <span className="text-data">{shownCount?.toLocaleString()}</span>
                    <span className="guide-filter-tally-total">of {vehicles.length.toLocaleString()}</span>
                    {active && (
                        <button type="button" onClick={() => onChange(EMPTY_VEHICLE_FILTERS)} className="guide-filter-reset">
                            Reset
                        </button>
                    )}
                </div>
            </div>
            {chips.length > 0 && (
                <div className="guide-narrowed-row">
                    <span className="text-nano">Narrowed by</span>
                    {chips.map((c, i) => (
                        <span key={c.id} className="contents">
                            {/* "all of" heads a facet's chips when it must match every one. */}
                            {c.group && chips[i - 1]?.group !== c.group && <span className="text-nano">{c.group}</span>}
                            <button
                                type="button"
                                className={`guide-narrowed-chip${c.mode === 'out' ? ' is-excluded' : ''}`}
                                onClick={() => onChange(removeChip(filters, c))}
                                title={`Remove ${c.text}`}
                            >
                                {c.text}
                                <span aria-hidden="true">✕</span>
                            </button>
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

import { useMemo, useState } from 'react';
import Popover from './Popover';
import { useAppContext } from '../context/AppContext';
import { searchMatches, vehicleFilterContext } from '../utils/vehicleFilters';
import { vehicleLabel } from '../utils/specHelpers';
import { DEFAULT_RUN_COLOR } from '../utils/colorUtils';
import { distanceUnit } from '../utils/unitConversions';
import { DATA_CATEGORIES, vehicleDataCategories, hasDataCategory } from '../utils/vehicleDataCategories';
import { epaRangeValue, epaRangeBasisMark } from './vehicles/VehicleCardFigures';

/**
 * The vehicle quick-add: "＋ Add" at the end of the chips row, opening a search over every
 * listed vehicle, so the selection can grow from whatever tab you are on rather
 * than only from Vehicles & Specs.
 *
 * A checklist, not a pick-one. Clicking a row toggles that vehicle in the
 * selection AT ONCE and leaves the panel open with the search as typed, so the
 * chip and the chart behind the panel are the confirmation and the next car is
 * one more click or one more search away. A selected row carries a ✓, and
 * clicking it again takes the vehicle back out.
 *
 * Matching is the filter bar's own `searchMatches`, so the two searches find
 * the same cars: each word on its own, across name, make, model, trim, year
 * and tags — "r1t 2023" finds a 2022-2024 R1T. Three toggles (Range, Charging,
 * EPA) keep only vehicles that have that data; on together, all must hold.
 *
 * Each row carries a second line — drive type, then the card's battery, EPA
 * range and test counts — so lookalike trims can be told apart without leaving.
 *
 *   vehicles          listed vehicles, in display order
 *   selectedIds       the selection, as App holds it
 *   onToggle          (vehicleId) => void — toggleVehicleSelection
 */
export default function VehicleQuickAdd({ vehicles, selectedIds, onToggle }) {
    const { performanceCounts, units } = useAppContext();
    // Held here rather than in the panel, so closing and reopening keeps the
    // last search. It is selected on focus, so the first key replaces it.
    const [search, setSearch] = useState('');
    // Test-data keys that must ALL be present; empty is no narrowing.
    const [needs, setNeeds] = useState([]);
    const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
    // For drive type, read through inheritance and the platform as the
    // filter bar's Drive facet reads it.
    const ctx = useMemo(() => vehicleFilterContext(vehicles, performanceCounts), [vehicles, performanceCounts]);

    const matches = useMemo(
        () => vehicles.filter(v => searchMatches(v, search)
            && needs.every(key => hasDataCategory(v, key, performanceCounts))),
        [vehicles, search, needs, performanceCounts]);
    const toggleNeed = (key) => setNeeds(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]));

    return (
        <Popover
            title="Add vehicles"
            // Room for name and figures on one line each; a phone gets the sheet.
            width="34rem"
            className="vehicle-quick-add"
            trigger={(props) => (
                <button {...props} type="button" className="btn btn-secondary" title="Add vehicles to the selection">
                    ＋ Add
                </button>
            )}
        >
            <div className="flex flex-col gap-2">
                <input
                    data-autofocus
                    type="search"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    onFocus={e => e.target.select()}
                    // Enter toggles the top match, so a search that narrows to
                    // one car never needs the mouse.
                    onKeyDown={e => {
                        if (e.key === 'Enter' && matches.length > 0) {
                            e.preventDefault();
                            onToggle(matches[0].id);
                        }
                    }}
                    placeholder="Search: model, year, trim…"
                    aria-label="Search vehicles"
                    className="form-input w-full"
                />
                <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Only vehicles with">
                    <span className="text-micro">Has</span>
                    {QUICK_ADD_NEEDS.map(({ key, label }) => (
                        <button
                            key={key}
                            type="button"
                            aria-pressed={needs.includes(key)}
                            className={`btn btn-toggle${needs.includes(key) ? ' active' : ''}`}
                            onClick={() => toggleNeed(key)}
                            title={`Only vehicles with ${label === 'EPA' ? 'EPA data' : `${label.toLowerCase()} tests`}`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
                <ul className="vehicle-quick-add-list" role="listbox" aria-multiselectable="true" aria-label="Vehicles">
                    {matches.map(v => {
                        const isSelected = selected.has(v.id);
                        return (
                            <li key={v.id} role="option" aria-selected={isSelected}>
                                <button
                                    type="button"
                                    className={`vehicle-quick-add-row option-row${isSelected ? ' is-selected' : ''}`}
                                    onClick={() => onToggle(v.id)}
                                    title={isSelected ? 'Remove from the selection' : 'Add to the selection'}
                                >
                                    <span className="vehicle-quick-add-check" aria-hidden="true">{isSelected ? '✓' : ''}</span>
                                    <span className="series-swatch" style={{ backgroundColor: v.color || DEFAULT_RUN_COLOR }} aria-hidden="true" />
                                    <span className="min-w-0">
                                        <span className="block truncate">{vehicleLabel(v)}</span>
                                        <QuickAddFigures vehicle={v} drive={ctx.specsOf(v)?.powertrain?.drive_type}
                                            units={units} performanceCounts={performanceCounts} />
                                    </span>
                                </button>
                            </li>
                        );
                    })}
                    {matches.length === 0 && (
                        <li className="vehicle-quick-add-empty text-meta">No matches</li>
                    )}
                </ul>
            </div>
        </Popover>
    );
}

/** The toggles under the search: each keeps only vehicles with that data, all must hold. */
const QUICK_ADD_NEEDS = [
    { key: 'range', label: 'Range' },
    { key: 'charging', label: 'Charging' },
    { key: 'epa', label: 'EPA' },
];

/**
 * "AWD · 82 kWh · 270 mi · ↯ 2  ↔ 1  EPA 1": drive type, then the card's
 * battery, EPA range and test counts, on one line. A missing figure is left
 * out, not dashed — the line says what the car has. Counts use the card's
 * glyphs; full names are titles.
 */
function QuickAddFigures({ vehicle, drive, units, performanceCounts }) {
    const range = epaRangeValue(vehicle, units);
    const mark = epaRangeBasisMark(vehicle);
    const counts = vehicleDataCategories(vehicle, performanceCounts);
    const tested = DATA_CATEGORIES.filter(c => counts[c.key] > 0);
    const parts = [
        drive && <span key="drive" title="Drive type">{drive}</span>,
        vehicle.socWindowKwh != null && <span key="kwh">{Math.round(vehicle.socWindowKwh)} kWh</span>,
        range != null && <span key="range" title="EPA range">{range} {distanceUnit(units)}{mark ? ` ${mark}` : ''}</span>,
        tested.length > 0 && (
            <span key="tests" className="vehicle-quick-add-counts">
                {tested.map(c => (
                    <span key={c.key} title={`${counts[c.key]} ${c.label.toLowerCase()} ${counts[c.key] === 1 ? 'test' : 'tests'}`}>
                        {c.glyph ?? c.short ?? c.label} {counts[c.key]}
                    </span>
                ))}
            </span>
        ),
    ].filter(Boolean);
    if (!parts.length) return null;
    return (
        <span className="option-row-detail vehicle-quick-add-figures">
            {parts.flatMap((p, i) => (i ? [<span key={`sep${i}`} aria-hidden="true">·</span>, p] : [p]))}
        </span>
    );
}

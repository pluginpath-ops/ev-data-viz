import { useMemo, useState } from 'react';
import Popover from './Popover';
import { searchMatches } from '../utils/vehicleFilters';
import { vehicleLabel } from '../utils/specHelpers';
import { DEFAULT_RUN_COLOR } from '../utils/colorUtils';

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
 * Matching is the filter bar's own `searchMatches`, applied word by word, so
 * the two searches find the same cars and "rivian lr" still finds a Rivian
 * whose trim is "LR".
 *
 *   vehicles          listed vehicles, in display order
 *   selectedIds       the selection, as App holds it
 *   onToggle          (vehicleId) => void — toggleVehicleSelection
 */
export default function VehicleQuickAdd({ vehicles, selectedIds, onToggle }) {
    // Held here rather than in the panel, so closing and reopening keeps the
    // last search. It is selected on focus, so the first key replaces it.
    const [search, setSearch] = useState('');
    const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const matches = words.length
        ? vehicles.filter(v => words.every(w => searchMatches(v, w)))
        : vehicles;

    return (
        <Popover
            title="Add vehicles"
            width="20rem"
            className="vehicle-quick-add"
            trigger={(props) => (
                <button {...props} type="button" className="btn btn-primary" title="Add vehicles to the selection">
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
                    placeholder="Search vehicles…"
                    aria-label="Search vehicles"
                    className="form-input w-full"
                />
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
                                    <span className="truncate">{vehicleLabel(v)}</span>
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

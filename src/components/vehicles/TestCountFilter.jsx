import MenuButton from '../shell/MenuButton';
import NumberInput from '../NumberInput';
import { DATA_CATEGORIES } from '../../utils/vehicleDataCategories';
import { countRange, countRangeText, setCountRange } from '../../utils/vehicleFilters';

/**
 * Bound how many tests of each kind a vehicle has: "at least 4 range tests",
 * "at most 1 charging test" — the question a curator asks to find where the
 * data is thin or deep. Beside the facets in the filter bar, curators only.
 *
 * A row per kind, a minimum and a maximum, either left blank. The number is the
 * one the card shows (listed tests). The facet buttons' look, so it reads as
 * one of them; its active chips sit under the bar like theirs.
 */
export default function TestCountFilter({ filters, onChange }) {
    const set = (key, patch) => onChange(setCountRange(filters, key, { ...countRange(filters, key), ...patch }));
    const active = DATA_CATEGORIES.filter(c => {
        const r = countRange(filters, c.key);
        return r.min != null || r.max != null;
    });
    const summary = active.length === 0 ? null
        : active.length > 1 ? String(active.length)
            : `${active[0].label} ${countRangeText(countRange(filters, active[0].key))}`;

    return (
        <MenuButton
            label="Test count"
            value={summary}
            active={active.length > 0}
            title="Test count — how many tests of a kind a vehicle has"
        >
            {() => (
                <>
                    <div className="guide-facet-panel-head">
                        <span className="text-nano">Vehicles with…</span>
                        {active.length > 0 && (
                            <button type="button" className="section-action" onClick={() => onChange({ ...filters, counts: {} })}>
                                clear
                            </button>
                        )}
                    </div>
                    <div className="guide-facet-panel-list">
                        {DATA_CATEGORIES.map(c => {
                            const r = countRange(filters, c.key);
                            return (
                                <div key={c.key} className="px-2 py-1.5">
                                    <div className="text-note mb-1">{c.label} tests</div>
                                    <div className="flex items-center gap-3">
                                        {[['min', 'at least'], ['max', 'at most']].map(([bound, word]) => (
                                            <label key={bound} className="flex items-center gap-1.5 text-nano whitespace-nowrap">
                                                {word}
                                                <NumberInput
                                                    className="form-input count-filter-input"
                                                    value={r[bound]}
                                                    onChange={n => set(c.key, { [bound]: n })}
                                                    min={0}
                                                    integer
                                                    allowEmpty
                                                    aria-label={`${c.label} tests, ${word}`}
                                                />
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </>
            )}
        </MenuButton>
    );
}

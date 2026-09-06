import { useMemo } from 'react';
import MenuButton from '../../shell/MenuButton';
import { EMPTY_FILTERS } from '../../../utils/feGuideBrowse';
import GuideFacetMenu from './GuideFacetMenu';

/**
 * The guide browser's filter strip (#235, re-skin phase 5a).
 *
 * It was a wall of chips — every value of every facet rendered at once, which
 * with 38 makes and 9 classes and 6 years cost most of a screen before the
 * first row of data, and had to be collapsed behind a disclosure to be usable
 * at all. It is now one row: a search box, a button per facet, and the count.
 * A strip that costs a line does not need to be collapsible, so the disclosure
 * around it is gone.
 *
 * What is narrowing the view moves OUT of the controls and onto its own line —
 * a removable chip per active value. Reading the current state used to mean
 * opening the filters and scanning them for highlights.
 */

/**
 * The facets, once.
 *
 * Counts, menus and the narrowed-by chips are all derived from this list. They
 * were three hand-written blocks that had to be kept in step, which is how the
 * chip line would have been born already missing a facet.
 *
 * `rowKey` is the field on a row; `key` is the filter it drives.
 */
const FACETS = [
    { key: 'years',       rowKey: 'model_year',    label: 'Year' },
    { key: 'makes',       rowKey: 'brand',         label: 'Make' },
    { key: 'bodyClasses', rowKey: 'body_class',    label: 'Class' },
    { key: 'drives',      rowKey: 'drive_desc',    label: 'Drive' },
    { key: 'motorCounts', rowKey: 'motor_count',   label: 'Motors' },
    // Named as partial because it is: EPA has no wheel column, and only some
    // makers write the size into the configuration name.
    { key: 'wheelSizes',  rowKey: 'wheel_size_in', label: 'Wheels',
      format: v => `${v}"`, hint: 'where stated' },
    // Only appears once a curator has set parents.
    { key: 'parents',     rowKey: 'parent_name',   label: 'Parent' },
];

/**
 * A min/max pair behind its own button, so bounds cost a line like a facet.
 *
 * It was a <details>, on the grounds that nothing inside needed JavaScript.
 * That was true and still wrong: <details> does not light-dismiss, so alone in
 * a row of menus that close on an outside click these two stayed open — and
 * their panel sat in the DOM whether open or not, so `.guide-facet-panel`
 * stopped meaning "a menu is open". Same state and the same hook as its
 * neighbours now; the row behaves as one kind of control.
 */
function RangeMenu({ label, unit, minKey, maxKey, filters, onChange }) {
    const min = filters[minKey];
    const max = filters[maxKey];
    const set = (key) => (e) => {
        const raw = e.target.value;
        onChange({ [key]: raw === '' ? null : Number(raw) });
    };
    const active = min != null || max != null;
    return (
        <MenuButton
            label={label}
            value={active ? `${min ?? '–'}…${max ?? '–'}` : null}
            active={active}
            panelClass="guide-range-panel"
        >
            <div className="guide-facet-panel-head">
                <span className="text-nano">{unit}</span>
                {active && (
                    <button
                        type="button"
                        className="section-action"
                        onClick={() => onChange({ [minKey]: null, [maxKey]: null })}
                    >
                        clear
                    </button>
                )}
            </div>
            <div className="guide-range-inputs">
                <input type="number" inputMode="numeric" placeholder="min"
                    aria-label={`Minimum ${label}`}
                    value={min ?? ''} onChange={set(minKey)} className="form-input guide-range-input" />
                <span className="text-meta">–</span>
                <input type="number" inputMode="numeric" placeholder="max"
                    aria-label={`Maximum ${label}`}
                    value={max ?? ''} onChange={set(maxKey)} className="form-input guide-range-input" />
            </div>
        </MenuButton>
    );
}

export default function GuideFilterBar({
    rows, facets, filters, onChange, onReset, filterFn, columnPicker, shownCount,
    clustered, onToggleClustered,
}) {
    /**
     * Counts per facet value, each computed with that facet's own selection
     * removed — so a number says what clicking would LEAVE rather than what the
     * corpus holds. Recomputed together so one pass serves them all.
     */
    const counts = useMemo(() => {
        const out = {};
        for (const f of FACETS) {
            const base = filterFn(rows, { ...filters, [f.key]: [] });
            const tally = new Map();
            for (const r of base) {
                const v = r[f.rowKey];
                if (v == null || v === '') continue;
                tally.set(v, (tally.get(v) ?? 0) + 1);
            }
            out[f.key] = tally;
        }
        return out;
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

    /** Every active value, flattened, so the chip line is data rather than markup. */
    const narrowedBy = FACETS.flatMap(f =>
        (filters[f.key] ?? []).map(v => ({
            id: `${f.key}:${v}`,
            text: (f.format ?? String)(v),
            remove: () => onChange({ [f.key]: filters[f.key].filter(x => x !== v) }),
        })),
    );

    return (
        <div className="guide-filter-strip">
            <div className="guide-filter-row">
                <input
                    type="search"
                    value={filters.search}
                    onChange={e => onChange({ search: e.target.value })}
                    placeholder="Search carline or test group…"
                    aria-label="Search carline or test group"
                    className="form-input guide-search-input"
                />

                {FACETS.map(f => (
                    <GuideFacetMenu
                        key={f.key}
                        label={f.label}
                        hint={f.hint}
                        format={f.format}
                        values={facets[f.key]}
                        selected={filters[f.key]}
                        countFor={v => counts[f.key].get(v) ?? 0}
                        onToggle={toggle(f.key)}
                        onClear={clear(f.key)}
                    />
                ))}

                <RangeMenu label="Range" unit="miles" minKey="minRange" maxKey="maxRange"
                    filters={filters} onChange={onChange} />
                <RangeMenu label="MPGe" unit="combined MPGe" minKey="minMpge" maxKey="maxMpge"
                    filters={filters} onChange={onChange} />

                {/* Not a filter, but it belongs here: everything that changes
                    what you are looking at lives in this row. */}
                {columnPicker}

                <div className="guide-filter-tally">
                    <span className="text-data">{shownCount?.toLocaleString()}</span>
                    <span className="guide-filter-tally-total">of {rows.length.toLocaleString()}</span>
                    {active && (
                        <button type="button" onClick={onReset} className="guide-filter-reset">
                            Reset
                        </button>
                    )}
                </div>
            </div>

            {/* What is narrowing the view, stated. Reading it used to mean
                opening the filters and scanning them for highlights.
                The row renders whenever there is something to put on it — the
                cluster toggle lives here too, at the right, because it changes
                how the rows are grouped rather than which rows there are. */}
            {(narrowedBy.length > 0 || onToggleClustered) && (
                <div className="guide-narrowed-row">
                    {narrowedBy.length > 0 && <span className="text-nano">Narrowed by</span>}
                    {narrowedBy.map(c => (
                        <button
                            key={c.id}
                            type="button"
                            className="guide-narrowed-chip"
                            onClick={c.remove}
                            title={`Remove ${c.text}`}
                        >
                            {c.text}
                            <span aria-hidden="true">✕</span>
                        </button>
                    ))}
                    {onToggleClustered && (
                        <label className="guide-cluster-toggle">
                            <input type="checkbox" checked={clustered} onChange={onToggleClustered} />
                            Cluster by EPA test group
                        </label>
                    )}
                </div>
            )}
        </div>
    );
}

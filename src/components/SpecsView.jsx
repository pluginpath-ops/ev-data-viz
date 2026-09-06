import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { SPEC_CATEGORIES, formatCustomKey } from '../utils/vehicleSpecSchema';
import { formatSpecValue, distanceLabel } from '../utils/unitConversions';
import { SpecFieldFlagButton } from './VoteButtons';
import { mergeInheritedSpecs, resolveEffectiveSpecs, vehicleLabel, vehicleColor } from '../utils/specHelpers';
import SpecsControls from './specs/SpecsControls';
import { bestIndices, rowDiffers, rowIsEmpty } from '../utils/specCompare';

/** Allocated once: a new Set per row per render is 70 objects a keystroke. */
const EMPTY_SET = new Set();

export default function SpecsView({ selectedVehicleIds }) {
    // Read vehicles directly from context so optimistic updates (e.g. admin unflag)
    // reflect immediately without depending on the App.jsx prop-chain re-render timing.
    const { vehicles, flagSpecField, unflagSpecField, isAdmin, units } = useAppContext();

    // Pending flags — buffered locally, committed to DB when the tab is left (unmount).
    const [pendingFlags, setPendingFlags] = useState(() => new Map());

    /**
     * What the table is showing.
     *
     * `hideEmpty` starts ON: a row every vehicle leaves blank says nothing, and
     * with 65 rows in the schema most comparisons are mostly blank. `markBest`
     * starts OFF — see the note on SPEC_CATEGORIES for why that is not a
     * default anyone should have to turn back off.
     */
    /**
     * The header's measured height, so the category bands can stick directly
     * under it.
     *
     * Measured rather than written down: the header grows a line when a vehicle
     * inherits its specs, so a constant would be right for some selections and
     * wrong for others — 75px against the 52 a fixed value would have guessed.
     */
    const [headHeight, setHeadHeight] = useState(0);
    /* A CALLBACK ref, not a ref object with an effect. The view renders an
       empty state before it renders a table, so the <thead> arrives on a later
       render than the first — and a ref object's identity never changes, so an
       effect keyed on it would never re-run to find it. React 19 takes a
       cleanup return from a callback ref, which is where the observer is
       disconnected. */
    const headRef = useCallback((el) => {
        if (!el) return undefined;
        const measure = () => setHeadHeight(el.offsetHeight);
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    /**
     * How tall the table can be before its bottom edge leaves the screen.
     *
     * Measured, because everything above it varies: the sticky header grows
     * with the number of selected vehicles, and the controls strip wraps. The
     * constant it replaces — `calc(100vh - 14rem)` — left the container bottom
     * 5px inside the fold at 1280×800 with four vehicles, which is to say one
     * extra row of chips put the horizontal scrollbar just off the bottom of
     * the screen. A scrollbar you cannot reach is worse than no scrollbar.
     *
     * Measured against the container's PAGE offset, not its viewport top. The
     * viewport top is the tempting one and it oscillates: sizing to it makes
     * the container taller as you scroll, a taller container makes a taller
     * page, and the page grows under the scroll that is measuring it. The page
     * offset does not move when you scroll, so the answer is stable — and it is
     * the tighter of the two constraints anyway, since the table starts below
     * more chrome than stays pinned above it.
     */
    const [maxHeight, setMaxHeight] = useState(null);
    const tableRef = useCallback((el) => {
        if (!el) return undefined;
        let frame = 0;
        const measure = () => {
            frame = 0;
            const pageTop = el.getBoundingClientRect().top + window.scrollY;
            // 16px so the container's bottom border is not flush with the fold.
            setMaxHeight(Math.max(240, Math.round(window.innerHeight - pageTop - 16)));
        };
        const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
        measure();
        window.addEventListener('resize', schedule);
        // The chrome above the table grows with the selection, and the controls
        // strip wraps — both move the page offset without a window resize.
        const ro = new ResizeObserver(schedule);
        ro.observe(document.body);
        return () => {
            if (frame) cancelAnimationFrame(frame);
            window.removeEventListener('resize', schedule);
            ro.disconnect();
        };
    }, []);

    const [filter, setFilter]       = useState('');
    const [diffOnly, setDiffOnly]   = useState(false);
    const [hideEmpty, setHideEmpty] = useState(true);
    const [markBest, setMarkBest]   = useState(false);
    const pendingFlagsRef = useRef(pendingFlags);
    useEffect(() => { pendingFlagsRef.current = pendingFlags; }, [pendingFlags]);

    // Commit all pending flags on tab leave (component unmount).
    useEffect(() => {
        return () => {
            for (const [vehicleId, fieldKeys] of pendingFlagsRef.current) {
                fieldKeys.forEach(fieldKey => flagSpecField(vehicleId, fieldKey));
            }
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps -- intentional: fire only on unmount

    const handleFlag = (vehicleId, fieldKey) => {
        setPendingFlags(prev => {
            const next = new Map(prev);
            const keys = new Set(next.get(vehicleId) ?? []);
            if (keys.has(fieldKey)) keys.delete(fieldKey); // undo
            else keys.add(fieldKey);
            next.set(vehicleId, keys);
            return next;
        });
    };

    // Map over selectedVehicleIds (not vehicles) to preserve pill order.
    const displayVehicles = selectedVehicleIds.length > 0
        ? selectedVehicleIds.map(id => vehicles.find(v => v.id === id)).filter(Boolean)
        : vehicles;

    // Resolve effective specs (own overrides + full ancestor chain) for each vehicle.
    const resolvedVehicles = displayVehicles.map(v => {
        const source = v.spec_source_vehicle_id
            ? vehicles.find(sv => sv.id === v.spec_source_vehicle_id)
            : null;
        const ancestorSpecs = source ? resolveEffectiveSpecs(source, vehicles, new Set([v.id])) : null;
        const { merged, inheritedKeys } = mergeInheritedSpecs(v.specs, ancestorSpecs);
        return {
            ...v,
            effectiveSpecs: merged,
            inheritedKeys,
            sourceVehicleName: source ? vehicleLabel(source) : null,
        };
    });

    // Collect union of all _custom keys per category across effective specs.
    const customKeysByCategory = {};
    for (const rv of resolvedVehicles) {
        for (const cat of SPEC_CATEGORIES) {
            const custom = rv.effectiveSpecs?.[cat.key]?._custom || {};
            if (!customKeysByCategory[cat.key]) customKeysByCategory[cat.key] = new Set();
            for (const customKey of Object.keys(custom)) customKeysByCategory[cat.key].add(customKey);
        }
    }

    const formatValue = (value, type, unitGroup) => {
        if (value === null || value === undefined || value === '') return '—';
        if (type === 'boolean') return value ? 'Yes' : 'No';
        if (unitGroup) return formatSpecValue(value, unitGroup, units);
        return String(value);
    };

    // Small inherited indicator shown in cells where the value came from a source vehicle.
    const InheritedTag = ({ sourceName }) => (
        <span
            className="specs-inherited-tag"
            title={sourceName ? `Inherited from ${sourceName}` : 'Inherited'}
        >↑</span>
    );

    /**
     * Every row the table can show, as DATA (#277, re-skin phase 9).
     *
     * It used to build `<tr>` elements directly in a flatMap, which is why the
     * table could not answer any question about itself: "how many rows differ",
     * "hide the empty ones", "which cell is best" are all questions about a set
     * of values, and there was no set — only markup. The controls strip below
     * is what this refactor is for.
     *
     * `values` is one entry per vehicle, in column order, carrying the raw
     * value as well as the formatted one: `differs` has to compare what was
     * recorded, not how it was printed, or two figures that round to the same
     * string would read as agreement.
     */
    const buildRow = (key, label, get, { type, unitGroup, better, italic } = {}) => ({
        key, label, better, italic,
        values: resolvedVehicles.map(rv => {
            const raw = get(rv);
            const empty = raw === null || raw === undefined || raw === '';
            return { raw: empty ? null : raw, text: formatValue(raw, type, unitGroup), rv };
        }),
    });

    const coreRows = [
        buildRow('vehicle.make',    'Make',    v => v.make),
        buildRow('vehicle.model',   'Model',   v => v.model),
        buildRow('vehicle.trim',    'Trim',    v => v.trim),
        buildRow('vehicle.year',    'Year',    v => v.year),
        buildRow('vehicle.battery', 'Battery (kWh, usable)', v => v.battery),
        // The RAW number, formatted by unitGroup. Passing `fmtDistance(...)`
        // here made the row's value the string "405 mi", which `Number()` reads
        // as NaN — so the one core row with a better direction could never have
        // a best cell. A row model has to hold what was recorded.
        buildRow('vehicle.range',   `EPA Range (${distanceLabel(units)})`,
            v => v.range, { unitGroup: 'distance', better: 'higher' }),
        buildRow('vehicle.runs',    'Test Runs', v => v.runs?.length ?? 0),
    ];

    const sections = [
        { key: '--core', label: 'Vehicle', rows: coreRows },
        ...SPEC_CATEGORIES.map(cat => {
            const customKeys = [...(customKeysByCategory[cat.key] || new Set())];
            return {
                key: cat.key,
                label: cat.label,
                rows: [
                    ...cat.fields.map(f => ({
                        ...buildRow(`${cat.key}.${f.key}`, f.label,
                            rv => rv.effectiveSpecs?.[cat.key]?.[f.key],
                            { type: f.type, unitGroup: f.unitGroup, better: f.better }),
                        flagKey: `${cat.key}.${f.key}`,
                    })),
                    ...customKeys.map(ck => buildRow(
                        `${cat.key}._custom.${ck}`, formatCustomKey(ck),
                        rv => rv.effectiveSpecs?.[cat.key]?._custom?.[ck],
                        { italic: true })),
                ],
            };
        }),
    ];

    // The three questions the controls ask, in utils/specCompare so their edge
    // cases can be tested rather than eyeballed — two of the three bugs found
    // in them were `Number(null) === 0` and a formatted string, neither of
    // which a glance at the table would catch.
    const differs = (row) => rowDiffers(row.values.map(v => v.raw));
    const isEmpty = (row) => rowIsEmpty(row.values.map(v => v.raw));
    const bestSet = (row) => (markBest
        ? bestIndices(row.values.map(v => v.raw), row.better)
        : EMPTY_SET);

    const needle = filter.trim().toLowerCase();
    const visibleSections = sections
        .map(sec => ({
            ...sec,
            rows: sec.rows.filter(r =>
                (!needle || r.label.toLowerCase().includes(needle))
                && (!hideEmpty || !isEmpty(r))
                && (!diffOnly || differs(r))),
        }))
        .filter(sec => sec.rows.length > 0);

    const shownCount = visibleSections.reduce((n, s) => n + s.rows.length, 0);
    const totalCount = sections.reduce((n, s) => n + s.rows.length, 0);

    return (
        <div className="specs-view">
            <SpecsControls
                filter={filter} onFilter={setFilter}
                diffOnly={diffOnly} onDiffOnly={() => setDiffOnly(v => !v)}
                hideEmpty={hideEmpty} onHideEmpty={() => setHideEmpty(v => !v)}
                markBest={markBest} onMarkBest={() => setMarkBest(v => !v)}
                shown={shownCount} total={totalCount} vehicles={resolvedVehicles.length}
            />

            {displayVehicles.length === 0 ? (
                <div className="empty-state">
                    <p className="text-lg">
                        {vehicles.length === 0
                            ? 'No vehicles to compare. Add vehicles first!'
                            : 'No vehicles selected. Select vehicles from the Vehicles page to compare them here.'}
                    </p>
                </div>
            ) : (
                <div
                    className="specs-table-container"
                    ref={tableRef}
                    style={{
                        '--specs-head-h': `${headHeight}px`,
                        ...(maxHeight ? { '--specs-max-h': `${maxHeight}px` } : {}),
                    }}
                >
                    <table className="specs-table">
                        <thead ref={headRef}>
                            <tr>
                                <th className="specs-th specs-col-label">Specification</th>
                                {resolvedVehicles.map((rv, i) => (
                                    <th key={String(rv.id)} className="specs-th">
                                        {/* The column carries the vehicle's series colour, so a
                                            column ties to the same vehicle on every chart. Same
                                            helper the charts use, so they cannot disagree. */}
                                        <span
                                            className="specs-col-swatch"
                                            style={{ backgroundColor: vehicleColor(rv, i) }}
                                            aria-hidden="true"
                                        />
                                        <span className="specs-col-name">{vehicleLabel(rv)}</span>
                                        {rv.sourceVehicleName && (
                                            <span className="specs-col-inherits">
                                                ↑ inherits from {rv.sourceVehicleName}
                                            </span>
                                        )}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {visibleSections.map(sec => (
                                <Fragment key={sec.key}>
                                    <tr className="specs-category-row">
                                        <td className="specs-category-header" colSpan={resolvedVehicles.length + 1}>
                                            <span className="specs-category-label">{sec.label}</span>
                                            <span className="specs-category-count">
                                                {sec.rows.length} row{sec.rows.length === 1 ? '' : 's'}
                                            </span>
                                        </td>
                                    </tr>
                                    {sec.rows.map(row => {
                                        const best = bestSet(row);
                                        return (
                                            <tr key={row.key} className="specs-row">
                                                <td className={`specs-td specs-col-label${row.italic ? ' is-custom' : ''}`}>
                                                    {row.label}
                                                    {/* Which rows take part, said on the rows
                                                        themselves. Without it "mark best" looks
                                                        broken on every row that has no better
                                                        direction — the reader cannot tell a row
                                                        that was skipped on purpose from one the
                                                        feature missed. Shown only with the toggle
                                                        on, because off it is answering a question
                                                        nobody asked. */}
                                                    {markBest && row.better && (
                                                        <span
                                                            className="specs-direction"
                                                            title={row.better === 'higher'
                                                                ? 'Higher is better — the best cell is marked'
                                                                : 'Lower is better — the best cell is marked'}
                                                        >
                                                            {row.better === 'higher' ? '↑' : '↓'}
                                                        </span>
                                                    )}
                                                </td>
                                                {row.values.map((cell, i) => {
                                                    const isInherited = row.flagKey
                                                        ? cell.rv.inheritedKeys.has(row.flagKey)
                                                        : cell.rv.inheritedKeys.has(row.key);
                                                    const committed = row.flagKey
                                                        && (cell.rv.flagged_specs || []).includes(row.flagKey);
                                                    const pending = row.flagKey
                                                        && (pendingFlags.get(cell.rv.id)?.has(row.flagKey) ?? false);
                                                    return (
                                                        <td
                                                            key={String(cell.rv.id)}
                                                            className={`specs-td${best.has(i) ? ' is-best' : ''}${cell.raw == null ? ' is-unrecorded' : ''}`}
                                                        >
                                                            <span className="specs-cell">
                                                                <span className={isInherited ? 'specs-inherited' : undefined}>
                                                                    {cell.text}
                                                                </span>
                                                                {isInherited && <InheritedTag sourceName={cell.rv.sourceVehicleName} />}
                                                                {row.flagKey && (
                                                                    <SpecFieldFlagButton
                                                                        isFlagged={committed || pending}
                                                                        isPending={pending && !committed}
                                                                        onFlag={() => handleFlag(cell.rv.id, row.flagKey)}
                                                                        onUnflag={() => unflagSpecField(cell.rv.id, row.flagKey)}
                                                                        isAdmin={isAdmin}
                                                                    />
                                                                )}
                                                            </span>
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        );
                                    })}
                                </Fragment>
                            ))}
                        </tbody>
                    </table>
                    {shownCount === 0 && (
                        <div className="empty-state">No specification matches these filters.</div>
                    )}
                </div>
            )}
        </div>
    );
}

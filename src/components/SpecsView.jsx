import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { SPEC_CATEGORIES, formatCustomKey } from '../utils/vehicleSpecSchema';
import { formatSpecValue, fmtDistance, distanceLabel } from '../utils/unitConversions';
import { SpecFieldFlagButton } from './VoteButtons';
import { mergeInheritedSpecs, resolveEffectiveSpecs, vehicleLabel, vehicleColor } from '../utils/specHelpers';
import SpecsControls from './specs/SpecsControls';

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
        buildRow('vehicle.range',   `EPA Range (${distanceLabel(units)})`,
            v => (v.range ? fmtDistance(v.range, units) : null)),
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

    /** Not all the same recorded value — the question "differences only" asks. */
    const differs = (row) => {
        const first = row.values[0]?.raw ?? null;
        return row.values.some(v => (v.raw ?? null) !== first);
    };
    const isEmpty = (row) => row.values.every(v => v.raw == null);

    /**
     * Which cell wins, or null.
     *
     * Null unless the FIELD says which way is an improvement — see the note on
     * SPEC_CATEGORIES. A tie has no winner either: washing three of four cells
     * says "these three beat that one", which is not what a tie means.
     */
    const bestIndex = (row) => {
        if (!markBest || !row.better) return null;
        const nums = row.values.map(v => (typeof v.raw === 'number' ? v.raw : Number(v.raw)));
        const valid = nums.filter(n => Number.isFinite(n));
        if (valid.length < 2) return null;
        const target = row.better === 'lower' ? Math.min(...valid) : Math.max(...valid);
        if (valid.filter(n => n === target).length > 1) return null;
        return nums.findIndex(n => n === target);
    };

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
                    style={{ '--specs-head-h': `${headHeight}px` }}
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
                                        const best = bestIndex(row);
                                        return (
                                            <tr key={row.key} className="specs-row">
                                                <td className={`specs-td specs-col-label${row.italic ? ' is-custom' : ''}`}>
                                                    {row.label}
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
                                                            className={`specs-td${i === best ? ' is-best' : ''}${cell.raw == null ? ' is-unrecorded' : ''}`}
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

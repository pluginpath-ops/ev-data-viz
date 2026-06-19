import { useEffect, useRef, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { SPEC_CATEGORIES, formatCustomKey } from '../utils/vehicleSpecSchema';
import { formatSpecValue, fmtDistance, distanceLabel } from '../utils/unitConversions';
import { SpecFieldFlagButton } from './VoteButtons';
import { mergeInheritedSpecs, resolveEffectiveSpecs, vehicleLabel } from '../utils/specHelpers';

export default function SpecsView({ selectedVehicleIds }) {
    // Read vehicles directly from context so optimistic updates (e.g. admin unflag)
    // reflect immediately without depending on the App.jsx prop-chain re-render timing.
    const { vehicles, flagSpecField, unflagSpecField, isAdmin, units } = useAppContext();

    // Pending flags — buffered locally, committed to DB when the tab is left (unmount).
    const [pendingFlags, setPendingFlags] = useState(() => new Map());
    const pendingFlagsRef = useRef(pendingFlags);
    useEffect(() => { pendingFlagsRef.current = pendingFlags; }, [pendingFlags]);

    // ── Sticky mirror scrollbar ───────────────────────────────────────────────
    // The real scroll container is deep inside the page; its native scrollbar
    // only appears at the very bottom of the content. The mirror scrollbar sticks
    // to the bottom of the viewport and overlays the table so it is always reachable.
    const tableContainerRef = useRef(null);
    const mirrorRef = useRef(null);
    const isSyncing = useRef(false);
    const [isOverflowing, setIsOverflowing] = useState(false);
    const [mirrorInnerWidth, setMirrorInnerWidth] = useState(0);

    useEffect(() => {
        const container = tableContainerRef.current;
        if (!container) return;
        const update = () => {
            setIsOverflowing(container.scrollWidth > container.clientWidth + 1);
            setMirrorInnerWidth(container.scrollWidth);
        };
        update();
        const ro = new ResizeObserver(update);
        ro.observe(container);
        const table = container.querySelector('table');
        if (table) ro.observe(table);
        return () => ro.disconnect();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const container = tableContainerRef.current;
        const mirror = mirrorRef.current;
        if (!container || !mirror) return;
        const onContainerScroll = () => {
            if (isSyncing.current) return;
            isSyncing.current = true;
            mirror.scrollLeft = container.scrollLeft;
            isSyncing.current = false;
        };
        const onMirrorScroll = () => {
            if (isSyncing.current) return;
            isSyncing.current = true;
            container.scrollLeft = mirror.scrollLeft;
            isSyncing.current = false;
        };
        container.addEventListener('scroll', onContainerScroll, { passive: true });
        mirror.addEventListener('scroll', onMirrorScroll, { passive: true });
        return () => {
            container.removeEventListener('scroll', onContainerScroll);
            mirror.removeEventListener('scroll', onMirrorScroll);
        };
    }, []);

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
            className="text-[10px] text-indigo-400 ml-0.5 leading-none select-none"
            title={sourceName ? `Inherited from ${sourceName}` : 'Inherited'}
        >↑</span>
    );

    // Build a flat array of <tr> elements for all spec categories.
    const specRows = SPEC_CATEGORIES.flatMap(cat => {
        const customKeys = [...(customKeysByCategory[cat.key] || new Set())];

        const hasAnyData = resolvedVehicles.some(rv => {
            const catData = rv.effectiveSpecs?.[cat.key];
            if (!catData) return false;
            return cat.fields.some(f => {
                const val = catData[f.key];
                return val !== null && val !== undefined && val !== '';
            }) || customKeys.some(ck => catData._custom?.[ck] != null);
        });
        if (!hasAnyData) return [];

        const headerRow = (
            <tr key={`${cat.key}--header`}>
                <td className="specs-table-category-header" colSpan={resolvedVehicles.length + 1}>
                    {cat.label}
                </td>
            </tr>
        );

        const predefinedRows = cat.fields.flatMap(field => {
            const hasValue = resolvedVehicles.some(rv => {
                const val = rv.effectiveSpecs?.[cat.key]?.[field.key];
                return val !== null && val !== undefined && val !== '';
            });
            if (!hasValue) return [];
            const fieldKey = `${cat.key}.${field.key}`;
            return [(
                <tr key={`${cat.key}--${field.key}`}>
                    <td className="specs-table-cell font-medium text-sm">{field.label}</td>
                    {resolvedVehicles.map(rv => {
                        const value = rv.effectiveSpecs?.[cat.key]?.[field.key];
                        const isInherited = rv.inheritedKeys.has(fieldKey);
                        const committedIsFlagged = (rv.flagged_specs || []).includes(fieldKey);
                        const isPending = pendingFlags.get(rv.id)?.has(fieldKey) ?? false;
                        return (
                            <td key={String(rv.id)} className="specs-table-cell text-sm">
                                <span className="flex items-center gap-1">
                                    <span className={isInherited ? 'text-indigo-400' : ''}>
                                        {formatValue(value, field.type, field.unitGroup)}
                                    </span>
                                    {isInherited && <InheritedTag sourceName={rv.sourceVehicleName} />}
                                    <SpecFieldFlagButton
                                        isFlagged={committedIsFlagged || isPending}
                                        isPending={isPending && !committedIsFlagged}
                                        onFlag={() => handleFlag(rv.id, fieldKey)}
                                        onUnflag={() => unflagSpecField(rv.id, fieldKey)}
                                        isAdmin={isAdmin}
                                    />
                                </span>
                            </td>
                        );
                    })}
                </tr>
            )];
        });

        const customRows = customKeys.map(customKey => (
            <tr key={`${cat.key}--custom--${customKey}`}>
                <td className="specs-table-cell font-medium text-sm text-muted italic">
                    {formatCustomKey(customKey)}
                </td>
                {resolvedVehicles.map(rv => {
                    const value = rv.effectiveSpecs?.[cat.key]?._custom?.[customKey];
                    const isInherited = rv.inheritedKeys.has(`${cat.key}._custom.${customKey}`);
                    return (
                        <td key={String(rv.id)} className="specs-table-cell text-sm">
                            {value != null ? (
                                <span className="flex items-center gap-0.5">
                                    <span className={isInherited ? 'text-indigo-400' : ''}>{value}</span>
                                    {isInherited && <InheritedTag sourceName={rv.sourceVehicleName} />}
                                </span>
                            ) : '—'}
                        </td>
                    );
                })}
            </tr>
        ));

        return [headerRow, ...predefinedRows, ...customRows];
    });

    return (
        <div>
            <h2 className="page-title mb-6">
                Vehicle Specifications Comparison
                {selectedVehicleIds.length > 0 && ` (${selectedVehicleIds.length} Selected)`}
            </h2>

            {displayVehicles.length === 0 ? (
                <div className="empty-state">
                    <p className="text-lg">
                        {vehicles.length === 0
                            ? 'No vehicles to compare. Add vehicles first!'
                            : 'No vehicles selected. Select vehicles from the Vehicles page to compare them here.'}
                    </p>
                </div>
            ) : (
                <div className="specs-table-container" ref={tableContainerRef}>
                    <table className="w-full">
                        <thead>
                            <tr>
                                <th className="px-6 py-3 text-left font-semibold">Specification</th>
                                {resolvedVehicles.map(rv => (
                                    <th key={String(rv.id)} className="px-6 py-3 text-left font-semibold">
                                        <div>{vehicleLabel(rv)}</div>
                                        {rv.sourceVehicleName && (
                                            <div className="text-xs font-normal text-indigo-400 mt-0.5">
                                                ↑ inherits from {rv.sourceVehicleName}
                                            </div>
                                        )}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y dark:divide-slate-700">
                            {/* ── Core vehicle fields ── */}
                            <tr>
                                <td className="specs-table-cell font-medium">Make</td>
                                {displayVehicles.map(v => <td key={String(v.id)} className="specs-table-cell">{v.make || '—'}</td>)}
                            </tr>
                            <tr>
                                <td className="specs-table-cell font-medium">Model</td>
                                {displayVehicles.map(v => <td key={String(v.id)} className="specs-table-cell">{v.model || '—'}</td>)}
                            </tr>
                            <tr>
                                <td className="specs-table-cell font-medium">Trim</td>
                                {displayVehicles.map(v => <td key={String(v.id)} className="specs-table-cell">{v.trim || '—'}</td>)}
                            </tr>
                            <tr>
                                <td className="specs-table-cell font-medium">Year</td>
                                {displayVehicles.map(v => <td key={String(v.id)} className="specs-table-cell">{v.year || '—'}</td>)}
                            </tr>
                            <tr>
                                <td className="specs-table-cell font-medium">Battery (kWh, usable)</td>
                                {displayVehicles.map(v => <td key={String(v.id)} className="specs-table-cell">{v.battery || '—'}</td>)}
                            </tr>
                            <tr>
                                <td className="specs-table-cell font-medium">EPA Range ({distanceLabel(units)})</td>
                                {displayVehicles.map(v => <td key={String(v.id)} className="specs-table-cell">{v.range ? fmtDistance(v.range, units) : '—'}</td>)}
                            </tr>
                            <tr>
                                <td className="specs-table-cell font-medium">Test Runs</td>
                                {displayVehicles.map(v => <td key={String(v.id)} className="specs-table-cell">{v.runs?.length || 0}</td>)}
                            </tr>

                            {/* ── Structured spec categories (flat array, no nested arrays) ── */}
                            {specRows}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Mirror scrollbar — no longer needed now that the container has a
                fixed max-height and owns both scroll axes; native scrollbar is
                always visible at the container bottom. Hidden but kept for reference. */}
            <div ref={mirrorRef} style={{ display: 'none' }} />
        </div>
    );
}

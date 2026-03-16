import { useEffect, useRef, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { SPEC_CATEGORIES, formatCustomKey } from '../utils/vehicleSpecSchema';
import { SpecFieldFlagButton } from './VoteButtons';

export default function SpecsView({ vehicles, selectedVehicleIds }) {
    const { flagSpecField, unflagSpecField, isAdmin } = useAppContext();

    // Pending flags — buffered locally, committed to DB when the tab is left (unmount).
    // Map of vehicleId (number) → Set<fieldKey string>.
    // Using a ref in sync with state so the unmount cleanup reads the latest value.
    const [pendingFlags, setPendingFlags] = useState(() => new Map());
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
    const displayVehicles = selectedVehicleIds.length > 0
        ? vehicles.filter(v => selectedVehicleIds.includes(v.id))
        : vehicles;

    // Collect union of all _custom keys per category across displayed vehicles.
    // Order of insertion into the Set determines row order in the table.
    const customKeysByCategory = {};
    for (const vehicle of displayVehicles) {
        if (!vehicle.specs) continue;
        for (const cat of SPEC_CATEGORIES) {
            const custom = vehicle.specs[cat.key]?._custom || {};
            if (!customKeysByCategory[cat.key]) customKeysByCategory[cat.key] = new Set();
            for (const customKey of Object.keys(custom)) customKeysByCategory[cat.key].add(customKey);
        }
    }

    const formatValue = (value, type) => {
        if (value === null || value === undefined || value === '') return '—';
        if (type === 'boolean') return value ? 'Yes' : 'No';
        return String(value);
    };

    // Build a flat array of <tr> elements for all spec categories.
    // Using flatMap (not map returning arrays) so React gets a flat child list
    // with stable, unique keys — avoids stale reconciliation with nested arrays.
    const specRows = SPEC_CATEGORIES.flatMap(cat => {
        const customKeys = [...(customKeysByCategory[cat.key] || new Set())];

        const hasAnyData = displayVehicles.some(v => {
            const catData = v.specs?.[cat.key];
            if (!catData) return false;
            return cat.fields.some(f => {
                const val = catData[f.key];
                return val !== null && val !== undefined && val !== '';
            }) || customKeys.some(ck => catData._custom?.[ck] != null);
        });
        if (!hasAnyData) return [];

        const headerRow = (
            <tr key={`${cat.key}--header`}>
                <td className="specs-table-category-header" colSpan={displayVehicles.length + 1}>
                    {cat.label}
                </td>
            </tr>
        );

        const predefinedRows = cat.fields.flatMap(field => {
            const hasValue = displayVehicles.some(v => {
                const val = v.specs?.[cat.key]?.[field.key];
                return val !== null && val !== undefined && val !== '';
            });
            if (!hasValue) return [];
            const fieldKey = `${cat.key}.${field.key}`;
            return [(
                <tr key={`${cat.key}--${field.key}`}>
                    <td className="specs-table-cell font-medium text-sm">{field.label}</td>
                    {displayVehicles.map(v => {
                        const isFlagged = (v.flagged_specs || []).includes(fieldKey)
                            || (pendingFlags.get(v.id)?.has(fieldKey) ?? false);
                        return (
                            <td key={String(v.id)} className="specs-table-cell text-sm">
                                <span className="flex items-center gap-1">
                                    {formatValue(v.specs?.[cat.key]?.[field.key], field.type)}
                                    <SpecFieldFlagButton
                                        isFlagged={isFlagged}
                                        onFlag={() => handleFlag(v.id, fieldKey)}
                                        onUnflag={() => unflagSpecField(v.id, fieldKey)}
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
                <td className="specs-table-cell font-medium text-sm text-gray-500 italic">
                    {formatCustomKey(customKey)}
                </td>
                {displayVehicles.map(v => (
                    <td key={String(v.id)} className="specs-table-cell text-sm">
                        {v.specs?.[cat.key]?._custom?.[customKey] ?? '—'}
                    </td>
                ))}
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
                <div className="specs-table-container">
                    <table className="w-full">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left font-semibold">Specification</th>
                                {displayVehicles.map(v => (
                                    <th key={String(v.id)} className="px-6 py-3 text-left font-semibold">{v.name}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y">
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
                                <td className="specs-table-cell font-medium">Year</td>
                                {displayVehicles.map(v => <td key={String(v.id)} className="specs-table-cell">{v.year || '—'}</td>)}
                            </tr>
                            <tr>
                                <td className="specs-table-cell font-medium">Battery (kWh, usable)</td>
                                {displayVehicles.map(v => <td key={String(v.id)} className="specs-table-cell">{v.battery || '—'}</td>)}
                            </tr>
                            <tr>
                                <td className="specs-table-cell font-medium">EPA Range (mi)</td>
                                {displayVehicles.map(v => <td key={String(v.id)} className="specs-table-cell">{v.range || '—'}</td>)}
                            </tr>
                            <tr>
                                <td className="specs-table-cell font-medium">Peak Power (kW)</td>
                                {displayVehicles.map(v => <td key={String(v.id)} className="specs-table-cell">{v.power || '—'}</td>)}
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
        </div>
    );
}

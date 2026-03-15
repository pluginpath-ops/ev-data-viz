import { SPEC_CATEGORIES, formatCustomKey } from '../utils/vehicleSpecSchema';

export default function SpecsView({ vehicles, selectedVehicleIds }) {
    const displayVehicles = selectedVehicleIds.length > 0
        ? vehicles.filter(v => selectedVehicleIds.includes(v.id))
        : vehicles;

    // Collect union of all _custom keys per category across displayed vehicles
    const customKeysByCategory = {};
    for (const vehicle of displayVehicles) {
        if (!vehicle.specs) continue;
        for (const cat of SPEC_CATEGORIES) {
            const custom = vehicle.specs[cat.key]?._custom || {};
            if (!customKeysByCategory[cat.key]) customKeysByCategory[cat.key] = new Set();
            for (const key of Object.keys(custom)) customKeysByCategory[cat.key].add(key);
        }
    }

    const formatValue = (value, type) => {
        if (value === null || value === undefined || value === '') return '—';
        if (type === 'boolean') return value ? 'Yes' : 'No';
        return String(value);
    };

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
                                    <th key={v.id} className="px-6 py-3 text-left font-semibold">{v.name}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {/* ── Core vehicle fields ── */}
                            <tr>
                                <td className="specs-table-cell font-medium">Make</td>
                                {displayVehicles.map(v => <td key={v.id} className="specs-table-cell">{v.make || '—'}</td>)}
                            </tr>
                            <tr>
                                <td className="specs-table-cell font-medium">Model</td>
                                {displayVehicles.map(v => <td key={v.id} className="specs-table-cell">{v.model || '—'}</td>)}
                            </tr>
                            <tr>
                                <td className="specs-table-cell font-medium">Year</td>
                                {displayVehicles.map(v => <td key={v.id} className="specs-table-cell">{v.year || '—'}</td>)}
                            </tr>
                            <tr>
                                <td className="specs-table-cell font-medium">Battery (kWh, usable)</td>
                                {displayVehicles.map(v => <td key={v.id} className="specs-table-cell">{v.battery || '—'}</td>)}
                            </tr>
                            <tr>
                                <td className="specs-table-cell font-medium">EPA Range (mi)</td>
                                {displayVehicles.map(v => <td key={v.id} className="specs-table-cell">{v.range || '—'}</td>)}
                            </tr>
                            <tr>
                                <td className="specs-table-cell font-medium">Peak Power (kW)</td>
                                {displayVehicles.map(v => <td key={v.id} className="specs-table-cell">{v.power || '—'}</td>)}
                            </tr>
                            <tr>
                                <td className="specs-table-cell font-medium">Test Runs</td>
                                {displayVehicles.map(v => <td key={v.id} className="specs-table-cell">{v.runs?.length || 0}</td>)}
                            </tr>

                            {/* ── Structured spec categories ── */}
                            {SPEC_CATEGORIES.map(cat => {
                                const customKeys = [...(customKeysByCategory[cat.key] || new Set())];

                                // Only render this category block if at least one vehicle has data for it
                                const hasAnyData = displayVehicles.some(v => {
                                    const catData = v.specs?.[cat.key];
                                    if (!catData) return false;
                                    return cat.fields.some(f => {
                                        const val = catData[f.key];
                                        return val !== null && val !== undefined && val !== '';
                                    }) || customKeys.some(k => catData._custom?.[k] != null);
                                });
                                if (!hasAnyData) return null;

                                return [
                                    // Category header row
                                    <tr key={`${cat.key}-header`}>
                                        <td className="specs-table-category-header" colSpan={displayVehicles.length + 1}>
                                            {cat.label}
                                        </td>
                                    </tr>,
                                    // Predefined field rows
                                    ...cat.fields.map(field => {
                                        const hasValue = displayVehicles.some(v => {
                                            const val = v.specs?.[cat.key]?.[field.key];
                                            return val !== null && val !== undefined && val !== '';
                                        });
                                        if (!hasValue) return null;
                                        return (
                                            <tr key={`${cat.key}-${field.key}`}>
                                                <td className="specs-table-cell font-medium text-sm">{field.label}</td>
                                                {displayVehicles.map(v => (
                                                    <td key={v.id} className="specs-table-cell text-sm">
                                                        {formatValue(v.specs?.[cat.key]?.[field.key], field.type)}
                                                    </td>
                                                ))}
                                            </tr>
                                        );
                                    }).filter(Boolean),
                                    // Custom field rows
                                    ...customKeys.map(key => (
                                        <tr key={`${cat.key}-custom-${key}`}>
                                            <td className="specs-table-cell font-medium text-sm text-gray-500 italic">
                                                {formatCustomKey(key)}
                                            </td>
                                            {displayVehicles.map(v => (
                                                <td key={v.id} className="specs-table-cell text-sm">
                                                    {v.specs?.[cat.key]?._custom?.[key] ?? '—'}
                                                </td>
                                            ))}
                                        </tr>
                                    )),
                                ];
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

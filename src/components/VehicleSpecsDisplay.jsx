import { useState } from 'react';
import { SPEC_CATEGORIES, formatCustomKey } from '../utils/vehicleSpecSchema';

/**
 * Read-only collapsible display of a vehicle's structured specs.
 * Used inside vehicle cards (VehiclesView) and potentially other places.
 *
 * Renders nothing if specs is null/undefined or all categories are empty.
 * Each category is collapsed by default; only categories with ≥1 value are shown.
 */
export default function VehicleSpecsDisplay({ specs, defaultAllOpen = false }) {
    const [openCategories, setOpenCategories] = useState(() =>
        defaultAllOpen ? new Set(SPEC_CATEGORIES.map(c => c.key)) : new Set()
    );

    if (!specs) return null;

    const toggleCategory = (key) => {
        setOpenCategories(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const formatValue = (value, type) => {
        if (value === null || value === undefined || value === '') return null;
        if (type === 'boolean') return value ? 'Yes' : 'No';
        return String(value);
    };

    // Only show categories that have at least one non-null predefined value or a custom field
    const visibleCategories = SPEC_CATEGORIES.filter(cat => {
        const catData = specs[cat.key];
        if (!catData) return false;
        const hasPredefined = cat.fields.some(f => {
            const v = catData[f.key];
            return v !== null && v !== undefined && v !== '';
        });
        const hasCustom = Object.keys(catData._custom || {}).length > 0;
        return hasPredefined || hasCustom;
    });

    if (visibleCategories.length === 0) return null;

    return (
        <div className="mt-3">
            {visibleCategories.map(cat => {
                const catData = specs[cat.key] || {};
                const isOpen = openCategories.has(cat.key);

                const predefinedRows = cat.fields
                    .map(f => ({ label: f.label, value: formatValue(catData[f.key], f.type) }))
                    .filter(row => row.value !== null);

                const customRows = Object.entries(catData._custom || {}).map(([k, v]) => ({
                    label: formatCustomKey(k),
                    value: String(v),
                }));

                return (
                    <div key={cat.key} className="specs-category">
                        <button
                            type="button"
                            className="specs-category-header"
                            onClick={() => toggleCategory(cat.key)}
                        >
                            <span
                                className="specs-chevron"
                                style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
                            >
                                ▶
                            </span>
                            {cat.label}
                        </button>

                        {isOpen && (
                            <div className="mt-1 mb-2">
                                {predefinedRows.map(row => (
                                    <div key={row.label} className="specs-field-row">
                                        <span className="specs-field-label">{row.label}</span>
                                        <span className="specs-field-value">{row.value}</span>
                                    </div>
                                ))}
                                {customRows.map(row => (
                                    <div key={row.label} className="specs-field-row">
                                        <span className="specs-field-label">{row.label}</span>
                                        <span className="specs-field-value">{row.value}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

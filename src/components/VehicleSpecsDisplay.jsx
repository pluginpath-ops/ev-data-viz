import { useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { SPEC_CATEGORIES, formatCustomKey } from '../utils/vehicleSpecSchema';
import { SpecFieldFlagButton } from './VoteButtons';

/**
 * Read-only collapsible display of a vehicle's structured specs.
 *
 * Props:
 *   specs            — vehicle.specs JSONB object (may be pre-merged with inherited values)
 *   flaggedSpecs     — vehicle.flagged_specs string[] (e.g. ['powertrain.horsepower_hp'])
 *   vehicleId        — vehicle.id (needed for flag actions)
 *   defaultAllOpen   — start with all categories expanded
 *   showFlagButtons  — show 🚩 flag buttons on each field (default false)
 *   inheritedKeys    — optional Set<string> of field keys whose values came from a source vehicle
 *   sourceVehicleName — optional display name of the source vehicle (for tooltip text)
 *   pendingFlags     — optional Set<string> buffered locally (not yet in DB)
 *   onFlagField      — optional override flag handler (used for deferred commit)
 *
 * Renders nothing if specs is null/undefined or all categories are empty.
 */
export default function VehicleSpecsDisplay({
    specs,
    flaggedSpecs: flaggedSpecsProp = [],
    vehicleId,
    defaultAllOpen = false,
    showFlagButtons = false,
    inheritedKeys,
    sourceVehicleName,
    pendingFlags,
    onFlagField,
}) {
    const { vehicles, flagSpecField, unflagSpecField, isAdmin } = useAppContext();

    // Read flagged_specs directly from live context so updates reflect immediately
    const liveVehicle = vehicleId ? vehicles.find(v => v.id === vehicleId) : null;
    const flaggedSpecs = liveVehicle?.flagged_specs ?? flaggedSpecsProp;

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

    const InheritedTag = () => (
        <span
            className="text-[10px] text-indigo-400 ml-0.5 leading-none select-none"
            title={sourceVehicleName ? `Inherited from ${sourceVehicleName}` : 'Inherited'}
        >↑</span>
    );

    return (
        <div className="mt-3">
            {sourceVehicleName && (
                <p className="text-xs text-indigo-500 mb-3 flex items-center gap-1">
                    <span>↑</span>
                    <span>Some fields are inherited from <span className="font-medium">{sourceVehicleName}</span></span>
                </p>
            )}
            {visibleCategories.map(cat => {
                const catData = specs[cat.key] || {};
                const isOpen = openCategories.has(cat.key);

                const predefinedRows = cat.fields
                    .map(f => ({
                        label:      f.label,
                        key:        `${cat.key}.${f.key}`,
                        value:      formatValue(catData[f.key], f.type),
                        inherited:  inheritedKeys?.has(`${cat.key}.${f.key}`) ?? false,
                    }))
                    .filter(row => row.value !== null);

                const customRows = Object.entries(catData._custom || {}).map(([k, v]) => ({
                    label:     formatCustomKey(k),
                    key:       `${cat.key}._custom.${k}`,
                    value:     String(v),
                    inherited: inheritedKeys?.has(`${cat.key}._custom.${k}`) ?? false,
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
                                {predefinedRows.map(row => {
                                    const committedIsFlagged = flaggedSpecs.includes(row.key);
                                    const isPending = pendingFlags?.has(row.key) ?? false;
                                    return (
                                        <div key={row.key} className="specs-field-row items-center">
                                            <span className="specs-field-label">{row.label}</span>
                                            <span className="specs-field-value flex items-center gap-1">
                                                <span className={row.inherited ? 'text-indigo-400' : ''}>
                                                    {row.value}
                                                </span>
                                                {row.inherited && <InheritedTag />}
                                                {showFlagButtons && (
                                                    <SpecFieldFlagButton
                                                        isFlagged={committedIsFlagged || isPending}
                                                        isPending={isPending && !committedIsFlagged}
                                                        onFlag={onFlagField
                                                            ? () => onFlagField(row.key)
                                                            : () => flagSpecField(vehicleId, row.key)}
                                                        onUnflag={() => unflagSpecField(vehicleId, row.key)}
                                                        isAdmin={isAdmin}
                                                    />
                                                )}
                                            </span>
                                        </div>
                                    );
                                })}
                                {customRows.map(row => {
                                    const committedIsFlagged = flaggedSpecs.includes(row.key);
                                    const isPending = pendingFlags?.has(row.key) ?? false;
                                    return (
                                        <div key={row.key} className="specs-field-row items-center">
                                            <span className="specs-field-label">{row.label}</span>
                                            <span className="specs-field-value flex items-center gap-1">
                                                <span className={row.inherited ? 'text-indigo-400' : ''}>
                                                    {row.value}
                                                </span>
                                                {row.inherited && <InheritedTag />}
                                                {showFlagButtons && (
                                                    <SpecFieldFlagButton
                                                        isFlagged={committedIsFlagged || isPending}
                                                        isPending={isPending && !committedIsFlagged}
                                                        onFlag={onFlagField
                                                            ? () => onFlagField(row.key)
                                                            : () => flagSpecField(vehicleId, row.key)}
                                                        onUnflag={() => unflagSpecField(vehicleId, row.key)}
                                                        isAdmin={isAdmin}
                                                    />
                                                )}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

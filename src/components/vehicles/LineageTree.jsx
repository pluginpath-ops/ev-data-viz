/**
 * Vehicles & Specs › Lineage: every lineage with something that passes the
 * filters, from its origin down, each vehicle once (`lineageTrees`).
 *
 * The other side of the Cards view's stacks. A stack repeats a source above
 * each of its variants, because there the result is the vehicle; here the
 * result is the lineage, so nothing repeats, and a source the filters remove
 * is a gap row on the way to the variant that matched.
 *
 * A row selects on click, as a List row does, with its checkbox saying so.
 * Each lineage is one bordered panel, its rows divided by hairlines, so where
 * one tree ends and the next begins is never a matter of reading the indent.
 */
import { useState } from 'react';
import LineageIcon from './LineageIcon';
import UnlistedNote from './UnlistedNote';
import BatteryRevisionNote from './BatteryRevisionNote';
import { lineageRole } from '../../utils/vehicleInheritance';
import { distanceValue, distanceUnit } from '../../utils/unitConversions';

/**
 * The connector lines for one row, behind its name cell: a line carried down
 * past the row for every ancestor with a later sibling, the row's own elbow
 * (├ or └) into it from its source, and a stub down to its first variant.
 */
function Connectors({ trail, hasVariants }) {
    const depth = trail.length;
    return (
        <span className="lineage-connectors" aria-hidden="true">
            {trail.map((more, k) => (
                <span
                    key={k}
                    className={`lineage-connector ${k < depth - 1 ? (more ? 'is-through' : '') : (more ? 'is-branch' : 'is-last')}`}
                />
            ))}
            {hasVariants && <span className="lineage-connector is-stub" />}
        </span>
    );
}

function LineageRow({ vehicle, depth, trail, hasVariants, role, units, selected, onToggle, onViewRuns }) {
    const range = vehicle.epaRangeMi ? distanceValue(vehicle.epaRangeMi, units) : null;
    return (
        <div
            role="row"
            onClick={() => onToggle(vehicle)}
            className={`vehicle-card lineage-row${selected ? ' is-selected' : ''}`}
            style={{ '--lineage-depth': depth }}
        >
            <Connectors trail={trail} hasVariants={hasVariants} />
            {/* The checkbox after the lineage icon, so it indents with the
                row and the icon reads as where the row sits in the tree. */}
            <span role="cell" className="lineage-row-name">
                <LineageIcon role={role} />
                <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => onToggle(vehicle)}
                    onClick={e => e.stopPropagation()}
                    aria-label={`Select ${vehicle.name}`}
                />
                <span className="rolodex-card-swatch" style={{ backgroundColor: vehicle.color }} aria-hidden="true" />
                <span className="lineage-row-title">{vehicle.name}</span>
                <UnlistedNote vehicle={vehicle} />
                <BatteryRevisionNote vehicle={vehicle} />
                <span className="vehicle-list-meta">
                    {[vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(' · ')}
                </span>
            </span>
            <span role="cell" className="rolodex-card-figures">
                {vehicle.socWindowKwh != null && <>{vehicle.socWindowKwh}<span className="stat-cell-unit"> kWh</span></>}
            </span>
            <span role="cell" className="rolodex-card-figures">
                {range != null && <>{range}<span className="stat-cell-unit"> {distanceUnit(units)}</span></>}
            </span>
            <span role="cell" onClick={e => e.stopPropagation()}>
                <button type="button" className="btn btn-secondary" onClick={() => onViewRuns(vehicle)}>
                    Tests &amp; Data →
                </button>
            </span>
        </div>
    );
}

/**
 * Sources the filters left out on the way to a variant that matched. Closed,
 * it says how many; open, it names them, as the one line of descent they are.
 */
function GapRow({ row }) {
    const [open, setOpen] = useState(false);
    return (
        <div role="row" className="lineage-row is-gap" style={{ '--lineage-depth': row.depth }}>
            <Connectors trail={row.trail} hasVariants={row.hasVariants} />
            <span role="cell" className="lineage-row-name">
                <button
                    type="button"
                    className="lineage-gap-toggle"
                    aria-expanded={open}
                    onClick={() => setOpen(o => !o)}
                    title={open ? 'Hide what the filters left out' : 'Show what the filters left out'}
                >
                    <span className="lineage-gap-mark" aria-hidden="true">⋯</span>
                    <span>{row.gap} filtered out{open ? ':' : ''}</span>
                    {open && (
                        <span className="vehicle-list-meta">
                            {row.hidden.map(v => [v.year, v.name].filter(Boolean).join(' ')).join(' → ')}
                        </span>
                    )}
                </button>
            </span>
        </div>
    );
}

/**
 * Sources this reader is not shown because they are unlisted: named only as
 * "Unlisted record", and not opened, though the tree carries on past them.
 */
function UnlistedRow({ row }) {
    return (
        <div role="row" className="lineage-row is-gap" style={{ '--lineage-depth': row.depth }} title="Unlisted vehicles are not shown here">
            <Connectors trail={row.trail} hasVariants={row.hasVariants} />
            <span role="cell" className="lineage-row-name">
                <span className="lineage-gap-mark" aria-hidden="true">⋯</span>
                <span>{row.unlisted > 1 ? `${row.unlisted} unlisted records` : 'Unlisted record'}</span>
            </span>
        </div>
    );
}

export default function LineageTree({ trees, index, units, isSelected, onToggle, onViewRuns }) {
    if (trees.length === 0) return <p className="lineage-tree-empty">No vehicles match these filters.</p>;
    return (
        <div className="lineage-tree" role="table" aria-label="Vehicle lineages">
            {trees.map(({ root, rows }) => (
                <div key={root.id} role="rowgroup" className="lineage-tree-group">
                    {rows.map((row, i) => row.unlisted
                        ? <UnlistedRow key={`unlisted-${i}`} row={row} />
                        : row.gap
                        ? <GapRow key={`gap-${i}`} row={row} />
                        : (
                            <LineageRow
                                key={row.vehicle.id}
                                vehicle={row.vehicle}
                                depth={row.depth}
                                trail={row.trail}
                                hasVariants={row.hasVariants}
                                role={lineageRole(row.vehicle, index)}
                                units={units}
                                selected={isSelected(row.vehicle.id)}
                                onToggle={onToggle}
                                onViewRuns={onViewRuns}
                            />
                        ))}
                </div>
            ))}
        </div>
    );
}

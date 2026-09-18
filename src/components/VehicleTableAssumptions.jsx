import MenuButton from './shell/MenuButton';
import { DEFAULT_ASSUMPTIONS, ADD_DISTANCE_RANGE } from '../utils/vehicleTable';

/**
 * The vehicle table's assumptions (#335): inputs the reader sets for the
 * calculated columns that need one. Today that is one: how far a charging stop
 * should take them, for "Time to add 150 mi".
 *
 * One menu for every assumption rather than a control inside each header: a
 * header already sorts on click and moves on drag, and a third gesture on the
 * same cell competes with both. The charge window (10→X%) and an electricity
 * price belong here next, once tested charging curves are in the table (#335).
 */
export default function VehicleTableAssumptions({ assumptions, units, onChange }) {
    const unit = units === 'metric' ? 'km' : 'mi';
    const { addDistance } = assumptions;
    const changed = addDistance !== DEFAULT_ASSUMPTIONS.addDistance;
    return (
        <MenuButton
            label="Assumptions"
            value={`add ${addDistance} ${unit}`}
            active={changed}
            title="Inputs to the calculated columns, such as how far a charging stop should take you"
            panelClass="vehicle-table-assumptions"
        >
            <div className="guide-facet-panel-head">
                <span className="text-nano">Assumptions</span>
                {changed && (
                    <button type="button" className="section-action" onClick={() => onChange(DEFAULT_ASSUMPTIONS)}>
                        reset
                    </button>
                )}
            </div>
            <label className="assumption-field">
                <span className="assumption-field-name">
                    A charging stop adds <span className="text-data">{addDistance} {unit}</span>
                </span>
                <input
                    type="range"
                    className="assumption-slider"
                    min={ADD_DISTANCE_RANGE.min}
                    max={ADD_DISTANCE_RANGE.max}
                    step={ADD_DISTANCE_RANGE.step}
                    value={addDistance}
                    onChange={e => onChange({ ...assumptions, addDistance: Number(e.target.value) })}
                />
                <span className="text-note">
                    Used by “Time to add”. Charge times come from each car’s 10→80% figure, so this
                    assumes the average rate across that window, starting from 10%.
                </span>
            </label>
        </MenuButton>
    );
}

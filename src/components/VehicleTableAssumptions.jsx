import MenuButton from './shell/MenuButton';
import { DEFAULT_ASSUMPTIONS } from '../utils/vehicleTable';
import VehicleAssumptionFields, { assumptionSummary } from './VehicleAssumptionFields';
import { DEFAULT_CORRECTION_TARGET } from '../utils/correctionSettings';

/**
 * The vehicle table's assumptions (#335): inputs the reader sets for the
 * calculated columns that need one — the charge window, how far a stop should
 * take them, what electricity costs at home and at a fast charger, and the
 * conditions the composite range is corrected to — the last is the site-wide
 * correction target, the same setting the charts' Correct control edits.
 *
 * One menu for every assumption rather than a control inside each header: a
 * header already sorts on click and moves on drag, and a third gesture on the
 * same cell competes with both.
 *
 * It offers only what the shown columns read (`needed`), so a preset with no
 * cost column has no price to set, and the table shows no menu at all when
 * nothing needs one. Every default is one a reader need never touch; the
 * sliders are there for the reader who goes looking.
 */
export default function VehicleTableAssumptions({ assumptions, needed, units, onChange, correctionTarget, onCorrectionTargetChange }) {
    // The button names only what the reader changed, and only among what is
    // on offer. The defaults need no restating: the column headers already
    // carry them ("Charge 10→80%", "Time to add 150 mi").
    const summary = assumptionSummary({ assumptions, needed, units, correctionTarget });
    const changed = summary.length > 0;
    const shows = (key) => needed.has(key);

    return (
        <MenuButton
            label="Assumptions"
            value={summary.join(' · ') || null}
            active={changed}
            title="Inputs to the calculated columns: the charge window, how far a stop should take you, electricity prices, the conditions a composite range is corrected to"
            panelClass="vehicle-table-assumptions"
        >
            <div className="guide-facet-panel-head">
                <span className="text-nano">Assumptions</span>
                {changed && (
                    <button type="button" className="section-action" onClick={() => {
                        onChange(DEFAULT_ASSUMPTIONS);
                        if (shows('conditions')) onCorrectionTargetChange(DEFAULT_CORRECTION_TARGET);
                    }}>
                        reset
                    </button>
                )}
            </div>
            <VehicleAssumptionFields
                assumptions={assumptions} needed={needed} units={units} onChange={onChange}
                correctionTarget={correctionTarget} onCorrectionTargetChange={onCorrectionTargetChange}
            />
        </MenuButton>
    );
}

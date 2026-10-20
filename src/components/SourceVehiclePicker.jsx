import VehicleCombobox from './VehicleCombobox';
import NumberInput from './NumberInput';
import InfoIcon from './InfoIcon';
import { descendantIds } from '../utils/vehicleInheritance';
import { packKwh, vehicleDetailLabel, vehicleLabel, vehicleSearchText } from '../utils/specHelpers';

/* Two packs "differ" past this, in either direction. Usable figures for one
   pack are often quoted a percent apart (the R2s: 87.9 and 88.7 kWh); a pack of
   a different size is several percent off. */
const PACK_TOLERANCE = 0.02;

const round3 = (n) => Math.round(n * 1000) / 1000;

/**
 * The source vehicle: what a vehicle inherits from, and how its charging tests come down from it
 * (migration 086, utils/lineageCharging.js).
 *
 * The source pointer used to be set on the specs form, but specs are only one
 * of the things it carries — color, photo, tags, platforms and charging tests
 * come through it too — so it lives with the vehicle.
 *
 * With a source chosen, two more fields:
 *
 *   Battery revision  the pack differs in chemistry or construction: no charging
 *                     tests from the source or above. Its variants inherit
 *                     from it as usual.
 *   Capacity factor   the same battery in a different size: the source's tests
 *                     scaled by it. 1 unless the packs differ in size only.
 *
 * When both packs are on record and differ while neither is set, it says so:
 * the source's curves are being read as this car's at ×1.
 *
 *   vehicle   the vehicle being edited, resolved (its pack figure)
 *   vehicles  the fleet, resolved, to choose from
 *   value     { spec_source_vehicle_id, battery_revision, capacity_factor }
 *   onChange  (patch) => void
 *   canRevise whether migration 086 is applied, so the two fields can be saved
 */
export default function SourceVehiclePicker({ vehicle, vehicles = [], value, onChange, canRevise = true }) {
    const excluded = descendantIds(vehicle?.id, vehicles);
    const options = vehicles
        .filter(v => v.id !== vehicle?.id && !excluded.has(v.id))
        .sort((a, b) => vehicleLabel(a).localeCompare(vehicleLabel(b)))
        .map(v => ({ id: v.id, label: vehicleDetailLabel(v), search: vehicleSearchText(v) }));

    const sourceId = value.spec_source_vehicle_id;
    const source = sourceId != null ? vehicles.find(v => String(v.id) === String(sourceId)) : null;
    const sourceName = source ? vehicleLabel(source) : 'the source';
    const factor = Number(value.capacity_factor) > 0 ? Number(value.capacity_factor) : 1;

    const own = packKwh(vehicle);
    const theirs = packKwh(source);
    const ratio = own && theirs ? own / theirs : null;
    const packsDiffer = ratio != null && Math.abs(ratio - 1) > PACK_TOLERANCE;
    const unaccounted = packsDiffer && !value.battery_revision && Math.abs(factor - ratio) > PACK_TOLERANCE;

    const sourceHelp = source
        ? `Specs, color, photo, tags and platforms it leaves blank come from ${sourceName}, and so do its charging tests unless it is a battery revision.`
        : 'Its own values only. Pick a source to make it a variant.';
    const revisionHelp = `Tick when its pack differs from ${sourceName}’s in chemistry or construction: it then takes no charging tests from ${sourceName} or above, and its own variants inherit from it. Left clear, the same battery: ${sourceName}’s charging tests come down to it.`;
    const factorHelp = `Its pack against ${sourceName}’s, for the same battery in a different size: the charging tests that come down are scaled by it. Leave at 1 for the same pack.`;

    return (
        <div className="source-vehicle-picker">
            <div className="inline-row">
                <label className="source-vehicle-picker-label">Inherits from</label>
                <VehicleCombobox
                    options={options}
                    value={sourceId != null ? String(sourceId) : ''}
                    noneLabel="— Nothing: an origin —"
                    // Its source is nearly always the same model: open on those.
                    suggestedSearch={vehicle?.model ?? ''}
                    onChange={id => onChange({ spec_source_vehicle_id: id ? Number(id) : null })}
                />
                <InfoIcon text={sourceHelp} />
            </div>

            {source && canRevise && (
                <div className="source-vehicle-picker-battery">
                    <div className="inline-row">
                        <label className="inline-row">
                            <input
                                type="checkbox"
                                checked={!!value.battery_revision}
                                onChange={e => onChange({ battery_revision: e.target.checked })}
                            />
                            <span>Battery revision</span>
                        </label>
                        <InfoIcon text={revisionHelp} />
                        {!value.battery_revision && (
                            <>
                                <label className="source-vehicle-picker-label source-vehicle-picker-factor-label" htmlFor="capacity-factor">Capacity factor ×</label>
                                <NumberInput
                                    id="capacity-factor"
                                    className="form-input source-vehicle-picker-factor"
                                    value={factor}
                                    min={0.01}
                                    step="0.001"
                                    onChange={n => onChange({ capacity_factor: n })}
                                />
                                <InfoIcon text={factorHelp} />
                                {packsDiffer && Math.abs(factor - ratio) > PACK_TOLERANCE && (
                                    <button type="button" className="btn btn-secondary"
                                        onClick={() => onChange({ capacity_factor: round3(ratio) })}>
                                        Use {round3(ratio)}
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                    {unaccounted && (
                        <p className="pack-mismatch">
                            The packs differ: {own} kWh here, {theirs} kWh on {sourceName}. Its curves are read
                            here at ×{factor}. Mark a battery revision, or set the capacity factor if it is the
                            same battery in a different size.
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}

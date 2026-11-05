import { useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { chargingLineage } from '../../utils/lineageCharging';
import { vehicleLabel } from '../../utils/specHelpers';
import InfoIcon from '../InfoIcon';

/**
 * The top of Inherited Tests: where this vehicle's charging tests come from
 * down its lineage (migration 086), or that a battery revision stops them.
 * A curator who can edit the vehicle gets the Battery revision box itself,
 * the same field Edit vehicle holds, since this is where its effect shows.
 * Nothing for a vehicle with no source.
 *
 * Walks the whole fleet, unlisted vehicles included, as the resolver does: a
 * listed variant still inherits through an unlisted source.
 */
export default function LineageChargingNote({ vehicle, canEdit = false }) {
    const { fleet, updateVehicle, batteryRevisionAvailable } = useAppContext();
    const [saving, setSaving] = useState(false);
    if (vehicle?.spec_source_vehicle_id == null) return null;
    const byId = new Map(fleet.map(v => [v.id, v]));
    const source = byId.get(vehicle.spec_source_vehicle_id);
    if (!source) return null;
    const name = vehicleLabel(source);
    const revised = !!vehicle.battery_revision;

    const lineage = chargingLineage(vehicle, byId);
    const furthest = lineage.at(-1)?.source;
    const factor = lineage[0]?.capacityFactor ?? 1;
    const status = revised
        ? `Battery revision: takes no charging tests from ${name} or above.`
        : `Charging tests come down from ${name}`
            + (furthest && furthest.id !== source.id ? ` and its sources up to ${vehicleLabel(furthest)}` : '')
            + (factor !== 1 ? `, scaled ×${factor}` : '')
            + '.';

    if (!(canEdit && batteryRevisionAvailable)) {
        return <p className="text-note mt-1">{status}</p>;
    }

    const toggle = async (next) => {
        setSaving(true);
        try { await updateVehicle(vehicle.id, { battery_revision: next }); }
        finally { setSaving(false); }
    };
    return (
        <div className="inline-row mt-1">
            <label className="inline-row">
                <input
                    type="checkbox"
                    checked={revised}
                    disabled={saving}
                    onChange={e => toggle(e.target.checked)}
                />
                <span>Battery revision</span>
            </label>
            <InfoIcon text={`Tick when its pack differs from ${name}’s in chemistry or construction: it then takes no charging tests from ${name} or above, and its own variants inherit from it. Left clear, the same battery: ${name}’s charging tests come down to it.`} />
            <span className="text-note">{saving ? 'Saving…' : status}</span>
        </div>
    );
}

import { useEffect, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import VehicleSpecsDisplay from './VehicleSpecsDisplay';
import { SpecVouchButton } from './VoteButtons';
import { mergeInheritedSpecs, vehicleLabel } from '../utils/specHelpers';

/**
 * Read-only modal showing a vehicle's specs.
 * Shown to users who can view but not edit specs.
 * All categories expanded by default.
 * Includes a vouch button for anonymous / non-editor users.
 */
export default function ViewSpecsModal({ vehicle, onClose }) {
    const { vehicles, specVouches, loadSpecVouches, toggleSpecVouch, flagSpecField } = useAppContext();

    useEffect(() => {
        loadSpecVouches(vehicle.id);
    }, [vehicle.id]);

    // Use the live vehicle from context so flagged_specs updates are reflected immediately
    const liveVehicle = vehicles.find(v => v.id === vehicle.id) || vehicle;
    const vouches = specVouches[vehicle.id] ?? { count: 0, myVouch: false };

    // Resolve inherited specs
    const sourceVehicle = liveVehicle.spec_source_vehicle_id
        ? vehicles.find(v => v.id === liveVehicle.spec_source_vehicle_id)
        : null;
    const { merged: effectiveSpecs, inheritedKeys } = mergeInheritedSpecs(
        liveVehicle.specs,
        sourceVehicle?.specs
    );
    const sourceVehicleName = sourceVehicle ? vehicleLabel(sourceVehicle) : null;

    // Pending flags — buffered locally, committed to DB only when the modal closes.
    // Clicking 🚩 again before closing cancels the flag (no DB call at all).
    const [pendingFlags, setPendingFlags] = useState(() => new Set());

    const handleFlagField = (fieldKey) => {
        setPendingFlags(prev => {
            const next = new Set(prev);
            if (next.has(fieldKey)) next.delete(fieldKey); // undo
            else next.add(fieldKey);
            return next;
        });
    };

    const handleClose = () => {
        // Commit all pending flags fire-and-forget, then close
        pendingFlags.forEach(fieldKey => flagSpecField(liveVehicle.id, fieldKey));
        onClose();
    };

    return (
        <div className="modal-overlay" onClick={handleClose}>
            <div
                className="modal-panel rounded-xl shadow-2xl w-full mx-4"
                style={{ maxWidth: '560px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
                onClick={e => e.stopPropagation()}
            >
                <div className="modal-header px-6 pt-5 pb-3">
                    <h3 className="section-title mb-0">Specs — {liveVehicle.name}</h3>
                    <button
                        onClick={handleClose}
                        className="text-gray-400 hover:text-gray-600 text-xl leading-none"
                        aria-label="Close"
                    >
                        ×
                    </button>
                </div>

                <div className="modal-body flex-1 overflow-y-auto">
                    <VehicleSpecsDisplay
                        specs={effectiveSpecs}
                        flaggedSpecs={liveVehicle.flagged_specs || []}
                        vehicleId={liveVehicle.id}
                        defaultAllOpen={true}
                        showFlagButtons={true}
                        inheritedKeys={inheritedKeys}
                        sourceVehicleName={sourceVehicleName}
                        pendingFlags={pendingFlags}
                        onFlagField={handleFlagField}
                    />
                </div>

                <div className="modal-footer justify-between">
                    <SpecVouchButton
                        count={vouches.count}
                        myVouch={vouches.myVouch}
                        onVouch={() => toggleSpecVouch(vehicle.id)}
                    />
                    <button type="button" onClick={handleClose} className="btn btn-secondary text-sm">
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}

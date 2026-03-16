import { useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import VehicleSpecsDisplay from './VehicleSpecsDisplay';
import { SpecVouchButton } from './VoteButtons';

/**
 * Read-only modal showing a vehicle's specs.
 * Shown to users who can view but not edit specs.
 * All categories expanded by default.
 * Includes a vouch button for anonymous / non-editor users.
 */
export default function ViewSpecsModal({ vehicle, onClose }) {
    const { specVouches, loadSpecVouches, toggleSpecVouch } = useAppContext();

    useEffect(() => {
        loadSpecVouches(vehicle.id);
    }, [vehicle.id]);

    const vouches = specVouches[vehicle.id] ?? { count: 0, myVouch: false };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div
                className="modal-panel rounded-xl shadow-2xl w-full mx-4"
                style={{ maxWidth: '560px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
                onClick={e => e.stopPropagation()}
            >
                <div className="modal-header px-6 pt-5 pb-3">
                    <h3 className="section-title mb-0">Specs — {vehicle.name}</h3>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 text-xl leading-none"
                        aria-label="Close"
                    >
                        ×
                    </button>
                </div>

                <div className="modal-body flex-1 overflow-y-auto">
                    <VehicleSpecsDisplay
                        specs={vehicle.specs}
                        flaggedSpecs={vehicle.flagged_specs || []}
                        vehicleId={vehicle.id}
                        defaultAllOpen={true}
                        showFlagButtons={true}
                    />
                </div>

                <div className="modal-footer justify-between">
                    <SpecVouchButton
                        count={vouches.count}
                        myVouch={vouches.myVouch}
                        onVouch={() => toggleSpecVouch(vehicle.id)}
                    />
                    <button type="button" onClick={onClose} className="btn btn-secondary text-sm">
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}

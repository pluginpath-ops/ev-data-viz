import VehicleSpecsDisplay from './VehicleSpecsDisplay';

/**
 * Read-only modal showing a vehicle's specs.
 * Shown to users who can view but not edit specs.
 * All categories expanded by default.
 */
export default function ViewSpecsModal({ vehicle, onClose }) {
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
                    <VehicleSpecsDisplay specs={vehicle.specs} defaultAllOpen={true} />
                </div>

                <div className="modal-footer">
                    <button type="button" onClick={onClose} className="btn btn-secondary text-sm">
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}

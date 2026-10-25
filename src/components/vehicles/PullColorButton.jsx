import { useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { displayImageUrl } from '../../utils/imageRenditions';
import { sampleImageColor } from '../../utils/imageColor';
import { ownValues } from '../../utils/vehicleInheritance';

/**
 * "Pull color" — set a vehicle's own color from its photo, in one click (#311).
 *
 * Offered to curators only, and only to a vehicle with no color of its own
 * that is not already borrowing a source's: a variant that inherits a vehicle's
 * color is following it on purpose, and a pull would cut that pointer. A color
 * inherited from the BRAND does not count as set, since pulling over it is
 * exactly what the button is for.
 *
 * The click is the choice, so a pull that finds nothing honest writes nothing
 * and says why in place, and a pull that does write offers Undo in the banner.
 */
export function canPullColor(vehicle) {
    if (ownValues(vehicle).color) return false;
    const from = vehicle.inheritedFrom?.color;
    if (from && !from.brand) return false;
    return Boolean(displayImageUrl(vehicle));
}

export default function PullColorButton({ vehicle, onUpdate }) {
    const { showUndoable, isContributor } = useAppContext();
    const [state, setState] = useState({ busy: false, reason: null });

    if (!isContributor || !canPullColor(vehicle)) return null;

    const pull = async () => {
        setState({ busy: true, reason: null });
        const { color, reason } = await sampleImageColor(displayImageUrl(vehicle));
        setState({ busy: false, reason });
        if (!color) return;
        if (await onUpdate(vehicle.id, { color }) === false) return;
        showUndoable(`Color set from ${vehicle.name}'s photo`, 'Undo', () => onUpdate(vehicle.id, { color: null }));
    };

    return (
        <>
            <button
                type="button"
                className="vehicle-media-color-pull"
                disabled={state.busy}
                onClick={pull}
                title="Set this vehicle's color from its photo"
            >
                {state.busy ? 'Reading…' : 'Pull color'}
            </button>
            {state.reason && <span className="vehicle-media-color-caption">{state.reason}</span>}
        </>
    );
}

/**
 * The note that a car's fast-charging minutes are a guess: no test, no
 * 10→80% time and no max DC kW, so the model assumes a peak. Names the cars.
 * Nothing when every car has data. Shown where fast minutes or cost are.
 */
import { fastIsAssumed } from '../../utils/costToDrive';
import { vehicleLabel } from '../../utils/specHelpers';

/** @param {{entries: Array<{vehicle, profile}>}} props  priced entries; missing ones are skipped */
export default function FastSpeedNote({ entries }) {
    const names = entries.filter(e => e && !e.missing && fastIsAssumed(e.profile)).map(e => vehicleLabel(e.vehicle));
    if (!names.length) return null;
    return (
        <p className="note-panel mb-2" role="note">
            Fast-charging speed assumed (no data for {names.join(', ')}): its fast-charging minutes and cost are a guess.
        </p>
    );
}

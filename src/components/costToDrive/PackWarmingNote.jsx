/**
 * The warning that winter, parked outside, costs more than Cost & Time prices:
 * the car warms its battery before it charges and before it drives. Shown in
 * the Season settings and on Home Charger, where 120 V suffers most. Nothing
 * when the winter temperature is at or above PACK_WARMING_BELOW_F.
 */
import { PACK_WARMING_BELOW_F } from '../../constants/costToDrive';

export default function PackWarmingNote({ settings }) {
    if (settings.winterF >= PACK_WARMING_BELOW_F) return null;
    return (
        <p className="note-panel" role="note">
            Parked outside at {settings.winterF}°F, a car warms its battery before it charges and before
            it drives. That energy is not priced, so winter costs more than shown, most on 120 V, where
            warming can take much of a night&rsquo;s charge. In a garage, or above about {PACK_WARMING_BELOW_F}°F,
            the battery warms itself as it charges and the loss is small.
        </p>
    );
}

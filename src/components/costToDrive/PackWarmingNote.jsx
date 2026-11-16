/**
 * The note that winter, parked outside, prices battery warming as a guess:
 * the car warms its battery before it charges and before it drives. Shown in
 * the Season settings and on Charging Speeds. Nothing when the winter
 * temperature is at or above PACK_WARMING_BELOW_F.
 */
import { PACK_WARMING_BELOW_F } from '../../constants/costToDrive';

export default function PackWarmingNote({ settings }) {
    if (settings.winterF >= PACK_WARMING_BELOW_F) return null;
    return (
        <p className="note-panel" role="note">
            Below {PACK_WARMING_BELOW_F}°F, the first home charge and the first fast charge of the day pay to
            warm the battery: a rough estimate, scaled by each vehicle&rsquo;s battery size and the outside
            temperature. At home it comes out of the charger&rsquo;s time, so on 120 V in hard cold it can take
            most of the night; for a fast charge it is drawn from the battery on the way there.
        </p>
    );
}

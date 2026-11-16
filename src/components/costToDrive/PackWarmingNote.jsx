/**
 * The note that winter, parked outside, prices battery warming as a guess:
 * the car warms its battery before it charges and before it drives. Shown in
 * the Season settings and on Home Charger. Nothing when the winter
 * temperature is at or above PACK_WARMING_BELOW_F.
 */
import { PACK_WARMING_BELOW_F } from '../../constants/costToDrive';

export default function PackWarmingNote({ settings }) {
    if (settings.winterF >= PACK_WARMING_BELOW_F) return null;
    return (
        <p className="note-panel" role="note">
            Parked outside at {settings.winterF}°F, a car warms its battery before it charges and before
            it drives. Each home charge is priced with a guess at that energy, scaled by battery size and
            degrees below {PACK_WARMING_BELOW_F}°F. Real cars vary a lot. In a garage it costs less; on 120 V
            in hard cold, warming can take most of a night&rsquo;s charge, which is not priced.
        </p>
    );
}

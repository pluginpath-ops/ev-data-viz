/**
 * The week under the chart, a column a day: the day type and miles, then the
 * day's charging as two blocks in one style (owner, 2026-11-07) —
 *
 *   Home · $2
 *   10% → 24% @ 4:00 am
 *   Fast · $10
 *   Add 27% in 23 min
 *
 * Home first (every day has a night), fast under it (owner, 2026-11-07).
 *
 * Fast lists each stop by what it added and how long it took; the time of day
 * of a stop is left out, since the week's driving hours are a sketch. Home is
 * the night, from arriving home to where it stopped and when: full, or the
 * end of the plug-in window when the night ran out. A planned fast charge that
 * was skipped (the car was already above the cap) says so, since a stop that
 * silently went missing reads as a bug.
 */
import { weekTimeText, minutesText, dollars } from '../../utils/costToDrive';

const TYPE_NAMES = { D: 'Daily', L: 'Long day', O: 'Off' };
/** A clock time from an hour of the day, fractional: "4:10 am". */
const clockText = (h) => weekTimeText(h % 24).slice(4);

export default function DayStrip({ week, settings }) {
    // A night's cost: the week's home cost by its share of what the nights
    // added, since every night is bought at one price through one charger.
    const nightsAdded = week.days.reduce((t, d) => t + d.night.added, 0);
    const nightCost = (night) => (nightsAdded > 0 ? week.homeCost * night.added / nightsAdded : 0);
    return (
        <ol className="day-strip" aria-label="The week, day by day">
            {week.days.map((d) => {
                const fastCost = d.stops.reduce((t, s) => t + s.cost, 0);
                const n = d.night;
                return (
                    <li key={d.day} className={`day-strip-day is-${d.type}`}>
                        <span className="day-strip-head">
                            <span className="text-label">{d.day}</span>
                            <span className="text-meta">{TYPE_NAMES[d.type]}{d.miles ? ` · ${d.miles} mi` : ''}</span>
                        </span>
                        <span className="day-charge is-home">
                            <span className="day-charge-head">Home · {dollars(nightCost(n))}</span>
                            {n.added < 0.5
                                ? <span>Already at {Math.round(n.endSoc)}%</span>
                                : (
                                    <span title={n.ranOut ? 'The plug-in window ended before the battery reached its limit.' : undefined}>
                                        {Math.round(d.homeSoc)}% → {Math.round(n.endSoc)}% @ {clockText(n.ranOut ? settings.plugUntil : n.fullAt)}
                                    </span>
                                )}
                        </span>
                        {d.stops.length > 0 && (
                            <span className="day-charge is-fast">
                                <span className="day-charge-head">Fast · {dollars(fastCost)}</span>
                                {d.stops.map((s) => (
                                    <span key={s.hour}
                                          title={`${s.planned ? 'Planned fast charge' : 'Fast stop'}: ${Math.round(s.fromSoc)}% to ${Math.round(s.toSoc)}%, ${minutesText(s.minutes)} with ${s.planned ? '' : 'the detour and '}time to start and pay`}>
                                        {s.planned ? 'Planned: add' : 'Add'} {Math.round(s.toSoc - s.fromSoc)}% in {minutesText(s.minutes)}
                                    </span>
                                ))}
                            </span>
                        )}
                        {d.plannedSkipped && <span className="text-note">Planned stop skipped: already above {settings.capTo}%</span>}
                    </li>
                );
            })}
        </ol>
    );
}

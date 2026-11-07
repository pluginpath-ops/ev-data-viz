/**
 * The week under the chart, a column a day: the day type and miles, each fast
 * stop as a chip (when, from and to, minutes), and what the night at home put
 * back. A planned fast charge that was skipped (the car was already above the
 * cap) says so, since a chip that silently went missing reads as a bug.
 */
import { weekTimeText, minutesText } from '../../utils/costToDrive';
import { hourText } from './DriveFields';

const TYPE_NAMES = { D: 'Daily', L: 'Long day', O: 'Off' };

function nightText(night, plugFrom) {
    if (night.added < 0.5) return 'Home: nothing to add';
    const to = `+${Math.round(night.added)}% to ${Math.round(night.endSoc)}%`;
    if (night.ranOut) return `Home: ${to}, the night ran out`;
    return `Home: ${to} by ${hourText(Math.ceil(night.fullAt ?? plugFrom) % 24)}`;
}

export default function DayStrip({ week, settings }) {
    return (
        <ol className="day-strip" aria-label="The week, day by day">
            {week.days.map((d) => (
                <li key={d.day} className={`day-strip-day is-${d.type}`}>
                    <span className="day-strip-head">
                        <span className="text-label">{d.day}</span>
                        <span className="text-meta">{TYPE_NAMES[d.type]}{d.miles ? ` · ${d.miles} mi` : ''}</span>
                    </span>
                    {d.stops.map((s) => (
                        <span key={s.hour} className={`stop-chip${s.planned ? ' is-planned' : ''}`}
                              title={`${s.planned ? 'Planned fast charge' : 'Fast stop'} at ${weekTimeText(s.hour)}, mile ${s.mile}: ${Math.round(s.fromSoc)}% to ${Math.round(s.toSoc)}%, ${minutesText(s.minutes)} with the detour and time to start and pay`}>
                            <span>{weekTimeText(s.hour).slice(4)}</span>
                            <span>{Math.round(s.fromSoc)}→{Math.round(s.toSoc)}%</span>
                            <span>{minutesText(s.minutes)}</span>
                        </span>
                    ))}
                    {d.plannedSkipped && <span className="text-note">Planned stop skipped: already above {settings.capTo}%</span>}
                    <span className="text-note">{nightText(d.night, settings.plugFrom)}</span>
                </li>
            ))}
        </ol>
    );
}

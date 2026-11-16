/**
 * Your week: a day button for each weekday that cycles Daily → Long day → Off,
 * and beneath each a planned fast charge (a grocery run, a regular stop).
 * `compact` is the sidebar's: one-letter days and the planned days as a select.
 */
import { WEEKDAYS } from '../../constants/costToDrive';

const NAMES = { D: 'Daily', L: 'Long day', O: 'Off' };
const SHORT = { D: 'D', L: 'L', O: '–' };
const NEXT = { D: 'L', L: 'O', O: 'D' };

export default function WeekPicker({ settings, onChange, compact = false }) {
    const { week, planned } = settings;
    const miles = (t) => (t === 'L' ? `${settings.longMi} mi` : t === 'D' ? `${settings.dailyMi} mi` : '—');
    const cycle = (d) => onChange({ week: week.slice(0, d) + NEXT[week[d]] + week.slice(d + 1) });
    const togglePlanned = (d) => onChange({ planned: planned ^ (1 << d) });

    const days = WEEKDAYS.map((name, d) => (
        <button
            key={name}
            type="button"
            className={`week-day is-${week[d]}`}
            aria-label={`${name}: ${NAMES[week[d]]}. Click to change.`}
            onClick={() => cycle(d)}
        >
            <span className="text-meta">{name}</span>
            {compact
                ? <span className="week-day-type">{SHORT[week[d]]}</span>
                : (
                    // Both, and the card's width picks (.week-picker-frame): the
                    // names overran each other at phone width.
                    <span className="week-day-type">
                        <span className="week-day-name">{NAMES[week[d]]}</span>
                        <span className="week-day-letter" aria-hidden="true">{SHORT[week[d]]}</span>
                    </span>
                )}
            {!compact && <span className="text-caption">{miles(week[d])}</span>}
        </button>
    ));

    if (compact) {
        const plannedDays = WEEKDAYS.filter((_, d) => planned & (1 << d));
        return (
            <div className="week-picker is-compact">
                <div className="week-days">{days}</div>
                <span className="text-note">D Daily · L Long day · – Off. Click a day to change it.</span>
                <label className="drive-field is-wide">
                    <span className="text-label">Planned fast charge</span>
                    <select
                        className="form-input"
                        value={plannedDays.length === 1 ? WEEKDAYS.indexOf(plannedDays[0]) : plannedDays.length ? 'many' : 'none'}
                        onChange={e => {
                            const v = e.target.value;
                            if (v === 'none') onChange({ planned: 0 });
                            else if (v !== 'many') onChange({ planned: 1 << Number(v) });
                        }}
                    >
                        <option value="none">None</option>
                        {WEEKDAYS.map((n, d) => <option key={n} value={d}>{n}</option>)}
                        {plannedDays.length > 1 && <option value="many">{plannedDays.join(', ')}</option>}
                    </select>
                </label>
            </div>
        );
    }

    return (
        <div className="week-picker-frame">
            <div className="week-picker">
                <span className="text-label">Day</span>
                {days}
                <span className="week-picker-label">
                    <span className="text-label">Planned fast charge</span>
                    <span className="text-meta">a grocery run</span>
                </span>
                {WEEKDAYS.map((name, d) => {
                    const on = (planned & (1 << d)) !== 0;
                    return (
                        <label key={name} className={`week-planned${on ? ' is-on' : ''}`}>
                            <input type="checkbox" checked={on} aria-label={`Planned fast charge on ${name}`} onChange={() => togglePlanned(d)} />
                            {/* A glyph, not the words: "Fast charge" wrapped to two lines in a day's
                                narrow column. The row's label and the checkbox's name say it. */}
                            {on && <span aria-hidden="true">⚡</span>}
                        </label>
                    );
                })}
            </div>
        </div>
    );
}

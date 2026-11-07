/**
 * The home charger level: a grid of radio cards on Your Driving, a select in
 * the sidebar (`compact`). Each names its volts and amps and the power they
 * make, a wall outlet saying so.
 */
import { HOME_LEVELS, levelKw } from '../../constants/costToDrive';

export const levelLabel = (level) => `${level.volts} V · ${level.amps} A`;
const powerText = (level) => `${levelKw(level).toFixed(1)} kW${level.volts < 200 ? ' · wall outlet' : ''}`;

export default function HomeLevelPicker({ settings, onChange, compact = false }) {
    if (compact) {
        return (
            <select
                aria-label="Home charger"
                className="form-input"
                value={settings.level}
                onChange={e => onChange({ level: Number(e.target.value) })}
            >
                {HOME_LEVELS.map((l, i) => <option key={i} value={i}>{levelLabel(l)} ({levelKw(l).toFixed(1)} kW)</option>)}
            </select>
        );
    }
    return (
        <fieldset className="home-levels">
            <legend className="text-label">Charger</legend>
            {HOME_LEVELS.map((l, i) => (
                <label key={i} className={`home-level${settings.level === i ? ' is-on' : ''}`}>
                    <input type="radio" name="home-level" checked={settings.level === i} onChange={() => onChange({ level: i })} />
                    <span className="home-level-text">
                        <span className="text-body">{levelLabel(l)}</span>
                        <span className="text-meta">{powerText(l)}</span>
                    </span>
                </label>
            ))}
        </fieldset>
    );
}

/**
 * The gas car's picker: one click for a car (F-150, Civic, RAV4, X3, Pilot,
 * with its EPA mpg and tank), or a name for the reader's own. Picking one names
 * the gas car after it (`gasCar`); typing a name makes it the reader's own.
 *
 * One component for both tabs that draw the gas car — Cost & Time's settings
 * and Road Trip's sidebar — so the car is picked the same way in each and the
 * choice, held once in the shared settings, shows in both (#555). `info` is an
 * ⓘ set beside the "Car" label, where a tab has more to say. Names:
 * docs/vocabulary.md, Cost to Drive.
 */
import { GAS_CAR_PRESETS, GAS_CAR_FALLBACK_NAME } from '../../constants/costToDrive';

export default function GasCarPicker({ settings, onChange, info = null }) {
    const custom = settings.gasCar === 'custom';
    return (
        <div className="drive-presets" role="group" aria-label="Car">
            <span className="text-label">Car{info}</span>
            {GAS_CAR_PRESETS.map(p => (
                <button key={p.key} type="button" className="btn btn-secondary" title={`${p.title}: ${p.settings.gasCity} city / ${p.settings.gasHwy} hwy mpg, ${p.settings.gasTank} gal`}
                    aria-pressed={settings.gasCar === p.key}
                    onClick={() => onChange({ ...p.settings, gasCar: p.key })}>
                    {p.label}
                </button>
            ))}
            <input type="text" className={`form-input drive-name-input${custom ? ' is-selected' : ''}`}
                value={settings.gasName} placeholder={GAS_CAR_FALLBACK_NAME} maxLength={24}
                aria-label="Your own car's name" title="Your own car: name it here"
                onClick={() => { if (!custom) onChange({ gasCar: 'custom' }); }}
                onChange={e => onChange({ gasName: e.target.value, gasCar: 'custom' })} />
        </div>
    );
}

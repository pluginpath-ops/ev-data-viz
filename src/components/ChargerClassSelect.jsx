import { VOLTAGE_CLASSES } from '../utils/platforms';

/**
 * The voltage class of the charger a test was taken on (#366), on the test's
 * add and edit forms. "Not recorded" is its own choice and the default
 * (utils/runChargerClass.js).
 */
export default function ChargerClassSelect({ value, onChange }) {
    return (
        <select
            value={value ?? ''}
            onChange={e => onChange(e.target.value)}
            className="form-input w-full mt-2"
            aria-label="Charger voltage class"
            title="The class of the charger this test used. An 800 V car on a 400 V charger — a V3 Supercharger — is held to a fraction of its rate, and its curve says nothing about the car until the taper takes over."
        >
            <option value="">Charger: not recorded</option>
            {VOLTAGE_CLASSES.map(v => <option key={v} value={v}>Charger: {v} V class</option>)}
        </select>
    );
}

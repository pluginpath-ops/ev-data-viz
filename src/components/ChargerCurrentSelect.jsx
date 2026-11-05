import { CHARGER_CURRENT_CLASSES, chargerCurrentText } from '../utils/chargerCurrentClass';

/**
 * The current class of the charger a test was taken on, beside the voltage class
 * (ChargerClassSelect), on the test's add and edit forms. "Not recorded" is its
 * own choice and the default, and is read as 500 A (utils/chargerCurrentClass.js).
 */
export default function ChargerCurrentSelect({ value, onChange }) {
    return (
        <select
            value={value ?? ''}
            onChange={e => onChange(e.target.value)}
            className="form-input w-full mt-2"
            aria-label="Charger current class"
            title="The most current the charger this test used could supply. Chargers of one voltage still differ: a V3.5 Supercharger holds a car near 500 A where another stall allows 600 A and up. Not recorded is read as 500 A, and curves are only split by current when a lower class is seen limiting the car."
        >
            <option value="">Charger current: not recorded (reads as 500 A)</option>
            {CHARGER_CURRENT_CLASSES.map(a => <option key={a} value={a}>Charger current: {chargerCurrentText(a)} class</option>)}
        </select>
    );
}

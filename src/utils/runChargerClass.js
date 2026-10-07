/**
 * The voltage class of the charger a charging test was taken on (#366 layer 1,
 * `runs.charger_voltage_class`, migration 076).
 *
 * null is "not recorded" — every test until someone says — and is never the
 * same answer as either class. The values are VOLTAGE_CLASSES (platforms.js).
 *
 * The forms hold it as a select value ('400' | '800' | ''); the database and
 * every reader hold the number or null.
 *
 * Pure module: no data access, no React.
 */
import { VOLTAGE_CLASSES } from './platforms';

/** A form's select value, or a stored value, as what the column holds. */
export function toChargerClass(v) {
    const n = Number(v);
    return v !== '' && v != null && VOLTAGE_CLASSES.includes(n) ? n : null;
}

/** A stored value as the forms' select value. */
export function chargerClassFormValue(v) {
    const n = toChargerClass(v);
    return n == null ? '' : String(n);
}

/** The test peek's fact, absent when not recorded. */
export function chargerClassFact(v) {
    const n = toChargerClass(v);
    return n == null ? null : `${n} V class`;
}

/**
 * The current class of the charger a charging test was taken on
 * (`runs.charger_current_class_a`, migration 092).
 *
 * The twin of runChargerClass.js, which holds the VOLTAGE class. Two chargers of
 * one voltage class still differ by a fifth or more in what they let a car
 * draw: a V3.5 Supercharger holds an R2 near 190 kW (about 500 A at 400 V)
 * where another stall lets it reach 225 kW (600 A and up).
 *
 * null is "not recorded" and is READ as DEFAULT_CHARGER_CURRENT_A wherever a
 * class is needed (`currentClassOf`): the owner's call, 2026-10-26, because most
 * of the chargers tests are taken on are about 500 A. It is never stored as
 * 500 — a test nobody classified stays "not recorded", so a later, better
 * default does not have to guess which 500s were meant.
 *
 * The forms hold it as a select value ('350' | '500' | '600' | '700' | ''); the
 * database and every reader hold the number or null. The list is code, the
 * column only rules out nonsense, so a new class (an 800 A charger) is a change
 * here and not a migration.
 *
 * Pure module: no data access, no React.
 */

/** The classes a test can be recorded on. 700 stands for "700 A and over". */
export const CHARGER_CURRENT_CLASSES = [350, 500, 600, 700];

/** What a test with no recorded current class is read as. */
export const DEFAULT_CHARGER_CURRENT_A = 500;

/** A form's select value, or a stored value, as what the column holds. */
export function toChargerCurrent(v) {
    const n = Number(v);
    return v !== '' && v != null && CHARGER_CURRENT_CLASSES.includes(n) ? n : null;
}

/** A stored value as the forms' select value. */
export function chargerCurrentFormValue(v) {
    const n = toChargerCurrent(v);
    return n == null ? '' : String(n);
}

/** How a class reads: "500 A", and "700 A+" for the top one. */
export const chargerCurrentText = (a) => `${a} A${a === CHARGER_CURRENT_CLASSES[CHARGER_CURRENT_CLASSES.length - 1] ? '+' : ''}`;

/** The test peek's fact, absent when not recorded. */
export function chargerCurrentFact(v) {
    const n = toChargerCurrent(v);
    return n == null ? null : `${chargerCurrentText(n)} class`;
}

/**
 * The class a test is treated as, for grouping: what was recorded, else
 * DEFAULT_CHARGER_CURRENT_A. A stored value outside the list (a hand-edited
 * row) is read as what it is, so nothing is silently moved to another class.
 */
export function currentClassOf(run) {
    const n = Number(run?.charger_current_class_a);
    return run?.charger_current_class_a != null && run.charger_current_class_a !== '' && Number.isFinite(n) && n > 0
        ? n
        : DEFAULT_CHARGER_CURRENT_A;
}

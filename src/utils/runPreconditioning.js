/**
 * Whether the battery was preconditioned for a charging test (#352,
 * `runs.preconditioned`, migration 073).
 *
 * Three answers, never two: true, false, and null for "not recorded". A test
 * nobody wrote this down for must not read as "not preconditioned" — that is
 * a claim about the test, and the reason a slow curve was slow.
 *
 * The forms hold it as a select value ('yes' | 'no' | ''); the database and
 * every reader hold the boolean or null.
 *
 * Pure module: no data access, no React.
 */

/** A form's select value, or a stored value, as what the column holds. */
export function toPreconditioned(v) {
    if (v === true || v === 'yes') return true;
    if (v === false || v === 'no') return false;
    return null;
}

/** A stored value as the forms' select value. */
export function preconditionedFormValue(v) {
    return v === true ? 'yes' : v === false ? 'no' : '';
}

/** What sits beneath a tested charge time, or null when not recorded. */
export function preconditionedNote(v) {
    return v === true ? 'preconditioned' : v === false ? 'not preconditioned' : null;
}

/** The test peek's fact: said either way, and absent when not recorded. */
export function preconditionedFact(v) {
    return v === true ? 'Yes' : v === false ? 'No' : null;
}

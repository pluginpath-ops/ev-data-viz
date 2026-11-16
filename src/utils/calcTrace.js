/**
 * Calculation trace — the math a page did, step by step, written down by the
 * code that did it ("Show the math"). Traced so far: the range correction,
 * Cost & Time, the Charge Stop range basis, the vehicle table's worked-out
 * columns and Performance › Compare. Not yet: the road trip, the composite
 * charging curve, the Trip Optimizer, the EPA derivations.
 *
 * A pure function that wants to be traceable takes an optional `trace`
 * (default null) and, beside each line of math, records it:
 *
 *     const factor = atRun / atTarget;
 *     trace?.step('Correction factor', { formula: 'k = L_run / L_target',
 *         values: { L_run: atRun, L_target: atTarget }, result: factor });
 *
 * Off is free: `trace?.step(…)` short-circuits before its argument object is
 * built, so an untraced call allocates nothing and runs the same math. The
 * trace never feeds a number back — it only records — so a traced call
 * returns exactly what an untraced one does (calcTrace.test.js checks).
 *
 * The formula text sits on the line beside the math it names, so a change to
 * one is in the same diff as the other. That is the whole defense against
 * drift: nothing here re-derives a number.
 *
 * A value is a number, or `{ v, unit, src }` where `src` says where it came
 * from:
 *   'knob:KEY'   a model constant with local → site → default layers (constants/knobs.js)
 *   'code:NAME'  a constant fixed in code
 *   'setting'    the reader's own setting (correction target, Cost & Time)
 *   'data'       a field of the vehicle or test
 *   'assumed'    a stand-in for a blank field
 * Every knob and code constant a pass touches is collected once, for the
 * constants table.
 *
 * Pure module — no React.
 */

/** A value as a step records it. */
export const val = (v, unit = null, src = null) => ({ v, unit, src });

const isValue = (x) => x != null && typeof x === 'object' && 'v' in x;

/**
 * A new, empty trace. `step` records one line of math, `note` a sentence,
 * `group` a nested chain (a function called from this one) and returns a trace
 * for it to write into.
 */
export function createTrace(title = null) {
    const constants = new Map();
    const make = (node) => ({
        node,
        step(label, { formula = null, values = {}, result = null, unit = null, note = null, assumed = false } = {}) {
            const vals = Object.entries(values).map(([name, x]) => {
                const value = isValue(x) ? x : { v: x, unit: null, src: null };
                const m = /^(knob|code):(.+)$/.exec(value.src ?? '');
                if (m && !constants.has(m[2])) {
                    constants.set(m[2], { key: m[2], kind: m[1], value: value.v, unit: value.unit });
                }
                return { name, ...value };
            });
            node.children.push({ type: 'step', label, formula, values: vals, result, unit, note, assumed });
        },
        note(text, { assumed = false } = {}) {
            node.children.push({ type: 'note', text, assumed });
        },
        group(label) {
            const child = { type: 'group', label, children: [] };
            node.children.push(child);
            return make(child);
        },
    });
    const root = { type: 'group', label: title, children: [] };
    const trace = make(root);
    trace.constants = constants;
    return trace;
}

/** A figure as a step prints it: enough digits to check by hand, no more. */
export function traceNumber(x) {
    if (x == null) return '—';
    if (Array.isArray(x)) return x.map(traceNumber).join('–');
    if (typeof x !== 'number') return String(x);
    if (!Number.isFinite(x)) return String(x);
    if (Number.isInteger(x)) return x.toLocaleString('en-US');
    const a = Math.abs(x);
    // Trailing zeros dropped: 88.7 kWh, not 88.7000.
    const trim = (s) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);
    if (a >= 1000) return x.toLocaleString('en-US', { maximumFractionDigits: 1 });
    if (a >= 100) return trim(x.toFixed(2));
    if (a >= 1) return trim(x.toFixed(4));
    return trim(x.toPrecision(4));
}

/**
 * The formula with each named value put in its place: "k = L_run / L_target"
 * with L_run 1.08 and L_target 1.00 reads "k = 1.08 / 1.00". Names are matched
 * whole, longest first, so `v_run` is not read as `v` followed by "_run".
 */
export function substitute(formula, values, format = (x) => String(x)) {
    if (!formula) return null;
    const eq = formula.indexOf('=');
    const lhs = eq >= 0 ? formula.slice(0, eq + 1) : '';
    let rhs = eq >= 0 ? formula.slice(eq + 1) : formula;
    const names = values.filter(x => typeof x.v === 'number').sort((a, b) => b.name.length - a.name.length);
    if (!names.length) return null;
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<![\\p{L}0-9_])(${names.map(n => esc(n.name)).join('|')})(?![\\p{L}0-9_])`, 'gu');
    const byName = new Map(names.map(n => [n.name, n]));
    rhs = rhs.replace(re, (m) => format(byName.get(m).v));
    return `${lhs}${rhs}`;
}

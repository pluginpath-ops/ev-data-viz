/**
 * Which CSV column holds which field, guessed from the headers (#16).
 *
 * The upload's mapping step used to recognise a charge-rate column only when
 * its header held both "charge" and "rate", so every export that said
 * "Power (kW)", "kW" or "ChargePower" needed choosing by hand. Headers are now
 * read as WORDS — "ChargeKW" is charge + kw, "Power_kW" is power + kw — and
 * each field scores every header, so the likeliest column wins rather than
 * whichever came last.
 *
 * ── Rules ───────────────────────────────────────────────────────────────────
 *
 *   soc          "SoC", "state of charge" · "%", "percent" · "Charge" alone
 *   chargeRate   "charge" with "rate", "power" or "kW" · "kW", "kilowatts" ·
 *                "Power" alone — never kWh, volts, amps, current or energy
 *   timestamp    "timestamp"
 *   time         "time", "elapsed", "duration" · "minutes", "mins" · "min"
 *                alone (a "Min SoC" column is not a time)
 *   range, temperature, frame   as before: a word starting "range", "temp", "frame"
 *
 * A header is given to one field at most, fields choosing in the order above,
 * so "Charge Rate" never also becomes the SoC column. Ties go to the leftmost
 * header. A guess, not a decision: every mapping stays editable.
 *
 * Pure module: no React.
 */

/**
 * A header as lower-case words; camelCase and punctuation split, "%" its own
 * word. A capital starts a new word only where a lower-case word follows it
 * ("ChargePower") or it opens a run of capitals ("ChargeKW") — so the units
 * written in mixed case, "kW" and "SoC", stay one word.
 */
export function headerWords(header) {
    return String(header ?? '')
        .replace(/([a-z])(?=[A-Z][a-z])/g, '$1 ')
        .replace(/([a-z])(?=[A-Z]{2,}(?![a-z]))/g, '$1 ')
        .replace(/%/g, ' percent ')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
}

const has = (words, ...any) => any.some(w => words.includes(w));
const startsWith = (words, prefix) => words.some(w => w.startsWith(prefix));

/** Words that make a header something other than a charge rate. */
const NOT_A_RATE = ['kwh', 'wh', 'energy', 'volt', 'volts', 'voltage', 'v', 'amp', 'amps', 'ampere', 'amperes', 'current', 'a'];

/**
 * How strongly a header reads as each field: 0 is not at all. Higher wins.
 * In the order fields choose, which settles a header two fields both want.
 */
const SCORERS = [
    ['soc', (w) => {
        if (has(w, 'soc') || (has(w, 'state') && has(w, 'charge'))) return 3;
        if (has(w, 'percent', 'pct')) return 2;
        // "Charge" on its own; "Charge Rate", "Charge Power" and "Charging
        // Time" are other fields.
        if (w.length === 1 && has(w, 'charge')) return 1;
        return 0;
    }],
    ['chargeRate', (w) => {
        if (has(w, ...NOT_A_RATE)) return 0;
        const charge = has(w, 'charge', 'charging');
        if (charge && has(w, 'rate', 'power', 'kw')) return 3;
        if (has(w, 'kw', 'kilowatt', 'kilowatts')) return 2;
        if (has(w, 'power')) return 1;
        return 0;
    }],
    ['timestamp', (w) => (has(w, 'timestamp') ? 3 : 0)],
    ['time', (w) => {
        if (has(w, 'timestamp')) return 0;
        if (has(w, 'time', 'elapsed', 'duration')) return 3;
        if (has(w, 'minutes', 'minute', 'mins')) return 2;
        if (w.length === 1 && has(w, 'min')) return 2;
        return 0;
    }],
    ['range',       (w) => (startsWith(w, 'range') ? 1 : 0)],
    ['temperature', (w) => (startsWith(w, 'temp') ? 1 : 0)],
    ['frame',       (w) => (startsWith(w, 'frame') ? 1 : 0)],
];

/**
 * The guessed mapping for a file's headers.
 *
 * @param {string[]} headers
 * @returns {Object} field → header, only for fields something matched
 */
export function autoMapHeaders(headers = []) {
    const words = headers.map(headerWords);
    const taken = new Set();
    const mapping = {};
    for (const [field, score] of SCORERS) {
        let best = -1;
        let bestScore = 0;
        headers.forEach((_, i) => {
            if (taken.has(i)) return;
            const s = score(words[i]);
            if (s > bestScore) { best = i; bestScore = s; }
        });
        if (best >= 0) {
            mapping[field] = headers[best];
            taken.add(best);
        }
    }
    return mapping;
}

/**
 * Parse a pasted published test-result block (Car and Driver and similar).
 *
 * These blocks have a consistent shape — one labelled figure per line — so
 * pasting one is far less work than typing a dozen fields by hand:
 *
 *   60 mph: 3.9 sec
 *   1/4-Mile: 12.3 sec @ 115 mph
 *   Results above omit 1-ft rollout of 0.3 sec.
 *   Rolling Start, 5-60 mph: 4.1 sec
 *   Top Gear, 30-50 mph: 1.5 sec
 *   Top Speed (gov ltd): 127 mph
 *   Braking, 70-0 mph: 174 ft
 *   Roadholding, 300-ft Skidpad: 0.88 g
 *
 * Lines are matched by shape, not position, and the set of lines is NOT fixed —
 * one car gets a `130 mph:` line another doesn't, and braking may appear twice.
 * Anything unrecognised is reported back rather than silently dropped, so a
 * source with a line shape we've never seen is visible instead of invisible.
 *
 * Pure — no DB calls, no side effects, same contract as parsePerformanceCSV.js
 * and parseEpaCsiPdf.js. Two stages, deliberately separate:
 *
 *   parsePublishedResults(text)          — what the block SAYS
 *   buildSummaryPayload(parsed, opts)    — what to WRITE, once the rollout
 *                                          basis has been confirmed by a human
 *
 * The split exists because the rollout question (below) has no safe default,
 * and folding it into the parse would bury a contested decision inside a
 * function that looks purely mechanical.
 */

/** Sources mix en-dashes, minus signs and hyphens; normalise to ASCII "-". */
const normaliseDashes = (s) => s.replace(/[‐-―−–—]/g, '-');

/** Leading bullets/dashes on list-style lines. */
const stripBullet = (s) => s.replace(/^[\s•*·]+/, '');

const KPH_PER_MPH = 1.609344;

/** Speed unit as stored: 'mph' | 'kph'. */
function speedUnit(raw) {
    return /k/i.test(raw || '') ? 'kph' : 'mph';
}

/** Distance unit as stored: 'ft' | 'm'. */
function distanceUnit(raw) {
    return /^m/i.test((raw || '').trim()) ? 'm' : 'ft';
}

const f = (s) => {
    const v = parseFloat(s);
    return Number.isFinite(v) ? v : null;
};

// ── Line shapes ───────────────────────────────────────────────────────────────
// Every one anchors at the start of the line and requires the label, so a stray
// number in prose can't be mistaken for a result.

const SPEED = String.raw`(\d+(?:\.\d+)?)`;
const UNIT  = String.raw`(mph|km\/?h|kph)`;

const RE = {
    // "60 mph: 3.9 sec" — an acceleration window from rest to that speed.
    accel:      new RegExp(String.raw`^${SPEED}\s*${UNIT}\s*:\s*${SPEED}\s*sec`, 'i'),
    // "0-60 mph: 3.9 sec" / "0-100 km/h: 3.5 sec" — the same thing written as a
    // range. European blocks always use this form, and it's common elsewhere.
    rangeAccel: new RegExp(String.raw`^${SPEED}\s*-\s*${SPEED}\s*${UNIT}\s*:\s*${SPEED}\s*sec`, 'i'),
    // "1/4-Mile: 12.3 sec @ 115 mph" — trap speed optional.
    drag:       new RegExp(String.raw`^(?:standing\s+)?(1\/4|¼|1\/8|⅛)[\s-]*mile\s*:\s*${SPEED}\s*sec(?:\s*@\s*${SPEED}\s*${UNIT})?`, 'i'),
    // "Rolling Start, 5-60 mph: 4.1 sec"
    rolling:    new RegExp(String.raw`^rolling\s+start\s*,?\s*${SPEED}\s*-\s*${SPEED}\s*${UNIT}\s*:\s*${SPEED}\s*sec`, 'i'),
    // "Top Gear, 30-50 mph: 1.5 sec" — the passing measure.
    passing:    new RegExp(String.raw`^top\s+gear\s*,?\s*${SPEED}\s*-\s*${SPEED}\s*${UNIT}\s*:\s*${SPEED}\s*sec`, 'i'),
    // "Braking, 70-0 mph: 174 ft" / metric "100-0 km/h: 38.5 m"
    braking:    new RegExp(String.raw`^braking\s*,?\s*${SPEED}\s*-\s*${SPEED}\s*${UNIT}\s*:\s*${SPEED}\s*(ft|feet|m|meters?|metres?)\b`, 'i'),
    // "Top Speed (gov ltd): 127 mph" — the parenthetical says WHY it stops there.
    topSpeed:   new RegExp(String.raw`^top\s+speed\s*(?:\(([^)]*)\))?\s*:\s*${SPEED}\s*${UNIT}`, 'i'),
    // "Roadholding, 300-ft Skidpad: 0.88 g"
    skidpad:    new RegExp(String.raw`^roadholding\s*,?\s*([^:]*?)\s*:\s*${SPEED}\s*g\b`, 'i'),
};

/**
 * "Results above omit 1-ft rollout of 0.3 sec."
 *
 * Matched loosely — the wording drifts between eras and outlets — but the two
 * things that matter are extracted explicitly: the verb (omit / include) and
 * the allowance in seconds.
 */
function parseRolloutFootnote(line) {
    if (!/roll\s?out/i.test(line)) return null;
    // "without" is checked first and on purpose: it contains "with", and the
    // two readings are exact opposites. No trailing \b after "includ" — the
    // word is almost always "includes", where a boundary can't match.
    const verb = /\b(omit|exclud|without)/i.test(line) ? 'omit'
        : /\b(includ)/i.test(line) || /\bwith\b/i.test(line) ? 'include'
        : null;
    const secs = f((/([\d.]+)\s*sec/i.exec(line) || [])[1]);
    return { stated: verb, seconds: secs, raw: line.trim() };
}

/**
 * @param {string} text  the pasted block
 * @returns {{
 *   accelWindows: Array, drag: Object, intervals: Array, fields: Object,
 *   rollout: Object|null, notes: string[], warnings: Array, unmatched: string[],
 *   matched: number
 * }}
 */
export function parsePublishedResults(text) {
    const lines = String(text || '')
        .split(/\r?\n/)
        .map(l => stripBullet(normaliseDashes(l)).trim())
        .filter(Boolean);

    // Rest-to-speed windows, kept neutral: which column a 0-60 lands in depends
    // on the rollout basis, which isn't settled until a human says so.
    const accelWindows = [];   // { toSpeed, unit, seconds, raw }
    const intervals    = [];   // rows for performance_intervals
    const fields       = {};   // promoted columns, rollout-independent only
    const drag         = {};   // { quarterSec, quarterTrapMph, eighthSec, eighthTrapMph }
    const notes        = [];
    const warnings     = [];
    const unmatched    = [];
    let rollout = null;
    let matched = 0;

    const warn = (level, message) => warnings.push({ level, message });

    for (const line of lines) {
        let m;

        if ((m = RE.accel.exec(line))) {
            accelWindows.push({
                toSpeed: f(m[1]), unit: speedUnit(m[2]), seconds: f(m[3]), raw: line,
            });
            matched++; continue;
        }

        if ((m = RE.rangeAccel.exec(line))) {
            const from = f(m[1]);
            if (from === 0) {
                accelWindows.push({
                    toSpeed: f(m[2]), unit: speedUnit(m[3]), seconds: f(m[4]), raw: line,
                });
            } else {
                // A window not starting from rest is a roll-on, same as a
                // "Rolling Start" line written without the label.
                intervals.push({
                    kind: 'accel',
                    from_speed: from, to_speed: f(m[2]), speed_unit: speedUnit(m[3]),
                    elapsed_s: f(m[4]), distance: null, distance_unit: 'ft',
                    raw: line,
                });
            }
            matched++; continue;
        }

        if ((m = RE.drag.exec(line))) {
            const eighth = /8/.test(m[1]) || m[1] === '⅛';
            const trapUnit = speedUnit(m[4]);
            let trap = f(m[3]);
            if (trap != null && trapUnit === 'kph') {
                notes.push(`Trap speed reported as ${trap} km/h; stored as mph.`);
                trap = trap / KPH_PER_MPH;
            }
            if (eighth) { drag.eighthSec = f(m[2]); drag.eighthTrapMph = trap; }
            else        { drag.quarterSec = f(m[2]); drag.quarterTrapMph = trap; }
            matched++; continue;
        }

        if ((m = RE.rolling.exec(line))) {
            // A rolling start measures acceleration, just not from rest.
            intervals.push({
                kind: 'accel',
                from_speed: f(m[1]), to_speed: f(m[2]), speed_unit: speedUnit(m[3]),
                elapsed_s: f(m[4]), distance: null, distance_unit: 'ft',
                raw: line,
            });
            matched++; continue;
        }

        if ((m = RE.passing.exec(line))) {
            intervals.push({
                kind: 'passing',
                from_speed: f(m[1]), to_speed: f(m[2]), speed_unit: speedUnit(m[3]),
                elapsed_s: f(m[4]), distance: null, distance_unit: 'ft',
                raw: line,
            });
            matched++; continue;
        }

        if ((m = RE.braking.exec(line))) {
            intervals.push({
                kind: 'braking',
                from_speed: f(m[1]), to_speed: f(m[2]), speed_unit: speedUnit(m[3]),
                elapsed_s: null, distance: f(m[4]), distance_unit: distanceUnit(m[5]),
                raw: line,
            });
            matched++; continue;
        }

        if ((m = RE.topSpeed.exec(line))) {
            const unit = speedUnit(m[3]);
            let v = f(m[2]);
            // The column is mph and there's no metric twin, so a metric figure
            // has to be converted rather than dropped — recorded in notes so the
            // conversion isn't invisible later.
            if (v != null && unit === 'kph') {
                notes.push(`Top speed reported as ${v} km/h; stored as mph.`);
                v = v / KPH_PER_MPH;
            }
            fields.top_speed_mph = v;
            // "(gov ltd)" says the number is a governor, not the car's limit —
            // that changes what it means, so it's kept rather than discarded.
            if (m[1]) notes.push(`Top speed qualifier: ${m[1].trim()}.`);
            matched++; continue;
        }

        if ((m = RE.skidpad.exec(line))) {
            fields.skidpad_g = f(m[2]);
            const descriptor = (m[1] || '').trim();
            // skidpad_g assumes the 300 ft convention; anything else changes the
            // number's meaning and must not pass unremarked.
            if (descriptor && !/300[\s-]*(ft|foot|feet)/i.test(descriptor)) {
                warn('warn', `Skidpad described as "${descriptor}" — the stored field assumes the 300 ft convention. A different radius is not comparable.`);
            }
            matched++; continue;
        }

        const foot = parseRolloutFootnote(line);
        if (foot) { rollout = foot; matched++; continue; }

        unmatched.push(line);
    }

    if (matched === 0) {
        warn('error', 'Nothing recognisable in that paste. Expected lines like "60 mph: 3.9 sec" or "Braking, 70-0 mph: 174 ft".');
    }

    validate({ accelWindows, drag, intervals, rollout, warn });

    return { accelWindows, drag, intervals, fields, rollout, notes, warnings, unmatched, matched };
}

/**
 * Sanity checks that read the block as a whole.
 *
 * The one that matters most is monotonicity. A real block once read
 * `1/4-Mile: 11.4 sec @ 26 mph` — a car at 100 mph after 7.1 s cannot be doing
 * 26 mph at 11.4 s, so the trap figure is a digit short. That class of slip is
 * invisible field-by-field and obvious across the block.
 */
function validate({ accelWindows, drag, intervals, rollout, warn }) {
    // Time → speed pairs, mph only (a metric window isn't comparable without
    // asserting a conversion the source didn't make).
    const pts = accelWindows
        .filter(w => w.unit === 'mph' && w.seconds != null && w.toSpeed != null)
        .map(w => ({ t: w.seconds, v: w.toSpeed, what: `${w.toSpeed} mph` }));

    if (drag.quarterSec != null && drag.quarterTrapMph != null) {
        pts.push({ t: drag.quarterSec, v: drag.quarterTrapMph, what: 'quarter-mile trap' });
    }
    if (drag.eighthSec != null && drag.eighthTrapMph != null) {
        pts.push({ t: drag.eighthSec, v: drag.eighthTrapMph, what: 'eighth-mile trap' });
    }

    pts.sort((a, b) => a.t - b.t);
    for (let i = 1; i < pts.length; i++) {
        const prev = pts[i - 1], cur = pts[i];
        if (cur.v < prev.v) {
            // A leading digit lost in transcription is the usual cause, so offer
            // the smallest restoration that makes the block consistent.
            let suggestion = null;
            for (const prefix of [1, 2]) {
                const candidate = Number(`${prefix}${cur.v}`);
                if (candidate >= prev.v) { suggestion = candidate; break; }
            }
            warn('error',
                `${cur.what} reads ${cur.v} mph at ${cur.t} s, but the car was already doing ${prev.v} mph at ${prev.t} s. ` +
                `Speed can't fall during an acceleration run` +
                (suggestion ? ` — likely a dropped digit, i.e. ${suggestion} mph.` : '.'));
        }
    }

    // Braking that implies an impossible grip level is a units or transcription
    // slip — 1 g from 70 mph is about 163 ft, and road cars sit near there.
    for (const iv of intervals.filter(i => i.kind === 'braking')) {
        const fromMph = iv.speed_unit === 'kph' ? iv.from_speed / KPH_PER_MPH : iv.from_speed;
        const toMph   = iv.speed_unit === 'kph' ? iv.to_speed   / KPH_PER_MPH : iv.to_speed;
        const distFt  = iv.distance_unit === 'm' ? iv.distance * 3.280839895 : iv.distance;
        if (!(fromMph > 0) || !(distFt > 0)) continue;
        // v² = 2·a·d, in ft/s² then over g.
        const fps = (mph) => mph * 1.4666667;
        const g = (fps(fromMph) ** 2 - fps(toMph) ** 2) / (2 * distFt * 32.174);
        if (g > 1.4 || g < 0.5) {
            warn('warn',
                `Braking ${iv.from_speed}-${iv.to_speed} ${iv.speed_unit} in ${iv.distance} ${iv.distance_unit} ` +
                `works out to ${g.toFixed(2)} g, outside the range road cars reach. Check the figure and its units.`);
        }
    }

    if (!rollout && accelWindows.length > 0) {
        warn('warn', 'No rollout footnote found in this block. The rollout basis has to be set by hand below — the two 0-60 figures differ by about 0.3 s and are not interchangeable.');
    } else if (rollout && !rollout.stated) {
        warn('warn', `Rollout footnote found but its wording is unclear: "${rollout.raw}". Confirm the basis below.`);
    }
}

/**
 * Turn a parse into the rows to write, once the rollout basis is settled.
 *
 * `rolloutBasis` is the caller's decision, not the parser's:
 *   'none'    — printed figures are standing-start, clock from 0 mph
 *   'rollout' — printed figures include the 1-ft drag-strip rollout
 *   null      — not yet decided. Columns are laid out as for 'none' so a
 *               preview can render, but no interval is stamped with a rollout
 *               convention, because that would be asserting the answer.
 *
 * Only the figure the source actually printed is written. The other one is NOT
 * back-computed into its column: printed ± 0.3 s is a derivation, and this
 * codebase computes derivations at read time rather than freezing them into a
 * column that then can't be told apart from a measurement.
 *
 * @returns {{ fields: Object, intervals: Array }}
 */
export function buildSummaryPayload(parsed, { rolloutBasis = null, notes } = {}) {
    const stamp = rolloutBasis == null ? {} : { rollout: rolloutBasis === 'rollout' };
    const fields = { ...parsed.fields };
    const intervals = parsed.intervals.map(({ raw, ...row }) => ({
        ...row,
        ...(row.kind === 'accel' ? stamp : {}),
    }));

    const zeroToSixty = rolloutBasis === 'rollout' ? 'zero_to_60_rollout_sec' : 'zero_to_60_sec';

    for (const w of parsed.accelWindows) {
        if (w.seconds == null || w.toSpeed == null) continue;

        // The promoted columns are mph-specific. A metric "0-100 km/h" is a
        // 0-62 mph window and must not land in zero_to_100_sec.
        if (w.unit === 'mph' && w.toSpeed === 60)  { fields[zeroToSixty] = w.seconds; continue; }
        if (w.unit === 'mph' && w.toSpeed === 100) { fields.zero_to_100_sec = w.seconds; continue; }

        intervals.push({
            kind: 'accel',
            from_speed: 0, to_speed: w.toSpeed, speed_unit: w.unit,
            elapsed_s: w.seconds, distance: null, distance_unit: 'ft',
            ...stamp,
        });
    }

    if (parsed.drag.quarterSec != null)    fields.quarter_mile_sec        = parsed.drag.quarterSec;
    if (parsed.drag.quarterTrapMph != null) fields.quarter_mile_trap_mph  = round(parsed.drag.quarterTrapMph);
    if (parsed.drag.eighthSec != null)     fields.eighth_mile_sec         = parsed.drag.eighthSec;
    if (parsed.drag.eighthTrapMph != null) fields.eighth_mile_trap_mph    = round(parsed.drag.eighthTrapMph);

    if (fields.top_speed_mph != null) fields.top_speed_mph = round(fields.top_speed_mph);

    // Grouped for a readable preview: the extra accel windows are collected
    // last during the parse, which would otherwise scatter them below braking.
    const ORDER = { accel: 0, passing: 1, braking: 2 };
    intervals.sort((a, b) =>
        (ORDER[a.kind] - ORDER[b.kind]) || (a.from_speed - b.from_speed) || (a.to_speed - b.to_speed));

    const noteLines = [...(parsed.notes || [])];
    if (parsed.rollout?.raw) noteLines.push(parsed.rollout.raw);
    if (notes) noteLines.push(notes);
    if (noteLines.length) fields.notes = noteLines.join('\n');

    return { fields, intervals };
}

/** Two decimals, without trailing-zero noise — only used on converted values. */
const round = (v) => (v == null ? v : Math.round(v * 100) / 100);

/** Human label for a parsed interval row, for the preview table. */
export function describeInterval(row) {
    const unit = row.speed_unit === 'kph' ? 'km/h' : 'mph';
    const window = `${row.from_speed}-${row.to_speed} ${unit}`;
    const value = row.distance != null
        ? `${row.distance} ${row.distance_unit}`
        : `${row.elapsed_s} s`;
    return { window, value, kind: row.kind };
}

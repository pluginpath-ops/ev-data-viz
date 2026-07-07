/**
 * Parsing helpers for time-like CSV columns.
 *
 * Charging exports frequently use colon-delimited *elapsed clock* strings that
 * are NOT valid to `Date.parse()`:
 *   - "MM:SS"          e.g. "05:30"
 *   - "HH:MM:SS"       e.g. "00:01:04"
 *   - "HH:MM:SS:FF"    SMPTE-style timecode with a trailing frame count
 * These must be read as durations, not wall-clock dates.
 */

// Frame rate assumed when a timecode carries a trailing frame field (HH:MM:SS:FF).
// Frames are sub-second, so an imperfect guess only perturbs the result by a
// fraction of a second — negligible at minute resolution.
const ASSUMED_FPS = 30;

/**
 * Parse a colon-delimited elapsed-clock / timecode string to seconds.
 * Accepts 2–4 integer (or decimal-second) parts; returns null for anything
 * that isn't a clean clock string (single tokens, >4 parts, non-numeric parts).
 *
 * @param {string|number} val
 * @returns {number|null} seconds, or null if not a clock string
 */
export const clockToSeconds = (val) => {
    if (typeof val !== 'string') return null;
    const s = val.trim();
    if (s === '') return null;

    const parts = s.split(':');
    if (parts.length < 2 || parts.length > 4) return null;
    if (!parts.every(p => /^\d+(\.\d+)?$/.test(p.trim()))) return null;

    const n = parts.map(Number);
    let h = 0, m = 0, sec = 0, frames = 0, hasFrames = false;
    if (parts.length === 2)      { [m, sec] = n; }
    else if (parts.length === 3) { [h, m, sec] = n; }
    else                         { [h, m, sec, frames] = n; hasFrames = true; }

    return h * 3600 + m * 60 + sec + (hasFrames ? frames / ASSUMED_FPS : 0);
};

/**
 * Convert a time-like cell to epoch-milliseconds for elapsed-time math.
 * Handles elapsed clock/timecode strings first, then falls back to real
 * wall-clock datetime strings (ISO, "2024-01-01 10:00:00", …).
 *
 * @param {string|number} val
 * @returns {number|null} milliseconds, or null if unparseable
 */
export const timestampToMs = (val) => {
    const secs = clockToSeconds(val);
    if (secs != null) return secs * 1000;
    if (typeof val !== 'string') return null;
    const s = val.trim();
    // A "bare clock" (only digits, dots, colons) either parsed above or is
    // malformed — never let Date.parse loosely reinterpret it (e.g. "51" or
    // "1:2:3:4:5"). Real datetimes carry a date separator (-, /, T, letters).
    if (s === '' || /^[\d.:]+$/.test(s)) return null;
    const ms = Date.parse(s);
    return isNaN(ms) ? null : ms;
};

/**
 * True when a cell looks like a wall-clock timestamp or elapsed clock/timecode
 * string rather than a plain number (which dynamicTyping would already have
 * turned into a JS number).
 */
export const isTimestampValue = (val) =>
    typeof val === 'string' && val.trim() !== '' && timestampToMs(val) != null;

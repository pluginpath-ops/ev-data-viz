import { readFileSync } from 'node:fs';
import { nameLines } from '../tableColumns';

/**
 * A model of how the browser sets text in the two tables' columns, for the
 * tests that hold a header or a cell to its column (headerFit.test.js,
 * cellFit.test.js). It is a MODEL, not a browser: the widths come from the font
 * and the sizes, weights and column widths come from src/index.css, so a change
 * to either fails the test rather than leaving it measuring a table that no
 * longer exists.
 *
 * Public Sans Variable's advance widths, in em, for ASCII 32..126 in order at
 * wght 400, 500 and 700 — read from the woff2's hmtx and HVAR tables. Kerning is
 * ignored, which `SLACK` covers.
 */

const ASCII = {
    400: '.243 .251 .425 .603 .658 .904 .708 .248 .303 .309 .394 .555 .241 .378 .225 .351 .612 .407 .596 .630 .628 .640 .623 .601 .648 .624 .225 .240 .546 .555 .545 .521 .831 .710 .670 .689 .694 .621 .594 .733 .766 .283 .388 .682 .577 .885 .754 .734 .636 .748 .676 .670 .593 .701 .672 .954 .688 .607 .637 .303 .351 .303 .473 .517 .218 .553 .597 .543 .597 .567 .396 .623 .577 .247 .263 .561 .303 .865 .577 .565 .596 .596 .391 .506 .389 .581 .504 .780 .564 .535 .481 .328 .263 .332 .568',
    500: '.238 .259 .440 .607 .664 .914 .729 .252 .311 .317 .416 .564 .251 .382 .237 .359 .621 .413 .607 .640 .636 .650 .633 .608 .654 .634 .237 .251 .554 .564 .554 .524 .830 .715 .674 .697 .701 .624 .599 .740 .767 .290 .392 .692 .577 .894 .762 .741 .641 .755 .682 .676 .600 .707 .681 .958 .696 .624 .646 .312 .359 .312 .476 .527 .231 .557 .600 .544 .600 .569 .396 .624 .581 .253 .270 .567 .310 .873 .581 .568 .599 .599 .397 .512 .397 .585 .509 .782 .571 .543 .485 .343 .265 .346 .580',
    700: '.226 .282 .480 .616 .681 .939 .784 .261 .333 .336 .473 .588 .277 .393 .270 .381 .645 .428 .635 .665 .656 .675 .660 .626 .671 .659 .270 .278 .577 .588 .578 .534 .827 .726 .684 .718 .720 .635 .614 .759 .770 .307 .402 .717 .578 .918 .782 .761 .652 .773 .696 .692 .616 .724 .704 .968 .717 .667 .670 .337 .381 .337 .484 .553 .264 .566 .608 .547 .608 .576 .397 .628 .592 .267 .288 .580 .329 .895 .593 .576 .607 .607 .412 .527 .416 .595 .520 .788 .588 .563 .496 .384 .268 .384 .612',
};
const EXTRA = {
    400: { '–': 0.5551, '÷': 0.5547, '¼': 0.7917, '’': 0.2313, '×': 0.5398, '—': 1.1168, '·': 0.2296, '°': 0.463 },
    500: { '–': 0.5653, '÷': 0.5639, '¼': 0.8024, '’': 0.2395, '×': 0.5498, '—': 1.1255, '·': 0.2376, '°': 0.466 },
    700: { '–': 0.5923, '÷': 0.5884, '¼': 0.8309, '’': 0.2615, '×': 0.5766, '—': 1.1486, '·': 0.2591, '°': 0.474 },
};
const TABLE = Object.fromEntries(Object.entries(ASCII).map(([w, s]) => [w, s.split(' ').map(Number)]));
// Not in the Latin subset (an arrow falls back to another face): assume a full em.
const FALLBACK_EM = 1;
/** Kerning and rounding: a few percent at most. */
export const SLACK = 1.03;

/** The width of one character in em at a weight. A digit is the widest digit: tabular figures may be on. */
function charEm(ch, weight, tabularDigits) {
    const code = ch.charCodeAt(0);
    if (code >= 48 && code <= 57 && tabularDigits) return Math.max(...TABLE[weight].slice(16, 26));
    if (code >= 32 && code < 127) return TABLE[weight][code - 32];
    return EXTRA[weight][ch] ?? FALLBACK_EM;
}

/** The width of a string in rem, at a font size (rem), weight and with slack. */
export function textRem(text, { sizeRem, weight, tabularDigits = false }) {
    return [...text].reduce((sum, ch) => sum + charEm(ch, weight, tabularDigits), 0) * sizeRem * SLACK;
}

// ── What the stylesheet says ────────────────────────────────────────────────

const CSS = readFileSync('src/index.css', 'utf8');

const block = (selectorPattern) => {
    const m = new RegExp(`^${selectorPattern}\\s*\\{([^}]*)\\}`, 'm').exec(CSS);
    if (!m) throw new Error(`index.css has no rule matching ${selectorPattern}`);
    return m[1];
};
const rem = (text, what) => {
    const m = /([\d.]+)rem/.exec(text);
    if (!m) throw new Error(`no rem value for ${what}`);
    return Number(m[1]);
};
/** Tailwind's `px-N` is N quarters of a rem. */
const applyPx = (body, what) => {
    const m = /\bpx-(\d+(?:\.\d+)?)\b/.exec(body);
    if (!m) throw new Error(`no px-N in ${what}`);
    return Number(m[1]) / 4;
};

/** Everything the tests need from index.css, in rem. */
export function tableMetrics() {
    // The rule that applies the padding, not the `width:` one-liners beside it.
    const th = /^\.guide-th\s*\{(\s*@apply[^}]*)\}/m.exec(CSS)?.[1] ?? '';
    const td = /^\.guide-td\s*\{([^}]*@apply[^}]*)\}/m.exec(CSS)?.[1] ?? '';
    const name = block('\\.guide-th-name');
    const unit = block('\\.stat-cell-unit');
    const bodyRem = rem(/--fs-body:\s*([\d.]+rem)/.exec(CSS)?.[1] ?? '', '--fs-body');
    const widths = {
        default: Number(/^\.guide-th\s*\{\s*width:\s*([\d.]+)rem;/m.exec(CSS)?.[1]),
    };
    for (const cls of ['numeric', 'short-values', 'long-text', 'noted-figures', 'long-figures']) {
        const m = new RegExp(`^\\.guide-th\\.${cls}\\s*\\{\\s*width:\\s*([\\d.]+)rem;`, 'm').exec(CSS);
        if (m) widths[cls] = Number(m[1]);
    }
    return {
        widths,
        headerPaddingRem: applyPx(th, '.guide-th') * 2,
        cellPaddingRem: applyPx(td, '.guide-td') * 2,
        nameSizeRem: rem(name.match(/font-size:[^;]*/)?.[0] ?? '', '.guide-th-name font-size'),
        nameWeight: Number(/font-weight:\s*(\d+)/.exec(name)?.[1]),
        bodyRem,
        unitSizeRem: bodyRem * Number(/\*\s*([\d.]+)\)/.exec(unit)?.[1]),
        unitWeight: Number(/font-weight:\s*(\d+)/.exec(unit)?.[1]),
        // .guide-table is text-sm: the cell text is the body size.
        // The stack's note wraps to two lines (a later rule beats the stack's one-line truncation).
        noteClampsAtTwoLines: /^\.guide-cell-stack > \.vehicle-table-note\s*\{[^}]*line-clamp:\s*2/m.test(CSS),
        tableIsTextSm: /^\.guide-table\s*\{[^}]*text-sm/m.test(CSS),
    };
}

/** A column's width in rem, by the class SortHeader gives its header (holds, else numeric, else the default). */
export function columnWidthRem(col, metrics = tableMetrics()) {
    const w = metrics.widths;
    return w[col.holds] ?? (col.numeric ? w.numeric : w.default);
}

// ── Setting a name in a header ──────────────────────────────────────────────

/**
 * Split at the places a browser may break (UAX #14): after a space; after a
 * hyphen or a slash, but not before a digit ("Cost/100", "10-min" keeps its
 * figure); after an en dash.
 */
// A space a browser may break at: not the no-break space.
const SPACE = /[ \t\n]/;
const trimEnd = (t) => t.replace(/[ \t\n]+$/, '');

function pieces(name) {
    const out = [];
    let cur = '';
    const chars = [...name];
    chars.forEach((ch, i) => {
        cur += ch;
        const next = chars[i + 1];
        const breakAfter = SPACE.test(ch) ? next !== undefined && !SPACE.test(next)
            : ch === '–' ? next !== undefined
            : (ch === '-' || ch === '/') ? next !== undefined && !/[\d \t\n]/.test(next)
            : false;
        if (breakAfter) { out.push(cur); cur = ''; }
    });
    if (cur) out.push(cur);
    return out;
}

/** How many lines `name` takes in `room` rem, with `tail` rem of it held by a trailing caret. */
export function linesNeeded(name, room, font, tail = 0) {
    const all = pieces(name);
    const space = textRem(' ', font);
    let lines = 1, used = 0;
    all.forEach((piece, i) => {
        const word = trimEnd(piece);
        const gap = piece.length > word.length ? space : 0;
        const w = textRem(word, font) + (i === all.length - 1 ? tail : 0);
        if (used > 0 && used + w > room) { lines += 1; used = 0; }
        if (w > room) {
            // A word wider than the line breaks anywhere (overflow-wrap: anywhere).
            let run = 0;
            for (const ch of [...word]) {
                const cw = textRem(ch, font);
                if (run + cw > room) { lines += 1; run = 0; }
                run += cw;
            }
            used = run;
        } else {
            used += w;
        }
        used += gap;
    });
    return lines;
}

/**
 * How many lines a column's NAME takes: a `qualified` column's name breaks
 * after its comma (nameLines), the head wrapping as it must and the qualifier
 * whole on its own line, where a caret rides.
 */
export function headerLinesNeeded(label, room, font, tail = 0, qualified = false) {
    const [head, qualifier] = qualified ? nameLines(label) : [label, null];
    if (!qualifier) return linesNeeded(head, room, font, tail);
    return linesNeeded(head, room, font) + linesNeeded(qualifier, room, font, tail);
}

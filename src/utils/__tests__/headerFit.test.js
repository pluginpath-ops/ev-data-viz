import { describe, it, expect } from 'vitest';
import { VEHICLE_COLUMNS, labelledColumn, DEFAULT_ASSUMPTIONS } from '../vehicleTable';
import { GUIDE_COLUMNS } from '../feGuideBrowse';
import { DEFAULT_CORRECTION_TARGET } from '../correctionSettings';
import { tableMetrics, columnWidthRem, linesNeeded, headerLinesNeeded } from './textMetrics';

/**
 * No column header is cut off at its default width (#446).
 *
 * A header is its name alone, at most two lines (`.guide-th-name`'s clamp),
 * and a name that needs a third is silently ellipsed — the reader gets
 * "Max DC Charge R…" and nothing says so. The fix is a shorter `tableLabel`
 * (vehicleSpecSchema.js) or, for a guide column, a shorter `label`, or a wider
 * column; never a taller header row.
 *
 * The widths, padding and type are read from src/index.css (textMetrics.js),
 * so changing a column width there changes what this checks. The text is
 * measured by a MODEL of the browser's wrapping, not a browser: Public Sans
 * Variable's real advance widths, a greedy line break at the places UAX #14
 * allows, `overflow-wrap: anywhere` for a word wider than the line. A name that
 * only just fits the model might not fit the browser, so every name is held
 * MARGIN_REM inside its line — about 4px.
 */

const MAX_LINES = 2;             // .guide-th-name line-clamp
const MARGIN_REM = 0.25;         // headroom the model's kerning-blindness may eat
const CARET_REM = 0.25 + 0.5625; // .guide-sort-caret: ml-1, and a glyph at 0.5625rem

const metrics = tableMetrics();
const font = { sizeRem: metrics.nameSizeRem, weight: metrics.nameWeight };
const roomRem = (col) => columnWidthRem(col, metrics) - metrics.headerPaddingRem - MARGIN_REM;

/** Every header a column can show: its name under each unit system and extreme assumption. */
function vehicleHeaders() {
    const assumptionSets = [DEFAULT_ASSUMPTIONS, { ...DEFAULT_ASSUMPTIONS, addDistance: 300, windowFrom: 0, windowTo: 100 }];
    const targets = [DEFAULT_CORRECTION_TARGET, { ...DEFAULT_CORRECTION_TARGET, speedMph: 80 }];
    const out = [];
    for (const col of VEHICLE_COLUMNS.filter(c => !c.sticky)) {
        const names = new Set();
        for (const units of ['imperial', 'metric']) {
            for (const a of assumptionSets) {
                for (const t of targets) names.add(labelledColumn(col, a, units, t).label);
            }
        }
        for (const name of names) out.push({ table: 'vehicle table', key: col.key, name, col });
    }
    return out;
}

const guideHeaders = () => GUIDE_COLUMNS.filter(c => !c.sticky)
    .map(col => ({ table: 'EPA guide table', key: col.key, name: col.label, col }));

/** The narrowest width, in rem, at which the name fits in two lines with the margin. */
function narrowestRem(h, tail) {
    let w = metrics.headerPaddingRem + MARGIN_REM + 1;
    while (headerLinesNeeded(h.name, w - metrics.headerPaddingRem - MARGIN_REM, font, tail, h.col.qualified) > MAX_LINES && w < 40) w += 0.05;
    return Math.round(w * 100) / 100;
}

describe('the line-break model', () => {
    it('wraps at spaces and after hyphens, and breaks a word that cannot fit', () => {
        expect(linesNeeded('Range', 4.5, font)).toBe(1);
        expect(linesNeeded('Max DC', 4.5, font)).toBe(1);
        expect(linesNeeded('Max DC Rate', 4.5, font)).toBe(2);
        expect(linesNeeded('Supercharger access wide enough to take three lines', 4.5, font)).toBeGreaterThan(2);
        // One word wider than the line still wraps, by character.
        expect(linesNeeded('Vehicle-to-Load', 2, font)).toBeGreaterThan(1);
    });

    it('does not break at a slash or a hyphen before a digit (UAX #14)', () => {
        // "Cost/100" stays whole when it can; "Cost/" alone on a line would orphan the figure.
        const wholeWord = linesNeeded('Cost/100', 4.5, font);
        expect(wholeWord).toBe(1);
        // Too narrow for "Cost/100" but wide enough for "Cost/" and "100": it must break the word, not at the slash.
        const narrow = linesNeeded('Cost/100', 1.3, font);
        expect(narrow).toBeGreaterThan(1);
    });

    it('reads its widths from the stylesheet', () => {
        expect(metrics.widths.numeric).toBeGreaterThan(0);
        expect(metrics.widths.default).toBeGreaterThan(metrics.widths.numeric);
        expect(metrics.headerPaddingRem).toBe(1.5);
        expect(metrics.nameWeight).toBe(700);
        expect(metrics.nameSizeRem).toBe(0.75);
    });
});

describe('column headers fit their columns', () => {
    const all = [...vehicleHeaders(), ...guideHeaders()];

    it('checks every column of both tables', () => {
        expect(all.length).toBeGreaterThan(100);
    });

    it('takes no more than two lines at the default width, with a margin', () => {
        const over = all
            .filter(h => headerLinesNeeded(h.name, roomRem(h.col), font, 0, h.col.qualified) > MAX_LINES)
            .map(h => `${h.table}: "${h.name}" (${h.key}) needs ${narrowestRem(h)}rem, has ${columnWidthRem(h.col, metrics)}rem`);
        expect(over).toEqual([]);
    });

    it('still fits when the sort caret rides on the last line', () => {
        const over = all
            .filter(h => headerLinesNeeded(h.name, roomRem(h.col), font, CARET_REM, h.col.qualified) > MAX_LINES)
            .map(h => `${h.table}: "${h.name}" (${h.key}) loses its sort caret; needs ${narrowestRem(h, CARET_REM)}rem, has ${columnWidthRem(h.col, metrics)}rem`);
        expect(over).toEqual([]);
    });
});

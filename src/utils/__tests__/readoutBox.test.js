import { describe, it, expect } from 'vitest';
import { fitText, layoutReadoutBox, sampleObstacles, placeReadoutBox, BOX_MAX_COLUMNS } from '../readoutBox';

// Every glyph 6px wide: enough to make widths predictable.
const measure = (t) => String(t).length * 6;
const base = { measure, lineHeight: 14, padding: 8, swatch: 14, gap: 8, maxHeight: 200, maxWidth: 360, title: 'At 50%' };
const rows = (n) => Array.from({ length: n }, (_, i) => ({ name: `Vehicle ${i + 1}`, value: `${100 + i} mi` }));

describe('fitText', () => {
    it('leaves text that fits', () => expect(fitText('abc', 100, measure)).toBe('abc'));
    it('shortens with an ellipsis within the width', () => {
        const out = fitText('A very long vehicle name', 60, measure);
        expect(out.endsWith('…')).toBe(true);
        expect(measure(out)).toBeLessThanOrEqual(60);
    });
});

describe('layoutReadoutBox', () => {
    it('lists a few rows in one column, none hidden', () => {
        const box = layoutReadoutBox({ ...base, rows: rows(4) });
        expect(box.columns).toHaveLength(1);
        expect(box.hidden).toBe(0);
        expect(box.columns[0].indices).toEqual([0, 1, 2, 3]);
    });

    it('wraps twelve series into two balanced columns inside the height cap', () => {
        const box = layoutReadoutBox({ ...base, rows: rows(12) });
        expect(box.columns).toHaveLength(2);
        expect(box.columns.map(c => c.indices.length)).toEqual([6, 6]);
        expect(box.hidden).toBe(0);
        expect(box.height).toBeLessThanOrEqual(base.maxHeight);
    });

    it('counts what it cannot fit instead of growing past the cap', () => {
        const box = layoutReadoutBox({ ...base, rows: rows(40) });
        const listed = box.columns.reduce((n, c) => n + c.indices.length, 0);
        expect(box.columns.length).toBeLessThanOrEqual(BOX_MAX_COLUMNS);
        expect(box.hidden).toBe(40 - listed);
        expect(box.hidden).toBeGreaterThan(0);
        expect(box.height).toBeLessThanOrEqual(base.maxHeight);
        expect(box.moreY).not.toBeNull();
    });

    it('truncates long names rather than outgrowing the width cap', () => {
        const long = [{ name: 'x'.repeat(200), value: '99 mi' }];
        const box = layoutReadoutBox({ ...base, rows: long });
        expect(box.width).toBeLessThanOrEqual(base.maxWidth);
        expect(box.names[0].endsWith('…')).toBe(true);
    });
});

describe('sampleObstacles', () => {
    it('fills the gap between distant samples', () => {
        const pts = sampleObstacles([[{ x: 0, y: 0 }, { x: 60, y: 0 }]], 6);
        expect(pts.length).toBeGreaterThan(8);
    });
    it('does not bridge a gap in the data', () => {
        const pts = sampleObstacles([[{ x: 0, y: 0 }, { x: NaN, y: 0 }, { x: 60, y: 0 }]], 6);
        expect(pts).toHaveLength(2);
    });
});

describe('placeReadoutBox', () => {
    const area = { left: 40, right: 440, top: 10, bottom: 310 };
    const size = { width: 120, height: 80 };

    it('defaults to right of the line, top, on an empty plot', () => {
        const at = placeReadoutBox({ size, area, xPx: 100, obstacles: [] });
        expect(at.left).toBeGreaterThan(100);
        expect(at.top).toBe(area.top + 6);
    });

    it('moves to the bottom when a line runs along the top', () => {
        const top = Array.from({ length: 60 }, (_, i) => ({ x: 40 + i * 6, y: 30 }));
        const at = placeReadoutBox({ size, area, xPx: 100, obstacles: top });
        expect(at.top).toBeGreaterThan(150);
    });

    it('takes the left side near the right edge, and never covers the guide line', () => {
        const at = placeReadoutBox({ size, area, xPx: 430, obstacles: [] });
        expect(at.left + size.width).toBeLessThan(430);
    });

    it('stays inside the plot area', () => {
        const at = placeReadoutBox({ size, area, xPx: 45, obstacles: [] });
        expect(at.left).toBeGreaterThanOrEqual(area.left);
        expect(at.left + size.width).toBeLessThanOrEqual(area.right);
    });
});

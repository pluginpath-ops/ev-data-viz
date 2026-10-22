import { describe, it, expect } from 'vitest';
import { wrapCanvasText, wrapAxisLabel, laneLabelBudget } from '../wrapCanvasText';

// Every character is 6px wide, whatever the font — enough to reason about fit.
const fakeCtx = () => {
    const ctx = {
        font: '10px sans-serif',
        stack: [],
        measureText: s => ({ width: String(s).length * 6 }),
        save() { this.stack.push(this.font); },
        restore() { this.font = this.stack.pop(); },
    };
    return ctx;
};

describe('wrapCanvasText', () => {
    it('breaks at spaces and keeps every line within the width', () => {
        const lines = wrapCanvasText(fakeCtx(), 'Model Y Premium AWD · 80 kWh EPA tested', 120, 5);
        expect(lines.length).toBeGreaterThan(1);
        for (const ln of lines) expect(ln.length * 6).toBeLessThanOrEqual(120);
        expect(lines.join(' ')).toBe('Model Y Premium AWD · 80 kWh EPA tested');
    });

    it('ends the last line in an ellipsis only when the lines run out', () => {
        const lines = wrapCanvasText(fakeCtx(), 'alpha beta gamma delta epsilon zeta', 60, 2);
        expect(lines).toHaveLength(2);
        expect(lines[1].endsWith('…')).toBe(true);
    });

    it('splits a single word wider than the line', () => {
        const lines = wrapCanvasText(fakeCtx(), 'abcdefghijklmnop', 48, 5);
        expect(lines.length).toBeGreaterThan(1);
        expect(lines.join('')).toBe('abcdefghijklmnop');
    });
});

describe('wrapAxisLabel', () => {
    it('measures in the axis font and puts the context back', () => {
        const ctx = fakeCtx();
        const fonts = [];
        const measure = ctx.measureText;
        ctx.measureText = s => { fonts.push(ctx.font); return measure(s); };
        wrapAxisLabel(ctx, '13px Inter', 'Model Y Premium AWD', 60, 3);
        expect(new Set(fonts)).toEqual(new Set(['13px Inter']));
        expect(ctx.font).toBe('10px sans-serif');
    });

    it('returns the same lines wrapCanvasText gives, as an array Chart.js draws as multi-line', () => {
        const text = 'Model Y Premium AWD · 80 kWh EPA tested';
        expect(wrapAxisLabel(fakeCtx(), '13px x', text, 90, 3)).toEqual(wrapCanvasText(fakeCtx(), text, 90, 3));
    });

    it('returns an empty string for an empty label', () => {
        expect(wrapAxisLabel(fakeCtx(), '13px x', '', 90, 3)).toBe('');
    });
});

describe('laneLabelBudget', () => {
    const base = { chartHeight: 600, lanes: 6, lineHeight: 15.6 };

    it('scales the width with the chart and clamps it', () => {
        expect(laneLabelBudget({ ...base, chartWidth: 1000 }).maxWidth).toBe(220);
        expect(laneLabelBudget({ ...base, chartWidth: 700 }).maxWidth).toBe(210);
        expect(laneLabelBudget({ ...base, chartWidth: 340 }).maxWidth).toBe(102);
        expect(laneLabelBudget({ ...base, chartWidth: 100 }).maxWidth).toBe(72);
    });

    it('gives a phone narrower labels than a desktop', () => {
        expect(laneLabelBudget({ ...base, chartWidth: 340 }).maxWidth)
            .toBeLessThan(laneLabelBudget({ ...base, chartWidth: 1000 }).maxWidth);
    });

    it('allows up to 3 lines when lanes are roomy and fewer as they crowd', () => {
        expect(laneLabelBudget({ ...base, chartWidth: 800, lanes: 5 }).maxLines).toBe(3);
        expect(laneLabelBudget({ ...base, chartWidth: 800, lanes: 13 }).maxLines).toBe(2);
        expect(laneLabelBudget({ ...base, chartWidth: 800, lanes: 40 }).maxLines).toBe(1);
    });

    it('never asks for fewer than one line, even on a degenerate chart', () => {
        expect(laneLabelBudget({ chartWidth: 0, chartHeight: 0, lanes: 0, lineHeight: 15 }))
            .toEqual({ maxWidth: 72, maxLines: 1 });
    });
});

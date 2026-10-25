import { describe, it, expect } from 'vitest';
import { readingsAtX, nearestRow, windowRows, autoTolerance, readoutNumber, unitOf, nameOf, withUnit, READOUT_CAP } from '../readoutAtX';

const line = (label, pts, extra = {}) => ({ label, data: pts.map(([x, y]) => ({ x, y })), showLine: true, borderColor: '#111', ...extra });

describe('readingsAtX', () => {
    it('reads each series at the same x even when their samples differ', () => {
        const a = line('A', [[0, 0], [10, 100]]);
        const b = line('B', [[4, 40], [6, 60], [12, 120]]);
        const { rows } = readingsAtX([a, b], 5);
        const byLabel = Object.fromEntries(rows.map(r => [r.label, r]));
        expect(byLabel.A.y).toBeCloseTo(50);
        expect(byLabel.B.y).toBeCloseTo(50);
        expect(byLabel.A.interpolated).toBe(true);
        expect(byLabel.A.x).toBe(5);
    });

    it('snaps to a sample within the fuzz and does not call it interpolated', () => {
        const s = line('A', [[0, 0], [10, 100]]);
        const near = readingsAtX([s], 9.9, { fuzz: 0.2 }).rows[0];
        expect(near.interpolated).toBe(false);
        expect(near.y).toBe(100);
        expect(near.x).toBe(10);
        const far = readingsAtX([s], 5, { fuzz: 0.2 }).rows[0];
        expect(far.interpolated).toBe(true);
    });

    it('reports an exact sample as a sample, not an interpolation', () => {
        const { rows } = readingsAtX([line('A', [[0, 0], [5, 7], [10, 100]])], 5);
        expect(rows[0].interpolated).toBe(false);
        expect(rows[0].y).toBe(7);
    });

    it('samples a point-only series within the tolerance, and skips it beyond', () => {
        const pts = line('P', [[10, 1], [20, 2]], { showLine: false });
        expect(readingsAtX([pts], 10.8, { tolerance: 1 }).rows[0].y).toBe(1);
        const far = readingsAtX([pts], 12, { tolerance: 1 });
        expect(far.rows).toHaveLength(0);
        expect(far.missing).toBe(1);
    });

    it('does not interpolate between the points of a sample-mode series', () => {
        const s = line('S', [[0, 0], [10, 10]], { readoutMode: 'sample' });
        expect(readingsAtX([s], 5, { tolerance: 1 }).rows).toHaveLength(0);
    });

    it('snaps to the end sample just past an interpolated series, within tolerance', () => {
        const s = line('S', [[0, 0], [10, 10]]);
        expect(readingsAtX([s], 10.5, { tolerance: 1 }).rows[0].y).toBe(10);
        expect(readingsAtX([s], -0.5, { tolerance: 1 }).rows[0].y).toBe(0);
        expect(readingsAtX([s], 12, { tolerance: 1 }).rows).toHaveLength(0);
    });

    it('reads a series whose samples are not in x order', () => {
        const s = line('S', [[10, 100], [0, 0], [5, 50]]);
        expect(readingsAtX([s], 2.5).rows[0].y).toBeCloseTo(25);
    });

    it('leaves out spread bands, opted-out datasets and hidden ones', () => {
        const ds = [
            line('A', [[0, 0], [10, 10]]),
            line('band', [[0, 0], [10, 10]], { spreadOf: 1 }),
            line('road', [[0, 0], [10, 10]], { _spread: true }),
            line('off', [[0, 0], [10, 10]], { readout: false }),
            line('H', [[0, 0], [10, 10]]),
        ];
        const { rows } = readingsAtX(ds, 5, { isVisible: i => i !== 4 });
        expect(rows.map(r => r.label)).toEqual(['A']);
    });

    it('folds a group into one row with companions', () => {
        const ds = [
            line('Run', [[0, 0], [10, 100]], { readoutGroup: 'r1', yAxisID: 'y' }),
            line('Run (right)', [[0, 30], [10, 40]], { readoutGroup: 'r1', yAxisID: 'y2' }),
        ];
        const { rows } = readingsAtX(ds, 5);
        expect(rows).toHaveLength(1);
        expect(rows[0].companions).toEqual([expect.objectContaining({ yAxisID: 'y2', y: 35 })]);
    });

    it('orders rows as the lines stack on screen', () => {
        const ds = [line('low', [[0, 1], [10, 1]]), line('high', [[0, 9], [10, 9]])];
        expect(readingsAtX(ds, 5).rows.map(r => r.label)).toEqual(['high', 'low']);
        // A reversed axis puts the larger value lower down.
        const reversed = readingsAtX(ds, 5, { toPixelY: (_, y) => y });
        expect(reversed.rows.map(r => r.label)).toEqual(['low', 'high']);
    });

    it('counts a series with nothing at this x', () => {
        const ds = [line('A', [[0, 0], [10, 10]]), line('B', [[20, 0], [30, 10]])];
        const r = readingsAtX(ds, 5, { tolerance: 1 });
        expect(r.rows).toHaveLength(1);
        expect(r.missing).toBe(1);
    });

    it('uses the label override', () => {
        const s = line('long label · source · 125 kWh', [[0, 0], [1, 1]], { readoutLabel: 'Short' });
        expect(readingsAtX([s], 0.5).rows[0].label).toBe('Short');
    });
});

describe('nearestRow and windowRows', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ pixelY: i * 10 }));

    it('picks the row closest to the cursor vertically', () => {
        expect(nearestRow(rows, 63)).toBe(6);
        expect(nearestRow(rows, null)).toBe(0);
        expect(nearestRow([], 5)).toBe(-1);
    });

    it('picks none when the cursor is out of reach of every line', () => {
        expect(nearestRow(rows, 63, 40)).toBe(6);
        expect(nearestRow(rows, 500, 40)).toBe(-1);
        // no cursor y (keyboard): the top row stays active
        expect(nearestRow(rows, null, 40)).toBe(0);
    });

    it('shows everything under the cap', () => {
        expect(windowRows(rows.slice(0, 5), 2).shown).toHaveLength(5);
    });

    it('windows around the nearest row and counts the rest', () => {
        const w = windowRows(rows, 10);
        expect(w.shown).toHaveLength(READOUT_CAP);
        expect(w.shown).toContain(rows[10]);
        expect(w.above + w.below + w.shown.length).toBe(20);
        expect(windowRows(rows, 0).above).toBe(0);
        expect(windowRows(rows, 19).below).toBe(0);
    });
});

describe('autoTolerance', () => {
    it('is one x-unit on an axis people read in whole units', () => {
        expect(autoTolerance({ span: 100, pxPerUnit: 8 })).toBe(1);
    });
    it('shrinks on a small axis', () => {
        expect(autoTolerance({ span: 3, pxPerUnit: 200 })).toBeCloseTo(0.06);
    });
    it('never demands better aim than three pixels', () => {
        expect(autoTolerance({ span: 1000, pxPerUnit: 1 })).toBe(3);
    });
});

describe('readoutNumber', () => {
    it('prints whole numbers from 10 up and keeps a decimal below', () => {
        expect(readoutNumber(212.43817)).toBe('212');
        expect(readoutNumber(54)).toBe('54');
        expect(readoutNumber(3.14159)).toBe('3.1');
        expect(readoutNumber(0.4567)).toBe('0.46');
        expect(readoutNumber(null)).toBe('—');
    });
});

describe('units after the numbers', () => {
    it('takes a short trailing unit from an axis title', () => {
        expect(unitOf('Charge Rate (kW)')).toBe('kW');
        expect(unitOf('Temperature (°F)')).toBe('°F');
        expect(nameOf('Charge Rate (kW)')).toBe('Charge Rate');
    });
    it('leaves a definition alone', () => {
        expect(unitOf('C-Rate (~kW ÷ battery)')).toBe('');
        expect(nameOf('C-Rate (~kW ÷ battery)')).toBe('C-Rate (~kW ÷ battery)');
        expect(unitOf('State of Charge')).toBe('');
    });
    it('attaches % and degrees, spaces the rest', () => {
        expect(withUnit('54', '%')).toBe('54%');
        expect(withUnit('36', '°F')).toBe('36°F');
        expect(withUnit('212', 'kW')).toBe('212 kW');
        expect(withUnit('212', '')).toBe('212');
    });
});

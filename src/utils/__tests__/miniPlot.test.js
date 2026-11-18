import { describe, it, expect } from 'vitest';
import { miniPlotSeries } from '../miniPlot';

describe('miniPlotSeries', () => {
    it('keeps entry order; axes start at 0 and round outward', () => {
        const s = miniPlotSeries([
            { soc: 10.4, chargeRate: 150.2 },
            { soc: 50, chargeRate: null },
            { soc: 30, chargeRate: 90.7 },
            { soc: 20.1, chargeRate: 120 },
        ], 'soc', 'chargeRate');
        expect(s.pts.map(p => p.x)).toEqual([10.4, 30, 20.1]);
        expect([s.x0, s.x1, s.y0, s.y1]).toEqual([0, 30, 0, 151]);
    });

    it('pins the right edge with xMax, and a point past it or below 0 is never clipped', () => {
        const pts = [{ soc: 10, chargeRate: 50 }, { soc: 60, chargeRate: -3.2 }];
        const s = miniPlotSeries(pts, 'soc', 'chargeRate', { xMax: 100 });
        expect([s.x0, s.x1, s.y0, s.y1]).toEqual([0, 100, -4, 50]);
        expect(miniPlotSeries([{ soc: 5, chargeRate: 1 }, { soc: 104, chargeRate: 2 }], 'soc', 'chargeRate', { xMax: 100 }).x1).toBe(104);
    });

    it('is null with fewer than two usable points', () => {
        expect(miniPlotSeries([{ time: 0, soc: 10 }, { time: null, soc: 20 }], 'time', 'soc')).toBeNull();
        expect(miniPlotSeries(null, 'time', 'soc')).toBeNull();
    });
});

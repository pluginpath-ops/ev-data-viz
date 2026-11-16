import { describe, it, expect } from 'vitest';
import { miniPlotSeries } from '../miniPlot';

describe('miniPlotSeries', () => {
    it('keeps entry order and rounds extents outward', () => {
        const s = miniPlotSeries([
            { soc: 10.4, chargeRate: 150.2 },
            { soc: 50, chargeRate: null },
            { soc: 30, chargeRate: 90.7 },
            { soc: 20.1, chargeRate: 120 },
        ], 'soc', 'chargeRate');
        expect(s.pts.map(p => p.x)).toEqual([10.4, 30, 20.1]);
        expect([s.x0, s.x1, s.y0, s.y1]).toEqual([10, 30, 90, 151]);
    });

    it('is null with fewer than two usable points', () => {
        expect(miniPlotSeries([{ time: 0, soc: 10 }, { time: null, soc: 20 }], 'time', 'soc')).toBeNull();
        expect(miniPlotSeries(null, 'time', 'soc')).toBeNull();
    });
});

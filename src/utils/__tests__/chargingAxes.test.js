import { describe, it, expect } from 'vitest';
import { chargingAxisOptions, chargingAxisOr, isChargingAxis, groupAxes, axisForBasis, basisOfAxes } from '../chargingAxes';
import { parseChartUrl, chartConfigFromParsed } from '../chartUrlState';
import { defaultChartConfig } from '../chartDefaults';

describe('the axes Charging Curves offers', () => {
    const options = chargingAxisOptions('imperial');

    it('lists the four groups in the order the picker shows them', () => {
        expect([...new Set(options.map(o => o.group))]).toEqual(['Time', 'Charging speed', 'Battery']);
    });

    it('offers each speed, with the distance in the reader\'s units', () => {
        const names = g => chargingAxisOptions(g).filter(o => o.group === 'Charging speed').map(o => o.name);
        expect(names('imperial')).toEqual(['kW', 'mi/min', 'mi/hr', 'SoC/min', 'C-rate']);
        expect(names('metric')).toEqual(['kW', 'km/min', 'km/hr', 'SoC/min', 'C-rate']);
    });

    it('keeps the full label on every axis so a title still says what it plots', () => {
        const byKey = Object.fromEntries(options.map(o => [o.value, o.label]));
        expect(byKey.rangeRateHr).toBe('Tested Range Rate (mi/hr)');
        expect(byKey.socRate).toBe('SoC Rate (%/min)');
        expect(byKey.deltaRange).toBe('Tested Range Added (mi)');
        const epa = Object.fromEntries(chargingAxisOptions('imperial', 'epa').map(o => [o.value, o.label]));
        expect(epa.deltaRangeEpa).toBe('EPA Range Added (mi)');
        expect(epa.rangeRate).toBe('EPA Range Rate (mi/min)');
    });

    it('no longer offers Temperature or Frame', () => {
        expect(options.some(o => o.value === 'temperature' || o.value === 'frame')).toBe(false);
    });

    it('has one entry per key', () => {
        expect(new Set(options.map(o => o.value)).size).toBe(options.length);
    });
});

describe('the picker groups', () => {
    it('keeps every axis, grouped in the list own order', () => {
        const groups = groupAxes(chargingAxisOptions('imperial'));
        expect(groups.map(g => g.group)).toEqual(['Time', 'Charging speed', 'Battery']);
        expect(groups.flatMap(g => g.options)).toHaveLength(9);
    });
});

describe('a link that names an axis the chart dropped', () => {
    it('knows which axes are offered', () => {
        expect(isChargingAxis('rangeRateHr')).toBe(true);
        expect(isChargingAxis('temperature')).toBe(false);
        expect(chargingAxisOr('frame', 'soc')).toBe('soc');
        expect(chargingAxisOr('time', 'soc')).toBe('time');
    });

    it('opens on the default axes rather than plotting nothing', () => {
        const { chart } = parseChartUrl('?x=temperature&y=rangeRateHr&y2=frame');
        const config = chartConfigFromParsed(chart, defaultChartConfig());
        expect(config.xAxis).toBe('soc');
        expect(config.yAxis).toBe('rangeRateHr');
        expect(config.y2Axis).toBe(null);
    });
});

describe('SoC Added', () => {
    it('is no longer offered, and a link that names it falls back', () => {
        expect(isChargingAxis('deltaSoc')).toBe(false);
        expect(chargingAxisOr('deltaSoc', 'time')).toBe('time');
    });
});

describe('range basis', () => {
    it('swaps only the range axes', () => {
        expect(axisForBasis('range', 'epa')).toBe('rangeEpa');
        expect(axisForBasis('deltaRangeEpa', 'tested')).toBe('deltaRange');
        expect(axisForBasis('rangeRate', 'epa')).toBe('rangeRate');
        expect(axisForBasis(null, 'epa')).toBe(null);
    });

    it('lists one Range and one Range Added whichever basis', () => {
        for (const basis of ['tested', 'epa']) {
            const names = chargingAxisOptions('imperial', basis).filter(o => o.group === 'Battery').map(o => o.name);
            expect(names).toEqual(['SoC', 'Range', 'Range Added']);
        }
    });

    it('still accepts every key a link could carry', () => {
        for (const k of ['range', 'rangeEpa', 'deltaRange', 'deltaRangeEpa']) expect(isChargingAxis(k)).toBe(true);
    });

    it('reads an older link by its axes, and rb when it has one', () => {
        expect(basisOfAxes(['soc', 'rangeEpa'])).toBe('epa');
        expect(basisOfAxes(['soc', 'rangeRate'])).toBe('tested');
        const old = chartConfigFromParsed(parseChartUrl('?x=soc&y=rangeEpa').chart, defaultChartConfig());
        expect([old.rangeBasis, old.yAxis]).toEqual(['epa', 'rangeEpa']);
        const rb = chartConfigFromParsed(parseChartUrl('?x=soc&y=rangeRate&rb=epa').chart, defaultChartConfig());
        expect([rb.rangeBasis, rb.yAxis]).toEqual(['epa', 'rangeRate']);
        const plain = chartConfigFromParsed(parseChartUrl('?x=soc&y=rangeRate').chart, defaultChartConfig());
        expect(plain.rangeBasis).toBe('tested');
    });
});

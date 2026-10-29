import { describe, it, expect } from 'vitest';
import { chargingAxisOptions, chargingAxisOr, isChargingAxis, groupAxes } from '../chargingAxes';
import { parseChartUrl, chartConfigFromParsed } from '../chartUrlState';
import { defaultChartConfig } from '../chartDefaults';

describe('the axes Charging Curves offers', () => {
    const options = chargingAxisOptions('imperial');

    it('lists the four groups in the order the picker shows them', () => {
        expect([...new Set(options.map(o => o.group))]).toEqual(['Time', 'Charging speed', 'Range', 'Range added']);
    });

    it('offers each speed, with the distance in the reader\'s units', () => {
        const names = g => chargingAxisOptions(g).filter(o => o.group === 'Charging speed').map(o => o.name);
        expect(names('imperial')).toEqual(['kW', 'mi/min', 'mi/hr', 'SoC/min', 'C-rate']);
        expect(names('metric')).toEqual(['kW', 'km/min', 'km/hr', 'SoC/min', 'C-rate']);
    });

    it('keeps the full label on every axis so a title still says what it plots', () => {
        const byKey = Object.fromEntries(options.map(o => [o.value, o.label]));
        expect(byKey.rangeRateHr).toBe('Range Rate (mi/hr)');
        expect(byKey.socRate).toBe('SoC Rate (%/min)');
        expect(byKey.deltaRangeEpa).toBe('Range Added - EPA (mi)');
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
        expect(groups.map(g => g.group)).toEqual(['Time', 'Charging speed', 'Range', 'Range added']);
        expect(groups.flatMap(g => g.options)).toHaveLength(12);
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

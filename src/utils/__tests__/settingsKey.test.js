import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
    SETTINGS_PARAMS, writeSettings, readSettings, mergeSettings, encodeSettingsKey, openSettingsKey,
} from '../settingsKey';

const roundTrip = (chartMode, configs) => {
    const p = new URLSearchParams();
    writeSettings(p, chartMode, configs);
    return readSettings(openSettingsKey(`sk=${encodeSettingsKey(p)}`));
};

describe('the settings key', () => {
    it('round-trips Customize routing\'s overrides, pair keys and all', () => {
        const perRun = { '434::351': { minSoc: 5, legDistance: 120.5 }, 'inherited_127_539::': { chargeTime: 25 } };
        expect(roundTrip('roadtrip', { chart: {}, roadTrip: { perRun }, epa: {} }).roadTrip.perRun).toEqual(perRun);
    });

    it('writes only the part of a setting that names something plotted', () => {
        const perRun = { '434::351': { minSoc: 5 }, '999::': { chargeTime: 25 } };
        const p = new URLSearchParams();
        writeSettings(p, 'roadtrip', { chart: {}, roadTrip: { perRun, mapKey: '999::' }, epa: {} }, new Set(['434::351']));
        expect(readSettings(p).roadTrip.perRun).toEqual({ '434::351': { minSoc: 5 } });

        const sizes = new URLSearchParams();
        writeSettings(sizes, 'specsize', { chart: { sizePicked: 7 }, roadTrip: {}, epa: {} }, new Set(['8']));
        expect(sizes.has('sz_p'), 'a picked vehicle no longer selected').toBe(false);

        const epa = new URLSearchParams();
        writeSettings(epa, 'epacurves', { chart: {}, roadTrip: {}, epa: { mappingColors: { a: '#112233', b: '#445566' } } }, new Set(['b']));
        expect(readSettings(epa).epa.mappingColors).toEqual({ b: '#445566' });
    });

    it('round-trips Modeled Efficiency\'s wind and elevation change, and leaves untouched ones out', () => {
        const extras = { windSpeedMph: '20', windDirectionDeg: '180', gradeExpanded: true, gradeGainFt: '-500', gradeDistanceMiles: '10' };
        expect(roundTrip('epacurves', { chart: {}, roadTrip: {}, epa: { extras } }).epa.extras).toEqual(extras);
        const wind = { windSpeedMph: '15', windDirectionDeg: '', gradeExpanded: false, gradeGainFt: '', gradeDistanceMiles: '' };
        expect(roundTrip('epacurves', { chart: {}, roadTrip: {}, epa: { extras: wind } }).epa.extras).toEqual(wind);
        const p = new URLSearchParams();
        writeSettings(p, 'epacurves', { chart: {}, roadTrip: {}, epa: { extras: { ...wind, windSpeedMph: '' } } });
        expect([...p.keys()]).toEqual([]);
    });

    it('round-trips a map of words, such as Performance Compare\'s metric per category', () => {
        const metrics = { accel: 'zero_to_60_sec', braking: 'braking:60-0' };
        expect(roundTrip('perfcompare', { chart: { perfCompare: { metrics } }, roadTrip: {}, epa: {} }).chart.perfCompare.metrics)
            .toEqual(metrics);
    });

    it('keeps an empty list, which means "none picked", apart from no list', () => {
        const picked = roundTrip('perfcurve', { chart: { perfCurve: { pickedRunIds: [] } }, roadTrip: {}, epa: {} });
        expect(picked.chart.perfCurve.pickedRunIds).toEqual([]);
        expect(roundTrip('perfcurve', { chart: {}, roadTrip: {}, epa: {} }).chart).toEqual({});
    });

    it('writes nothing for a setting at its default', () => {
        const p = new URLSearchParams();
        writeSettings(p, 'perfcompare', { chart: { perfCompare: { barMode: 'best', origin: 'all' } }, roadTrip: {}, epa: {} });
        expect([...p.keys()]).toEqual([]);
        expect(encodeSettingsKey(p)).toBe('');
    });

    it('merges a group field by field', () => {
        expect(mergeSettings({ perfCurve: { showG: true, grouping: 'mode' } }, { perfCurve: { grouping: 'all' } }))
            .toEqual({ perfCurve: { showG: true, grouping: 'all' } });
    });

    it('lets a plain parameter beside the key win', () => {
        const p = new URLSearchParams({ pal: 'okabe-ito' });
        const key = encodeSettingsKey(p);
        expect(openSettingsKey(`sk=${key}&pal=legacy`).get('pal')).toBe('legacy');
    });

    it('packs every one of its parameters by name, not spelled out', () => {
        // NAMES_V1 in shortLink.js: a parameter it lacks is packed as its text.
        const names = readFileSync('src/utils/shortLink.js', 'utf8').split('const NAMES_V1 = [')[1].split('\n];')[0];
        for (const param of SETTINGS_PARAMS) expect(names, param).toContain(`'${param}'`);
    });
});

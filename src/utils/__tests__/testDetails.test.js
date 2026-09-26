/**
 * A tested figure names its test so a reader can check it. These pin that the
 * reference says WHICH test and WHY that one, and that it points somewhere the
 * app can land.
 */
import { describe, it, expect } from 'vitest';
import {
    rangeTestReference, chargeTimeTestReference, chargeBestTestReference, performanceTestReference, testHref,
} from '../testDetails';
import { testedRangeSummary, testedEfficiency } from '../testedRange';

const vehicle = (runs) => ({ id: 12, socWindowKwh: 84, runs });
const rangeRun = (over = {}) => ({
    id: 5, kind: 'range', name: 'Highway loop', distance_miles: 291, energy_kwh: 84,
    start_soc: 100, end_soc: 2, speed_mph: 70, temperature_f: 72, date: '2025-03-14', source: 'Out of Spec', ...over,
});

describe('rangeTestReference', () => {
    it('names the test, why it was chosen, and its conditions', () => {
        const v = vehicle([rangeRun({ is_default: true })]);
        const ref = rangeTestReference(v, testedRangeSummary(v));
        expect(ref).toMatchObject({ vehicleId: 12, runId: 5, sub: 'tests', title: 'Highway loop', reason: 'The curator’s default range test' });
        expect(Object.fromEntries(ref.facts.map(f => [f.label, f.value]))).toMatchObject({
            Date: '2025-03-14', Source: 'Out of Spec', Temperature: '72°F', Speed: '70 mph',
            Window: '100→2%', Distance: '291 mi', 'Energy used': '84 kWh',
        });
    });

    it('says a figure was scaled, and a narrow window claims no range', () => {
        const scaled = vehicle([rangeRun({ start_soc: 90, end_soc: 10, distance_miles: 240 })]);
        const ref = rangeTestReference(scaled, testedRangeSummary(scaled));
        expect(ref.reason).toBe('The newest test that saw most of the pack');
        expect(ref.facts.find(f => f.label === 'Full pack').value).toBe('300 mi, scaled from the window');
        expect(ref.caveat).toMatch(/flat/);

        const narrow = vehicle([rangeRun({ start_soc: 56, end_soc: 10, distance_miles: 120, energy_kwh: 40 })]);
        expect(rangeTestReference(narrow, testedRangeSummary(narrow)).caveat).toMatch(/too narrow/);
        // An efficiency loses nothing to a narrow window, so it has no such caveat.
        expect(rangeTestReference(narrow, testedEfficiency(narrow), 'imperial', 'efficiency').caveat).toBeNull();
    });

    it('marks the speed of a mixed cycle, and converts for a metric reader', () => {
        const v = vehicle([rangeRun({ speed_basis: 'mixed' })]);
        const facts = rangeTestReference(v, testedRangeSummary(v), 'metric').facts;
        expect(facts.find(f => f.label === 'Speed').value).toBe('112.7 kph (mixed cycle)');
        expect(facts.find(f => f.label === 'Temperature').value).toBe('22°C');
    });

    it('is null with no test', () => {
        expect(rangeTestReference(vehicle([]), null)).toBeNull();
    });
});

describe('charging references', () => {
    const run = {
        id: 9, kind: 'charging', name: 'Supercharger V4', date: '2025-06-01', source: 'EVBench', temperature_f: 50,
        charge_summary: { startSoc: 8, peakKw: 247.6, durationMin: 31.2 },
    };

    it('says whether the charge time came from the default test or the newest covering one', () => {
        const ref = chargeTimeTestReference({ id: 3 }, { run, minutes: 21.4, isDefault: false }, { from: 10, to: 80 });
        expect(ref).toMatchObject({ runId: 9, title: 'Supercharger V4', reason: 'The newest charging test that covers 10→80%' });
        expect(Object.fromEntries(ref.facts.map(f => [f.label, f.value]))).toMatchObject({
            '10→80%': '21 min', 'Started at': '8%', Peak: '248 kW', Session: '31 min', Temperature: '50°F',
        });
        expect(chargeTimeTestReference({ id: 3 }, { run, minutes: 20, isDefault: true }, { from: 10, to: 80 }).reason)
            .toBe('The default charging test');
    });

    it('names the session that set a best window, and where the window sat', () => {
        const best = { kw: 180, runId: 9, runName: 'Supercharger V4', startSoc: 12, endSoc: 40, startMin: 1.5, timeDerived: true };
        const ref = chargeBestTestReference({ id: 3 }, best, 15);
        expect(ref.reason).toBe('The best 15-minute average across the vehicle’s charging tests');
        expect(ref.facts.find(f => f.label === 'Window').value).toBe('12→40%, from minute 1.5');
        expect(ref.facts.find(f => f.label === 'Time').value).toMatch(/not logged/);
        expect(chargeBestTestReference({ id: 3 }, { kw: 1 }, 15)).toBeNull();   // nothing to link to
    });

    it('says whether the battery was preconditioned, and nothing when not recorded (#352)', () => {
        const fact = (ref) => ref.facts.find(f => f.label === 'Preconditioned')?.value;
        const time = (pre) => chargeTimeTestReference({ id: 3 }, { run: { ...run, preconditioned: pre }, minutes: 20 }, { from: 10, to: 80 });
        expect(fact(time(true))).toBe('Yes');
        expect(fact(time(false))).toBe('No');          // a real answer, shown
        expect(fact(time(null))).toBeUndefined();      // not recorded is not "No"
        expect(fact(time(undefined))).toBeUndefined();
        expect(fact(chargeBestTestReference({ id: 3 }, { kw: 180, runId: 9, preconditioned: false }, 15))).toBe('No');
    });
});

describe('performanceTestReference', () => {
    it('lands on the Performance sub-tab, with no test card to scroll to', () => {
        const ref = performanceTestReference({ id: 3 }, {
            value: 3.1, basis: { sourceName: 'Car and Driver', origin: 'published', trim_label: 'Plaid', all: [{}, {}] },
        });
        expect(ref).toMatchObject({ runId: null, sub: 'performance', title: 'Car and Driver', reason: 'The best of 2 results on record' });
        expect(ref.facts).toEqual([{ label: 'Kind', value: 'Published figure' }, { label: 'Trim', value: 'Plaid' }]);
        expect(performanceTestReference({ id: 3 }, { value: null })).toBeNull();
    });
});

describe('testHref', () => {
    it('is a Tests & Data link the app restores, sub-tab always stated', () => {
        expect(testHref({ vehicleId: 12, runId: 5, sub: 'tests' })).toBe('?tab=runs&vid=12&sub=tests&run=5');
        expect(testHref({ vehicleId: 12, runId: null, sub: 'performance' })).toBe('?tab=runs&vid=12&sub=performance');
        expect(testHref(null)).toBeNull();
    });
});

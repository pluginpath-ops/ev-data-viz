/**
 * The upload's column guesses (#16): every header the issue lists maps where it
 * should, and nothing near it false-positives.
 */
import { describe, it, expect } from 'vitest';
import { autoMapHeaders, headerWords } from '../csvColumnMapping';

const fieldFor = (header, others = []) =>
    Object.entries(autoMapHeaders([header, ...others])).find(([, h]) => h === header)?.[0] ?? null;

describe('headerWords', () => {
    it('splits camelCase, punctuation and a percent sign', () => {
        expect(headerWords('ChargeKW')).toEqual(['charge', 'kw']);
        expect(headerWords('Power_kW')).toEqual(['power', 'kw']);
        expect(headerWords('Power (kW)')).toEqual(['power', 'kw']);
        expect(headerWords('SoC %')).toEqual(['soc', 'percent']);
        expect(headerWords('kW')).toEqual(['kw']);
        expect(headerWords('stateOfCharge')).toEqual(['state', 'of', 'charge']);
        expect(headerWords('%')).toEqual(['percent']);
    });
});

describe('charge rate', () => {
    it.each([
        'Power', 'power', 'Power (kW)', 'Power_kW', 'kilowatts', 'Kilowatts', 'kW', 'KW', 'kw',
        'ChargeKW', 'charge_kw', 'ChargePower', 'charge_power', 'ChargeRate', 'Charge Rate',
    ])('maps %s', (h) => expect(fieldFor(h)).toBe('chargeRate'));

    it.each(['Voltage', 'Amps', 'Current (A)', 'Energy (kWh)', 'kWh', 'Pack Voltage (V)'])(
        'does not map %s', (h) => expect(fieldFor(h)).not.toBe('chargeRate'));
});

describe('SoC', () => {
    it.each(['SoC', 'soc', 'Charge', 'charge', '%', 'percent', 'State of Charge', 'SoC_pct'])(
        'maps %s', (h) => expect(fieldFor(h)).toBe('soc'));

    it('keeps "Charge" for SoC and "Charge Rate" for the rate in one file', () => {
        expect(autoMapHeaders(['Charge', 'Charge Rate'])).toMatchObject({ soc: 'Charge', chargeRate: 'Charge Rate' });
    });
});

describe('time', () => {
    it.each(['Time', 'time', 'Minutes', 'minutes', 'Charging Time', 'charging_time', 'mins', 'MIN', 'Elapsed (min)'])(
        'maps %s', (h) => expect(fieldFor(h)).toBe('time'));

    it('keeps a timestamp apart, and a "Min SoC" column out of time', () => {
        expect(autoMapHeaders(['Timestamp', 'Time'])).toMatchObject({ timestamp: 'Timestamp', time: 'Time' });
        expect(fieldFor('Min SoC')).toBe('soc');
    });
});

describe('a whole file', () => {
    it('maps a typical export, one column per field, the likeliest winning', () => {
        expect(autoMapHeaders(['Time', 'SoC', 'Power (kW)', 'Voltage', 'Amps', 'Battery Temp', 'Range (mi)', 'Frame']))
            .toEqual({ time: 'Time', soc: 'SoC', chargeRate: 'Power (kW)', temperature: 'Battery Temp', range: 'Range (mi)', frame: 'Frame' });
        // "Charge Power" beats a bare "Power", wherever it sits.
        expect(autoMapHeaders(['Power', 'Charge Power']).chargeRate).toBe('Charge Power');
    });

    it('maps nothing it does not recognise', () => {
        expect(autoMapHeaders(['Voltage', 'Amps', 'Notes'])).toEqual({});
        expect(autoMapHeaders([])).toEqual({});
    });
});

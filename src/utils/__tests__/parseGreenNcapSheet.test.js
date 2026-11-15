import { describe, it, expect } from 'vitest';
import { odsSheets } from '../odsSheets';
import { parseGreenNcapSheet, vinModelYear } from '../parseGreenNcapSheet';

// Build content.xml the way LibreOffice writes it: sparse cells with
// number-columns-repeated gaps, office:value behind a rounded display.
const cell = c => {
    if (c == null) return '<table:table-cell/>';
    if (typeof c === 'number') return `<table:table-cell office:value-type="float" office:value="${c}"><text:p>${c.toFixed(1)}</text:p></table:table-cell>`;
    return `<table:table-cell office:value-type="string"><text:p>${c.replace(/&/g, '&amp;')}</text:p></table:table-cell>`;
};
const row = cells => `<table:table-row>${cells.map(cell).join('')}<table:table-cell table:number-columns-repeated="1000"/></table:table-row>`;
const sheet = (name, rows) => `<table:table table:name="${name}">${rows.map(row).join('')}<table:table-row table:number-rows-repeated="1048000"><table:table-cell/></table:table-row></table:table>`;
const xml = (...tables) => `<office:document-content><office:body><office:spreadsheet>${tables.join('')}</office:spreadsheet></office:body></office:document-content>`;

// A row 30 wide, figures placed at Green NCAP's columns.
const at = (pairs) => { const r = Array(30).fill(null); for (const [c, v] of Object.entries(pairs)) r[c] = v; return r; };

const RESULTS_2025 = [
    at({ 1: 'MAIN RESULTS 1', 17: 'Energy Consumption from Grid', 22: 'Board Comp. energy consumpt.', 25: 'Driving Range (electr. mode)',
         26: 'Measured Recharged Electric Energy (BEV and PHEV, from grid)', 27: 'Measured Net Battery Capacity',
         28: 'Efiiciency grid to battery output', 29: 'Electr. energy consumpt. from battery' }),
    at({ 17: 'kWh/100km', 22: 'kWh/100km', 25: 'km', 26: 'kWh', 27: 'kWh', 28: '-', 29: 'kWh/100km' }),
    at({ 1: 'Laboratory Tests', 3: 'WLTP CoC Type Approval', 17: 22.8, 25: 505, 26: 109.06, 27: 95.374678, 28: 0.874515665 }),
    at({ 3: 'WLTC+ Warm', 17: 23.3538578, 22: 22.1, 25: 466.989, 29: 20.4233 }),
    at({ 3: 'WLTC+ CAT Cold (-7°C)', 17: 42.686, 22: 38.5, 25: 255.49, 29: 37.33 }),
    at({ 3: 'BAB130 Motorway', 17: 35.1279, 25: 310.465, 29: 30.7199 }),
    at({ 1: 'On-Road Tests', 3: 'On-Road Drive', 17: 21.72, 22: 19.9, 25: 502.09, 29: 19 }),
    at({ 3: 'Congestion MAX value' }),
    at({ 1: 'PHEV in Charge Depeleting Mode', 17: 'Energy Consumption from Grid' }),
    at({ 3: 'WLTC+ Warm', 17: 99 }),   // a PHEV block row: must not be read
];
const SPECS = [
    ['Brand', 'KIA'], ['Model', 'EV9'], ['Variant Name', 'GT-line'],
    ['Green NCAP Test Reference Number', '25-KIA-0229'], ['Drivetrain', 'AWD'],
    ['Declared Battery Capacity (usable) [kWh]', 99.8], ['Declared Electric Range (for BEV) [km]', 505],
    ['VIN tested vehicle', 'KNAAE8150R6011117'],
];
const FAST = [
    ['SoC [%]', 'Time [mm:ss]', 'Power [kW]'],
    [7, '00:00', 0.0356], [10, '01:22', 192.76], [80, '59:58', 60], [81, '00:02', 58],
];

describe('odsSheets', () => {
    it('reads sparse rows, keeps full precision, and does not expand padding', () => {
        const s = odsSheets(xml(sheet('A', [['x', 1.23456], [null, null, 'z & y']])));
        expect(s.A[0][0].text).toBe('x');
        expect(s.A[0][1]).toEqual({ text: '1.2', value: 1.23456 });
        expect(s.A[1][2].text).toBe('z & y');
        expect(s.A.length).toBe(2);
    });
});

describe('parseGreenNcapSheet, 2025 layout', () => {
    const car = parseGreenNcapSheet(odsSheets(xml(sheet('SPECS', SPECS), sheet('TEST_RESULTS', RESULTS_2025), sheet('Fast_charging', FAST))));

    it('reads identity from SPECS, and the test year from the reference', () => {
        expect(car.layout).toBe('2025');
        expect(car.identity).toMatchObject({ make: 'KIA', model: 'EV9', variant: 'GT-line', declaredUsableKwh: 99.8, wltpRangeKm: 505, testYear: 2025, vinModelYear: 2024 });
    });

    it('takes the battery figures from whichever row carries them', () => {
        expect(car.battery).toEqual({ rechargedKwh: 109.06, netBatteryKwh: 95.37, gridToBattery: 0.8745 });
    });

    it('keys every test row, and stops at the PHEV block', () => {
        expect(car.tests.map(t => t.key)).toEqual(['wltp_type_approval', 'wltc_warm', 'wltc_cat_cold', 'bab130', 'on_road']);
        const bab = car.tests.find(t => t.key === 'bab130');
        expect(bab).toMatchObject({ group: 'lab', tempC: 23, fromGridKwh100km: 35.13, fromBatteryKwh100km: 30.72, rangeKm: 310.5, rangeMi: 192.9 });
        expect(bab.fromBatteryWhPerMi).toBe(494);
        expect(car.tests.find(t => t.key === 'on_road').group).toBe('road');
        expect(car.warnings).toEqual([]);
    });

    it('reads the fast-charging curve and carries the hour past 59:59', () => {
        expect(car.fastCharging.points.map(p => p.timeS)).toEqual([0, 82, 3598, 3602]);
    });
});

describe('parseGreenNcapSheet, 2020 layout', () => {
    const results = [
        at({ 0: 'DOMINANT FUEL', 1: 'MAIN RESULTS 1', 17: 'Electr. energy consumpt. from grid', 19: 'Electr. energy consumpt. from grid',
             22: 'Board Comp. energy consumpt.', 25: 'Driving Range (electr. mode)', 27: 'Electr. energy consumpt. from battery' }),
        at({ 17: 'kWh/100km', 19: 'Wh/s', 22: 'kWh/100km', 25: 'km', 27: 'kWh/100km' }),
        at({ 1: 'Laboratory Tests', 2: 'WLTC+ appr.', 3: 'WLTC+ cold engine (14 degr C)', 17: 19.2, 19: 'n.a.', 22: 17.2, 25: 323.5, 27: 17.2 }),
        at({ 3: 'WLTC+ cold engine 2 (not rated)', 17: 19, 25: 328.5, 27: 16.9 }),
        at({ 3: 'BAB130 Motorway', 17: 23.8, 25: 261.5, 27: 21.2 }),
        at({ 1: 'Real-World tests', 2: 'Approval', 3: 'PEMS+ Cold Engine 1', 17: 16.9, 25: 367.8, 27: 15.1 }),
        at({ 1: 'MAIN RESULTS 2' }),
    ];
    const car = parseGreenNcapSheet(odsSheets(xml(sheet('RESULTS', results), sheet('SPECS', [['Brand', 'Volkswagen'], ['Model:', 'ID.3'], ['Battery Size (kWh):', 58]]))));

    it('maps old labels to the same keys, by unit not position', () => {
        expect(car.layout).toBe('2020');
        expect(car.tests.map(t => [t.key, t.rated, t.tempC])).toEqual([
            ['wltc_cold', true, 14], ['wltc_cold_2', false, null], ['bab130', true, 23], ['on_road', true, null]]);
        expect(car.tests[0].fromGridKwh100km).toBe(19.2);
        expect(car.battery).toEqual({ rechargedKwh: null, netBatteryKwh: null, gridToBattery: null });
        expect(car.identity.declaredUsableKwh).toBe(58);
    });
});

describe('parseGreenNcapSheet, 2022 layout quirks', () => {
    const results = [
        at({ 1: 'MAIN RESULTS 1', 17: 'Energy Consumption from Grid', 25: 'Driving Range (electr. mode)',
             26: 'Gross Battery Capacity (from grid)', 27: 'Measured Netto Battery Capacity',
             28: 'Efiiciency grid to battery output', 29: 'Energy Consumption from Battery' }),
        at({ 17: 'kWh/100km', 25: 'km', 26: 'kWh', 27: 'kWh', 28: '%', 29: 'kWh/100km' }),
        at({ 1: 'Laboratory Tests', 3: 'WLTC+ cold engine (23°C)', 17: 16.5, 25: 414.4, 26: 68.5, 27: 61.0, 28: 89.08, 29: 14.72 }),
        at({ 3: 'WLTC+ CAT (-7°C)', 17: 28.5, 25: 240.6, 27: 0.88, 29: 25.36 }),
    ];
    const car = parseGreenNcapSheet(odsSheets(xml(sheet('RESULTS', results))));

    it('reads the other wordings, a bare percent, and keeps the first battery figure', () => {
        expect(car.layout).toBe('2022');
        expect(car.battery).toEqual({ rechargedKwh: 68.5, netBatteryKwh: 61, gridToBattery: 0.8908 });
        expect(car.tests.map(t => [t.key, t.tempC, t.fromBatteryKwh100km])).toEqual([['wltc_cold', 23, 14.72], ['wltc_cat_cold', -7, 25.36]]);
    });
});

describe('vinModelYear', () => {
    it('decodes position 10 near the test year, and declines a far one', () => {
        expect(vinModelYear('KNAAE8150R6011117', 2025)).toBe(2024);
        expect(vinModelYear('WVWZZZE1ZLP019111', 2021)).toBe(2020);
        expect(vinModelYear('WVWZZZE1Z1P019111', 2021)).toBe(null); // "1" = 2031 or 2001
        expect(vinModelYear('short', 2021)).toBe(null);
    });
});

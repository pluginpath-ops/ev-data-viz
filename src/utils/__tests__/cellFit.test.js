import { describe, it, expect } from 'vitest';
import { VEHICLE_COLUMNS, vehicleColumnByKey, formatVehicleCell, unitFor } from '../vehicleTable';
import { GUIDE_COLUMNS, formatCell } from '../feGuideBrowse';
import { unitAround } from '../tableColumns';
import { tableMetrics, columnWidthRem, textRem, linesNeeded } from './textMetrics';

/**
 * A figure and its unit fit their cell (#446).
 *
 * A cell is one line with an ellipsis (`.guide-td` truncates), so a figure that
 * is wider than its column's content box silently loses its last digits —
 * "154.21…" is a different number. Putting the unit beside every figure took
 * the room the figure had, and a unit in metric is often longer ("km/kWh" for
 * "mi/kWh"), so this holds the LARGEST plausible figure of each column, in both
 * unit systems, to the room its column gives it.
 *
 * Same model, and the same stylesheet-read widths, as headerFit.test.js.
 */

const MARGIN_REM = 0.25;
const metrics = tableMetrics();
const figureFont = { sizeRem: metrics.bodyRem, weight: 400, tabularDigits: true };
const unitFont = { sizeRem: metrics.unitSizeRem, weight: metrics.unitWeight };

/** The width of a figure with its unit beside it, as TableCell sets it, in rem. */
const cellRem = (text, unit, mark = '') => {
    const { before, after } = unitAround(unit);
    return textRem(before, unitFont) + textRem(text, figureFont) + textRem(after, unitFont) + textRem(mark, figureFont);
};
const roomRem = (col) => columnWidthRem(col, metrics) - metrics.cellPaddingRem - MARGIN_REM;

// The largest value each column plausibly holds, in the STORED unit (miles,
// pounds, inches, mph). Anything not listed gets a generic worst case below.
const VEHICLE_PEAK = {
    'figures.socWindowKwh': 250, 'figures.epaRangeMi': 520, 'figures.epaCityMi': 560, 'figures.epaHwyMi': 500,
    'figures.epaEfficiency': 5.2, 'calc.efficiency': 5.2, 'calc.rangePerChargeMin': 25.5, 'calc.timeToAdd': 120,
    'calc.avgChargeKw': 350, 'calc.peakCRate': 5.25, 'calc.pctOfEpaHwy': 120, 'calc.pricePerMile': 900,
    'calc.pricePerKwh': 950, 'calc.costPer100Home': 12.35, 'calc.costPer100Fast': 25.35, 'calc.weightPerHp': 25.5,
    'calc.totalCargo': 120, 'calc.batteryBuffer': 25.5,
    'tested.range_mi': 520, 'tested.efficiency_mi_kwh': 5.2, 'tested.composite_range_mi': 520,
    'tested.composite_efficiency_mi_kwh': 5.2, 'tested.when_new_range_mi': 520, 'tested.capacity_retention': 100,
    'tested.top_speed_mph': 260, 'tested.quarter_mile_trap_mph': 130, 'tested.charge_window_min': 120,
    'powertrain.horsepower_hp': 1200, 'powertrain.torque_lbft': 1200, 'powertrain.battery_gross_kwh': 250,
    'performance.top_speed_mph': 260, 'performance.quarter_mile_mph': 130, 'performance.weight_lbs': 9500,
    'performance.braking_60_0_ft': 200, 'performance.braking_70_0_ft': 260, 'performance.slalom_mph': 80,
    'performance.elk_test_mph': 80, 'dimensions.length_in': 250, 'dimensions.width_in': 100,
    'dimensions.height_in': 100, 'dimensions.wheelbase_in': 180, 'dimensions.ground_clearance_in': 15,
    'dimensions.bed_length_in': 100, 'wheels.wheel_size_in': 24, 'towing.towing_capacity_lbs': 11000,
    'towing.payload_lbs': 3000, 'warranty.battery_miles': 100000, 'warranty.basic_miles': 100000,
    'range.expected_epa_mi': 520, 'interior.cargo_cuft': 120, 'interior.frunk_cuft': 30,
    'interior.max_cargo_cuft': 120, 'interior.screen_size_in': 20, 'pricing.base_price_usd': 250000,
    'interior.sound_system_watts': 1900, 'charging.max_dc_kw': 400, 'charging.battery_usable_kwh': 250,
    'charging.max_dc_400v_kw': 225, 'charging.max_ac_kw': 22, 'charging.charge_time_10_to_80_pct_min': 120,
    'charging.battery_nominal_voltage_v': 900, 'figures.voltageClass': 800,
};
const GENERIC_PEAK = 99.99;

const GUIDE_PEAK = {
    model_year: 2027, label_comb_range_mi: 520, label_hwy_range_mi: 500, label_city_range_mi: 560,
    label_comb_mpge: 134, label_city_mpge: 150, label_hwy_mpge: 125, city_hwy_ratio: 1.329,
    nominal_pack_kwh: 200.5, total_voltage_v: 926, batt_capacity_ah: 1200, batt_specific_energy_wh_kg: 280,
    motor_power_kw: 1200, motor_count: 4, wheel_size_in: 23, charge_time_240v_h: 12.5,
    unadj_city_mpge: 154.214, unadj_hwy_mpge: 154.214, unadj_comb_mpge: 154.214,
    adj_city_mpge: 154.214, adj_hwy_mpge: 154.214, adj_comb_mpge: 154.214, label_adjustment_factor: 0.7294,
};

function vehicleCells() {
    const out = [];
    for (const col of VEHICLE_COLUMNS.filter(c => c.numeric)) {
        for (const units of ['imperial', 'metric']) {
            const peak = VEHICLE_PEAK[col.key] ?? GENERIC_PEAK;
            const text = formatVehicleCell({ values: { [col.key]: peak } }, col, units);
            // The asterisk on a scaled tested range rides at the end.
            const mark = col.key === 'tested.range_mi' ? '*' : '';
            out.push({ table: 'vehicle table', key: col.key, units, text, unit: unitFor(col, units), mark, col });
        }
    }
    return out;
}

const guideCells = () => GUIDE_COLUMNS.filter(c => c.numeric).map((col) => ({
    table: 'EPA guide table', key: col.key, units: '-', text: formatCell({ [col.key]: GUIDE_PEAK[col.key] ?? GENERIC_PEAK }, col),
    unit: col.unit ?? null, mark: '', col,
}));

describe('a figure and its unit fit their cell', () => {
    const all = [...vehicleCells(), ...guideCells()];

    it('checks every numeric column of both tables, in both unit systems', () => {
        expect(all.length).toBeGreaterThan(150);
    });

    it('names only columns that exist', () => {
        for (const k of Object.keys(VEHICLE_PEAK)) expect(vehicleColumnByKey(k), k).toBeTruthy();
        for (const k of Object.keys(GUIDE_PEAK)) expect(GUIDE_COLUMNS.some(c => c.key === k), k).toBe(true);
    });

    it('stays inside the cell, with a margin', () => {
        const over = all
            .filter(c => cellRem(c.text, c.unit, c.mark) > roomRem(c.col))
            .map(c => `${c.table}: "${c.text}${c.unit ? ` ${c.unit}` : ''}${c.mark}" (${c.key}, ${c.units}) is ${cellRem(c.text, c.unit, c.mark).toFixed(2)}rem, room ${roomRem(c.col).toFixed(2)}rem`);
        expect(over).toEqual([]);
    });
});

describe('the note under a tested figure wraps to two lines instead of truncating', () => {
    // Under a figure, `.guide-cell-stack > .vehicle-table-note` clamps at two lines of nano text.
    // These are the notes a tested cell USUALLY carries, in the longest unit system; a note
    // with a fourth part ("scaled from 100→5%") runs past two lines and the cell's peek
    // restates it, as for any clipped cell.
    const noteFont = { sizeRem: metrics.unitSizeRem, weight: 400 };
    const NOTES = {
        'tested.range_mi': '112.7 km/h · 37°C · −3.5% corrected',
        'tested.efficiency_mi_kwh': '112.7 km/h · 37°C · −3.5% corrected',
        'tested.composite_range_mi': 'composite of 12 tests · 3 left out',
        'tested.composite_efficiency_mi_kwh': 'composite of 12 tests · 2 est. from SoC',
        'tested.when_new_range_mi': 'at 82 kWh (EPA tested) · −3.5% corrected',
    };

    it('fits two lines in every noted column', () => {
        const over = Object.entries(NOTES)
            .filter(([key, note]) => linesNeeded(note, roomRem(vehicleColumnByKey(key)), noteFont) > 2)
            .map(([key, note]) => `"${note}" (${key}) needs more than two lines in ${roomRem(vehicleColumnByKey(key)).toFixed(2)}rem`);
        expect(over).toEqual([]);
    });

    it('is set to wrap in the stylesheet', () => {
        expect(metrics.noteClampsAtTwoLines).toBe(true);
    });
});

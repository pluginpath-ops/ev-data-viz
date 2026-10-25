import { describe, it, expect } from 'vitest';
import { targetRatios } from '../../hooks/useViewingConditions';
import { DEFAULT_CORRECTION_TARGET } from '../correctionSettings';
import { buildEpaCurveFromModel, correctMeasuredConsumption, curveAccessoryW } from '../epaDerivations';

// The same record as modeledEfficiencyPreview.test.js: a measured η.
const testVehicle = {
    test_vehicle_id: 'TG1', model_year: 2025, make: 'Porsche', epa_carline_name: 'Taycan 4 Cross Turismo',
    useable_kwh: 90,
    epa_coefficient_sets: [{ is_primary: true, target_a: 37, target_b: 0.2, target_c: 0.02, equiv_test_weight_lbs: 5500 }],
    epa_tests: [{
        procedure_code: 77, total_dc_energy_kwh: 90,
        epa_test_phases: [
            { phase_type: 'HWY', distance_mi: 10.26, dc_energy_kwh: 3.1 },
            { phase_type: 'HWY', distance_mi: 10.26, dc_energy_kwh: 3.0 },
            { phase_type: 'SS', distance_mi: 280, dc_energy_kwh: 84.52 },
        ],
    }],
};
const at = (over) => targetRatios({ ...DEFAULT_CORRECTION_TARGET, ...over });

describe('Modeled Efficiency under the shared correction target (#449)', () => {
    it('draws today’s curve, exactly, for a target nobody has moved', () => {
        const { densityRatio, accessoryDeltaW } = targetRatios(DEFAULT_CORRECTION_TARGET);
        expect(densityRatio).toBe(1);
        expect(accessoryDeltaW).toBe(0);
        expect(curveAccessoryW(testVehicle, accessoryDeltaW)).toBeNull();
        const today = buildEpaCurveFromModel(testVehicle, 90);
        const now = buildEpaCurveFromModel(testVehicle, 90, densityRatio, curveAccessoryW(testVehicle, accessoryDeltaW));
        expect(now).toEqual(today);
        // An untouched target says nothing at all, so a page that never opened it is unchanged.
        expect(targetRatios(undefined)).toEqual(targetRatios(DEFAULT_CORRECTION_TARGET));
    });

    it('thickens the air for a cold target and thins it for altitude', () => {
        expect(at({ temperatureF: 20 }).densityRatio).toBeGreaterThan(1);
        expect(at({ altitudeFt: 6000 }).densityRatio).toBeLessThan(1);
    });

    it('moves the accessory load with the temperature while on auto, and with the reader once set', () => {
        expect(at({ temperatureF: 20 }).accessoryDeltaW).toBe(2000);      // 2,300 W against the 300 W standard
        expect(at({ temperatureF: 90 }).accessoryDeltaW).toBe(1400);
        expect(at({ temperatureF: 20, accessoryW: 1000 }).accessoryDeltaW).toBe(700);
        expect(at({ accessoryW: 250 }).accessoryDeltaW).toBe(-50);
    });

    it('adds the target’s difference to the record’s own load, never below zero', () => {
        expect(curveAccessoryW(testVehicle, 2000)).toBe(2300);
        expect(curveAccessoryW({ ...testVehicle, accessory_load_w_override: 500 }, 2000)).toBe(2500);
        expect(curveAccessoryW(testVehicle, -1000)).toBe(0);
    });

    it('draws a heavier curve for a heavier accessory load, most at low speed', () => {
        const base = buildEpaCurveFromModel(testVehicle, 90);
        const loaded = buildEpaCurveFromModel(testVehicle, 90, 1, curveAccessoryW(testVehicle, 2000));
        const slow = loaded[0].kwh100mi - base[0].kwh100mi;
        const fast = loaded.at(-1).kwh100mi - base.at(-1).kwh100mi;
        expect(slow).toBeGreaterThan(fast);
        expect(fast).toBeGreaterThan(0);
    });
});

describe('correcting a measured point to the curve’s conditions', () => {
    const view = { densityRatio: 1, accessoryDeltaW: 0, windSpeedMph: 0, windDirectionDeg: 0, elevationGainFt: 0, elevationDistanceMiles: 0 };
    const measured = 320;

    it('leaves a test with no temperature alone at the default view, as it always did', () => {
        // Blank temperature is the 59°F reference density on both sides, and the
        // base accessory load on both sides: the ratio is 1.
        expect(correctMeasuredConsumption(testVehicle, 70, measured, { temperatureF: null }, view)).toBeCloseTo(measured, 9);
    });

    it('does not credit a cold test with a heater it did not need: it lowers the corrected consumption further', () => {
        // The same cold test, once with the accessory load of the weather it was
        // driven in and once as though it carried the base load (a comfort-band
        // test at the same air density cannot be built, so compare against the
        // 60°F edge of the band, which is the same load as 70°F).
        const cold = correctMeasuredConsumption(testVehicle, 70, measured, { temperatureF: 20 }, view);
        const mild = correctMeasuredConsumption(testVehicle, 70, measured, { temperatureF: 60 }, view);
        expect(cold).toBeLessThan(mild);
        expect(cold).toBeLessThan(measured);
    });

    it('prices the target’s own accessory load at the view', () => {
        const heavier = correctMeasuredConsumption(testVehicle, 70, measured, { temperatureF: 70 }, { ...view, accessoryDeltaW: 2000 });
        expect(heavier).toBeGreaterThan(measured);
    });
});

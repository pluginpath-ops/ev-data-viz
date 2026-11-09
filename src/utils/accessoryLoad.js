/**
 * The heating, cooling and everything-else the car draws that is not traction,
 * as a range correction needs it (#449).
 *
 * Two tests are not comparable if one ran a heater at 20°F and the other did
 * not. No test records its HVAC use, so the load is ASSUMED from the weather:
 * DEFAULT_ACCESSORY_W while the cabin holds itself (a comfort band around
 * 65°F), plus a straight line of watts per degree outside it. One line for
 * every car — a heat pump draws roughly half a resistive heater, and this
 * cannot tell them apart. See the explainer, "heating-cooling-and-range".
 *
 * ── Why watts become miles per kWh through speed ─────────────────────────────
 *
 * A heater draws watts, a range is miles. At a steady speed v the heater costs
 * P / v watt-hours for every mile, so the same 2,000 W is 29 Wh/mi at 70 mph
 * and 40 Wh/mi at 50. That 1/v is why a slow winter test loses more of its
 * range to the heater than a fast one, and why this term cannot be folded into
 * the aero fraction, which scales with the square of speed.
 *
 * ── How it combines with the aero model ──────────────────────────────────────
 *
 * Consumption C (Wh/mi) is the test's own, measured. Split it:
 *
 *     a_run = P_run / v_run                  the accessory share at the test
 *     D_run = C_run − a_run                  everything else ("traction")
 *     D_target = D_run · L_target / L_run    traction re-priced: speed, air
 *                                            density and wind (conditionCorrection's
 *                                            loadTerm)
 *     C_target = D_target + P_target / v_target
 *     k = C_run / C_target
 *
 * and k multiplies efficiency and range, as every correction factor does.
 *
 * Leaf module — it imports only constants, because conditionCorrection already
 * imports epaDerivations and the reverse would be a cycle. Pure: no React, no
 * database. The constants are named and the functions take them as defaults, so
 * a later comparison of predicted against actual tests (#475) can call them
 * with other values.
 */
import {
    DEFAULT_ACCESSORY_W, ACCESSORY_COMFORT_BAND_F, ACCESSORY_HEAT_W_PER_F,
    ACCESSORY_COOL_W_PER_F, ASSUMED_TEST_CONSUMPTION_WH_MI,
} from '../constants/epa';
import { val } from './calcTrace';

/**
 * The load a test (or a reader's target) is assumed to carry at an outside
 * temperature, in watts. A blank temperature is the base load: a stand-in for
 * "a day the cabin held itself", which is what an unrecorded test is corrected
 * from anyway (ASSUMED_TEST_CONDITIONS).
 */
export function assumedAccessoryW(temperatureF, {
    baseW = DEFAULT_ACCESSORY_W,
    comfortBand = ACCESSORY_COMFORT_BAND_F,
    heatWPerF = ACCESSORY_HEAT_W_PER_F,
    coolWPerF = ACCESSORY_COOL_W_PER_F,
    trace = null,
} = {}) {
    const t = Number(temperatureF);
    if (temperatureF == null || temperatureF === '' || !Number.isFinite(t)) {
        trace?.step('Accessory load (no temperature)', {
            formula: 'P = P_base', values: { P_base: val(baseW, 'W', 'knob:DEFAULT_ACCESSORY_W') },
            result: baseW, unit: 'W', assumed: true,
        });
        return baseW;
    }
    const watts = baseW
        + heatWPerF * Math.max(0, comfortBand[0] - t)
        + coolWPerF * Math.max(0, t - comfortBand[1]);
    trace?.step('Accessory load assumed from temperature', {
        formula: 'P = P_base + heat × max(0, T_lo − T) + cool × max(0, T − T_hi)',
        values: {
            comfort_band: val(comfortBand, '°F', 'knob:ACCESSORY_COMFORT_BAND_F'),
            P_base: val(baseW, 'W', 'knob:DEFAULT_ACCESSORY_W'),
            heat: val(heatWPerF, 'W/°F', 'knob:ACCESSORY_HEAT_W_PER_F'),
            cool: val(coolWPerF, 'W/°F', 'knob:ACCESSORY_COOL_W_PER_F'),
            T_lo: val(comfortBand[0], '°F', 'knob:ACCESSORY_COMFORT_BAND_F'),
            T_hi: val(comfortBand[1], '°F', 'knob:ACCESSORY_COMFORT_BAND_F'),
            T: val(t, '°F'),
        },
        result: watts, unit: 'W', assumed: true,
        note: 'no test records its heating or cooling; one line for every car',
    });
    return watts;
}

/**
 * The load a correction target carries: the reader's own setting when they
 * moved the slider (`accessoryW`), else what the temperature implies. `null` is
 * "auto" and is never stored as the number it resolves to, so the load keeps
 * following the temperature slider until the reader overrides it.
 */
export const effectiveAccessoryW = (target, opts) => {
    if (target?.accessoryW != null) {
        opts?.trace?.step('Accessory load, set by you', {
            values: { P: val(target.accessoryW, 'W', 'setting') }, result: target.accessoryW, unit: 'W',
        });
        return target.accessoryW;
    }
    return assumedAccessoryW(target?.temperatureF, opts);
};

/** Watt-hours a steady accessory draw costs per mile at a speed. */
export const accessoryWhPerMile = (watts, speedMph) => watts / speedMph;

/**
 * The factor to multiply a measured efficiency (and range) by, once the
 * traction share has been re-priced and the accessory load swapped for the
 * target's. See the header for the algebra.
 *
 * @param {Object} p
 * @param {number|null} p.consumptionWhMi  the test's own consumption; blank → ASSUMED_TEST_CONSUMPTION_WH_MI
 * @param {number} p.runW                  the accessory load the test is assumed to have carried
 * @param {number} p.runSpeedMph           the test's average moving speed (a mixed cycle's own)
 * @param {number} p.targetW               the accessory load of the target
 * @param {number} p.targetSpeedMph        the target speed
 * @param {number} p.tractionScale         L_target / L_run from the aero model, 1 = unchanged
 * @returns {{ factor: number|null, assumedConsumptionWhMi: number|null, skipped: string|null }}
 *   `factor` is null when the accessory share swallows the whole of the test's
 *   consumption, which no real test does and a mistyped one might — the caller
 *   then keeps the aero-only factor and says so.
 */
export function accessoryFactor({
    consumptionWhMi, runW, runSpeedMph, targetW, targetSpeedMph, tractionScale, trace = null,
}) {
    const measured = Number(consumptionWhMi);
    const known = consumptionWhMi != null && consumptionWhMi !== '' && Number.isFinite(measured) && measured > 0;
    const c = known ? measured : ASSUMED_TEST_CONSUMPTION_WH_MI;
    const runAccWhMi = accessoryWhPerMile(runW, runSpeedMph);
    const traction = c - runAccWhMi;
    trace?.step('Traction share of the test\'s consumption', {
        formula: 'D_run = C_run − P_run / v_run',
        values: {
            C_run: known ? val(c, 'Wh/mi', 'data') : val(c, 'Wh/mi', 'knob:ASSUMED_TEST_CONSUMPTION_WH_MI'),
            P_run: val(runW, 'W'), v_run: val(runSpeedMph, 'mph'),
        },
        result: traction, unit: 'Wh/mi', assumed: !known,
        note: known ? 'C_run is the test\'s own energy ÷ distance' : 'the test recorded no energy, so C_run is assumed',
    });
    if (!(traction > 0)) {
        return { factor: null, assumedConsumptionWhMi: null, skipped: 'more than the test used' };
    }
    const targetAccWhMi = accessoryWhPerMile(targetW, targetSpeedMph);
    const atTarget = traction * tractionScale + targetAccWhMi;
    trace?.step('Consumption at the target', {
        formula: 'C_target = D_run × s + P_target / v_target',
        values: { D_run: val(traction, 'Wh/mi'), s: tractionScale, P_target: val(targetW, 'W'), v_target: val(targetSpeedMph, 'mph', 'setting') },
        result: atTarget, unit: 'Wh/mi', note: 's = L_target / L_run, the aero model\'s re-pricing of traction',
    });
    trace?.step('Correction factor', {
        formula: 'k = C_run / C_target', values: { C_run: val(c, 'Wh/mi'), C_target: val(atTarget, 'Wh/mi') },
        result: c / atTarget, note: 'multiplies range and efficiency alike',
    });
    return {
        factor: c / atTarget,
        assumedConsumptionWhMi: known ? null : c,
        skipped: null,
    };
}

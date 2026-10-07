import { isListed, isExcluded } from './runListing';
import { buildEpaCurveFromModel, correctMeasuredConsumption } from './epaDerivations';
import { curveSubject } from './epaCurveSubjects';
import { filterRangeRuns } from './runUtils';
import { MPG_E_CONVERSION } from '../constants/units';

/**
 * One EPA link's modeled curve, and its vehicle's range tests laid over it, at
 * the chart's standard viewing conditions: what Modeled Efficiency draws when
 * it opens with the corrected overlay on and nothing adjusted.
 *
 * Built from the chart's own functions (buildEpaCurveFromModel,
 * correctMeasuredConsumption, curveSubject), so an explainer's preview and the
 * chart it links to cannot disagree. Pure: DataService supplies the rows,
 * useModeledEfficiency calls this.
 *
 * Two differences from the chart. Hidden and synthetic tests are left out: the
 * chart shows a curator everything, an explainer cites evidence. And range uses
 * the record's own energy (curveSubject), not the vehicle's spec fallback, so a
 * record with no energy of its own previews with no range rather than a borrowed one.
 */

/** Standard conditions: sea level, standard temperature, the record's own accessory load, still air, flat. */
export const STANDARD_VIEW = {
    densityRatio: 1,
    accessoryOverrideW: null,
    windSpeedMph: 0,
    windDirectionDeg: 0,
    elevationGainFt: 0,
    elevationDistanceMiles: 0,
};

const point = (mph, kwh100mi, useableKwh) => {
    const miPerKwh = 100 / kwh100mi;
    return {
        mph,
        kwh100mi,
        whMi: kwh100mi * 10,
        miPerKwh,
        mpge: miPerKwh * MPG_E_CONVERSION,
        rangeMi: useableKwh > 0 ? useableKwh / (kwh100mi / 100) : null,
    };
};

/**
 * @param {{ mappingId, vehicleId, vehicleName, epaGroup, runs }} row — DataService.getModeledEfficiencyPreview
 * @returns {null | { mappingId, vehicleId, vehicleName, label, tier, curve: Array, tests: Array }}
 */
export function modeledEfficiencyPreview(row) {
    const group = row?.epaGroup;
    const subject = group ? curveSubject(group) : null;
    if (!subject) return null;

    const useableKwh = subject.useableKwh;
    const curve = buildEpaCurveFromModel(group, useableKwh, STANDARD_VIEW.densityRatio)
        .map(p => point(p.mph, p.kwh100mi, useableKwh));
    if (!curve.length) return null;

    const tests = filterRangeRuns(row.runs)
        // Cited one by one, so listed tests only — never one a reader cannot
        // find, nor one kept out of the figures (#394, utils/runListing).
        .filter(r => !r.synthetic && isListed(r) && !isExcluded(r)
            && r.speed_mph != null && r.distance_miles > 0 && r.energy_kwh != null)
        .map(run => {
            const measured = (run.energy_kwh / run.distance_miles) * 100;
            const corrected = correctMeasuredConsumption(group, run.speed_mph, measured, {
                temperatureF: run.temperature_f,
                altitudeFt: run.altitude_ft,
                windSpeedMph: run.avg_wind_speed_mph,
                windDirectionDeg: run.wind_direction_deg,
                elevationGainFt: run.elevation_gain_ft,
                distanceMiles: run.distance_miles,
            }, STANDARD_VIEW);
            if (corrected == null) return null;
            return { id: run.id, name: run.name, source: run.source ?? null,
                measured: point(run.speed_mph, measured, useableKwh),
                ...point(run.speed_mph, corrected, useableKwh) };
        })
        .filter(Boolean);

    return {
        mappingId: row.mappingId,
        vehicleId: row.vehicleId,
        vehicleName: row.vehicleName,
        label: subject.label,
        tier: subject.tier,
        curve,
        tests,
    };
}

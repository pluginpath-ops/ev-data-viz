import { describe, it, expect } from 'vitest';
import { createTrace, substitute, traceNumber, val } from '../calcTrace';
import { correctionFactor, correctRunDistance } from '../conditionCorrection';
import { fullPackRange } from '../fullPackRange';
import { compositeRange } from '../compositeRange';
import { costToDriveVehicle, costToDriveComparison } from '../costToDrive';
import { normalizeCostToDrive } from '../costToDriveKey';
import { DEFAULT_COST_TO_DRIVE } from '../../constants/costToDrive';
import { miPerSocFrom, miPerKwhFrom, pairRangeSource } from '../rangeSource';
import { spreadEfficiency } from '../rangeTestSpread';
import { testedRangeSummary, testedEfficiency, whenNewRange } from '../testedRange';
import { VEHICLE_COLUMNS, isTracedColumn, buildVehicleRows, traceVehicleRow } from '../vehicleTable';
import { metricEntries, brakingGEntries } from '../performanceCompare';

// The rule this whole feature rests on: a trace records, it never steers. Each
// traced call must return exactly what the untraced one does.
//
// And the cost rule: with no trace, a traced function does nothing extra.
// Trace-only work sits inside `trace?.step(…)` arguments (skipped when trace
// is null) or an `if (trace)` block. These tests pin the first rule; the
// second is a review rule — keep new trace work behind one of those two.

const steps = (node) => node.children.flatMap(c => (c.type === 'group' ? steps(c) : c.type === 'step' ? [c] : []));

const CONDITIONS = [
    { speedMph: 75, altitudeFt: 1200, temperatureF: 40, whPerMile: 310 },
    { speedMph: 65, temperatureF: 95, windMph: 12, windDirDeg: 180, whPerMile: 260 },
    { speedMph: 70, windMph: 8, whPerMile: null },                       // blanks: assumed altitude/temperature/consumption
    { speedMph: 48, speedBasis: 'mixed', temperatureF: 20, whPerMile: 400 },
    { speedMph: 70, temperatureF: 70, whPerMile: 30 },                   // accessory swallows the test: skipped
];
const TARGETS = [
    { speedMph: 70, temperatureF: 70, altitudeFt: 0, accessoryW: null },
    { speedMph: 80, temperatureF: 20, altitudeFt: 5000, accessoryW: 2500 },
];

describe('tracing does not change a result', () => {
    it('correctionFactor, every mode, target and kind of blank', () => {
        for (const mode of ['none', 'aero', 'aero_wind']) {
            for (const target of TARGETS) {
                for (const c of CONDITIONS) {
                    const trace = createTrace();
                    expect(correctionFactor(c, { mode, target, trace })).toEqual(correctionFactor(c, { mode, target }));
                    if (mode !== 'none') expect(steps(trace.node).length).toBeGreaterThan(3);
                }
            }
        }
    });

    it('the Range chart pass: corrected distance, then the full-pack range', () => {
        const run = { id: 1, distance_miles: 212, energy_kwh: 64, start_soc: 95, end_soc: 12, speed_mph: 75, temperature_f: 41 };
        const vehicle = { socWindowKwh: 78 };
        for (const target of TARGETS) {
            const trace = createTrace();
            const traced = correctRunDistance(run, null, { mode: 'aero_wind', target }, trace);
            expect(traced).toEqual(correctRunDistance(run, null, { mode: 'aero_wind', target }));
            const corrected = { ...run, distance_miles: traced.distanceMiles };
            expect(fullPackRange(corrected, vehicle, trace)).toEqual(fullPackRange(corrected, vehicle));
            // The trace's last word is the figure the chart draws.
            expect(steps(trace.node).at(-1).result).toBeCloseTo(fullPackRange(corrected, vehicle).mi, 9);
        }
    });

    it('compositeRange', () => {
        const runs = [
            { id: 1, kind: 'range', distance_miles: 300, energy_kwh: 100, start_soc: 100, end_soc: 0, speed_mph: 70, temperature_f: 70 },
            { id: 2, kind: 'range', distance_miles: 150, energy_kwh: 52, start_soc: 90, end_soc: 40, speed_mph: 80, temperature_f: 30, altitude_ft: 2000 },
            { id: 3, kind: 'range', distance_miles: 100, energy_kwh: 30, speed_mph: 50, speed_basis: 'mixed', temperature_f: 70 },
        ];
        const car = { id: 1, socWindowKwh: 100, runs };
        for (const target of TARGETS) {
            const trace = createTrace();
            expect(compositeRange(car, { target, trace })).toEqual(compositeRange(car, { target }));
        }
    });

    it('Cost & Time: the vehicle profile and the comparison, both seasons', () => {
        const vehicle = {
            socWindowKwh: 75,
            epaRange: { hwyMi: 290 },
            runs: [{ id: 9, kind: 'range', distance_miles: 220, energy_kwh: 70, start_soc: 95, end_soc: 10, speed_mph: 70, temperature_f: 60 }],
            specs: { charging: { max_dc_kw: 170 } },
        };
        for (const over of [{}, { season: 'summer', level: 0 }, { efficiencyFrom: 'epa', week: 'LLLLLLL' }]) {
            const settings = normalizeCostToDrive({ ...DEFAULT_COST_TO_DRIVE, ...over });
            const trace = createTrace();
            const traced = costToDriveVehicle(vehicle, settings, { trace });
            const plain = costToDriveVehicle(vehicle, settings);
            // `fast.minutes` is a closure: compare what it answers, not its identity.
            const { fast: tf, ...tRest } = traced;
            const { fast: pf, ...pRest } = plain;
            expect(tRest).toEqual(pRest);
            expect(tf.basis).toBe(pf.basis);
            expect(tf.minutes(12, 63)).toBe(pf.minutes(12, 63));
            expect(costToDriveComparison(traced, settings, { trace })).toEqual(costToDriveComparison(plain, settings));
            expect(trace.constants.has('DC_FAST_LOSS')).toBe(true);
        }
    });

    const rangeRun = (over = {}) => ({
        id: 7, kind: 'range', distance_miles: 270, energy_kwh: 74,
        start_soc: 98, end_soc: 3, speed_mph: 72, temperature_f: 48, altitude_ft: 900, ...over,
    });

    it('range basis: mi per % SoC, mi per kWh, and the Charge Stop pairing', () => {
        const runs = [rangeRun(), rangeRun({ energy_kwh: null }), rangeRun({ start_soc: null, end_soc: null })];
        for (const run of runs) {
            expect(miPerSocFrom(run, createTrace())).toEqual(miPerSocFrom(run));
            expect(miPerKwhFrom(run, 84, createTrace())).toEqual(miPerKwhFrom(run, 84));
            expect(spreadEfficiency(run, 84, createTrace())).toEqual(spreadEfficiency(run, 84));
        }
        const vehicle = { id: 3, socWindowKwh: 84, epaRangeMi: 318, runs };
        const charging = { id: 50, kind: 'charging', vehicle_id: 3 };
        for (const target of TARGETS) {
            for (const mode of ['none', 'aero_wind']) {
                const correction = { mode, target };
                const trace = createTrace();
                expect(pairRangeSource(charging, runs[0], { vehicle, correction, trace }))
                    .toEqual(pairRangeSource(charging, runs[0], { vehicle, correction }));
                expect(steps(trace.node).length).toBeGreaterThan(0);
            }
        }
    });

    it('tested range, tested efficiency and when-new range (capacity below the threshold)', () => {
        for (const basis of ['usable', 'epa-tested', 'gross']) {
            const vehicle = { id: 3, socWindowKwh: 84, socWindowBasis: basis, epaRangeMi: 318, runs: [rangeRun()] };
            const trace = createTrace();
            expect(testedRangeSummary(vehicle, trace)).toEqual(testedRangeSummary(vehicle));
            expect(testedEfficiency(vehicle, trace)).toEqual(testedEfficiency(vehicle));
            expect(whenNewRange(vehicle, trace)).toEqual(whenNewRange(vehicle));
        }
        // 74 kWh over 95% implies ~78 kWh of 84: retention ~0.93, so a when-new range is shown.
        const trace = createTrace();
        const r = whenNewRange({ socWindowKwh: 84, socWindowBasis: 'usable', runs: [rangeRun()] }, trace);
        expect(r.retention).toBeLessThan(0.95);
        expect(steps(trace.node).at(-1).result).toBeCloseTo(r.whenNewMi, 9);
    });

    it('a vehicle table row: every worked-out column', () => {
        const columns = VEHICLE_COLUMNS.map(c => c.key).filter(isTracedColumn);
        const vehicles = [
            { id: 1, name: 'A', make: 'M', specs: {}, tags: [], epa_mappings: [], socWindowKwh: 84, socWindowBasis: 'usable', epaRangeMi: 318, epaRange: { hwyMi: 300 }, runs: [rangeRun()] },
            { id: 2, name: 'B', make: 'M', specs: {}, tags: [], epa_mappings: [], runs: [] },
        ];
        for (const correctionMode of ['none', 'aero_wind']) {
            const opts = { correctionMode };
            const rows = buildVehicleRows(vehicles, opts);
            for (const [i, v] of vehicles.entries()) {
                const trace = createTrace();
                expect(traceVehicleRow(v, vehicles, opts, { trace, columns })).toEqual(rows[i]);
            }
        }
    });

    it('Performance › Compare: scalars, windows from splits, braking in g', () => {
        const bucket = {
            sessions: [{ source_name: null, performance_runs: [
                { zero_to_60_sec: 3.2, drive_mode: 'Sport', performance_run_points: [
                    { label: '0-30', speed_mph: 30, elapsed_s: 1.4 }, { label: '0-50', speed_mph: 50, elapsed_s: 2.5 },
                    { label: '1/4', speed_mph: 115, elapsed_s: 11.2 },
                ] },
                { zero_to_60_sec: 3.1, drive_mode: 'Sport', slope_pct: 2, performance_run_points: [] },
            ] }],
            summaries: [{ source_name: 'Mag', zero_to_60_sec: 3.0, quarter_mile_sec: 11.0, quarter_mile_trap_mph: 118, performance_intervals: [
                { kind: 'braking', from_speed: 70, to_speed: 0, speed_unit: 'mph', distance: 155, distance_unit: 'ft' },
                { kind: 'braking', from_speed: 100, to_speed: 0, speed_unit: 'kph', distance: 34, distance_unit: 'm' },
                { kind: 'passing', from_speed: 30, to_speed: 50, speed_unit: 'mph', elapsed_s: 1.2 },
            ] }],
        };
        const cases = [['zero_to_60_sec', 'accel'], ['quarter_mile_sec', 'drag'], ['passing:30-50mph', 'passing'], ['braking:70-0mph', 'braking']];
        for (const origin of ['all', 'session', 'published']) {
            for (const [key, cat] of cases) {
                const trace = createTrace();
                expect(metricEntries(bucket, key, cat, origin, trace)).toEqual(metricEntries(bucket, key, cat, origin));
            }
            const trace = createTrace();
            expect(brakingGEntries(bucket, origin, trace)).toEqual(brakingGEntries(bucket, origin));
        }
        const trace = createTrace();
        metricEntries(bucket, 'passing:30-50mph', 'passing', 'all', trace);
        expect(trace.constants.has('G_MS2')).toBe(true);
    });
});

describe('the trace itself', () => {
    it('puts each value in its place, whole names only', () => {
        const values = [{ name: 'v', v: 70 }, { name: 'v_ref', v: 70 }, { name: 'f', v: 0.7 }, { name: 'ρ', v: 1.05 }];
        expect(substitute('L = f × (v / v_ref)² × ρ + (1 − f)', values, traceNumber))
            .toBe('L = 0.7 × (70 / 70)² × 1.05 + (1 − 0.7)');
    });

    it('collects each constant once, by key', () => {
        const trace = createTrace();
        trace.step('a', { values: { f: val(0.7, null, 'knob:AERO_FRACTION') } });
        trace.group('b').step('c', { values: { f: val(0.7, null, 'knob:AERO_FRACTION'), x: val(40, 'mph', 'code:DETOUR_MPH') } });
        expect([...trace.constants.keys()]).toEqual(['AERO_FRACTION', 'DETOUR_MPH']);
    });
});

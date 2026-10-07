/**
 * What a figure's test IS, for a reader who wants to check it (#335 follow-up).
 *
 * A tested figure in the vehicle table carries a short note beneath it — "Out
 * of Spec · 50°F", "70 mph · 72°F · scaled from 100→5%". That note is a claim
 * about a test, and the natural thing to do with a claim is to open it. So
 * every figure that stands on a test carries a TEST REFERENCE: enough to say
 * which test, why that one, and under what conditions, and where it lives on
 * the site, so the note can link to it and a peek can restate it.
 *
 * The link stays on EVBench — the test in Tests & Data, where its conditions,
 * its chart and its source link all are — rather than jumping to the video.
 *
 * Pure module: no data access, no React.
 */
import { REPORTED_RANGE_REASON } from './testedRange';
import { fmtSpeed, fmtDistance } from './unitConversions';
import { preconditionedFact } from './runPreconditioning';
import { chargerClassFact } from './runChargerClass';

/**
 * @typedef {Object} TestReference
 * @property {number|string} vehicleId
 * @property {number|string|null} runId   the test's run, or null where the
 *           destination has no per-test card to land on (performance)
 * @property {'tests'|'performance'} sub  the Tests & Data sub-tab it lives on
 * @property {string} title               the test's name
 * @property {string|null} reason         why this test stands for the vehicle
 * @property {Array<{label: string, value: string}>} facts
 * @property {string|null} [caveat]      what the figure cannot claim, when it matters
 */

const temperature = (f, units) => (units === 'metric' ? `${Math.round((f - 32) * 5 / 9)}°C` : `${Math.round(f)}°F`);
const fact = (label, value) => (value == null || value === '' ? null : { label, value: String(value) });
const round1 = (n) => Math.round(n * 10) / 10;

/** Date, source and temperature: what every test has to say first. */
const commonFacts = (run, units) => [
    fact('Date', run.date),
    fact('Source', run.source),
    fact('Temperature', run.temperature_f != null && run.temperature_f !== '' ? temperature(Number(run.temperature_f), units) : null),
];

/**
 * The reported range test, behind Tested range and Tested efficiency.
 *
 * @param {Object} vehicle
 * @param {Object} t  testedRangeSummary or testedEfficiency output
 * @param {'range'|'efficiency'} [figure]  which figure the reference sits
 *        behind, which decides the caveat: a narrow window costs a range its
 *        claim and costs an efficiency nothing
 */
export function rangeTestReference(vehicle, t, units = 'imperial', figure = 'range') {
    if (!t?.run) return null;
    const run = t.run;
    const speed = t.speedMph != null ? `${fmtSpeed(t.speedMph, units)}${t.speedNote ? ` (${t.speedNote})` : ''}` : null;
    const window = t.startSoc != null && t.endSoc != null ? `${t.startSoc}→${t.endSoc}%` : null;
    return {
        vehicleId: vehicle.id,
        runId: run.id,
        sub: 'tests',
        title: run.name || 'Range test',
        reason: REPORTED_RANGE_REASON[t.reason] ?? null,
        facts: [
            ...commonFacts(run, units),
            fact('Speed', speed),
            fact('Window', window),
            fact('Distance', run.distance_miles > 0 ? fmtDistance(run.distance_miles, units) : null),
            fact('Energy used', run.energy_kwh > 0 ? `${round1(Number(run.energy_kwh))} kWh` : null),
            fact('Full pack', t.isScaled && t.fullPackMi != null ? `${fmtDistance(t.fullPackMi, units)}, scaled from the window` : null),
        ].filter(Boolean),
        caveat: figure === 'efficiency'
            ? (t.estimated ? 'The test logged no energy, so it is estimated from the window and the battery.' : null)
            : t.startSoc == null ? 'The test does not record its state-of-charge window.'
            : t.isScaled ? 'Scaled to a full pack assuming consumption is flat across it.'
            : t.isRepresentative === false ? 'The window is too narrow to scale to a full pack, so no range is claimed from it.'
            : null,
    };
}

/**
 * The charging test a charge time over the reader's window comes from.
 *
 * @param {Object} tested  chargeTimeSession output, with a run
 * @param {{from: number, to: number}} window
 */
export function chargeTimeTestReference(vehicle, tested, { from, to }, units = 'imperial') {
    if (!tested?.run) return null;
    const run = tested.run;
    const summary = run.charge_summary ?? {};
    return {
        vehicleId: vehicle.id,
        runId: run.id,
        sub: 'tests',
        title: run.name || 'Charging test',
        reason: tested.isDefault
            ? 'The default charging test'
            : `The newest charging test that covers ${from}→${to}%`,
        facts: [
            ...commonFacts(run, units),
            fact(`${from}→${to}%`, `${Math.round(tested.minutes)} min`),
            fact('Preconditioned', preconditionedFact(run.preconditioned)),
            fact('Charger', chargerClassFact(run.charger_voltage_class)),
            fact('Started at', summary.startSoc != null ? `${summary.startSoc}%` : null),
            fact('Peak', summary.peakKw != null ? `${Math.round(summary.peakKw)} kW` : null),
            fact('Session', summary.durationMin != null ? `${Math.round(summary.durationMin)} min` : null),
        ].filter(Boolean),
    };
}

/**
 * The charging test that set a vehicle's best average over a window.
 *
 * @param {Object} best  one entry of bestChargeWindows
 * @param {number} minutes  the window's length
 */
export function chargeBestTestReference(vehicle, best, minutes, units = 'imperial') {
    if (!best?.runId) return null;
    const sat = best.startSoc != null && best.endSoc != null
        ? `${best.startSoc}→${best.endSoc}%${best.startMin != null ? `, from minute ${best.startMin}` : ''}`
        : null;
    return {
        vehicleId: vehicle.id,
        runId: best.runId,
        sub: 'tests',
        title: best.runName || 'Charging test',
        reason: `The best ${minutes}-minute average across the vehicle’s charging tests`,
        facts: [
            fact('Date', best.date),
            fact('Source', best.source),
            fact('Temperature', best.temperatureF != null ? temperature(best.temperatureF, units) : null),
            fact('Preconditioned', preconditionedFact(best.preconditioned)),
            fact('Window', sat),
            fact('Covered', best.spanMin != null ? `${best.spanMin} min — the whole session` : null),
            fact('Started at', best.sessionStartSoc != null ? `${best.sessionStartSoc}%` : null),
            fact('Peak', best.sessionPeakKw != null ? `${Math.round(best.sessionPeakKw)} kW` : null),
            fact('Time', best.timeDerived ? 'worked out from SoC and power, not logged' : null),
        ].filter(Boolean),
    };
}

/**
 * The source of a tested performance figure. Performance results have no
 * per-test card, so the reference lands on the vehicle's Performance sub-tab.
 *
 * @param {Object} result  deriveTested output with a value
 */
export function performanceTestReference(vehicle, result) {
    if (result?.value == null) return null;
    const basis = result.basis ?? {};
    const others = (basis.all?.length ?? 1) - 1;
    return {
        vehicleId: vehicle.id,
        runId: null,
        sub: 'performance',
        title: basis.sourceName || 'Tested result',
        reason: others > 0 ? `The best of ${others + 1} results on record` : 'The only result on record',
        facts: [
            fact('Kind', basis.origin === 'session' ? 'EVBench session data' : 'Published figure'),
            fact('Trim', basis.trim_label),
        ].filter(Boolean),
    };
}

/**
 * Where a test reference lives, as a query string — a real href, so opening
 * it in a new tab works. The app intercepts a plain click and navigates
 * without a reload.
 */
export function testHref(ref) {
    if (!ref) return null;
    // The sub-tab always, even the default: without it the app keeps whichever
    // sub-tab was last open, and a test link could land on EPA.
    const p = new URLSearchParams({ tab: 'runs', vid: String(ref.vehicleId), sub: ref.sub ?? 'tests' });
    if (ref.runId != null) p.set('run', String(ref.runId));
    return `?${p.toString()}`;
}

import { describe, it, expect } from 'vitest';
import {
    buildComposite, compositeCurves, compositeEligible, chargerClassOf, resampleBySoc, testSpread,
    smoothAlongSoc, SMOOTHING_HALF_WINDOW, SMOOTHING_MAX_GAP, compositeNote,
    planCompositeRebuild, compositeFingerprint, staleComposites, COMPOSITE_VERSION,
    compositeLabel, compositeConditions, PLATEAU_SHARE, HELD_BACK_MARGIN,
} from '../compositeCurve';

/**
 * A test sampled at every whole % from `from` to `to`, power from `kwAt(soc)`.
 * Time follows from power on a 100 kWh pack: 1% is 1 kWh, so a minute per %
 * at 60 kW.
 */
const test = ({ from = 10, to = 80, kwAt }) => {
    const pts = [];
    let t = 0;
    for (let soc = from; soc <= to; soc++) {
        const kw = kwAt(soc);
        pts.push({ soc, chargeRate: kw, time: Math.round(t * 1000) / 1000 });
        t += 60 / kw;
    }
    return pts;
};

/** The car's own curve: 400 kW to 30%, then a taper to 100 kW at 80%. */
const car = (soc) => (soc <= 30 ? 400 : 400 - (soc - 30) * 6);
/** The same car on a charger that holds it to 190 kW (a current limit, sloping slightly). */
const onLesserCharger = (soc) => Math.min(car(soc), 180 + soc * 0.2);

const run = (id, extra = {}) => ({ id, name: `test ${id}`, kind: 'charging', ...extra });
const at = (curve, soc) => curve.points.find(p => p.soc === soc);

describe('resampleBySoc', () => {
    it('reads each whole percent inside the data and nothing past it', () => {
        const m = resampleBySoc([{ soc: 10.5, chargeRate: 100, time: 0 }, { soc: 12.5, chargeRate: 200, time: 1 }]);
        expect([...m.keys()]).toEqual([11, 12]);
        expect(m.get(11).kw).toBeCloseTo(125);
    });

    it('takes the opening ramp off — the handshake describes the plug, not the car', () => {
        const pts = [{ soc: 10, chargeRate: 90, time: 0 }, ...test({ from: 11, to: 20, kwAt: () => 220 })
            .map(p => ({ ...p, time: p.time + 0.3 }))];
        expect(resampleBySoc(pts).has(10)).toBe(false);
        expect(resampleBySoc(pts).get(11).kw).toBe(220);
    });

    it('keeps the first reading of a SoC a logger repeats', () => {
        const m = resampleBySoc([
            { soc: 10, chargeRate: 200, time: 0 }, { soc: 11, chargeRate: 210, time: 0.2 },
            { soc: 11, chargeRate: 215, time: 0.4 }, { soc: 12, chargeRate: 220, time: 0.6 },
        ]);
        expect(m.get(11).kw).toBe(210);
    });
});

describe('buildComposite', () => {
    it('is the mean where the tests agree', () => {
        const c = buildComposite([
            { run: run(1), points: test({ kwAt: s => car(s) + 10 }) },
            { run: run(2), points: test({ kwAt: s => car(s) - 10 }) },
        ]);
        expect(at(c, 50).chargeRate).toBeCloseTo(car(50));
        expect(at(c, 50).n).toBe(2);
        expect(c.heldBack).toEqual([]);
    });

    it('is not offered from one test — at n = 1 the composite IS the test', () => {
        expect(buildComposite([{ run: run(1), points: test({ kwAt: car }) }])).toBeNull();
    });

    it('sets a charger-limited test aside where it was held back, and counts it once the car takes over', () => {
        // The iX3: ~190 on a Supercharger, ~400 on an 800 V charger, agreeing
        // once the taper falls below the lesser charger's limit (~65%).
        const c = buildComposite([
            { run: run('fast'),   points: test({ kwAt: car }) },
            { run: run('stall'),  points: test({ kwAt: onLesserCharger }) },
        ]);
        // A plain mean would say ~295 here — a session nobody had.
        expect(at(c, 20).chargeRate).toBe(400);
        expect(at(c, 20).n).toBe(1);
        // Past the meeting point the lesser charger no longer limits: both count.
        expect(at(c, 75).n).toBe(2);
        expect(at(c, 75).chargeRate).toBeCloseTo(car(75));
        const [span] = c.heldBack;
        expect(span).toMatchObject({ runId: 'stall', from: 10 });
        expect(span.to).toBeGreaterThan(50);
        expect(span.to).toBeLessThan(65);
    });

    it('keeps a cold session in: it reads low, but it climbs instead of holding a ceiling', () => {
        // Warming from 120 kW at 10% to the car's curve by 40%: below its own
        // peak where it is outdrawn, so nothing marks it as charger-limited.
        const cold = (s) => (s < 40 ? Math.min(car(s), 120 + (s - 10) * 8) : car(s));
        const c = buildComposite([
            { run: run('warm'), points: test({ kwAt: car }) },
            { run: run('cold'), points: test({ kwAt: cold }) },
        ]);
        expect(at(c, 20).n).toBe(2);
        expect(at(c, 20).chargeRate).toBeCloseTo((car(20) + cold(20)) / 2);
    });

    it('extends past the shortest test with fewer contributors, and says so on every point', () => {
        const c = buildComposite([
            { run: run(1), points: test({ to: 80, kwAt: car }) },
            { run: run(2), points: test({ to: 50, kwAt: car }) },
        ]);
        expect(at(c, 50).n).toBe(2);
        expect(at(c, 51).n).toBe(1);
        expect(c.points.at(-1).soc).toBe(80);
    });

    it('averages minutes per percent, so no pack capacity is assumed', () => {
        // 100 kW and 110 kW on a 100 kWh pack: 0.6 and 0.545 minutes per
        // percent. (Close enough that neither reads as charger-limited.)
        const c = buildComposite([
            { run: run(1), points: test({ from: 10, to: 20, kwAt: () => 100 }) },
            { run: run(2), points: test({ from: 10, to: 20, kwAt: () => 110 }) },
        ]);
        expect(at(c, 10).time).toBe(0);
        expect(at(c, 20).time).toBeCloseTo(10 * (0.6 + 60 / 110) / 2, 1);
    });

    it('stops the clock rather than guess across a gap no test timed', () => {
        const untimed = test({ kwAt: car }).map(p => ({ ...p, time: null }));
        const c = buildComposite([{ run: run(1), points: untimed }, { run: run(2), points: untimed }]);
        expect(at(c, 10).time).toBe(0);
        expect(at(c, 11).time).toBeNull();
        expect(at(c, 50).chargeRate).toBeCloseTo(car(50));
    });

    it('reports the conditions it was drawn from', () => {
        const c = buildComposite([
            { run: run(1, { temperature_f: 65, preconditioned: true }),  points: test({ kwAt: car }) },
            { run: run(2, { temperature_f: 80, preconditioned: null }),  points: test({ kwAt: car }) },
        ]);
        expect(compositeConditions(c)).toBe('65–80°F · 1 of 2 preconditioned');
        expect(compositeConditions(c, 'metric')).toBe('18.3–26.7°C · 1 of 2 preconditioned');
    });

    it('keeps its thresholds in a sane relation', () => {
        // A ceiling reading must be outdrawable by a test still on ITS ceiling,
        // or the inference can never fire between two plateaus.
        expect(PLATEAU_SHARE * HELD_BACK_MARGIN).toBeLessThan(1);
    });
});

describe('compositeCurves', () => {
    const vehicleOf = (classV, runs) => ({
        id: 'v', runs, platforms: { electrical: classV ? { voltage_class_v: classV } : null }, specs: {},
    });
    const fast = () => test({ kwAt: car });
    const slow = () => test({ kwAt: onLesserCharger });

    it('draws an 800 V car once per charger class, from what was recorded', () => {
        const runs = [run(1), run(2), run(3, { charger_voltage_class: 400 }), run(4, { charger_voltage_class: 400 })];
        const { curves, setAside } = compositeCurves(vehicleOf(800, runs), { 1: fast(), 2: fast(), 3: slow(), 4: slow() });
        expect(curves.map(c => c.chargerClassV)).toEqual([800, 400]);
        expect(compositeLabel(curves[0])).toBe('composite on 800 V chargers (2 tests)');
        expect(compositeLabel(curves[1])).toBe('composite on 400 V chargers (2 tests)');
        expect(at(curves[0], 20).chargeRate).toBe(400);
        // The 400 V curve is the car on a Supercharger, not a damaged 800 V one.
        expect(at(curves[1], 20).chargeRate).toBeCloseTo(onLesserCharger(20));
        expect(curves.flatMap(c => c.inferredTests)).toEqual([]);
        expect(setAside).toEqual([]);
    });

    it('works out the class from the curve when nobody recorded it — the iX3 case', () => {
        const runs = [run(1), run(2), run(3), run(4)];
        const { curves } = compositeCurves(vehicleOf(800, runs), { 1: fast(), 2: fast(), 3: slow(), 4: slow() });
        expect(curves.map(c => c.chargerClassV)).toEqual([800, 400]);
        expect(curves[1].tests.map(t => t.runId)).toEqual([3, 4]);
        expect(curves[1].inferredTests).toEqual(['test 3', 'test 4']);
    });

    it('lets a recorded class win over the curve', () => {
        // Held down like a 400 V charger, but recorded on an 800 V one (a
        // power-limited unit): it stays with the 800 V tests.
        const runs = [run(1), run(2), run(3, { charger_voltage_class: 800 })];
        const classes = chargerClassOf(runs.map(r => ({ run: r, points: r.id === 3 ? slow() : fast() })), 800);
        expect(classes.get(3)).toEqual({ classV: 800, inferred: false });
    });

    it('names a class with one test rather than averaging it in — the Gravity case', () => {
        const runs = [run(1), run(2), run(3, { charger_voltage_class: 400 })];
        const { curves, setAside } = compositeCurves(vehicleOf(800, runs), { 1: fast(), 2: fast(), 3: slow() });
        expect(curves).toHaveLength(1);
        expect(curves[0].tests.map(t => t.runId)).toEqual([1, 2]);
        expect(setAside).toEqual([expect.objectContaining({ runId: 3, reason: expect.stringContaining('only test on 400 V chargers') })]);
    });

    it('does not split a 400 V car: its slow stalls are left out where they held it back', () => {
        const { curves } = compositeCurves(vehicleOf(400, [run(1), run(2)]), { 1: fast(), 2: slow() });
        expect(curves).toHaveLength(1);
        expect(curves[0].chargerClassV).toBeNull();
        expect(compositeLabel(curves[0])).toBe('composite (2 tests)');
        expect(curves[0].heldBack[0].runId).toBe(2);
    });

    it('does not split when the car\'s own class is unknown', () => {
        const { curves } = compositeCurves(vehicleOf(null, [run(1), run(2, { charger_voltage_class: 400 })]), { 1: fast(), 2: fast() });
        expect(curves).toHaveLength(1);
        expect(curves[0].tests).toHaveLength(2);
    });

    it('names a vehicle\'s only test when no composite can be drawn', () => {
        const { curves, setAside } = compositeCurves(vehicleOf(400, [run(1)]), { 1: fast() });
        expect(curves).toEqual([]);
        expect(setAside[0].reason).toMatch(/only test/);
    });

    it('reports eligible tests whose points are not loaded yet', () => {
        const { missing } = compositeCurves(vehicleOf(800, [run(1), run(2)]), { 1: fast() });
        expect(missing).toEqual([2]);
    });
});

describe('stored as runs (migration 077)', () => {
    const vehicleOf = (classV, runs) => ({
        id: 48, runs, platforms: { electrical: classV ? { voltage_class_v: classV } : null }, specs: {},
    });
    const stored = (id, classV) => ({ id, kind: 'charging', synthetic: true, composite: { chargerClassV: classV } });
    const pts = () => ({ 1: test({ kwAt: car }), 2: test({ kwAt: car }), 3: test({ kwAt: onLesserCharger }), 4: test({ kwAt: onLesserCharger }) });

    it('inserts one run per composite the tests support, named for the picker', () => {
        const { writes, deletes } = planCompositeRebuild(vehicleOf(800, [run(1), run(2), run(3), run(4)]), pts());
        expect(writes.map(w => [w.id, w.name])).toEqual([
            [null, 'Composite on 800 V chargers (2 tests)'],
            [null, 'Composite on 400 V chargers (2 tests)'],
        ]);
        expect(writes[0].composite).toMatchObject({ chargerClassV: 800, version: COMPOSITE_VERSION });
        expect(writes[0].points.length).toBeGreaterThan(0);
        expect(deletes).toEqual([]);
    });

    it('rebuilds in place, so a composite keeps its id, DEF tag and pairings', () => {
        const runs = [run(1), run(2), run(3), run(4), stored(900, 800), stored(901, 400)];
        const { writes, deletes } = planCompositeRebuild(vehicleOf(800, runs), pts());
        expect(writes.map(w => w.id)).toEqual([900, 901]);
        expect(deletes).toEqual([]);
    });

    it('deletes a stored composite no class supports any more', () => {
        // Test 4 hidden: the 400 V class is down to one test.
        const runs = [run(1), run(2), run(3), run(4, { is_hidden: true }), stored(900, 800), stored(901, 400)];
        const { writes, deletes } = planCompositeRebuild(vehicleOf(800, runs), pts());
        expect(writes.map(w => w.id)).toEqual([900]);
        expect(deletes).toEqual([901]);
    });

    it('never feeds a stored composite back into itself', () => {
        expect(compositeEligible(stored(900, 800))).toBe(false);
        expect(compositeEligible({ ...run(5), composite: { chargerClassV: null } })).toBe(false);
    });

    it('is out of date when a test changes, or the method does', () => {
        const runs = [run(1), run(2)];
        const v = vehicleOf(400, runs);
        const fresh = { ...stored(900, null), composite: { chargerClassV: null, version: COMPOSITE_VERSION, fingerprint: compositeFingerprint(v) } };
        expect(staleComposites({ ...v, runs: [...runs, fresh] })).toEqual([]);
        const edited = [run(1), run(2, { charger_voltage_class: 400 })];
        expect(staleComposites({ ...v, runs: [...edited, fresh] })).toHaveLength(1);
        const old = { ...fresh, composite: { ...fresh.composite, version: COMPOSITE_VERSION - 1 } };
        expect(staleComposites({ ...v, runs: [...runs, old] })).toHaveLength(1);
    });

    it('notes what it was drawn from and what it left out, in one line', () => {
        const curve = {
            conditions: { tempMinF: 65, tempMaxF: 65, preconditioned: { yes: 1, no: 0, unknown: 1 } },
            inferredTests: ['SC'], heldBack: [{ name: 'SC', from: 56, to: 56 }, { name: 'B', from: 10, to: 40 }],
        };
        expect(compositeNote(curve)).toBe(
            '65°F · 1 of 2 preconditioned · charger class read from the curve, not recorded: SC'
            + ' · charger-limited stretches left out: SC 56%, B 10–40%');
    });
});

describe('smoothAlongSoc', () => {
    const line = (from, to, f) => Array.from({ length: to - from + 1 }, (_, i) => ({ soc: from + i, chargeRate: f(from + i) }));

    it('turns a step where a test joins or leaves into a ramp', () => {
        const pts = smoothAlongSoc(line(10, 40, s => (s < 25 ? 200 : 170)), ['chargeRate']);
        const steps = pts.slice(1).map((p, i) => Math.abs(p.chargeRate - pts[i].chargeRate));
        expect(Math.max(...steps)).toBeLessThanOrEqual(30 / (2 * SMOOTHING_HALF_WINDOW + 1) + 0.1);
        expect(pts[0].chargeRate).toBe(200);
        expect(pts.at(-1).chargeRate).toBe(170);
    });

    it('leaves a straight taper where it is, ends included', () => {
        const pts = smoothAlongSoc(line(40, 80, s => 400 - 4 * s), ['chargeRate']);
        pts.forEach(p => expect(p.chargeRate).toBeCloseTo(400 - 4 * p.soc));
    });

    it('never reaches across a gap wider than the limit', () => {
        const pts = smoothAlongSoc([
            ...line(10, 20, () => 300),
            ...line(20 + SMOOTHING_MAX_GAP + 1, 45, () => 100),
        ], ['chargeRate']);
        expect(pts.find(p => p.soc === 20).chargeRate).toBe(300);
        expect(pts.find(p => p.soc === 20 + SMOOTHING_MAX_GAP + 1).chargeRate).toBe(100);
    });

    it('keeps a missing spread missing, and never averages it in', () => {
        const pts = line(10, 20, () => 0).map(p => ({ ...p, spreadHi: p.soc < 15 ? 250 : null }));
        smoothAlongSoc(pts, ['spreadHi']);
        expect(pts.find(p => p.soc === 16).spreadHi).toBeNull();
        expect(pts.find(p => p.soc === 13).spreadHi).toBe(250);
    });
});

describe('testSpread', () => {
    it('runs from the best test down to one sample standard deviation below the mean', () => {
        // 200, 220, 240: mean 220, sample SD 20.
        expect(testSpread([200, 220, 240])).toEqual({ hi: 240, lo: 200 });
    });

    it('has no spread for one test — a zero-width one would claim agreement', () => {
        expect(testSpread([220])).toBeNull();
        expect(testSpread([])).toBeNull();
    });

    it('rides on every composite point that has two readings, and only those', () => {
        const c = buildComposite([
            { run: run(1), points: test({ to: 80, kwAt: s => car(s) + 10 }) },
            { run: run(2), points: test({ to: 50, kwAt: s => car(s) - 10 }) },
        ]);
        const p = at(c, 40);
        expect(p.spreadHi).toBeCloseTo(car(40) + 10);
        expect(p.spreadLo).toBeCloseTo(car(40) - Math.SQRT2 * 10, 0);
        expect(at(c, 60)).toMatchObject({ n: 1, spreadHi: null, spreadLo: null });
    });
});

describe('compositeEligible', () => {
    it('takes measured charging tests only', () => {
        expect(compositeEligible(run(1))).toBe(true);
        expect(compositeEligible(run(1, { kind: 'range' }))).toBe(false);
        expect(compositeEligible(run(1, { is_hidden: true }))).toBe(false);
        expect(compositeEligible(run(1, { synthetic: true }))).toBe(false);
        expect(compositeEligible(run('inherited_3_9'))).toBe(false);
    });
});

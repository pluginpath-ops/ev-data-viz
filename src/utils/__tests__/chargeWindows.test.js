import { describe, it, expect } from 'vitest';
import {
    summarizeChargeSession, bestChargeWindows, countsTowardBest, isCurrentSummary, CHARGE_SUMMARY_VERSION,
    minutesBetween, chargeTimeSession,
} from '../chargeWindows';

/** A session sampled every `step` minutes, power from `kwAt(t)`, SoC rising 1%/min from `soc0`. */
const session = ({ minutes = 30, step = 0.5, kwAt = () => 100, soc0 = 10 } = {}) => {
    const pts = [];
    for (let t = 0; t <= minutes + 1e-9; t += step) {
        pts.push({ time: Math.round(t * 100) / 100, chargeRate: kwAt(t), soc: soc0 + t });
    }
    return pts;
};

describe('summarizeChargeSession', () => {
    it('averages a flat curve to its own power', () => {
        const s = summarizeChargeSession(session({ kwAt: () => 150 }));
        expect(s.version).toBe(CHARGE_SUMMARY_VERSION);
        for (const w of [5, 10, 15]) expect(s.windows[w].kw).toBe(150);
        expect(s).toMatchObject({ durationMin: 30, startSoc: 10, peakKw: 150 });
    });

    it('finds a boost window, and where it sat', () => {
        // 250 kW for minutes 4–9, 120 kW otherwise: the 5-minute best is the boost.
        const s = summarizeChargeSession(session({ step: 0.25, kwAt: t => (t >= 4 && t <= 9 ? 250 : 120) }));
        expect(s.windows[5].kw).toBeCloseTo(250, 0);
        expect(s.windows[5].startSoc).toBe(14);
        expect(s.windows[5].endSoc).toBe(19);
        // The 15-minute best holds the whole boost and some of the rest.
        expect(s.windows[15].kw).toBeGreaterThan(120);
        expect(s.windows[15].kw).toBeLessThan(s.windows[5].kw);
    });

    it('places a window between samples, interpolating power across the partial stretches', () => {
        // Power climbs 20 kW a minute to 200 at minute 10, sampled every 2
        // minutes, then drops to 0 by minute 11. The best 5 minutes starts
        // near 5.45 — between the samples at 4 and 6 — and averages ~154.5 kW.
        // Snapped to samples, the best would read 150 (from 5) or 148 (from 6).
        const pts = [0, 2, 4, 6, 8, 10].map(t => ({ time: t, chargeRate: 20 * t, soc: 10 + t }));
        pts.push({ time: 11, chargeRate: 0, soc: 21 });
        const win = summarizeChargeSession(pts).windows[5];
        expect(win.startMin).toBeGreaterThan(4);
        expect(win.startMin).toBeLessThan(6);
        expect(win.kw).toBeCloseTo(154.5, 0);
        // Divided by the full 5 minutes, not by the span between the samples
        // inside it: a window from 5.5 holds power at 110 kW (interpolated
        // between 4 and 6) for its first half-minute.
        expect(win.kw).toBeGreaterThan(150);
    });

    it('weights by time, not by how densely a stretch was logged', () => {
        // Dense logging of a slow stretch must not drag down the average: 200 kW
        // for 10 minutes read every 2 minutes, then 100 kW logged every 6 seconds.
        const pts = [
            ...[0, 2, 4, 6, 8, 10].map(t => ({ time: t, chargeRate: 200, soc: 10 + t * 3 })),
            ...Array.from({ length: 101 }, (_, i) => ({ time: 10.1 + i * 0.1, chargeRate: 100, soc: 40 + i * 0.1 })),
        ];
        const s = summarizeChargeSession(pts);
        // Best 10 minutes is the first ten, at 200 — not the mean of 107 samples.
        expect(s.windows[10].kw).toBeCloseTo(200, 0);
    });

    it('refuses a window resting on a gap longer than half of it', () => {
        // Readings 3 minutes apart: fine for 10 and 15 (limits 5 and 7.5), not for 5 (2.5).
        const s = summarizeChargeSession(session({ step: 3 }));
        expect(s.windows[5]).toBeNull();
        expect(s.gaps[5]).toBe('gap');
        expect(s.windows[10].kw).toBe(100);
        expect(s.windows[15].kw).toBe(100);
    });

    it('lets a session a few seconds short of a window stand in for it, and says so', () => {
        // A "10% + 15 min" test that logged 14.7 minutes.
        const s = summarizeChargeSession(session({ minutes: 14.7, step: 0.1, kwAt: () => 180 }));
        expect(s.windows[15]).toMatchObject({ kw: 180, spanMin: 14.7, startSoc: 10, endSoc: 25 });
        expect(s.windows[10].spanMin).toBeUndefined();
        // 5% is the limit: 14.2 minutes is short for 15.
        expect(summarizeChargeSession(session({ minutes: 14.2, step: 0.1 })).gaps[15]).toBe('short');
        // And the gap rule still applies to a stand-in.
        const sparse = summarizeChargeSession([{ time: 0, chargeRate: 100 }, { time: 9, chargeRate: 100 }, { time: 14.6, chargeRate: 100 }]);
        expect(sparse.gaps[15]).toBe('gap');
    });

    it('marks a window longer than the session as short', () => {
        const s = summarizeChargeSession(session({ minutes: 12 }));
        expect(s.windows[10].kw).toBe(100);
        expect(s.windows[15]).toBeNull();
        expect(s.gaps[15]).toBe('short');
    });

    it('needs time and power, and says which is missing', () => {
        expect(summarizeChargeSession([{ soc: 10, chargeRate: 100 }, { soc: 20, chargeRate: 90 }]))
            .toMatchObject({ windows: null, reason: 'no time' });
        expect(summarizeChargeSession([{ soc: 10, time: 0 }, { soc: 20, time: 5 }]))
            .toMatchObject({ windows: null, reason: 'no power' });
        expect(summarizeChargeSession([])).toMatchObject({ windows: null });
    });

    it('sorts, keeps one reading per instant, and reads numbers stored as text', () => {
        const pts = session({ kwAt: () => 80 }).reverse().map(p => ({ ...p, time: String(p.time), chargeRate: String(p.chargeRate) }));
        pts.push({ time: '0', chargeRate: '80', soc: 10 });
        expect(summarizeChargeSession(pts).windows[15].kw).toBe(80);
    });
});

describe('bestChargeWindows', () => {
    const summary = (kw5, kw15) => ({
        version: CHARGE_SUMMARY_VERSION, startSoc: 10, peakKw: kw5,
        windows: { 5: { kw: kw5, startMin: 0, startSoc: 10, endSoc: 20 }, 10: null, 15: { kw: kw15, startMin: 0, startSoc: 10, endSoc: 45 } },
    });
    const run = (id, s, over = {}) => ({ id, name: `run ${id}`, kind: 'charging', charge_summary: s, ...over });

    it('takes each window\'s best from whichever session set it', () => {
        const best = bestChargeWindows([run(1, summary(250, 150), { temperature_f: 40 }), run(2, summary(200, 180), { source: 'Out of Spec' })]);
        expect(best[5]).toMatchObject({ kw: 250, runId: 1, temperatureF: 40 });
        expect(best[15]).toMatchObject({ kw: 180, runId: 2, source: 'Out of Spec' });
        expect(best[10]).toBeNull();
    });

    it('leaves out excluded, synthetic, inherited, range and stale sessions', () => {
        const s = summary(300, 300);
        expect(bestChargeWindows([
            run(1, s, { isExcluded: true }),
            run(2, s, { synthetic: true }),
            run('inherited_4_9', s),
            run(3, s, { kind: 'range' }),
            run(5, { ...s, version: 0 }),
            run(6, null),
        ])[5]).toBeNull();
        expect(isCurrentSummary({ version: CHARGE_SUMMARY_VERSION })).toBe(true);
        expect(countsTowardBest(run(7, s))).toBe(true);
    });

    it('counts an unlisted session — the pool (#394) — but not an excluded one', () => {
        const s = summary(300, 300);
        expect(countsTowardBest(run(1, s, { isHidden: true }))).toBe(true);
        expect(countsTowardBest(run(2, s, { isHidden: true, isExcluded: true }))).toBe(false);
        // A local edit sets the camel key while the loaded snake key is stale.
        expect(countsTowardBest(run(3, s, { is_excluded: true, isExcluded: false }))).toBe(true);
    });

    it('still reads the windows of a version-1 summary, which only lacks the curve', () => {
        // Version 2 added `socMin` and left the windows alone, so a session
        // Admin has not yet recomputed keeps setting its vehicle's best.
        const v1 = { ...summary(300, 300), version: 1 };
        expect(isCurrentSummary(v1)).toBe(false);
        expect(countsTowardBest(run(1, v1))).toBe(true);
    });

    it('marks a figure whose time was derived rather than logged', () => {
        const best = bestChargeWindows([run(1, summary(200, 150), { calculated_fields: ['time', 'range'] })]);
        expect(best[15].timeDerived).toBe(true);
    });
});

describe('the curve by state of charge (#335)', () => {
    it('records the minute each whole percent was first reached', () => {
        // SoC rises 1%/min from 10%, so p% is reached at minute p − 10.
        const s = summarizeChargeSession(session({ minutes: 70 }));
        expect(s.socMin).toHaveLength(101);
        expect(s.socMin[9]).toBeNull();              // below where it started
        expect(s.socMin[10]).toBe(0);
        expect(s.socMin[80]).toBe(70);
        expect(s.socMin[81]).toBeNull();             // above where it stopped
        expect(minutesBetween(s, 10, 80)).toBe(70);
        expect(minutesBetween(s, 20, 50)).toBe(30);
    });

    it('interpolates between sparse samples, as a checkpoint log needs', () => {
        const pts = [{ time: 0, soc: 8, chargeRate: 200 }, { time: 4, soc: 28, chargeRate: 180 }, { time: 20, soc: 80, chargeRate: 60 }];
        const s = summarizeChargeSession(pts);
        expect(s.socMin[10]).toBeCloseTo(0.4);       // 2 of 20 points in 4 minutes
        expect(s.socMin[80]).toBe(20);
    });

    it('stops where SoC stalls — a pause is not charging time', () => {
        // Charged to 30% by minute 5, sat there until minute 25, then resumed.
        const pts = [{ time: 0, soc: 10, chargeRate: 150 }, { time: 5, soc: 30, chargeRate: 150 },
            { time: 25, soc: 30, chargeRate: 0 }, { time: 40, soc: 80, chargeRate: 50 }];
        const s = summarizeChargeSession(pts);
        expect(s.socMin[30]).toBe(5);
        expect(s.socMin[31]).toBeNull();
        expect(minutesBetween(s, 10, 80)).toBeNull();
    });

    it('keeps the first time a percent was reached when SoC dips and recovers', () => {
        const pts = [{ time: 0, soc: 10, chargeRate: 100 }, { time: 2, soc: 12, chargeRate: 100 },
            { time: 3, soc: 11, chargeRate: 100 }, { time: 5, soc: 14, chargeRate: 100 }];
        const s = summarizeChargeSession(pts);
        expect(s.socMin[12]).toBe(2);
        expect(s.socMin[13]).toBeCloseTo(4.3, 1);
    });

    it('has no curve without SoC, and none from an old summary', () => {
        const pts = session().map(({ soc: _soc, ...p }) => p);
        expect(summarizeChargeSession(pts).socMin).toBeUndefined();
        expect(minutesBetween({ version: 1, windows: {} }, 10, 80)).toBeNull();
        expect(minutesBetween(null, 10, 80)).toBeNull();
    });
});

describe('chargeTimeSession — which session a charge time comes from (#335)', () => {
    const curve = (minutes10to80) => {
        const socMin = new Array(101).fill(null);
        for (let p = 5; p <= 90; p++) socMin[p] = ((p - 10) * minutes10to80) / 70 + 5;
        return { version: CHARGE_SUMMARY_VERSION, peakKw: 250, windows: {}, socMin };
    };
    const run = (id, summary, over = {}) => ({ id, kind: 'charging', date: '2025-01-01', charge_summary: summary, ...over });

    it('takes the curator\'s default over a newer session', () => {
        const got = chargeTimeSession([
            run(1, curve(30), { is_default: true, date: '2024-01-01', temperature_f: 41 }),
            run(2, curve(20), { date: '2025-06-01' }),
        ], { from: 10, to: 80 });
        expect(got.run.id).toBe(1);
        expect(got.minutes).toBeCloseTo(30);
        expect(got.temperatureF).toBe(41);
    });

    it("takes the vehicle's composite curve over the newest test when nothing is default (#313)", () => {
        const composite = { synthetic: true, composite: { chargerClassV: null, tests: [{}, {}] }, date: '2020-01-01' };
        const got = chargeTimeSession([
            run(1, curve(30), { date: '2024-01-01' }),
            run(2, curve(20), { date: '2025-06-01' }),
            run(9, curve(25), composite),
        ], { from: 10, to: 80 });
        expect(got.run.id).toBe(9);
        // …but a DEF test still wins, and other synthetic runs still never count.
        expect(chargeTimeSession([run(1, curve(30), { is_default: true }), run(9, curve(25), composite)],
            { from: 10, to: 80 }).run.id).toBe(1);
        expect(chargeTimeSession([run(1, curve(30)), run(5, curve(10), { synthetic: true })],
            { from: 10, to: 80 }).run.id).toBe(1);
    });

    it('falls back to the newest session that covers the window', () => {
        const got = chargeTimeSession([
            run(1, curve(30), { date: '2024-01-01' }),
            run(2, curve(20), { date: '2025-06-01' }),
            run(3, { ...curve(10), socMin: new Array(101).fill(null) }, { date: '2026-01-01', is_default: true }),
        ], { from: 10, to: 80 });
        expect(got.run.id).toBe(2);
    });

    it('leaves out a charger-limited session, and counts it', () => {
        const limited = { ...curve(40), peakKw: 120 };
        const got = chargeTimeSession([run(1, limited)], { from: 10, to: 80, maxDcKw: 250 });
        expect(got.run).toBeNull();
        expect(got.limitedOut).toBe(1);
        // Without the car's maximum there is nothing to call it limited against.
        expect(chargeTimeSession([run(1, limited)], { from: 10, to: 80 }).run.id).toBe(1);
    });

    it('leaves out hidden, synthetic, inherited and range sessions', () => {
        expect(chargeTimeSession([
            run(1, curve(20), { isHidden: true }),
            run(2, curve(20), { synthetic: true }),
            run('inherited_4_9', curve(20)),
            run(3, curve(20), { kind: 'range' }),
        ], { from: 10, to: 80 }).run).toBeNull();
    });
});

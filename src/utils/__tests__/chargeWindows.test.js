import { describe, it, expect } from 'vitest';
import {
    summarizeChargeSession, bestChargeWindows, countsTowardBest, isCurrentSummary, CHARGE_SUMMARY_VERSION,
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

    it('leaves out hidden, synthetic, inherited, range and stale sessions', () => {
        const s = summary(300, 300);
        expect(bestChargeWindows([
            run(1, s, { isHidden: true }),
            run(2, s, { synthetic: true }),
            run('inherited_4_9', s),
            run(3, s, { kind: 'range' }),
            run(5, { ...s, version: CHARGE_SUMMARY_VERSION - 1 }),
            run(6, null),
        ])[5]).toBeNull();
        expect(isCurrentSummary({ version: CHARGE_SUMMARY_VERSION })).toBe(true);
        expect(countsTowardBest(run(7, s))).toBe(true);
    });

    it('marks a figure whose time was derived rather than logged', () => {
        const best = bestChargeWindows([run(1, summary(200, 150), { calculated_fields: ['time', 'range'] })]);
        expect(best[15].timeDerived).toBe(true);
    });
});

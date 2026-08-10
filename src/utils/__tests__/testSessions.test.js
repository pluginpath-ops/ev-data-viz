import { describe, it, expect } from 'vitest';
import {
    toSessionRow, sessionLabel, runsInSession, vehiclesInSession, sessionsForPicker,
    sessionDateMismatch, suggestedPairing, summariseSessions, filterSessions,
    groupRunsBySession, sessionFor,
} from '../testSessions';

const car = (id, name, runs, extra = {}) => ({ id, name, runs, ...extra });
const run = (id, kind, session_id, extra = {}) => ({ id, kind, session_id, ...extra });

// The Out of Spec case: two cars, one loop, charge either side of the drive.
const fleet = [
    car(1, 'R1S',     [run(10, 'charging', 5), run(11, 'range', 5)], { make: 'Rivian', model: 'R1S' }),
    car(2, 'Model Y', [run(20, 'charging', 5), run(21, 'range', 5)], { make: 'Tesla', model: 'Model Y' }),
    car(3, 'Bolt',    [run(30, 'range', 9)],                          { make: 'Chevy', model: 'Bolt' }),
    car(4, 'iX3',     [run(40, 'range', null), run(41, 'charging', 5, { _inherited: true })]),
];

describe('field mapping', () => {
    it('writes only supplied fields, so a partial edit cannot blank a column', () => {
        expect(toSessionRow({ name: 'Ottawa loop' })).toEqual({ name: 'Ottawa loop' });
    });

    it('turns empty strings into null and keeps a real zero', () => {
        expect(toSessionRow({ name: '', temperatureF: 0 })).toEqual({ name: null, temperature_f: 0 });
    });

    it('ignores unknown keys rather than sending them to the database', () => {
        expect(toSessionRow({ nonsense: 1, name: 'x' })).toEqual({ name: 'x' });
    });
});

describe('labels', () => {
    it('never yields a blank option', () => {
        expect(sessionLabel({ id: 1, name: 'Ottawa loop', tested_at: '2026-02-11T08:00' })).toBe('Ottawa loop (2026-02-11)');
        expect(sessionLabel({ id: 1, tested_at: '2026-02-11' })).toBe('Untitled session (2026-02-11)');
        expect(sessionLabel({ id: 7 })).toBe('Session #7');
    });
});

describe('membership spans vehicles', () => {
    it('gathers runs from every vehicle in the session', () => {
        expect(runsInSession(fleet, 5).map(x => x.run.id)).toEqual([10, 11, 20, 21]);
    });

    it('excludes inherited runs — a link is not a test event', () => {
        expect(runsInSession(fleet, 5).some(x => x.run._inherited)).toBe(false);
    });

    it('lists the distinct vehicles taking part', () => {
        expect(vehiclesInSession(fleet, 5).map(v => v.name)).toEqual(['R1S', 'Model Y']);
    });

    it('gathers nothing for a null session rather than every unassigned run', () => {
        expect(runsInSession(fleet, null)).toHaveLength(0);
    });
});

describe('picker ordering', () => {
    const sessions = [
        { id: 5, name: 'OoS 4-car loop', tested_at: '2026-02-11' },
        { id: 9, name: 'Bolt solo', tested_at: '2026-03-01' },
        { id: 12, name: 'Older outing', tested_at: '2026-01-04' },
    ];

    it("puts this vehicle's own sessions first, then the rest newest-first", () => {
        const { used, others } = sessionsForPicker(sessions, fleet, 1);
        expect(used.map(s => s.id)).toEqual([5]);
        expect(others.map(s => s.id)).toEqual([9, 12]);
    });

    it("does not count an inherited run's session as the vehicle's own", () => {
        // Vehicle 4's only session_id comes from an inherited run, which belongs
        // to the source vehicle — offering it would name an outing it never attended.
        expect(sessionsForPicker(sessions, fleet, 4).used).toHaveLength(0);
    });
});

describe('date guard', () => {
    it('flags a run far from its session, with the gap in days', () => {
        expect(sessionDateMismatch({ date: '2026-02-20' }, { tested_at: '2026-02-11' })).toBe(9);
    });

    it('stays quiet for the same day, an outing spanning midnight, or a missing date', () => {
        expect(sessionDateMismatch({ date: '2026-02-11' }, { tested_at: '2026-02-11' })).toBeNull();
        expect(sessionDateMismatch({ date: '2026-02-12' }, { tested_at: '2026-02-11T23:00' })).toBeNull();
        expect(sessionDateMismatch({}, { tested_at: '2026-02-11' })).toBeNull();
    });
});

describe('implied pairing', () => {
    it('treats one charging + one range from one vehicle as the pairing', () => {
        expect(suggestedPairing(fleet, 5, 1)).toEqual({ rangeRunId: 11, chargingRunId: 10 });
    });

    it('scopes per vehicle rather than across the whole outing', () => {
        expect(suggestedPairing(fleet, 5, 2)).toEqual({ rangeRunId: 21, chargingRunId: 20 });
    });

    it('implies nothing for a speed sweep or a charging-only session', () => {
        const sweep = [car(1, 'R1S', [10, 11, 12, 13].map(i => run(i, 'range', 7)))];
        expect(suggestedPairing(sweep, 7, 1)).toBeNull();
        const socSweep = [car(1, 'R1S', [10, 11, 12].map(i => run(i, 'charging', 8)))];
        expect(suggestedPairing(socSweep, 8, 1)).toBeNull();
        expect(suggestedPairing(fleet, 9, 3)).toBeNull();
    });
});

describe('browsing and search', () => {
    const all = [
        { id: 5,  name: 'OoS 10% Challenge', tested_at: '2026-02-11' },
        { id: 9,  name: 'OoS 10% Challenge', tested_at: '2026-03-01' },
        { id: 12, name: 'Peregrine Dreams',  tested_at: '2026-01-04' },
    ];
    const summaries = summariseSessions(all, fleet);

    it('summarises newest first, with run counts and vehicles', () => {
        expect(summaries.map(s => s.session.id)).toEqual([9, 5, 12]);
        const five = summaries.find(s => s.session.id === 5);
        expect(five.runCount).toBe(4);
        expect(five.vehicles.map(v => v.model)).toEqual(['R1S', 'Model Y']);
    });

    it('searches by VEHICLE, which a duplicated name cannot do', () => {
        // "OoS 10% Challenge" appears twice; only the cars tell them apart.
        expect(filterSessions(summaries, 'bolt').map(s => s.session.id)).toEqual([9]);
    });

    it('ANDs terms, and searches name and date too', () => {
        expect(filterSessions(summaries, 'oos r1s').map(s => s.session.id)).toEqual([5]);
        expect(filterSessions(summaries, 'peregrine').map(s => s.session.id)).toEqual([12]);
        expect(filterSessions(summaries, '2026-01').map(s => s.session.id)).toEqual([12]);
        expect(filterSessions(summaries, 'MODEL Y').map(s => s.session.id)).toEqual([5]);
        expect(filterSessions(summaries, 'zzzz')).toHaveLength(0);
        expect(filterSessions(summaries, '')).toHaveLength(3);
    });
});

describe('grouping a vehicle\'s runs', () => {
    const shape = rs => groupRunsBySession(rs).map(g => `${g.sessionId ?? '-'}:[${g.runs.map(r => r.id)}]`);

    it('brings a session\'s runs together however interleaved the input', () => {
        expect(shape([run(1,'charging',5), run(2,'range',9), run(3,'range',5), run(4,'charging',9)]))
            .toEqual(['5:[1,3]', '9:[2,4]']);
    });

    it('keeps the order each session first appeared in', () => {
        expect(shape([run(1,'range',9), run(2,'range',5)])).toEqual(['9:[1]', '5:[2]']);
    });

    it('puts unassigned runs last however early they appear', () => {
        expect(shape([run(1,'range',null), run(2,'range',5), run(3,'range',null)]))
            .toEqual(['5:[2]', '-:[1,3]']);
    });

    it('loses no runs, and tolerates empty input', () => {
        const g = groupRunsBySession([run(1,'range',5), run(2,'range',null), run(3,'range',9)]);
        expect(g.reduce((n, x) => n + x.runs.length, 0)).toBe(3);
        expect(groupRunsBySession([])).toEqual([]);
        expect(groupRunsBySession(null)).toEqual([]);
    });
});

describe('sessionFor', () => {
    it('finds a run\'s session, and returns null when it has none', () => {
        const sessions = [{ id: 5, name: 'x' }];
        expect(sessionFor(sessions, run(1, 'range', 5))).toBe(sessions[0]);
        expect(sessionFor(sessions, run(1, 'range', null))).toBeNull();
    });
});

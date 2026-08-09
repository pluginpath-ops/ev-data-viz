/**
 * Test sessions — one testing outing: same day, same road, same weather, same
 * crew.
 *
 * A session deliberately has NO vehicle (migration 044). The outings worth
 * recording are often side-by-side — four cars round one loop, or two cars at
 * 50/60/70/80 mph — and the shared conditions are exactly the point. Membership
 * is expressed from the RUN's side (`runs.session_id`), so the multi-vehicle
 * case needs no multi-vehicle UI: it emerges when several runs pick the same
 * session.
 *
 * A session is NOT a pairing. Sessions holding only charging runs (10-80, 20-80,
 * 30-80 to shape a curve) or only range runs (a speed sweep) are ordinary. But
 * when one vehicle contributes exactly one run of each kind, that IS the pairing
 * — see suggestedPairing below.
 *
 * Pure module — no React, no Supabase.
 */

import { runKindFrom } from './runUtils';

/** camelCase field → database column. One definition, so the writer and the
 *  optimistic update cannot drift — which is how the per-kind default bug
 *  survived a fix. */
export const SESSION_COLUMNS = {
    name:         'name',
    testedAt:     'tested_at',
    tester:       'tester',
    locationName: 'location_name',
    temperatureF: 'temperature_f',
    sourceName:   'source_name',
    url:          'url',
    notes:        'notes',
};

const NUMERIC = new Set(['temperatureF']);

/** Translate a partial camelCase change set into a database payload. */
export function toSessionRow(changes = {}) {
    const row = {};
    for (const [key, col] of Object.entries(SESSION_COLUMNS)) {
        if (!(key in changes)) continue;
        const v = changes[key];
        row[col] = NUMERIC.has(key)
            ? (v != null && v !== '' ? Number(v) : null)
            : (v || null);
    }
    return row;
}

/**
 * What to call a session on screen.
 *
 * An unnamed session still has to be pickable, so it falls back to its date and
 * then to its id — never to an empty string, which would render a blank option
 * that looks like "no session".
 */
export function sessionLabel(session) {
    if (!session) return '';
    const name = session.name?.trim();
    const date = session.tested_at ? String(session.tested_at).slice(0, 10) : null;
    if (name && date) return `${name} (${date})`;
    if (name) return name;
    if (date) return `Untitled session (${date})`;
    return `Session #${session.id}`;
}

/** Every run across every vehicle that belongs to `sessionId`. */
export function runsInSession(vehicles, sessionId) {
    if (sessionId == null) return [];
    const out = [];
    for (const v of vehicles || []) {
        for (const r of v.runs || []) {
            if (r._inherited) continue;          // a link, not a test event
            if (String(r.session_id) === String(sessionId)) out.push({ run: r, vehicle: v });
        }
    }
    return out;
}

/** The distinct vehicles taking part, in the order encountered. */
export function vehiclesInSession(vehicles, sessionId) {
    const seen = new Map();
    for (const { vehicle } of runsInSession(vehicles, sessionId)) {
        if (!seen.has(vehicle.id)) seen.set(vehicle.id, vehicle);
    }
    return [...seen.values()];
}

/**
 * Sessions ordered for a picker: the ones this vehicle already appears in
 * first, then everything else by date. A curator adding the fourth run of an
 * outing should not have to hunt for the session the first three are in.
 */
export function sessionsForPicker(sessions, vehicles, vehicleId) {
    const mine = new Set();
    for (const v of vehicles || []) {
        if (String(v.id) !== String(vehicleId)) continue;
        for (const r of v.runs || []) {
            // Inherited runs are links to another vehicle's test event. Their
            // session belongs to the source vehicle, not this one — counting it
            // here would offer a session this car never attended.
            if (r._inherited) continue;
            if (r.session_id != null) mine.add(String(r.session_id));
        }
    }
    const byDate = (a, b) => String(b.tested_at ?? '').localeCompare(String(a.tested_at ?? ''));
    const used   = (sessions || []).filter(s => mine.has(String(s.id))).sort(byDate);
    const others = (sessions || []).filter(s => !mine.has(String(s.id))).sort(byDate);
    return { used, others };
}

/**
 * Flag a run whose own date is far from its session's.
 *
 * Sessions are global, so the realistic mistake is attaching a run to an outing
 * it was not part of. This does not block anything — a curator may know better,
 * and a session spanning midnight is real — it just says so.
 */
export function sessionDateMismatch(run, session, toleranceDays = 1) {
    const runDate = run?.date ?? run?.tested_at;
    if (!runDate || !session?.tested_at) return null;
    const a = new Date(runDate), b = new Date(session.tested_at);
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
    const days = Math.abs(a - b) / 86400000;
    return days > toleranceDays ? Math.round(days) : null;
}

/**
 * The pairing a session implies for one vehicle.
 *
 * Exactly one charging run and one range run from the same vehicle in the same
 * outing can only go together, which turns the most common curation chore into
 * a side effect of saying where a run came from. Anything else — a speed sweep,
 * three charging curves — implies nothing, and returns null rather than
 * guessing.
 */
export function suggestedPairing(vehicles, sessionId, vehicleId) {
    const rows = runsInSession(vehicles, sessionId)
        .filter(({ vehicle }) => String(vehicle.id) === String(vehicleId))
        .map(({ run }) => run);

    const charging = rows.filter(r => runKindFrom(r) === 'charging');
    const range    = rows.filter(r => runKindFrom(r) === 'range');
    if (charging.length !== 1 || range.length !== 1) return null;
    return { rangeRunId: range[0].id, chargingRunId: charging[0].id };
}

/**
 * One row's worth of what a session IS, for browsing: when, how big, and — the
 * part that actually identifies an outing — which cars were on it.
 */
export function sessionSummary(session, vehicles) {
    const rows = runsInSession(vehicles, session.id);
    return {
        session,
        runCount: rows.length,
        vehicles: vehiclesInSession(vehicles, session.id),
        date: session.tested_at ? String(session.tested_at).slice(0, 10) : null,
    };
}

/**
 * Search sessions by name OR by the vehicles taking part.
 *
 * Matching on vehicles matters more than it sounds: sessions inherit their names
 * from whoever published the test ("OoS 10% Challenge" appears eight times), so
 * the name alone often cannot tell two outings apart, while "the one with the
 * R1S and the Model Y" always can.
 *
 * Terms are AND-ed, so "oos r1s" finds the OoS outing the R1S was on.
 */
export function filterSessions(summaries, query) {
    const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return summaries;

    return summaries.filter(s => {
        const haystack = [
            s.session.name ?? '',
            s.date ?? '',
            s.session.location_name ?? '',
            s.session.tester ?? '',
            ...s.vehicles.flatMap(v => [v.name, v.make, v.model, v.trim, v.year].filter(Boolean)),
        ].join(' ').toLowerCase();
        return terms.every(t => haystack.includes(t));
    });
}

/** Every session, summarised, newest first — the browser's backing list. */
export function summariseSessions(sessions, vehicles) {
    return (sessions || [])
        .map(s => sessionSummary(s, vehicles))
        .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
}

/**
 * Group a vehicle's runs by session, so each session can be rendered as one
 * container holding its runs.
 *
 * Sessions appear in the order their first run does, so a curator's existing
 * sense of the list is preserved rather than resorted underneath them.
 * Unassigned runs collect at the end: they are an absence, not an outing, and
 * putting them first would bury the grouping under the ungrouped.
 *
 * Returns [{ key, sessionId, runs }] — a real nesting rather than a flat list
 * with markers, because the session card CONTAINS its runs on screen and
 * collapsing it should visibly fold them away.
 */
export function groupRunsBySession(runs) {
    const order = [];
    const bySession = new Map();

    for (const run of runs || []) {
        const key = run.session_id == null ? '__none__' : String(run.session_id);
        if (!bySession.has(key)) { bySession.set(key, []); order.push(key); }
        bySession.get(key).push(run);
    }

    // The absence goes last, however early its first run appeared.
    const keys = order.filter(k => k !== '__none__');
    if (bySession.has('__none__')) keys.push('__none__');

    return keys.map(key => ({
        key,
        sessionId: key === '__none__' ? null : key,
        runs: bySession.get(key),
    }));
}

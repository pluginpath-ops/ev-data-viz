/**
 * Tested via: which EPA test vehicles stand behind a Guide row.
 *
 * A Guide row is one model type in one year — what a window sticker says. A
 * test vehicle is one car in one setup, measured in a lab. Usually one test
 * vehicle stands behind a row; sometimes the row is EPA's sales-weighted blend
 * of several (the MY2025 Blazer EV AWD row is a blend of three configurations
 * of one car); sometimes no tested car is that model type at all.
 *
 * ── The identity ────────────────────────────────────────────────────────────
 *
 * A test vehicle's unadjusted city and highway kWh/100mi are
 *
 *     100 × AC recharge energy ÷ CD range
 *
 * from its multi-cycle test (city on the combined CD range, highway on the
 * highway one), or from its UDDS and highway charge-depleting tests. Where one
 * test vehicle stands behind a row this reproduces the Guide's kWh/100mi line
 * to its printed precision — 4 decimals for most makers. It needs no DC energy
 * and no phases, so it works on the files that report neither (GM's MY2024
 * Blazer EV, `1RMV5449`).
 *
 * A blend lands BETWEEN its members in that two-dimensional space. The weights
 * are sales mix and are not published, so a blend is reported as the span of
 * its members' figures, never as an estimated weighting (owner, 2026-10-31).
 *
 * ── Why not the MPGe check ─────────────────────────────────────────────────
 *
 * guideCandidateCheck compares MPGe at ±1% "agrees". Sibling configurations
 * are often closer than that — the R1S's are 0.4% apart — so every sibling
 * agrees and the check cannot say which one the row is. Here the tolerance
 * follows the precision the Guide printed, which separates them.
 *
 * ── Measured on the corpus (2026-10-31, MY2022–2027) ───────────────────────
 *
 * Of the 1,211 Guide EV rows on the local mirror: 601 one test vehicle
 * exactly, 70 within rounding of one, 150 a blend, 368 untested, 22 with no
 * lab data. See docs/epa-identity-and-guide-basis.md.
 *
 * Pure: the caller supplies the Guide row and the pool of test vehicles —
 * every test vehicle certified under the row's Test Group (guideTestedViaPool).
 */
import { PROC_MCT, PROC_CD_HWY, PROC_CD_UDDS } from '../constants/epa';
import { MPG_E_CONVERSION } from '../constants/units';

/** kWh/100mi a computed figure may sit from the printed one beyond rounding: its inputs carry 3–4 decimals. */
export const COMPUTED_SLACK = 0.006;
/** The MPGe and kWh/100mi lines are not always exactly 33.705 apart; a row read from MPGe allows for it. */
export const MPGE_LINE_SLACK = 0.01;
/** A blend may sit this many tolerances off the line between its members — the members' own rounding. */
export const BLEND_REACH = 3;
/** A blend weight nearer an end than this is that end, not a blend. */
export const BLEND_EDGE = 0.05;

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const decimals = (v) => (String(v).split('.')[1] ?? '').length;
/**
 * Half the last printed digit of a row's two figures. The finer of the two:
 * a stored number has lost its trailing zeros (EPA's "22.3300" reads back as
 * 22.33), and EPA prints both cycles of a row alike.
 */
const halfUnit = (a, b) => 0.5 * 10 ** -Math.max(decimals(a), decimals(b));

/**
 * A test vehicle's unadjusted kWh/100mi, city and highway, or null when its
 * tests cannot give both.
 */
export function testVehiclePoint(tv) {
    const tests = tv?.tests ?? tv?.epa_tests ?? [];
    const of = (code) => tests.filter(t => num(t.procedure_code) === code && num(t.ac_recharge_kwh) > 0);
    const per = (ac, mi) => (num(mi) > 0 ? 100 * num(ac) / num(mi) : null);

    for (const t of of(PROC_MCT)) {
        const city = per(t.ac_recharge_kwh, t.cd_range_combined_calc);
        const hwy  = per(t.ac_recharge_kwh, t.cd_range_hwy_calc);
        if (city && hwy) return { city, hwy, via: [t.test_number] };
    }
    const udds = of(PROC_CD_UDDS).find(t => num(t.cd_range_combined_calc) > 0);
    const hwyT = of(PROC_CD_HWY).find(t => num(t.cd_range_combined_calc) > 0);
    if (udds && hwyT) {
        return {
            city: per(udds.ac_recharge_kwh, udds.cd_range_combined_calc),
            hwy:  per(hwyT.ac_recharge_kwh, hwyT.cd_range_combined_calc),
            via:  [udds.test_number, hwyT.test_number],
        };
    }
    return null;
}

/**
 * A Guide row's unadjusted kWh/100mi and how far a match may sit from it.
 * Read from the row's kWh/100mi line (migration 094), or from its MPGe line
 * for a row imported before that.
 */
export function guidePoint(row) {
    const kc = num(row?.unadj_city_kwh_100mi);
    const kh = num(row?.unadj_hwy_kwh_100mi);
    if (kc > 0 && kh > 0) {
        return { city: kc, hwy: kh, tol: halfUnit(row.unadj_city_kwh_100mi, row.unadj_hwy_kwh_100mi) + COMPUTED_SLACK };
    }
    const mc = num(row?.unadj_city_mpge);
    const mh = num(row?.unadj_hwy_mpge);
    if (!(mc > 0) || !(mh > 0)) return null;
    const k = 100 * MPG_E_CONVERSION;
    // 1 MPGe at m is k/m² kWh/100mi; the lower MPGe spreads the most.
    const half = halfUnit(row.unadj_city_mpge, row.unadj_hwy_mpge);
    return {
        city: k / mc, hwy: k / mh,
        tol: k / Math.min(mc, mh) ** 2 * half + COMPUTED_SLACK + MPGE_LINE_SLACK,
    };
}

// Covered-model names arrive with the PDF's HTML entities (`w/19&quot; wheels`).
const norm = (s) => String(s ?? '').replace(/&[a-z]+;/gi, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
/** Same carline, as loosely as EPA spells one: "BLAZER EV AWD" and "Blazer EV AWD, 22 inch tire". */
export function sameCarline(guideCarline, testCarline) {
    const g = norm(guideCarline);
    const c = norm(testCarline);
    return !!g && !!c && (g.includes(c) || c.includes(g) || g.slice(0, 8) === c.slice(0, 8));
}

/**
 * Does this test vehicle stand for this Guide carline — by its own carline or
 * by a model its certificate says it covers? Rivian's R1S test vehicle covers
 * the R1T, and the R1T's Guide rows are its figures exactly.
 */
export function coversCarline(guideCarline, tv) {
    return [tv?.epa_carline_name, ...(tv?.covered_models ?? []).map(m => m?.carline_name ?? m)]
        .some(c => sameCarline(guideCarline, c));
}

const dist = (p, q) => Math.hypot(p.city - q.city, p.hwy - q.hwy);

/** Where `p` falls on segment a→b: { t, d } with t the share of the way. */
function onSegment(p, a, b) {
    const dx = b.city - a.city;
    const dy = b.hwy - a.hwy;
    const len2 = dx * dx + dy * dy;
    if (!len2) return null;
    const t = ((p.city - a.city) * dx + (p.hwy - a.hwy) * dy) / len2;
    return { t, d: Math.hypot(a.city + t * dx - p.city, a.hwy + t * dy - p.hwy) };
}

function inTriangle(p, a, b, c) {
    const s = (p1, p2, p3) => (p1.city - p3.city) * (p2.hwy - p3.hwy) - (p2.city - p3.city) * (p1.hwy - p3.hwy);
    const d1 = s(p, a, b); const d2 = s(p, b, c); const d3 = s(p, c, a);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}
const area = (a, b, c) => Math.abs((b.city - a.city) * (c.hwy - a.hwy) - (c.city - a.city) * (b.hwy - a.hwy)) / 2;

const spanOf = (members) => ({
    city: [Math.min(...members.map(m => m.city)), Math.max(...members.map(m => m.city))],
    hwy:  [Math.min(...members.map(m => m.hwy)),  Math.max(...members.map(m => m.hwy))],
});

/** Explain `g` from `pts` alone: exact, near, blend or null. */
function explain(g, pts) {
    if (!pts.length) return null;
    const ranked = [...pts].sort((a, b) => dist(g, a) - dist(g, b));
    const best = ranked[0];
    if (dist(g, best) <= g.tol) {
        // Two test vehicles both inside the printed precision cannot be told
        // apart by this row; say so rather than pick one.
        const tied = ranked.filter(p => dist(g, p) <= g.tol);
        return { verdict: 'exact', members: [best], ambiguous: tied.length > 1, alternatives: tied.slice(1) };
    }

    const pairs = [];
    for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
            const s = onSegment(g, pts[i], pts[j]);
            if (s && s.t >= 0 && s.t <= 1 && s.d <= g.tol * BLEND_REACH) pairs.push({ ...s, a: pts[i], b: pts[j] });
        }
    }
    pairs.sort((x, y) => x.d - y.d);
    const blendPairs = pairs.filter(x => x.t >= BLEND_EDGE && x.t <= 1 - BLEND_EDGE);
    if (blendPairs.length) {
        const { a, b } = blendPairs[0];
        return { verdict: 'blend', members: [a, b], ambiguous: blendPairs.length > 1, alternatives: blendPairs.slice(1).flatMap(x => [x.a, x.b]) };
    }
    if (pairs.length) {
        const { t, a, b } = pairs[0];
        return { verdict: 'near', members: [t < 0.5 ? a : b], ambiguous: false, alternatives: [] };
    }
    if (dist(g, best) <= g.tol * BLEND_REACH) return { verdict: 'near', members: [best], ambiguous: false, alternatives: [] };

    let tri = null;
    for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
            for (let k = j + 1; k < pts.length; k++) {
                const [a, b, c] = [pts[i], pts[j], pts[k]];
                if (inTriangle(g, a, b, c) && (!tri || area(a, b, c) < tri.area)) tri = { area: area(a, b, c), members: [a, b, c] };
            }
        }
    }
    if (tri) return { verdict: 'blend', members: tri.members, ambiguous: pts.length > 3, alternatives: [] };
    return null;
}

/**
 * @param {Object} guideRow      an epa_fe_guide row
 * @param {Array}  testVehicles  the pool, each with test_vehicle_id,
 *                               epa_carline_name, covered_models and tests
 *                               (or epa_tests)
 * @returns {{
 *   verdict: 'exact'|'near'|'blend'|'untested'|'no-lab-data'|'no-guide-figures',
 *   members: Array<{ test_vehicle_id, city, hwy, via }>,
 *   span: { city: [number, number], hwy: [number, number] } | null,
 *   ambiguous: boolean, alternatives: string[],
 *   otherCarline: boolean,
 *   nearest: number | null,
 *   closest: { test_vehicle_id, otherCarline, cityShare, hwyShare } | null,
 *   guide: { city, hwy, tol } | null,
 * }}
 *   exact        one test vehicle reproduces the row within its printed precision
 *   near         one test vehicle, just past rounding (a blend weighted almost
 *                all to one member reads the same)
 *   blend        the row lies between two or three test vehicles; `span` is
 *                what they span, which is what the row can be said to be
 *   untested     the pool has lab data and none of it is this row; `closest`
 *                is the nearest tested trim of the carline and how much more
 *                (negative: less) energy the row uses per cycle — a suggestion
 *                for a curator, not a link
 *   no-lab-data  no test vehicle in the pool has the tests to compare
 *   ambiguous    another test vehicle (exact) or pair (blend) explains it as
 *                well; `alternatives` names them
 *   otherCarline the explanation needed a test vehicle that neither is this
 *                carline nor lists it among its covered models
 *   nearest      kWh/100mi from the row to the nearest test vehicle
 */
export function testedVia(guideRow, testVehicles = []) {
    const g = guidePoint(guideRow);
    const empty = { members: [], span: null, ambiguous: false, alternatives: [], otherCarline: false, nearest: null, closest: null, guide: g };
    if (!g) return { ...empty, verdict: 'no-guide-figures' };

    // One point per test: a test vehicle stored twice is one car. The copy
    // filed under this row's carline is the one kept.
    const byRun = new Map();
    for (const tv of testVehicles) {
        const p = testVehiclePoint(tv);
        if (!p) continue;
        const key = `${p.city.toFixed(4)}|${p.hwy.toFixed(4)}`;
        const pt = { test_vehicle_id: tv.test_vehicle_id, city: p.city, hwy: p.hwy, own: coversCarline(guideRow.carline, tv), via: p.via };
        if (!byRun.has(key) || (pt.own && !byRun.get(key).own)) byRun.set(key, pt);
    }
    const pts = [...byRun.values()];
    if (!pts.length) return { ...empty, verdict: 'no-lab-data' };

    const own = pts.filter(p => p.own);
    const nearest = Math.min(...pts.map(p => dist(g, p)));
    const out = (r) => ({
        ...empty, ...r, nearest,
        otherCarline: r.members.some(m => !m.own),
        members: r.members.map(({ test_vehicle_id, city, hwy, via }) => ({ test_vehicle_id, city, hwy, via })),
        alternatives: (r.alternatives ?? []).map(m => m.test_vehicle_id),
        span: r.verdict === 'blend' ? spanOf(r.members) : null,
    });

    const mine = explain(g, own);
    if (mine) return out(mine);
    const any = explain(g, pts);
    if (any) return out(any);

    // Nothing tested is this row. The nearest tested trim of the same carline
    // is offered, with how far apart the two cycles are, for a curator to
    // judge — never linked on the numbers alone. A uniform scale (the same
    // factor in both cycles) looked like the signature of a derived model type,
    // but a same-maker pool from ANOTHER Test Group scales uniformly within
    // 0.3% for 14% of these rows by chance, against 26% for the row's own pool
    // (2026-10-31): not evidence enough to assume a link (owner, 2026-10-31).
    const near = [...(own.length ? own : pts)].sort((a, b) => dist(g, a) - dist(g, b))[0];
    return {
        ...empty, verdict: 'untested', nearest,
        closest: {
            test_vehicle_id: near.test_vehicle_id,
            otherCarline: !near.own,
            cityShare: g.city / near.city - 1,
            hwyShare:  g.hwy / near.hwy - 1,
        },
    };
}

/**
 * Could this test vehicle stand behind this row at all — reproduce it within
 * a blend's reach, or be one end of a two-way blend with any other test
 * vehicle of the pool, or (when the row itself needed three) one corner of a
 * three-way blend? Looser than `testedVia`, which names only the best
 * explanation: this answers "is it definitely NOT behind the row", the test
 * for hiding a test vehicle (epaBehindNoLabel): two 2023 Taycans that no row
 * named still pass it, and so stay.
 *
 * @param {Object} guideRow
 * @param {Object} testVehicle  with tests
 * @param {Array} pool  the row's pool (guideTestedViaPool)
 * @param {Object} [via]  the row's testedVia result, for the three-way case
 */
export function couldStandBehind(guideRow, testVehicle, pool = [], via = null) {
    const g = guidePoint(guideRow);
    const p = testVehiclePoint(testVehicle);
    if (!g || !p) return false;
    if (dist(g, p) <= g.tol * BLEND_REACH) return true;
    const others = pool
        .filter(o => o.test_vehicle_id !== testVehicle.test_vehicle_id)
        .map(testVehiclePoint).filter(Boolean);
    for (const q of others) {
        const s = onSegment(g, p, q);
        if (s && s.t >= BLEND_EDGE && s.t <= 1 - BLEND_EDGE && s.d <= g.tol * BLEND_REACH) return true;
    }
    if (via?.verdict === 'blend' && via.members?.length === 3) {
        for (let i = 0; i < others.length; i++) {
            for (let j = i + 1; j < others.length; j++) {
                if (inTriangle(g, p, others[i], others[j])) return true;
            }
        }
    }
    return false;
}

/**
 * The pool for a Guide row: every test vehicle that was certified under the
 * row's Test Group, wherever the file that says so is.
 *
 * That is more than the members of the row's own certification, in two ways:
 *
 *   • A carryover certification's row can be a blend of configurations its
 *     original listed. The MY2026 Blazer EV file lists `1SMV5028-0`; MY2025
 *     listed -0, -1 and -2. So the original Test Group's members count.
 *   • A LATER file can name configurations the original never listed. BMW's
 *     MY2024 i7 file (RBMXV00.0G7S) lists one configuration of `CL34779`; the
 *     MY2026 file lists four, each "originally certified" under RBMXV00.0G7S,
 *     and the MY2024 Guide rows are those configurations exactly. So any
 *     member whose carryover names the Test Group counts too.
 *
 * @param {string} testGroup  the row's smog_test_group
 * @param {Array} members  every certification membership: the test vehicle
 *        (test_vehicle_id, epa_carline_name, tests) plus `test_group`, its
 *        certification's, and `carryover_test_group`
 */
export function guideTestedViaPool(testGroup, members) {
    if (!testGroup) return [];
    const family = new Set([testGroup]);
    for (const m of members) {
        if (m.test_group === testGroup && m.carryover_test_group) family.add(m.carryover_test_group);
    }
    const pool = new Map();
    for (const m of members) {
        if ((family.has(m.test_group) || family.has(m.carryover_test_group)) && !pool.has(m.test_vehicle_id)) {
            pool.set(m.test_vehicle_id, m);
        }
    }
    return [...pool.values()];
}

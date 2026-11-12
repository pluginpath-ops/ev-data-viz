// The correction check (#475): how well the condition correction predicts a
// vehicle's own range tests, as a report for the owner. Offline and read-only.
//
//   npm run correction-check                      production, listed tests, published constants
//   npm run correction-check -- --mirror          the local mirror (scripts/localdb.sh), unlisted tests too
//   npm run correction-check -- --defaults        the repo's default constants, not the published ones
//   npm run correction-check -- --set AERO_FRACTION=0.62 --set ACCESSORY_COOL_W_PER_F=50
//   npm run correction-check -- --fit [--boot 100]
//   npm run correction-check -- --out <dir>       default: LocalDev/correction-check/ in the main checkout
//
// It runs the site's own modules (src/utils/correctionCheck.js, bundled with
// esbuild), so the check can never disagree with the charts. Constants
// resolve when those modules load, so they are set before the bundle is
// imported: published values first, then --set on top.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const mainCheckout = path.dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: repo, encoding: 'utf8' }).trim());

// ── Arguments ────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const values = (name) => argv.flatMap((a, i) => (a === name && argv[i + 1] ? [argv[i + 1]] : []));
const useMirror = flag('--mirror');
const useDefaults = flag('--defaults');
const doFit = flag('--fit');
const bootstrap = Number(values('--boot')[0] ?? 100);
const outDir = path.resolve(values('--out')[0] ?? path.join(mainCheckout, 'LocalDev', 'correction-check'));
const setValues = Object.fromEntries(values('--set').map(s => {
    const [k, v] = s.split('=');
    return [k, v.includes(',') ? v.split(',').map(Number) : Number(v)];
}));

// ── Data ─────────────────────────────────────────────────────────────────────

const RUN_COLUMNS = ['id', 'vehicle_id', 'name', 'date', 'kind', 'composite', 'speed_mph', 'speed_basis', 'temperature_f',
    'altitude_ft', 'avg_wind_speed_mph', 'wind_direction_deg', 'energy_kwh', 'distance_miles', 'start_soc', 'end_soc',
    'is_hidden', 'is_excluded', 'quality_override', 'session_id', 'source'];

function readEnv() {
    for (const dir of [repo, mainCheckout]) {
        const file = path.join(dir, '.env');
        if (!fs.existsSync(file)) continue;
        return Object.fromEntries(fs.readFileSync(file, 'utf8').split('\n')
            .map(l => l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)).filter(Boolean).map(m => [m[1], m[2].replace(/^['"]|['"]$/g, '')]));
    }
    throw new Error('No .env with VITE_SUPABASE_URL found in this checkout or the main one.');
}

/** Production, read with the public key: what a signed-out reader can see. */
async function productionReader() {
    const env = readEnv();
    const headers = { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}` };
    return async (table, columns, filter = '') => {
        const res = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/${table}?select=${columns.join(',')}${filter ? `&${filter}` : ''}&limit=10000`, { headers });
        if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`);
        return res.json();
    };
}

/** The local mirror, as its admin: unlisted tests included. */
function mirrorReader() {
    const quote = (v) => `'${String(v).replace(/^"|"$/g, '').replace(/'/g, "''")}'`;
    const where = (filter) => {
        if (!filter) return '';
        const [col, op, ...rest] = filter.split(/[=.]/);
        const arg = rest.join('.');
        if (op === 'eq') return ` where ${col} = ${quote(arg)}`;
        if (op === 'in') return ` where ${col} in (${arg.replace(/^\(|\)$/g, '').split(',').map(quote).join(',')})`;
        throw new Error(`mirror filter not understood: ${filter}`);
    };
    return async (table, columns, filter = '') => {
        const sql = `select coalesce(jsonb_agg(t), '[]'::jsonb) from (select ${columns.join(',')} from ${table}${where(filter)}) t`;
        const out = execFileSync(path.join(repo, 'scripts', 'localdb.sh'), ['psql', '--as', 'admin', '-At', '-c', sql], { encoding: 'utf8', maxBuffer: 64 << 20 });
        // jsonb prints on one line; anything else psql printed (a SET) is not it.
        return JSON.parse(out.split('\n').find(l => l.startsWith('[')));
    };
}

async function loadData(read) {
    const runs = await read('runs', RUN_COLUMNS, 'kind=eq.range');
    const vehicleIds = [...new Set(runs.map(r => r.vehicle_id))];
    const sessionIds = [...new Set(runs.map(r => r.session_id).filter(Boolean))];
    const inList = (ids) => `in.(${ids.join(',')})`;
    const [vehicles, sessions, mappings, settings] = await Promise.all([
        read('vehicles', ['id', 'name', 'year'], `id=${inList(vehicleIds)}`),
        sessionIds.length ? read('test_sessions', ['id', 'temperature_f', 'altitude_ft'], `id=${inList(sessionIds)}`) : [],
        read('epa_vehicle_mappings', ['vehicle_id', 'test_vehicle_id', 'is_primary'], `vehicle_id=${inList(vehicleIds)}`),
        read('site_settings', ['key', 'value'], 'key=eq.model_constants'),
    ]);
    const testVehicleIds = [...new Set(mappings.map(m => m.test_vehicle_id))];
    const coefficientSets = testVehicleIds.length
        ? await read('epa_coefficient_sets', ['test_vehicle_id', 'category', 'is_primary', 'target_a', 'target_b', 'target_c', 'set_a', 'set_b', 'set_c'],
            `test_vehicle_id=${inList(testVehicleIds.map(id => `"${id}"`))}`)
        : [];
    const raw = settings[0]?.value;
    return { runs, vehicles, sessions, mappings, coefficientSets, published: raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {} };
}

// ── The site's modules, with the constants this run asks for ────────────────

async function loadModules(constants) {
    // constants/overrides.js reads the reader's local layer from localStorage
    // when it first resolves; this stands in for it. Published values and
    // --set are both put there, which is the same as the site resolving them.
    const stored = JSON.stringify(constants);
    globalThis.localStorage = {
        getItem: (k) => (k === 'evbench.constants.overrides' ? stored : null),
        setItem: () => {}, removeItem: () => {},
    };
    const result = await build({
        stdin: {
            contents: `export * from './src/utils/correctionCheck.js';
                       export { EPA_DEFAULTS, STANDARD_CONDITIONS, REFERENCE_SPEED_MPH } from './src/constants/epa.js';
                       export { KNOB_GROUPS } from './src/constants/knobs.js';`,
            resolveDir: repo, loader: 'js',
        },
        bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'error',
    });
    // A file rather than a data: URL, so a stack trace names real lines.
    const bundle = path.join(os.tmpdir(), `evbench-correction-check-${process.pid}.mjs`);
    fs.writeFileSync(bundle, result.outputFiles[0].text);
    try {
        return await import(bundle);
    } finally {
        fs.rmSync(bundle, { force: true });
    }
}

// ── The report ───────────────────────────────────────────────────────────────

const fx = (v, d = 1) => (v == null || !Number.isFinite(v) ? '–' : v.toFixed(d));
const signed = (v, d = 1) => (v == null ? '–' : `${v > 0 ? '+' : ''}${v.toFixed(d)}`);
const missCell = (m) => (m ? `${signed(m.pct)}% (${signed(m.miPerKwh, 2)})` : '–');
const testLabel = (t) => `#${t.run.id} ${t.run.name}${t.run.source ? ` (${t.run.source})` : ''}`;
const conditionText = (t) => {
    const c = t.conditions;
    const parts = [`${fx(Number(c.speedMph), 0)} mph${c.speedBasis === 'mixed' ? ' mixed' : ''}`, `${fx(Number(c.temperatureF), 0)}°F`];
    parts.push(t.altitudeAssumed ? 'alt blank' : `${Number(c.altitudeFt).toLocaleString('en-US')} ft`);
    if (Number(c.windMph) > 0) parts.push(`wind ${fx(Number(c.windMph), 0)}${c.windDirDeg != null ? `@${c.windDirDeg}°` : ''}`);
    return parts.join(', ');
};
const vehicleName = (v) => `${v.name}${v.year ? ` (${v.year})` : ''}`;

function report({ m, check, fits, source, constants, published }) {
    const L = [];
    const nTests = check.vehicles.reduce((s, v) => s + v.tests.length, 0);
    const independent = check.vehicles.reduce((s, v) => s + v.tests.length - 1, 0);
    L.push(`# Correction check, ${new Date().toISOString().slice(0, 10)}`, '');
    L.push(`Source: ${source}. Mode: "Speed, altitude, temp & wind" (\`${m.CHECK_MODE}\`), as the composite range uses.`, '');
    L.push(`**${check.vehicles.length} vehicles, ${nTests} tests, ${check.pairs.length} test pairs.** Pairs on one vehicle share tests: they hold ${independent} independent comparisons, not ${check.pairs.length}. Every figure below names the count it rests on. This is a check, not a fit: no figure here is a verdict on a constant.`, '');

    L.push('## Constants used', '');
    L.push('| Constant | Value | From |', '|---|---|---|');
    const keys = ['AERO_FRACTION', 'REFERENCE_SPEED_MPH', 'DEFAULT_ACCESSORY_W', 'ACCESSORY_COMFORT_BAND_F', 'ACCESSORY_HEAT_W_PER_F', 'ACCESSORY_COOL_W_PER_F', 'ASSUMED_TEST_ALTITUDE_FT'];
    for (const k of keys) {
        const from = k in setValues ? '--set' : k in published && !useDefaults ? 'published' : 'default';
        L.push(`| \`${k}\` | ${JSON.stringify(constants[k] ?? m.EPA_DEFAULTS[k])} | ${from} |`);
    }
    L.push('');

    L.push('## How each method does', '');
    L.push('A miss is the prediction against what the reference test measured: + reads more efficient than it was. Medians are per vehicle first, then across vehicles, so a car with eight tests does not outvote one with two.', '');
    L.push('| Method | Vehicles | Tests | Pairs | Reads high | Reads low | Median miss (abs) | Worst vehicle (abs) |', '|---|---|---|---|---|---|---|---|');
    const row = (label, s) => `| ${label} | ${s.nVehicles} | ${s.nTests} | ${s.nPairs} | ${s.readsHigh} | ${s.readsLow} | ${fx(s.medianAbsPct)}% | ${fx(s.worstVehicleAbsPct)}% |`;
    for (const { key, label } of m.CHECK_METHODS) L.push(row(label, check.summary.methods[key]));
    L.push('', `**Same pairs only** (the vehicles with an EPA curve), the fair comparison of the two corrections:`, '');
    L.push('| Method | Vehicles | Tests | Pairs | Reads high | Reads low | Median miss (abs) | Worst vehicle (abs) |', '|---|---|---|---|---|---|---|---|');
    L.push(row('Generic (aero fraction)', check.summary.head2head.generic), row('EPA curve (candidate)', check.summary.head2head.epa), '');
    L.push(`Closest of the three, pair by pair (of ${check.pairs.length}): ${m.CHECK_METHODS.map(({ key, label }) => `${label} ${check.summary.closest[key]}`).join(' · ')}.`, '');

    if (fits.length) {
        L.push('## Fit', '');
        L.push(`Constants searched to make the pairs agree, each vehicle weighted once, within the knob's own range. A constant is fitted only when ${m.FIT_MIN_VEHICLES}+ vehicles have a pair that moves it. The spread is the 10th–90th percentile over ${bootstrap} resamples of whole vehicles. **Held out** fits without each vehicle in turn and predicts that vehicle: a fit that does not beat the knobs there has not earned anything. A constant pressed against its knob's limit means the pairs either want more than the range allows or cannot tell it from another constant (the base draw and the aero fraction both move the speed correction). Nothing here is applied.`, '');
        for (const f of fits) {
            L.push(`### ${f.method === 'epa' ? 'EPA curve (candidate)' : 'Generic (aero fraction)'}: ${f.nVehicles} vehicles, ${f.nPairs} pairs`, '');
            L.push('| Constant | Knob | Fitted | Spread (10–90%) | Vehicles that move it |', '|---|---|---|---|---|');
            for (const p of f.params) {
                L.push(`| \`${p.key}\` | ${fx(p.knobValue, 2)} | ${p.fitted == null ? `not fitted: ${p.heldBecause}` : `${fx(p.fitted, 2)}${p.atLimit ? ` **at the knob's ${p.atLimit}: not a value to read off**` : ''}`} | ${p.spread ? `${fx(p.spread[0], 2)} – ${fx(p.spread[1], 2)}` : '–'} | ${p.supportVehicles} |`);
            }
            const h = f.heldOut;
            L.push('', `Held out, ${h.nVehicles} vehicles: the fit predicted ${h.better} better and ${h.worse} worse than the knobs. Median miss (abs) ${fx(h.medianAbsPctFitted)}% fitted against ${fx(h.medianAbsPctKnobs)}% with the knobs.`, '');
        }
    }

    L.push('## Vehicles', '');
    for (const v of check.vehicles) {
        L.push(`### ${vehicleName(v.vehicle)}: ${v.tests.length} tests, ${v.pairs.length} pairs`, '');
        if (v.epaCurve.reason) {
            L.push(`EPA curve: none, ${m.NO_EPA_CURVE[v.epaCurve.reason]}.`, '');
        } else {
            const c = v.epaCurve;
            L.push(`EPA curve: \`${c.testVehicleId}\` (${c.basis === 'chosen' ? 'the chosen configuration' : 'its only configuration'}, ${c.source} coefficients) A ${fx(c.a, 2)}, B ${fx(c.b, 4)}, C ${fx(c.c, 5)}. Aero share at ${m.REFERENCE_SPEED_MPH} mph: ${fx(m.epaAeroShare(c, m.REFERENCE_SPEED_MPH), 2)} (generic ${fx(constants.AERO_FRACTION ?? m.EPA_DEFAULTS.AERO_FRACTION, 2)}).`, '');
        }
        L.push('| Test | Conditions | mi/kWh |', '|---|---|---|');
        for (const t of v.tests) L.push(`| ${testLabel(t)} | ${conditionText(t)} | ${fx(t.miPerKwh, 2)} |`);
        L.push('', '| Corrected → reference | Actual | Uncorrected | Generic | EPA curve |', '|---|---|---|---|---|');
        for (const p of v.pairs) {
            L.push(`| #${p.from.run.id} → #${p.ref.run.id} (${conditionText(p.from)} → ${conditionText(p.ref)}) | ${fx(p.actual, 2)} | ${missCell(p.misses.none)} | ${missCell(p.misses.generic)} | ${missCell(p.misses.epa)} |`);
        }
        L.push('');
    }

    L.push('## Left out', '');
    if (!check.leftOut.length) L.push('Nothing.');
    else {
        L.push('| Vehicle | Test | Why |', '|---|---|---|');
        for (const x of check.leftOut) L.push(`| ${vehicleName(x.vehicle)} | #${x.run.id} ${x.run.name} | ${m.CHECK_LEFT_OUT[x.reason]} |`);
    }
    if (!useMirror) L.push('', 'Unlisted tests are not visible to this read. `--mirror` includes them.');
    L.push('');
    return L.join('\n');
}

// ── Run ──────────────────────────────────────────────────────────────────────

const data = await loadData(useMirror ? mirrorReader() : await productionReader());
const constants = { ...(useDefaults ? {} : data.published), ...setValues };
const m = await loadModules(constants);

const byId = (rows) => new Map(rows.map(r => [r.id, r]));
const sessions = byId(data.sessions);
const sets = (id) => data.coefficientSets.filter(s => s.test_vehicle_id === id);
const vehicles = data.vehicles.map(v => ({
    ...v,
    runs: data.runs.filter(r => r.vehicle_id === v.id),
    epaMappings: data.mappings.filter(x => x.vehicle_id === v.id).map(x => ({
        isPrimary: x.is_primary,
        epaTestVehicle: { test_vehicle_id: x.test_vehicle_id, epa_coefficient_sets: sets(x.test_vehicle_id) },
    })),
}));
vehicles.sort((a, b) => b.runs.length - a.runs.length || a.name.localeCompare(b.name));
const check = m.correctionCheck(vehicles, { sessionOf: (r) => sessions.get(r.session_id) ?? null });
const fits = doFit ? ['generic', 'epa'].map(method => m.fitConstants(check.vehicles, method, { bootstrap })) : [];

const source = useMirror ? 'the local mirror, as admin (listed and unlisted tests)' : 'production, read with the public key (listed tests only)';
fs.mkdirSync(outDir, { recursive: true });
const stamp = `${new Date().toISOString().slice(0, 10)}${useMirror ? '-mirror' : ''}`;
const file = path.join(outDir, `correction-check-${stamp}.md`);
fs.writeFileSync(file, report({ m, check, fits, source, constants, published: data.published }));
console.log(`${check.vehicles.length} vehicles, ${check.pairs.length} test pairs, ${check.leftOut.length} tests left out.`);
console.log(`Report: ${file}`);

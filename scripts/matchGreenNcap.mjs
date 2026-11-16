#!/usr/bin/env node
/**
 * Write the Green NCAP matching review file: one line per car, a proposed
 * EVBench vehicle and why, and a `confirm` column for the owner.
 *
 *   node scripts/matchGreenNcap.mjs                      # live vehicles via PostgREST (.env)
 *   node scripts/matchGreenNcap.mjs --vehicles <file>    # a saved vehicles JSON instead
 *   node scripts/matchGreenNcap.mjs --dir <path>         # another download folder
 *
 * Reads <dir>/manifest.json (every electric car, published sheet or not) and
 * <dir>/parsed.json. Writes <dir>/vehicles.json (the snapshot it matched
 * against) and <dir>/matches.csv. A rerun keeps what is already in `confirm`.
 *
 * In `confirm`: "y" takes the proposed vehicle, a vehicle id takes that one
 * instead, "n" means no EVBench vehicle. Blank is not yet reviewed.
 * The matching is src/utils/matchGreenNcap.js.
 */
import { readFile, writeFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchGreenNcapCar, driveOf } from '../src/utils/matchGreenNcap.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null; };
const DIR = flag('--dir') ?? join(ROOT, 'LocalDev', 'green-ncap');
const vehiclesFile = flag('--vehicles');

const exists = p => access(p).then(() => true, () => false);
const readJson = async p => JSON.parse(await readFile(p, 'utf8'));

async function env() {
    const out = { ...process.env };
    const file = join(ROOT, '.env');
    if (await exists(file)) {
        for (const line of (await readFile(file, 'utf8')).split('\n')) {
            const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
            if (m && out[m[1]] == null) out[m[1]] = m[2];
        }
    }
    return out;
}

async function liveVehicles() {
    const e = await env();
    const url = e.VITE_SUPABASE_URL, key = e.VITE_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error('No VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env; pass --vehicles <file>');
    const res = await fetch(`${url}/rest/v1/vehicles?select=id,name,make,model,trim,year,visibility,spec_source_vehicle_id,specs&order=id&limit=5000`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!res.ok) throw new Error(`vehicles: HTTP ${res.status}`);
    return res.json();
}

const csvCell = v => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

function parseCsv(text) {
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (q) {
            if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
            else if (ch === '"') q = false;
            else cell += ch;
        } else if (ch === '"') q = true;
        else if (ch === ',') { row.push(cell); cell = ''; }
        else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
        else if (ch !== '\r') cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    const [head, ...body] = rows;
    return body.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

const label = v => `${v.make} ${v.model}${v.trim ? ' ' + v.trim : ''} [${v.year ?? '?'}]`;

async function main() {
    const manifest = await readJson(join(DIR, 'manifest.json'));
    const cars = Array.isArray(manifest) ? manifest : manifest.cars;
    const parsed = new Map((await readJson(join(DIR, 'parsed.json'))).map(p => [p.source.slug, p]));
    const vehicles = vehiclesFile ? await readJson(vehiclesFile) : await liveVehicles();
    await writeFile(join(DIR, 'vehicles.json'), JSON.stringify(vehicles, null, 1));

    const out = join(DIR, 'matches.csv');
    const kept = await exists(out) ? new Map(parseCsv(await readFile(out, 'utf8')).map(r => [r.slug, r.confirm])) : new Map();
    const byId = new Map(vehicles.map(v => [v.id, v]));

    const cols = ['slug', 'sheet', 'gn_make', 'gn_model', 'gn_variant', 'gn_drive', 'gn_year', 'gn_year_from',
        'gn_declared_kwh', 'gn_net_kwh', 'status', 'vehicle_id', 'vehicle', 'vehicle_drive', 'vehicle_kwh',
        'reason', 'other_candidates', 'confirm', 'page'];
    const rows = [];
    const tally = { match: 0, check: 0, none: 0 };
    for (const m of cars) {
        const p = parsed.get(m.slug);
        const id = p?.identity;
        const year = id?.vinModelYear ?? id?.testYear ?? m.year;
        const car = {
            make: id?.make ?? m.name?.split(' ')[0] ?? m.make,
            model: id?.model ?? m.model.replace(/-/g, ' '),
            variant: id?.variant ?? m.variant,
            drive: driveOf(id?.drivetrain) ?? driveOf(m.variant),
            year,
            declaredKwh: id?.declaredUsableKwh ?? null,
            netKwh: p?.battery?.netBatteryKwh ?? null,
        };
        // A two-word brand ("Alfa Romeo") from the listing: take the make slug instead.
        if (!id && m.make.includes('-')) car.make = m.make.replace(/-/g, ' ');
        const r = matchGreenNcapCar(car, vehicles, byId);
        tally[r.status]++;
        rows.push([m.slug, p ? 'yes' : 'not yet published', car.make, car.model, car.variant, car.drive, year,
            id?.vinModelYear ? 'VIN' : id?.testYear ? 'test year' : 'listing',
            car.declaredKwh, car.netKwh, r.status, r.best?.vehicle.id, r.best && label(r.best.vehicle), r.best?.drive,
            r.best?.kwh, r.reason, r.others.map(o => `${o.vehicle.id} ${label(o.vehicle)}`).join(' | '),
            kept.get(m.slug) ?? '', m.url]);
    }
    const order = { match: 0, check: 1, none: 2 };
    rows.sort((a, b) => order[a[10]] - order[b[10]] || a[0].localeCompare(b[0]));
    await writeFile(out, [cols, ...rows].map(r => r.map(csvCell).join(',')).join('\n') + '\n');
    console.log(`${cars.length} cars against ${vehicles.length} vehicles: ${tally.match} match, ${tally.check} to check, ${tally.none} none. Wrote ${out}`);
}

main().catch(e => { console.error(e.message ?? e); process.exit(1); });

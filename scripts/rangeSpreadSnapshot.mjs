/**
 * Writes the range-test snapshot the range-spread prototype draws from
 * (src/components/playground/rangeSpreadSnapshot.json).
 *
 * The playground reads no application data — playground.test.js asserts it —
 * so the prototype draws a frozen copy of the range tests instead of asking
 * Supabase. This reads the COPY blocks of a LocalDev SQL dump, the same way the
 * corpus measurements in #264 were made, and keeps only what a range bar needs.
 * Hidden and synthetic runs are left out, as the chart leaves them out.
 *
 *   node scripts/rangeSpreadSnapshot.mjs ../LocalDev/evbench-app-YYYYMMDD-HHMM.sql
 */
import { readFileSync, writeFileSync } from 'fs';
import { basename, join, dirname } from 'path';
import { fileURLToPath } from 'url';

const dump = process.argv[2];
if (!dump) { console.error('usage: node scripts/rangeSpreadSnapshot.mjs <dump.sql>'); process.exit(1); }
const lines = readFileSync(dump, 'utf8').split('\n');

function table(name) {
    const i = lines.findIndex(l => l.startsWith(`COPY public.${name} (`));
    const cols = lines[i].match(/\((.*)\) FROM/)[1].split(', ').map(c => c.replace(/"/g, ''));
    const rows = [];
    for (let j = i + 1; lines[j] !== '\\.'; j++) {
        const f = lines[j].split('\t').map(v => (v === '\\N' ? null : v));
        rows.push(Object.fromEntries(cols.map((c, k) => [c, f[k]])));
    }
    return rows;
}

const num = v => (v == null ? null : Number(v));
const vehicles = new Map(table('vehicles').map(v => [v.id, v]));
const sessions = new Map(table('test_sessions').map(s => [s.id, s]));

const byVehicle = new Map();
for (const r of table('runs')) {
    if (r.kind !== 'range' || r.is_hidden === 't' || r.synthetic === 't') continue;
    const v = vehicles.get(r.vehicle_id);
    if (!v) continue;
    // A run's own reading wins over its session's, as sessionFor does on the chart.
    const s = r.session_id ? sessions.get(r.session_id) : null;
    if (!byVehicle.has(v.id)) {
        byVehicle.set(v.id, {
            id: v.id,
            name: [v.year, v.make, v.name].filter(Boolean).join(' '),
            color: v.color,
            runs: [],
        });
    }
    byVehicle.get(v.id).runs.push({
        id: r.id,
        name: r.name,
        date: r.date,
        is_default: r.is_default === 't',
        start_soc: num(r.start_soc),
        end_soc: num(r.end_soc),
        distance_miles: num(r.distance_miles),
        energy_kwh: num(r.energy_kwh),
        speed_mph: num(r.speed_mph),
        speed_basis: r.speed_basis,
        temperature_f: num(r.temperature_f) ?? num(s?.temperature_f),
        altitude_ft: num(r.altitude_ft) ?? num(s?.altitude_ft),
    });
}

const out = {
    source: basename(dump),
    vehicles: [...byVehicle.values()].sort((a, b) => b.runs.length - a.runs.length || a.name.localeCompare(b.name)),
};
const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'src/components/playground/rangeSpreadSnapshot.json');
writeFileSync(target, JSON.stringify(out, null, 1) + '\n');
console.log(`${out.vehicles.length} vehicles, ${out.vehicles.reduce((n, v) => n + v.runs.length, 0)} range tests → ${target}`);

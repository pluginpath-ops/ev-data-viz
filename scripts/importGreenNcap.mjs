#!/usr/bin/env node
/**
 * Write the Green NCAP import as one SQL file, for the owner to run on the
 * local mirror and then in production (docs/green-ncap-plan.md, step 3).
 *
 *   node scripts/importGreenNcap.mjs               # LocalDev/green-ncap → import.sql
 *   node scripts/importGreenNcap.mjs --dir <path>  # another download folder
 *
 * Reads parsed.json (scripts/parseGreenNcap.mjs) and the owner's `confirm`
 * column in matches.csv (scripts/matchGreenNcap.mjs): "y" links the proposed
 * vehicle, a number links that vehicle, anything else links none. Every parsed
 * car is imported, linked or not. The SQL itself is
 * src/utils/greenNcapImportSql.js.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';
import { buildGreenNcapImportSql } from '../src/utils/greenNcapImportSql.js';

const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null; };
const DIR = flag('--dir') ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'LocalDev', 'green-ncap');

async function main() {
    const cars = JSON.parse(await readFile(join(DIR, 'parsed.json'), 'utf8'));
    const rows = Papa.parse(await readFile(join(DIR, 'matches.csv'), 'utf8'), { header: true, skipEmptyLines: true }).data;

    const vehicleFor = new Map();
    for (const r of rows) {
        const confirm = String(r.confirm ?? '').trim().toLowerCase();
        const id = confirm === 'y' ? Number(r.vehicle_id) : /^\d+$/.test(confirm) ? Number(confirm) : null;
        if (confirm === 'y' && !id) console.warn(`  ${r.slug}: confirmed, but no proposed vehicle`);
        if (id) vehicleFor.set(r.slug, id);
    }
    const parsedSlugs = new Set(cars.map(c => c.source.slug));
    for (const slug of vehicleFor.keys()) {
        if (!parsedSlugs.has(slug)) console.warn(`  ${slug}: linked, but its sheet is not published yet; nothing to import`);
    }

    const { sql, counts } = buildGreenNcapImportSql(cars, vehicleFor);
    const out = join(DIR, 'import.sql');
    await writeFile(out, sql);
    console.log(`${counts.assessments} assessments, ${counts.linked} linked, ${counts.rangeTests} BAB130 range tests. Wrote ${out}`);
}

main().catch(e => { console.error(e.message ?? e); process.exit(1); });

#!/usr/bin/env node
/**
 * Parse the Green NCAP sheets fetchGreenNcap.mjs downloaded.
 *
 *   node scripts/parseGreenNcap.mjs                 # every car in LocalDev/green-ncap
 *   node scripts/parseGreenNcap.mjs <slug> …        # just these
 *   node scripts/parseGreenNcap.mjs --dir <path>    # another download folder
 *   node scripts/parseGreenNcap.mjs --print <slug>  # one car's JSON to stdout
 *
 * Writes <slug>/parsed.json beside each sheet, and parsed.json (all cars) plus
 * summary.csv (one line per car, the figures worth eyeballing) at the top.
 * The parsing itself is src/utils/parseGreenNcapSheet.js; this file only
 * unzips the .ods and walks the folders.
 */
import { readFile, writeFile, readdir, access } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { odsSheets } from '../src/utils/odsSheets.js';
import { parseGreenNcapSheet } from '../src/utils/parseGreenNcapSheet.js';

const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null; };
const DIR = flag('--dir') ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'LocalDev', 'green-ncap');
const printSlug = flag('--print');
const only = new Set(args.filter(a => !a.startsWith('--')).concat(printSlug ?? []));

/** One file out of a zip, by name. Enough for an .ods: stored or deflated, no zip64. */
function unzipEntry(buf, wanted) {
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('not a zip file');
    let p = buf.readUInt32LE(eocd + 16);
    const count = buf.readUInt16LE(eocd + 10);
    for (let n = 0; n < count; n++) {
        const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
        const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
        const local = buf.readUInt32LE(p + 42);
        const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
        if (name === wanted) {
            const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
            const data = buf.subarray(start, start + size);
            if (method === 0) return data;
            if (method === 8) return inflateRawSync(data);
            throw new Error(`zip method ${method} not supported`);
        }
        p += 46 + nameLen + extraLen + commentLen;
    }
    throw new Error(`${wanted} not in archive`);
}

const exists = p => access(p).then(() => true, () => false);

async function parseOne(slug) {
    const dir = join(DIR, slug);
    const page = await exists(join(dir, 'page.json')) ? JSON.parse(await readFile(join(dir, 'page.json'), 'utf8')) : { slug };
    const xml = unzipEntry(await readFile(join(dir, 'sheet.ods')), 'content.xml').toString('utf8');
    const parsed = parseGreenNcapSheet(odsSheets(xml));
    const out = {
        source: {
            slug, url: page.url ?? null, sheetUrl: page.sheetUrl ?? null, datasheetUrl: page.datasheetUrl ?? null,
            listedAs: page.name ? `${page.name} ${page.variant}` : null, ratedOn: page.ratedOn ?? null,
            assessmentYear: page.year ?? null, fetchedAt: page.fetchedAt ?? null,
        },
        ...parsed,
    };
    await writeFile(join(dir, 'parsed.json'), JSON.stringify(out, null, 2));
    return out;
}

const csvCell = v => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

async function main() {
    const slugs = (await readdir(DIR, { withFileTypes: true }))
        .filter(d => d.isDirectory() && (!only.size || only.has(d.name)))
        .map(d => d.name).sort();
    const all = [];
    for (const slug of slugs) {
        if (!await exists(join(DIR, slug, 'sheet.ods'))) { console.warn(`  ${slug}: no sheet.ods`); continue; }
        try {
            const car = await parseOne(slug);
            all.push(car);
            if (car.warnings.length) console.warn(`  ${slug}: ${car.warnings.join('; ')}`);
        } catch (e) {
            console.warn(`  ${slug}: FAILED ${e.message}`);
        }
    }
    if (printSlug) { console.log(JSON.stringify(all.find(c => c.source.slug === printSlug), null, 2)); return; }
    if (only.size) { console.log(`Parsed ${all.length}`); return; }

    await writeFile(join(DIR, 'parsed.json'), JSON.stringify(all, null, 2));
    const test = (c, k) => c.tests.find(t => t.key === k);
    const cols = ['slug', 'layout', 'make', 'model', 'variant', 'test_year', 'vin_model_year', 'declared_usable_kwh',
        'net_battery_kwh', 'recharged_kwh', 'grid_to_battery', 'wltp_range_km', 'bab130_kwh_100km_battery',
        'bab130_range_km', 'bab130_range_mi', 'warm_range_km', 'on_road_range_km', 'fast_charge_points', 'warnings'];
    const rows = all.map(c => [c.source.slug, c.layout, c.identity.make, c.identity.model, c.identity.variant,
        c.identity.testYear, c.identity.vinModelYear, c.identity.declaredUsableKwh, c.battery.netBatteryKwh,
        c.battery.rechargedKwh, c.battery.gridToBattery, c.identity.wltpRangeKm,
        test(c, 'bab130')?.fromBatteryKwh100km, test(c, 'bab130')?.rangeKm, test(c, 'bab130')?.rangeMi,
        test(c, 'wltc_warm')?.rangeKm, test(c, 'on_road')?.rangeKm, c.fastCharging?.points.length ?? 0,
        c.warnings.join(' | ')]);
    await writeFile(join(DIR, 'summary.csv'), [cols, ...rows].map(r => r.map(csvCell).join(',')).join('\n') + '\n');
    console.log(`Parsed ${all.length} of ${slugs.length}; ${all.filter(c => c.warnings.length).length} with warnings. Wrote parsed.json and summary.csv in ${DIR}`);
}

main().catch(e => { console.error(e); process.exit(1); });

#!/usr/bin/env node
/**
 * Fetch Green NCAP's results sheets for every electric car it has assessed.
 *
 *   node scripts/fetchGreenNcap.mjs            # new assessments only
 *   node scripts/fetchGreenNcap.mjs --refresh  # download every sheet again
 *   node scripts/fetchGreenNcap.mjs kia-ev9-gt-line-2025-0229   # just these slugs
 *   node scripts/fetchGreenNcap.mjs --dir <path>                 # download elsewhere
 *
 * Writes LocalDev/green-ncap/<slug>/{sheet.ods, datasheet.pdf, page.json} and
 * LocalDev/green-ncap/manifest.json. LocalDev/ is git-ignored: the sheets are
 * Green NCAP's, not ours to commit.
 *
 * How the site is laid out (surveyed 2026-11-15):
 *   - www.greenncap.com/assessments/ lists every car in one table; each <tr>
 *     carries data-year, data-make, data-model, data-engine ("electric",
 *     "plug-in-hybrid", …) and data-href to the car's page.
 *   - A car's page links a test-results .ods (wp-content/uploads/test-results/
 *     <upload year>/…) and a datasheet PDF. File names do not follow the slug
 *     (older ones are "GreenNCAP_VW_ID3_2021_0060_SUMMARYSpreadSheet.ods"), so
 *     the links are read off the page, never built.
 *   - green-ncap.com (with the hyphen) did not resolve from here; greenncap.com does.
 */
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { GREEN_NCAP_DIR } from './mainCheckout.mjs';

const SITE = 'https://www.greenncap.com';
const UA = 'EVBench data import (non-commercial; one request at a time)';
const PAUSE_MS = 500;

const args = process.argv.slice(2);
// --dir <path>: download elsewhere. Default: the main checkout's LocalDev/, from a worktree too.
const dirAt = args.indexOf('--dir');
const OUT = dirAt >= 0 ? args.splice(dirAt, 2)[1] : GREEN_NCAP_DIR;
const refresh = args.includes('--refresh');
const only = new Set(args.filter(a => !a.startsWith('--')));

const sleep = ms => new Promise(res => setTimeout(res, ms));
const exists = p => access(p).then(() => true, () => false);
const decode = s => s.replace(/&amp;/g, '&').replace(/&hellip;/g, '…').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"');
const text = s => decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// The server drops a connection now and then mid-file; three tries, backing off.
async function get(url, as = 'text') {
    for (let attempt = 1; ; attempt++) {
        try {
            const res = await fetch(url, { headers: { 'User-Agent': UA } });
            if (!res.ok) throw new Error(`${res.status} ${url}`);
            return as === 'text' ? await res.text() : Buffer.from(await res.arrayBuffer());
        } catch (e) {
            if (attempt >= 3 || /^4\d\d /.test(e.message)) throw e;
            await sleep(2000 * attempt);
        }
    }
}

/** Every row of the assessments table, electric only. */
function listElectric(html) {
    const cars = [];
    for (const m of html.matchAll(/<tr data-id="(\d+)"([^>]*)>([\s\S]*?)<\/tr>/g)) {
        const a = Object.fromEntries([...m[2].matchAll(/data-([a-z-]+)="([^"]*)"/g)].map(x => [x[1], decode(x[2])]));
        if (a.engine !== 'electric') continue;
        const cell = cls => text(m[3].match(new RegExp(`<span class="${cls}">([\\s\\S]*?)</span>`))?.[1] ?? '');
        cars.push({
            id: m[1],
            slug: a.href.replace(/\/$/, '').split('/').pop(),
            url: a.href,
            year: Number(a.year),
            make: a.make,
            model: a.model,
            name: cell('car-name'),           // "Kia EV4"
            variant: cell('car-variant'),     // "81.4 kWh Earth electric FWD automatic"
            ratedOn: cell('date-list'),       // "Sep 2026"
        });
    }
    return cars;
}

const fileLinks = html => ({
    sheetUrl: html.match(/href="([^"]*\/test-results\/[^"]+\.(?:ods|xlsx?))"/i)?.[1] ?? null,
    datasheetUrl: html.match(/href="([^"]*\/datasheets\/[^"]+\.pdf)"/i)?.[1] ?? null,
});

async function main() {
    await mkdir(OUT, { recursive: true });
    const cars = listElectric(await get(`${SITE}/assessments/`))
        .filter(c => !only.size || only.has(c.slug));
    console.log(`${cars.length} electric assessments listed`);

    const manifest = [], failed = [];
    for (const car of cars) {
        const dir = join(OUT, car.slug);
        const sheetPath = join(dir, 'sheet.ods');
        if (!refresh && await exists(sheetPath)) {
            manifest.push(JSON.parse(await readFile(join(dir, 'page.json'), 'utf8')));
            continue;
        }
        await mkdir(dir, { recursive: true });
        try {
            const links = fileLinks(await get(car.url));
            const entry = { ...car, ...links, fetchedAt: new Date().toISOString() };
            // Newly rated cars can be listed before their sheet is up; a later run picks them up.
            if (!links.sheetUrl) {
                console.warn(`  no results sheet yet: ${car.slug}`);
            } else {
                await sleep(PAUSE_MS);
                if (!/\.ods$/i.test(links.sheetUrl)) console.warn(`  not .ods (${links.sheetUrl}) — the parser reads .ods only`);
                await writeFile(sheetPath, await get(encodeURI(decodeURI(links.sheetUrl)), 'buffer'));
            }
            if (links.datasheetUrl) {
                await sleep(PAUSE_MS);
                await writeFile(join(dir, 'datasheet.pdf'), await get(encodeURI(decodeURI(links.datasheetUrl)), 'buffer'));
            }
            await writeFile(join(dir, 'page.json'), JSON.stringify(entry, null, 2));
            manifest.push(entry);
            console.log(`  ${car.slug}`);
        } catch (e) {
            failed.push(car.slug);
            console.warn(`  FAILED ${car.slug}: ${e.cause?.message ?? e.message}`);
        }
        await sleep(PAUSE_MS);
    }
    manifest.sort((a, b) => a.slug.localeCompare(b.slug));
    if (!only.size) await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(`Done: ${manifest.length} cars in ${OUT}` + (failed.length ? `; ${failed.length} failed, run again: ${failed.join(' ')}` : ''));
    if (failed.length) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exit(1); });

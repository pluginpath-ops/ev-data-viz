/**
 * `npm run drift` — print the drift ledger without running the suite.
 *
 * The test can only tell you a number moved. This tells you what the numbers
 * ARE, which is what you need to decide what to clean up next — and it is why
 * the ledger is worth having at all. A ratchet you can only meet by accident
 * is a tax; a ratchet you can plan against is a backlog.
 *
 *   npm run drift            the table
 *   npm run drift <key>      every site behind one probe, with file:line
 *   npm run drift --all      every site behind every probe
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { LEDGER, EXEMPT, ROOT, measure } from './driftProbes.js';

const arg = process.argv[2];
const results = measure();

const BAR = '─'.repeat(72);

function pad(s, n) { return String(s).padEnd(n); }

if (arg && arg !== '--all') {
    const probe = results.find(p => p.key === arg);
    if (!probe) {
        console.error(`No probe named "${arg}". Known: ${LEDGER.map(p => p.key).join(', ')}`);
        process.exit(1);
    }
    console.log(`\n${probe.key} — ${probe.actual} in ${probe.scope}\n${BAR}`);
    console.log(`${probe.what}\n\nWhere it goes: ${probe.fix}\n${BAR}`);
    for (const f of probe.found) console.log(`  ${f.file}:${f.line}  ${f.hit}`);
    console.log();
    process.exit(0);
}

console.log(`\nDrift ledger — appearance written outside the theme\n${BAR}`);
console.log(`${pad('probe', 22)}${pad('now', 6)}${pad('ledger', 8)}scope`);
console.log(BAR);

let drifted = 0;
for (const p of results) {
    const moved = p.actual !== p.count;
    if (moved) drifted++;
    const delta = moved ? `  ${p.actual > p.count ? '▲' : '▼'} ${Math.abs(p.actual - p.count)}` : '';
    console.log(`${pad(p.key, 22)}${pad(p.actual, 6)}${pad(p.count, 8)}${p.scope}${delta}`);
}

const total = results.reduce((n, p) => n + p.actual, 0);
console.log(BAR);
console.log(`${pad('total', 22)}${pad(total, 6)}`);

// The two ratchets that live in their own suites, read straight from those
// files so this table cannot quietly go stale against them.
const readNum = (file, re) => (readFileSync(join(ROOT, file), 'utf8').match(re) || [])[1];
console.log(`\nRatcheted elsewhere (see driftProbes.mjs for why)`);
console.log(BAR);
console.log(`${pad('light surfaces', 22)}${pad(readNum('src/__tests__/contrast.test.js', /KNOWN_OFFENDERS = (\d+)/) ?? '?', 6)}src/__tests__/contrast.test.js`);
console.log(`${pad('dark overrides', 22)}${pad(readNum('src/__tests__/playground.test.js', /toBeLessThanOrEqual\((\d+)\)/) ?? '?', 6)}src/__tests__/playground.test.js`);

if (EXEMPT.length) {
    console.log(`\nExempt — correct code, never counted`);
    console.log(BAR);
    for (const e of EXEMPT) console.log(`  ${e.probe} · ${e.file}\n    ${e.why}`);
}

if (arg === '--all') {
    for (const p of results) {
        console.log(`\n${p.key}\n${BAR}`);
        for (const f of p.found) console.log(`  ${f.file}:${f.line}  ${f.hit}`);
    }
}

console.log(
    drifted
        ? `\n${drifted} probe${drifted === 1 ? '' : 's'} moved. A fall means you cleared some — `
          + `lower the count in scripts/driftProbes.mjs. A rise needs a reason in the PR.\n`
        : `\nEvery probe matches the ledger.\n`,
);


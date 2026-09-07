/**
 * `npm run css` — the stylesheet ledger, without running the suite.
 *
 * The test can only tell you a number moved. This tells you which classes are
 * behind it, which is what you need to fix one.
 *
 *   npm run css              the table
 *   npm run css <key>        every site behind one probe
 *   npm run css --all        every site behind every probe
 */
import { LEDGER, measure, stats, CSS_FILE } from './cssProbes.js';

const arg = process.argv[2];
const results = measure();
const BAR = '─'.repeat(72);
const pad = (s, n) => String(s).padEnd(n);

if (arg && arg !== '--all') {
    const probe = results.find(p => p.key === arg);
    if (!probe) {
        console.error(`No probe named "${arg}". Known: ${LEDGER.map(p => p.key).join(', ')}`);
        process.exit(1);
    }
    console.log(`\n${probe.key} — ${probe.actual} in ${CSS_FILE}\n${BAR}`);
    console.log(`${probe.what}\n\nWhere it goes: ${probe.fix}\n${BAR}`);
    for (const f of probe.found) console.log(`  ${f.label}${f.detail ? `   ${f.detail}` : ''}`);
    console.log();
    process.exit(0);
}

const s = stats();
console.log(`\nStylesheet ledger — ${CSS_FILE}\n${BAR}`);
console.log(`${pad('probe', 18)}${pad('now', 6)}${pad('ledger', 8)}what it counts`);
console.log(BAR);
for (const p of results) {
    const move = p.actual === p.count ? '' : (p.actual > p.count ? `  ▲ ${p.actual - p.count}` : `  ▼ ${p.count - p.actual}`);
    console.log(`${pad(p.key, 18)}${pad(p.actual, 6)}${pad(p.count, 8)}${p.what.split('.')[0]}${move}`);
}
console.log(BAR);

// Reported, not ratcheted: these move with ordinary feature work, and a
// ratchet that fires on every feature is one nobody runs.
console.log('\nContext — reported, not ratcheted');
console.log(BAR);
console.log(`${pad('lines', 18)}${s.lines}`);
console.log(`${pad('rules', 18)}${s.rules}`);
console.log(`${pad('classes', 18)}${s.classes}`);
console.log(`${pad('used once only', 18)}${s.onceOnly}   ${Math.round(s.onceOnly / s.classes * 100)}% of classes`);
console.log(BAR);

if (arg === '--all') {
    for (const p of results) {
        console.log(`\n${p.key} — ${p.actual}\n${BAR}`);
        for (const f of p.found) console.log(`  ${f.label}${f.detail ? `   ${f.detail}` : ''}`);
    }
}

const drifted = results.filter(p => p.actual !== p.count);
console.log(drifted.length === 0
    ? '\nEvery probe matches the ledger.\n'
    : `\n${drifted.length} probe(s) no longer match — update scripts/cssProbes.js.\n`);

/**
 * `npm run health` — every ratchet in this project, in one table.
 *
 * They accumulated one at a time, each in the suite that needed it, and they
 * are now in four places: a contrast ratchet in `contrast.test.js`, a
 * dark-override cap in the playground catalogue, ten drift probes in
 * `driftProbes.js`, three stylesheet probes in `cssProbes.js`. Each is
 * readable on its own and none of them answers "how is the codebase doing".
 *
 * This does not add a rule. It reads the same numbers the suites assert, so it
 * cannot disagree with them — if it says a target is met, the test agrees, and
 * if it drifts the test is already failing.
 *
 *   npm run health            the table
 *   npm run health --targets  the same, with what each number is heading for
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { measure as measureDrift, ROOT } from './driftProbes.js';
import { measure as measureCss, stats as cssStats } from './cssProbes.js';
import { DARK_OVERRIDE_CLASSES } from '../src/components/playground/catalogue.js';

const BAR = '═'.repeat(74);
const bar = '─'.repeat(74);
const pad = (s, n) => String(s).padEnd(n);
const showTargets = process.argv.includes('--targets');

/** The one ratchet that lives as a bare literal in a test file. */
function knownOffenders() {
    const src = readFileSync(join(ROOT, 'src', '__tests__', 'contrast.test.js'), 'utf8');
    return Number(/const KNOWN_OFFENDERS = (\d+);/.exec(src)?.[1] ?? NaN);
}

const rows = [];

// ── Appearance written outside the theme ───────────────────────────────────
const drift = measureDrift();
rows.push({ group: 'Theme', name: 'drift total', now: drift.reduce((n, p) => n + p.actual, 0),
    target: 0, note: 'npm run drift' });
for (const p of drift.filter(p => p.actual > 0)) {
    rows.push({ group: 'Theme', name: `  ${p.key}`, now: p.actual, target: 0, note: p.scope, sub: true });
}
rows.push({ group: 'Theme', name: 'hardcoded light surfaces', now: knownOffenders(), target: 0,
    note: 'KNOWN_OFFENDERS, contrast.test.js' });
rows.push({ group: 'Theme', name: 'dark overrides', now: DARK_OVERRIDE_CLASSES.size, target: 0,
    note: 'cannot follow a themed subtree' });

// ── The stylesheet itself ──────────────────────────────────────────────────
for (const p of measureCss()) {
    rows.push({ group: 'Stylesheet', name: p.key, now: p.actual, target: 0, note: 'npm run css' });
}
const cs = cssStats();
rows.push({ group: 'Stylesheet', name: 'lines', now: cs.lines, target: null, note: 'reported, not ratcheted' });
rows.push({ group: 'Stylesheet', name: 'classes', now: cs.classes, target: null, note: `${cs.onceOnly} used once` });

// ── Print ──────────────────────────────────────────────────────────────────
console.log(`\n${BAR}\n  EVBench — ratchets and where they are heading\n${BAR}`);
let group = null;
for (const r of rows) {
    if (r.group !== group) { group = r.group; console.log(`\n${group}\n${bar}`); }
    const target = r.target === null ? '—' : String(r.target);
    const cols = `${pad(r.name, 30)}${pad(r.now, 9)}`;
    console.log(showTargets ? `${cols}${pad(target, 9)}${r.note}` : `${cols}${r.note}`);
}
console.log(`\n${bar}`);
console.log(showTargets
    ? '  Target 0 means "should end at zero" — not "must be zero now".'
    : '  npm run health --targets  to see what each number is heading for.');
console.log(`${bar}\n`);

/**
 * `npm run vocab` — check what you are about to commit against the Retired
 * table in docs/vocabulary.md.
 *
 *   npm run vocab              changed lines vs main, working tree included
 *   npm run vocab --staged     just what is staged
 *   npm run vocab --text "…"   arbitrary prose — a PR title or description
 *   echo "…" | npm run vocab -- --text
 *
 * ── Changed lines only, and no ratchet ──────────────────────────────────────
 *
 * Unlike the drift ledger this carries no counts. Drift is a backlog being
 * worked down, so it needs a number that can fall; a retired word is one you
 * should simply never newly write, so the only acceptable answer on a line you
 * just touched is zero. Scoping to the diff is also what keeps it honest: the
 * tree holds retired words on purpose in places (see "Deferred renames" —
 * `.chart-rail` keeps its class name while the prose says sidebar), and a
 * whole-tree scan would report those forever until someone deleted the check.
 *
 * ── What is NOT checked, and why ────────────────────────────────────────────
 *
 * Four of the eight Retired rows cannot be matched without flagging correct
 * code, and driftProbes.js already has this project's position on that: "a
 * ledger that counts legitimate code teaches people to ignore it." These stay
 * with the reader, which is what the pledge in CLAUDE.md is for:
 *
 *   - "chrome" for the header. Chrome is ALSO the correct word for the whole
 *     category, so the wrong use is the one that means a specific region —
 *     a distinction that lives in the sentence, not the token.
 *   - "Runs" in UI text. `runs` is the table, the column, the prop and the
 *     variable; only the user-visible string is wrong, and which strings reach
 *     a user is not decidable by regex.
 *   - "pinning" for choosing vehicles. `pinned` is correct popover vocabulary
 *     and appears in five components that have nothing to do with the specs
 *     table.
 *   - a bare "band". Measured: 81 existing bare uses against 10 qualified
 *     ones, so on any line near the EPA curves this would fire constantly and
 *     be the first thing anyone learned to skip.
 */
import { execSync } from 'child_process';

// Straight from the Retired table. A row lands here only if its wrong use can
// be told from its right use by the token alone — see the header for the four
// that cannot.
const RETIRED = [
    {
        pattern: /\bthe rail\b/gi,
        write:   'accent border · sub-nav · sidebar — whichever you meant',
        why:     'meant all three at once, which is why the table exists',
    },
    {
        pattern: /\bselection strip\b/gi,
        write:   'chips',
        why:     'collided with "selection bar"',
    },
    {
        pattern: /\bsparklines?\b/gi,
        write:   'bar cell',
        why:     'a sparkline is a series drawn small; nothing here is a series',
    },
    {
        pattern: /\ball vehicles\b/gi,
        write:   'all tests',
        why:     'the widest recolor scope reseeds every run, not every vehicle',
    },
];

/**
 * The two files that hold every retired word on purpose.
 *
 * Caught by the check on its own first run, which is the right kind of proof
 * that it works — but a checker that fails on its own source, and a glossary
 * that fails for listing the words it retires, are both nonsense. Named
 * explicitly rather than pattern-matched, so a third file cannot quietly join
 * them.
 */
const SELF_EXEMPT = new Set(['scripts/vocabCheck.js', 'docs/vocabulary.md']);

const args    = process.argv.slice(2);
const flag    = (f) => args.includes(f);
const textArg = args[args.indexOf('--text') + 1];

/** Added lines from a diff, as {file, line, text}. */
function addedLines(range) {
    const diff = execSync(`git diff ${range} --unified=0`, {
        encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
    const out = [];
    let file = null, lineNo = 0;
    for (const raw of diff.split('\n')) {
        if (raw.startsWith('+++ b/')) { file = raw.slice(6); continue; }
        const hunk = raw.match(/^@@ .* \+(\d+)/);
        if (hunk) { lineNo = Number(hunk[1]); continue; }
        if (raw.startsWith('+') && !raw.startsWith('+++')) {
            out.push({ file, line: lineNo++, text: raw.slice(1) });
        }
    }
    return out;
}

function subject() {
    if (flag('--text')) {
        const text = textArg ?? execSync('cat', { encoding: 'utf8' });
        return {
            label: 'the supplied text',
            lines: text.split('\n').map((text, i) => ({ file: '(text)', line: i + 1, text })),
        };
    }
    if (flag('--staged')) {
        return { label: 'staged changes', lines: addedLines('--cached') };
    }
    // Everything this branch adds on top of main, working tree included — the
    // question being asked is "is what I am about to push clean", and an
    // uncommitted line is as much a part of that as a committed one.
    const base = execSync('git merge-base HEAD main', { encoding: 'utf8' }).trim();
    return { label: 'changes vs main (working tree included)', lines: addedLines(base) };
}

const { label, lines } = subject();
const hits = [];
for (const { file, line, text } of lines) {
    if (SELF_EXEMPT.has(file)) continue;
    for (const rule of RETIRED) {
        rule.pattern.lastIndex = 0;
        const found = text.match(rule.pattern);
        if (found) hits.push({ file, line, found: found[0], rule, text: text.trim() });
    }
}

console.log(`\nvocabulary — ${label}: ${lines.length} added line(s)\n`);

if (!hits.length) {
    console.log('  No retired terms.\n');
    console.log('  Four Retired rows are not machine-checkable ("chrome" for the header,');
    console.log('  "Runs" in UI text, "pinning", a bare "band") — those are on you.');
    console.log('  docs/vocabulary.md\n');
    process.exit(0);
}

for (const h of hits) {
    console.log(`  ${h.file}:${h.line}`);
    console.log(`    "${h.found}" → ${h.rule.write}`);
    console.log(`    ${h.rule.why}`);
    console.log(`    ${h.text.slice(0, 96)}\n`);
}
console.log(`  ${hits.length} retired term(s). docs/vocabulary.md\n`);
process.exit(1);

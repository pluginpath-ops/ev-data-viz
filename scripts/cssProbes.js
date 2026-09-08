/**
 * The stylesheet ledger — what `src/index.css` has accumulated.
 *
 * A sibling of `driftProbes.js`, and the same bargain: counts asserted with
 * `toBe`, so a fall is as loud as a rise and a cleanup becomes a recorded fact
 * rather than something someone remembers doing. Read it with `npm run css`.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * Two bugs in one week, neither of which any existing tool could see:
 *
 *   - `.specs-category-header` was defined twice, six hundred lines apart, for
 *     two unrelated components. The later rule won, so a table band silently
 *     inherited `@apply flex` on a `<td>` — which replaces `display:
 *     table-cell` and collapses colSpan. The band rendered one column wide.
 *
 *   - `.run-pair` and `.note-panel` were each shipped TWICE, 99 lines of
 *     identical declarations, because a script failed partway and its retry
 *     re-inserted the block. Behaviourally harmless and completely invisible.
 *
 * Neither the linter, the compiler, the tests nor the build says anything about
 * a stylesheet defining the same name twice. At 6,000 lines and 639 classes,
 * nobody holds the set in their head — which is the honest case for Tailwind's
 * popularity, and the reason to give the machine the job of remembering.
 *
 * ── The design risk, again ──────────────────────────────────────────────────
 *
 * A ledger that counts legitimate code teaches people to ignore it. Both
 * probes here were tightened until what they match is worth looking at:
 *
 *   - `redefined` counts SOLO selectors only. A grouped rule — shared metrics
 *     for `.import-badge-create, -update, -skip, -error` followed by one rule
 *     per variant for its colour — is good practice, and a naive count called
 *     it 25 redefinitions. Excluding groups takes it to 8, and all 8 are
 *     genuinely two places to look for one class.
 *
 *   - `near-identical` needs BOTH classes to carry at least three declarations.
 *     Without that floor every one-property class matches every other, and the
 *     probe reports a hundred pairs that share `display: flex`.
 *
 * A third candidate was dropped: total class count. It would fire on every
 * feature, which is the "lint that fails on arrival" CLAUDE.md warns against.
 * It is reported instead — see STATS — so the trend is visible without being
 * a tax on ordinary work.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSS_PATH = join(ROOT, 'src', 'index.css');

/** How alike two declaration sets must be before the pair is worth a look. */
const NEAR_THRESHOLD = 0.7;
/** Below this many declarations, "alike" means nothing. */
const MIN_DECLS = 3;

/**
 * Classes built by string interpolation, which no literal search can find.
 *
 * Listed rather than guessed at: a heuristic that treats any `is-` class as
 * possibly-constructed excuses every modifier in the stylesheet, which is most
 * of what the unreferenced probe exists to catch.
 */
export const CONSTRUCTED = {
    'nav-menu-main': 'NavMenu builds `nav-menu-${level}`.',
    'nav-menu-sub':  'NavMenu builds `nav-menu-${level}`.',
    'is-prose':      'RunSpecRows builds `is-${cell.tone}`.',
    'is-hue':        'SeriesColorPicker builds `color-slider-input is-${track}`.',
    'is-lightness':  'SeriesColorPicker builds `color-slider-input is-${track}`.',
    'is-saturation': 'SeriesColorPicker builds `color-slider-input is-${track}`.',
    'is-weak':       'SeriesColorPicker builds `text-caption${weak ? \' is-weak\' : \'\'}` '
        + 'when a colour falls under the 3:1 non-text contrast minimum.',
    'step-1': 'StatsHistogram builds `step-${n}` for its four-step fill.',
    'step-2': 'StatsHistogram builds `step-${n}` for its four-step fill.',
    'step-3': 'StatsHistogram builds `step-${n}` for its four-step fill.',
    'step-4': 'StatsHistogram builds `step-${n}` for its four-step fill.',
};

// ── Parsing ─────────────────────────────────────────────────────────────────

/**
 * Every top-level rule, as { selector, line, body }.
 *
 * Rules nested in an at-rule are skipped entirely: `.chart-rail` inside a
 * `@media` block is the SAME class being adjusted at a breakpoint, which is the
 * mechanism responsive CSS is made of, not a redefinition.
 */
export function topLevelRules(css = readFileSync(CSS_PATH, 'utf8')) {
    // Blank the comments but keep the newlines, so line numbers stay true.
    const src = css.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
    const rules = [];
    const stack = [];
    let buf = '', line = 1, seen = 0;

    for (let i = 0; i < src.length; i++) {
        const ch = src[i];
        if (ch === '{') {
            line += (src.slice(seen, i).match(/\n/g) || []).length;
            seen = i;
            const sel = buf.trim();
            stack.push({ sel, isAt: /^@/.test(sel), start: i, line });
            buf = '';
        } else if (ch === '}') {
            const frame = stack.pop();
            if (frame && !frame.isAt && !stack.some(f => f.isAt)) {
                rules.push({ sel: frame.sel, line: frame.line, body: src.slice(frame.start + 1, i) });
            }
            buf = '';
        } else {
            buf += ch;
        }
    }
    return rules;
}

const soloClass = (sel) => /^\.([a-z][a-z0-9-]*)$/.exec(sel.trim())?.[1] ?? null;

const declarationsOf = (body) => new Set(
    (body.match(/[a-z-]+\s*:\s*[^;]+/g) || []).map(d => d.replace(/\s+/g, ' ').trim()),
);

// ── Probes ──────────────────────────────────────────────────────────────────

/** A class whose own solo rule is written more than once, at the top level. */
export function redefined(rules = topLevelRules()) {
    const byName = new Map();
    for (const r of rules) {
        const name = soloClass(r.sel);
        if (!name) continue;
        if (!byName.has(name)) byName.set(name, []);
        byName.get(name).push(r.line);
    }
    return [...byName.entries()]
        .filter(([, lines]) => lines.length > 1)
        .map(([name, lines]) => ({ name, lines }))
        .sort((a, b) => a.lines[0] - b.lines[0]);
}

/**
 * Pairs of classes that say nearly the same thing.
 *
 * Jaccard over the declaration set: shared declarations divided by the union.
 * 1.00 means two names for one rule; 0.7 means one differs by a property or
 * two, which is usually a modifier that was written as a new class.
 */
export function nearIdentical(rules = topLevelRules()) {
    const cands = rules
        .map(r => ({ name: soloClass(r.sel), line: r.line, decls: declarationsOf(r.body) }))
        .filter(r => r.name && r.decls.size >= MIN_DECLS);

    const pairs = [];
    for (let i = 0; i < cands.length; i++) {
        for (let j = i + 1; j < cands.length; j++) {
            const a = cands[i], b = cands[j];
            if (a.name === b.name) continue;
            const shared = [...a.decls].filter(d => b.decls.has(d)).length;
            const score = shared / (a.decls.size + b.decls.size - shared);
            if (score >= NEAR_THRESHOLD) {
                pairs.push({ a: a.name, b: b.name, aLine: a.line, bLine: b.line, score: +score.toFixed(2) });
            }
        }
    }
    return pairs.sort((x, y) => y.score - x.score || x.aLine - y.aLine);
}

// ── Usage, for the reported stats ───────────────────────────────────────────

function sourceFiles(dir = join(ROOT, 'src'), out = []) {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) {
            if (entry !== '__tests__') sourceFiles(p, out);
        } else if (/\.jsx?$/.test(entry)) {
            out.push(p);
        }
    }
    return out;
}

/** Every class the stylesheet defines, however it is selected. */
export function definedClasses(rules = topLevelRules()) {
    const names = new Set();
    for (const r of rules) for (const m of r.sel.matchAll(/\.([a-z][a-z0-9-]*)/g)) names.add(m[1]);
    return names;
}

export function usage() {
    const rules = topLevelRules();
    const names = definedClasses(rules);
    const src = sourceFiles().map(f => readFileSync(f, 'utf8')).join('\n');
    const counts = new Map();
    for (const name of names) {
        const re = new RegExp(`(?<![a-z0-9-])${name.replace(/-/g, '\\-')}(?![a-z0-9-])`, 'g');
        counts.set(name, (src.match(re) || []).length);
    }
    const unreferenced = [...counts.entries()]
        .filter(([n, c]) => c === 0 && !(n in CONSTRUCTED))
        .map(([n]) => n).sort();
    return {
        classes: names.size,
        onceOnly: [...counts.values()].filter(c => c === 1).length,
        unreferenced,
        counts,
    };
}

// ── The ledger ──────────────────────────────────────────────────────────────

export const LEDGER = [
    {
        key: 'redefined',
        // 8 → 7: the popover pass merged `.info-icon-tooltip`, which was
        // defined twice — once for the base state and once to re-declare the
        // same `display: none` reasoning in a comment above it.
        count: 7,
        what: 'a class whose own solo rule is written more than once. Two places to '
            + 'look for what one class does, and the later one silently wins.',
        fix: 'merge them, or give the second one a modifier that says what it changes.',
        run: () => redefined().map(r => ({ label: `.${r.name}`, detail: `lines ${r.lines.join(', ')}` })),
    },
    {
        key: 'near-identical',
        count: 43,
        what: `pairs of classes at least ${NEAR_THRESHOLD * 100}% identical by declaration. `
            + 'Two names for one idea is how a 639-class stylesheet stops being holdable.',
        fix: 'one class, and a modifier for whatever genuinely differs.',
        run: () => nearIdentical().map(p => ({
            label: `${p.score.toFixed(2)}  .${p.a} ≈ .${p.b}`,
            detail: `lines ${p.aLine}, ${p.bLine}`,
        })),
    },
    {
        key: 'unreferenced',
        count: 20,
        what: 'classes the stylesheet defines that no source file names. Dead rules are '
            + 'invisible to the compiler, the linter and the tests alike.',
        fix: 'delete it, or add it to CONSTRUCTED with the template that builds it.',
        run: () => usage().unreferenced.map(n => ({ label: `.${n}`, detail: '' })),
    },
];

export function measure() {
    return LEDGER.map(probe => {
        const found = probe.run();
        return { ...probe, actual: found.length, found };
    });
}

/** Reported, not ratcheted — these move with ordinary feature work. */
export function stats() {
    const u = usage();
    return {
        lines: readFileSync(CSS_PATH, 'utf8').split('\n').length,
        classes: u.classes,
        onceOnly: u.onceOnly,
        rules: topLevelRules().length,
    };
}

export const CSS_FILE = relative(ROOT, CSS_PATH);

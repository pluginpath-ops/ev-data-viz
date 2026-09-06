/**
 * The drift ledger — what this codebase still paints outside the theme.
 *
 * ── Why a ledger and not a lint rule ────────────────────────────────────────
 *
 * The project already has a ratchet: `KNOWN_OFFENDERS` in
 * `src/__tests__/contrast.test.js`. It watches 61 things, and it reads as
 * though it watches "drift". It does not. It matches one narrow shape — a
 * LIGHT background utility with no `dark:` on the same line — which is about
 * 13% of the colour drift here and none of the size drift. Everything else
 * has been growing unwatched: 272 `text-<palette>-<shade>`, 102 `text-[Npx]`,
 * 62 raw hex literals.
 *
 * A lint rule that failed on all of those would fail on arrival, and this
 * project's own position on that is on record in CLAUDE.md: "a lint that fails
 * on arrival is one nobody runs". So this is a ledger instead. Each probe
 * carries a count asserted with `toBe`, which means it fails on a FALL as well
 * as a rise: clearing some drift is not silently absorbed, it is a number you
 * are made to lower. That is the only mechanism here that turns a cleanup into
 * a recorded fact rather than a thing someone remembers doing.
 *
 * ── The design risk, which matters more than the probes ─────────────────────
 *
 * A ledger that counts legitimate code teaches people to ignore it. A number
 * that is 30% false positives is not a ratchet, it is a wall someone will
 * eventually delete. So every probe here has been checked against what it
 * actually matches, and two candidate probes were DROPPED for failing that:
 *
 *   - Literal colours inside inline `style={{…}}`. There are 91 inline style
 *     blocks and, measured, ZERO of them hold a literal colour — they are all
 *     runtime values like `backgroundColor: run.color`, a series colour that
 *     can never be a class. Counting the blocks would have put 91 legitimate
 *     lines in the ledger on day one.
 *   - `#nnn` three-digit hex. Half the matches were issue references in
 *     comments (`#221`, `#195`). The hex probe below therefore requires a hex
 *     LETTER in the short forms, so a PR number in a comment can never move a
 *     drift count.
 *
 * ── What is NOT here, and why ───────────────────────────────────────────────
 *
 * Two ratchets live elsewhere and are deliberately left there rather than
 * gathered in for tidiness:
 *
 *   - `KNOWN_OFFENDERS` (contrast.test.js) asserts a CONTRAST claim — a fixed
 *     light surface with no dark counterpart is the invisible-input bug — and
 *     Phase 10 owns driving it to zero.
 *   - the `[data-theme="dark"] .foo` cap (playground.test.js) is bound to
 *     `DARK_OVERRIDE_CLASSES` in the playground catalogue, which marks those
 *     specimens in the side-by-side view. Splitting the count from the list it
 *     keeps in step would leave two half-guards.
 *
 * `npm run drift` prints all of it, including those two, so there is still one
 * place to LOOK even though there are three places to edit.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_DIRS = new Set(['node_modules', 'dist', '__tests__', '.git']);

/** Tailwind's default colour families. Deliberately not `[a-z]+` — that would */
/** swallow `text-primary`, `bg-card` and every other token-backed class. */
const FAMILY = 'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime'
    + '|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';

/** `-` before the property name would make `border-t-gray-200` two matches. */
const paletteFor = (props) =>
    new RegExp(`(?<![\\w-])(?:${props})(?:-[a-z]{1,2})?-(?:${FAMILY})-\\d{2,3}\\b`, 'g');

function walk(dir, ext, acc = []) {
    for (const entry of readdirSync(dir)) {
        if (SKIP_DIRS.has(entry)) continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, ext, acc);
        else if (entry.endsWith(ext)) acc.push(full);
    }
    return acc;
}

const jsxFiles = () => walk(join(ROOT, 'src'), '.jsx');
/** Canvas drawing lives in .js utilities as well as components. */
const chartJsFiles = () => [...jsxFiles(), join(ROOT, 'src', 'utils', 'chartUtils.js')];
const cssFile = () => join(ROOT, 'src', 'index.css');

/**
 * Matches that are correct code and must never be counted.
 *
 * Named and reasoned rather than silently subtracted, the way `ALLOWED_UNUSED`
 * in the wiring suite records a decision instead of an exemption. An entry here
 * is a claim that the thing CANNOT be a token, not that nobody got round to it.
 */
export const EXEMPT = [
    {
        probe: 'hex-literal',
        file: 'src/components/AuthModal.jsx',
        pattern: /#(?:4285F4|34A853|FBBC05|EA4335)/i,
        why: 'The Google mark. Those four hexes ARE the logo — re-valuing them '
            + 'against our palette would repaint someone else\'s trademark.',
    },
    {
        probe: 'off-scale-font-size',
        file: 'src/index.css',
        pattern: /--ui-scale/,
        why: 'The root `html` rule that APPLIES the scale knob. It is the '
            + 'mechanism every other size derives through, not a size itself.',
    },
];

const exemptions = (key, file) =>
    EXEMPT.filter(e => e.probe === key && relative(ROOT, file) === e.file);

function scanJsx(key, pattern) {
    const found = [];
    for (const file of jsxFiles()) {
        const src = readFileSync(file, 'utf8');
        const exempts = exemptions(key, file);
        src.split('\n').forEach((line, i) => {
            const hits = line.match(pattern);
            if (!hits) return;
            for (const hit of hits) {
                if (exempts.some(e => e.pattern.test(hit) || e.pattern.test(line))) continue;
                found.push({ file: relative(ROOT, file), line: i + 1, hit });
            }
        });
    }
    return found;
}

function scanJs(key, pattern) {
    const found = [];
    for (const file of chartJsFiles()) {
        const src = readFileSync(file, 'utf8');
        const exempts = exemptions(key, file);
        src.split('\n').forEach((line, i) => {
            const hits = line.match(pattern);
            if (!hits) return;
            for (const hit of hits) {
                if (exempts.some(e => e.pattern.test(hit) || e.pattern.test(line))) continue;
                found.push({ file: relative(ROOT, file), line: i + 1, hit: line.trim().slice(0, 90) });
            }
        });
    }
    return found;
}

function scanCss(key, test) {
    const file = cssFile();
    const exempts = exemptions(key, file);
    const found = [];
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (!test(line)) return;
        if (exempts.some(e => e.pattern.test(line))) return;
        found.push({ file: 'src/index.css', line: i + 1, hit: line.trim().slice(0, 90) });
    });
    return found;
}

/**
 * The ledger.
 *
 * `count` is the number as of the last time someone looked. `what` says what
 * the number MEANS, because a bare integer tells the next reader nothing about
 * whether 83 is bad. `fix` says where the drift is supposed to go, so lowering
 * one is a known move rather than a research task.
 *
 * A rise must be explained and justified in the PR that causes it.
 */
export const LEDGER = [
    {
        key: 'palette-text',
        count: 270,
        scope: 'src/**/*.jsx',
        what: 'Text colours written as Tailwind palette utilities. These sit outside '
            + 'the theme: when the re-skin re-valued the tokens, every one of these '
            + 'kept painting the old palette.',
        fix: 'The typography tiers — .text-secondary / .text-meta / .text-faint — or '
            + 'a semantic class carrying the colour.',
        scan: () => scanJsx('palette-text', paletteFor('text')),
    },
    {
        key: 'palette-bg',
        count: 125,
        scope: 'src/**/*.jsx',
        what: 'Background fills written as palette utilities. The subset of these that '
            + 'are LIGHT fills with no dark counterpart is separately ratcheted as '
            + 'KNOWN_OFFENDERS in contrast.test.js, because those are the ones that '
            + 'have actually shipped as unreadable screens.',
        fix: '--color-surface-muted for chrome; the status triad '
            + '(--color-warning-surface / -danger- / -success-) for meaning.',
        scan: () => scanJsx('palette-bg', paletteFor('bg')),
    },
    {
        key: 'palette-border',
        count: 85,
        scope: 'src/**/*.jsx',
        what: 'Border colours written as palette utilities.',
        fix: '--color-border, --color-border-strong, --color-border-subtle.',
        scan: () => scanJsx('palette-border', paletteFor('border')),
    },
    {
        key: 'palette-other',
        count: 2,
        scope: 'src/**/*.jsx',
        what: 'Palette colours on the remaining properties — ring, divide, gradient '
            + 'stops, fill, stroke. Small, and kept as its own probe so a new one '
            + 'cannot slip through the gap between the three probes above.',
        fix: 'The same tokens; these are usually --color-border in disguise.',
        scan: () => scanJsx('palette-other', paletteFor(
            'ring|divide|from|via|to|fill|stroke|outline|decoration|accent|caret|shadow',
        )),
    },
    {
        key: 'arbitrary-text-size',
        count: 102,
        scope: 'src/**/*.jsx',
        what: 'Font sizes written as arbitrary values — `text-[10px]`, `text-[11px]`. '
            + 'Every one is a size the global UI-scale knob cannot move and the type '
            + 'scale does not know about. This is the whole of the size drift: the '
            + 'existing ratchets see none of it.',
        fix: '.text-micro and .text-nano exist for exactly these. Where neither fits, '
            + 'a new role derived from --fs-body × --fs-step, not a literal.',
        scan: () => scanJsx('arbitrary-text-size', /(?<![\w-])text-\[(?!var\()[^\]]*(?:px|rem|em|pt)\]/g),
    },
    {
        key: 'hex-literal',
        count: 58,
        scope: 'src/**/*.jsx',
        what: 'Raw hex colours in component source. Mostly canvas drawing and the '
            + '`#3b82f6` default series colour, repeated at eight call sites rather '
            + 'than exported once.',
        fix: 'chartTheme() already reads the tokens for canvas work. A default series '
            + 'colour wants to be one exported constant.',
        // Six or eight digits, or a short form containing a hex LETTER — so an
        // issue reference in a comment (`#221`) can never move this number.
        scan: () => scanJsx(
            'hex-literal',
            /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{0,2}[a-fA-F][0-9a-fA-F]?(?![0-9a-fA-F]))\b/g,
        ),
    },
    {
        key: 'rgb-literal',
        count: 22,
        scope: 'src/**/*.jsx',
        what: 'rgb()/rgba()/hsl() colour literals, almost all of them canvas fills and '
            + 'alpha washes drawn by chart plugins. Canvas cannot take a class — but '
            + 'it can read a token, which is what chartTheme() is for.',
        fix: 'chartTheme(), or a token read through getComputedStyle at plugin-build '
            + 'time the way the bar plugins already do.',
        scan: () => scanJsx('rgb-literal', /\b(?:rgba?|hsla?)\(\s*\d/g),
    },
    {
        key: 'canvas-font-literal',
        count: 0,
        scope: 'src/**/*.jsx, src/utils/chartUtils.js',
        what: 'Canvas text drawn with a hardcoded font shorthand. Held at ZERO — it '
            + 'was 15 across seven files, every chart on the site labelling itself in '
            + '`11px system-ui` while the page around it rendered in Public Sans, and '
            + 'none of them moving when the --ui-scale knob did. This is the one probe '
            + 'that guards a surface already clean, because canvas is where the '
            + 'stylesheet cannot reach and drift here is invisible to every other '
            + 'guard in the repo.',
        fix: 'chartFonts() — family and size, both derived from --fs-body.',
        scan: () => scanJs('canvas-font-literal', /\.font\s*=\s*['"`][^'"`]*\d\s*px\s+(?!\$\{)/g),
    },
    {
        key: 'apply-palette',
        count: 19,
        scope: 'src/index.css',
        what: 'Semantic classes whose @apply line reaches for a palette colour. These '
            + 'are the sharpest kind of drift: the class NAME says the right thing, so '
            + 'nothing at the call site looks wrong, and the colour still misses the '
            + 'theme.',
        fix: 'Replace the utility with the token — `background-color: '
            + 'var(--color-warning-surface)` beside the @apply, not inside it.',
        scan: () => scanCss('apply-palette', line => new RegExp(
            `@apply[^;]*?(?<![\\w-])(?:text|bg|border|ring|divide|from|via|to)-(?:${FAMILY})-\\d{2,3}\\b`,
        ).test(line)),
    },
    {
        key: 'off-scale-font-size',
        count: 12,
        scope: 'src/index.css',
        what: 'font-size declarations that do not derive from the type scale. A size '
            + 'the --ui-scale knob cannot reach, in the stylesheet that defines the '
            + 'scale.',
        fix: 'var(--fs-<role>), or a calc() off --fs-body × --fs-step.',
        scan: () => scanCss('off-scale-font-size', (line) => {
            const m = line.match(/font-size\s*:\s*([^;]+);/);
            return !!m && !/var\(\s*--fs-/.test(m[1]);
        }),
    },
];

/** Every probe run, with actual counts alongside the recorded ones. */
export function measure() {
    return LEDGER.map(probe => {
        const found = probe.scan();
        return { ...probe, actual: found.length, found };
    });
}

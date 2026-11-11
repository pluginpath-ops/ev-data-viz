/**
 * The drift ledger — what this codebase still paints outside the theme.
 *
 * ── Why a ledger and not a lint rule ────────────────────────────────────────
 *
 * The project already has a ratchet: `KNOWN_OFFENDERS` in
 * `src/__tests__/contrast.test.js`. It watches nothing now (it is 0), and it once read as
 * though it watches "drift". It does not. It matches one narrow shape — a
 * LIGHT background utility (it used to excuse one with a `dark:` pair) — about
 * 13% of the color drift here and none of the size drift. Everything else
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
 *   - Literal colors inside inline `style={{…}}`. There are 91 inline style
 *     blocks and, measured, ZERO of them hold a literal color — they are all
 *     runtime values like `backgroundColor: run.color`, a series color that
 *     can never be a class. Counting the blocks would have put 91 legitimate
 *     lines in the ledger on day one.
 *   - `#nnn` three-digit hex. Half the matches were issue references in
 *     comments (`#221`, `#195`). The hex probe below therefore requires a hex
 *     LETTER in the short forms, so a PR number in a comment can never move a
 *     drift count.
 *
 * ── What is NOT here, and why ───────────────────────────────────────────────
 *
 * One ratchet lives elsewhere and is deliberately left there: `KNOWN_OFFENDERS`
 * (contrast.test.js) asserts a CONTRAST claim — a fixed light surface with no
 * dark counterpart is the invisible-input bug. `npm run drift` prints it too,
 * so there is still one place to LOOK.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_DIRS = new Set(['node_modules', 'dist', '__tests__', '.git']);

/** Tailwind's default color families. Deliberately not `[a-z]+` — that would */
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
        probe: 'css-color-literal',
        file: 'src/index.css',
        pattern: /#(?:ffffff|dadce0|1f1f1f|f8f9fa)\b/i,
        why: 'The Google sign-in button, to Google\'s own branding rules: white, '
            + 'their gray edge, their near-black label, in both themes.',
    },
    {
        probe: 'css-color-literal',
        file: 'src/index.css',
        pattern: /hsl\(|rgba\(0, 0, 0, 0\.55\)|background-color: #fff;/,
        why: 'The color picker\'s slider tracks and thumbs. A hue spectrum is the '
            + 'data being picked, and the thumb must show against every hue.',
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
 * As scanCss, with comments blanked first (line numbers kept). A probe that
 * looks for a color cannot tell `#277` in a note from a hex in a rule.
 */
function scanCssCode(key, test) {
    const file = cssFile();
    const exempts = exemptions(key, file);
    const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
    const found = [];
    code.split('\n').forEach((line, i) => {
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
        count: 0,  // 178 → 0: curator screens moved onto tokens — .status-text, .callout, .link-button (#296)
        scope: 'src/**/*.jsx',
        what: 'Text colors written as Tailwind palette utilities. These sit outside '
            + 'the theme: when the re-skin re-valued the tokens, every one of these '
            + 'kept painting the old palette.',
        fix: 'The typography tiers — .text-secondary / .text-meta / .text-faint — or '
            + 'a semantic class carrying the color.',
        scan: () => scanJsx('palette-text', paletteFor('text')),
    },
    {
        key: 'palette-bg',
        count: 0,  // 32 → 0: curator screens moved onto tokens (#296)
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
        count: 0,  // 29 → 0: curator screens moved onto tokens (#296)
        scope: 'src/**/*.jsx',
        what: 'Border colors written as palette utilities.',
        fix: '--color-border, --color-border-strong, --color-border-subtle.',
        scan: () => scanJsx('palette-border', paletteFor('border')),
    },
    {
        key: 'palette-other',
        count: 0,  // 1 → 0: the Road Trip table's row rules read --color-border (#296)
        scope: 'src/**/*.jsx',
        what: 'Palette colors on the remaining properties — ring, divide, gradient '
            + 'stops, fill, stroke. Small, and kept as its own probe so a new one '
            + 'cannot slip through the gap between the three probes above.',
        fix: 'The same tokens; these are usually --color-border in disguise.',
        scan: () => scanJsx('palette-other', paletteFor(
            'ring|divide|from|via|to|fill|stroke|outline|decoration|accent|caret|shadow',
        )),
    },
    {
        key: 'dark-variant',
        count: 0,  // 57 when the curator screens moved onto tokens and the variant was deleted (#296)
        scope: 'src/**/*.jsx',
        what: 'Tailwind `dark:` utilities. Held at ZERO. The stylesheet used to key '
            + '`dark:` to data-theme; that line is gone, and Tailwind\'s own `dark:` '
            + 'follows the device rather than the theme picker. One written now is '
            + 'wrong whenever the two differ, and inside a themed subtree always.',
        fix: 'A token. Both values live in the two token blocks, so one class '
            + 'serves both themes.',
        scan: () => scanJsx('dark-variant', /(?<![\w-])dark:[\w[-]+/g),
    },
    {
        key: 'arbitrary-text-size',
        count: 94,  // 96 → 95: the Admin EPA list's Test Group line became .text-caption (#374); 95 → 94: the accessory-load reference footnote became .text-meta (#449)
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
        count: 6,  // 38 → 15: chart text and lines read chartTheme(), and two retyped palettes import the one in colorUtils (#296). 15 → 6: the Admin role badges use the status triads (#296). Left: white labels on bars (4), which sit on a series color, and the zoom drag box (2)
        scope: 'src/**/*.jsx',
        what: 'Raw hex colors in component source. Mostly canvas drawing and the '
            + '`#3b82f6` default series color, repeated at eight call sites rather '
            + 'than exported once.',
        fix: 'chartTheme() already reads the tokens for canvas work. A default series '
            + 'color wants to be one exported constant.',
        // Six or eight digits, or a short form containing a hex LETTER — so an
        // issue reference in a comment (`#221`) can never move this number.
        scan: () => scanJsx(
            'hex-literal',
            /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{0,2}[a-fA-F][0-9a-fA-F]?(?![0-9a-fA-F]))\b/g,
        ),
    },
    {
        key: 'rgb-literal',
        count: 6,  // 20 → 9: the EPA curve plugin and the Road Trip lane lines read chartTheme() (#296). 9 → 6: Charge Stop's no-data bars and Road Trip's charge-stop wash read chartTheme() (#296). Left: plates under bar labels (4) and the zoom drag box (2)
        scope: 'src/**/*.jsx',
        what: 'rgb()/rgba()/hsl() color literals, almost all of them canvas fills and '
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
            + 'was 15 across seven files, every chart on the site labeling itself in '
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
        count: 0,  // 16 → 11 in the button and pill pass; 11 → 0 when light mode came back (#296)
        scope: 'src/index.css',
        what: 'Semantic classes whose @apply line reaches for a palette color. These '
            + 'are the sharpest kind of drift: the class NAME says the right thing, so '
            + 'nothing at the call site looks wrong, and the color still misses the '
            + 'theme.',
        fix: 'Replace the utility with the token — `background-color: '
            + 'var(--color-warning-surface)` beside the @apply, not inside it.',
        scan: () => scanCss('apply-palette', line => new RegExp(
            `@apply[^;]*?(?<![\\w-])(?:text|bg|border|ring|divide|from|via|to)-(?:${FAMILY})-\\d{2,3}\\b`,
        ).test(line)),
    },
    {
        key: 'off-scale-font-size',
        count: 9,
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
    {
        key: 'css-color-literal',
        count: 19,  // 27 when added (#296). 27 → 19: the media band's scrim and name follow the card color. Left: 9 plates and marks over the vehicle photo, 6 cycle bars, 2 card shadows, the modal overlay, the race-mode knob
        scope: 'src/index.css',
        what: 'Color literals in a rule, outside the token blocks. The stylesheet '
            + 'is where the tokens live, and until light mode came back (#296) '
            + 'nothing watched the rules beside them. What is left paints over a '
            + 'photograph (the media band), or is a mark that is dark in both '
            + 'themes (the cycle bars), or a shadow.',
        fix: 'A token. A wash wants `-surface`, an edge `-border`. Something that '
            + 'truly cannot follow the theme goes in EXEMPT with the reason.',
        scan: () => scanCssCode('css-color-literal', line =>
            // A token definition is the one place a literal belongs.
            !/^\s*--[a-z-]+\s*:/.test(line)
            && /#[0-9a-fA-F]{3,8}\b|\brgba?\(\s*\d|\bhsla?\(/.test(line)),
    },
];

/** Every probe run, with actual counts alongside the recorded ones. */
export function measure() {
    return LEDGER.map(probe => {
        const found = probe.scan();
        return { ...probe, actual: found.length, found };
    });
}

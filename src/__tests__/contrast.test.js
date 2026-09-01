/**
 * The contrast sweep.
 *
 * Every other suite checks what a function returns. This one checks something
 * no function returns: whether the text the site renders can actually be read.
 * That failure has shipped three times — a cream panel of towing inputs under
 * light text, a data cell that turned white while you typed into it, a
 * reorder box the same — and each time it was found by a person opening that
 * screen and squinting, because nothing here could see a colour.
 *
 * ── Why the token layer is the right place to check ─────────────────────────
 *
 * A rendered sweep would need a browser, a running server and a route for every
 * screen, and would still only cover the screens someone remembered to list.
 * The tokens are where the answer actually lives: a component that takes its
 * colours from `--color-warning-text` on `--color-warning-surface` is legible
 * exactly when that PAIR is legible, in both themes, and there are a few dozen
 * pairs rather than a few hundred screens.
 *
 * What that does not cover is a component ignoring the tokens and writing
 * `bg-amber-50` inline — which is what every one of the three bugs actually
 * did. So the second half of this file counts those, and holds the number
 * still. See `hardcoded light surfaces` below.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';
import { ratioOf, AA_NORMAL, AA_LARGE, parseColor } from '../utils/contrast';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CSS = readFileSync(join(ROOT, 'src', 'index.css'), 'utf8');

/**
 * The token values for one theme, read from the stylesheet itself.
 *
 * Parsed rather than duplicated here: a copy would pass forever while the real
 * palette drifted underneath it, which is the failure this suite exists to
 * catch rather than commit.
 */
function tokensFor(theme) {
    // Anchored to the start of a line, and not allowed to cross `;` or `}`.
    // Line 4 declares `@variant dark (&:where([data-theme="dark"], …))`, so a
    // pattern that may skip any characters up to the next `{` matches THERE and
    // then runs on into the light block — handing back the light palette
    // labelled as dark. The selector list itself is matched loosely, since
    // light is `:root, [data-theme="light"]` and pinning the exact text broke
    // twenty assertions when that gained a second selector.
    const block = theme === 'dark'
        ? CSS.match(/\n\[data-theme="dark"\][^{;}]*\{([\s\S]*?)\n\}/)
        : CSS.match(/\n:root[^{;}]*\{([\s\S]*?)\n\}/);
    if (!block) throw new Error(`no ${theme} token block found in index.css`);

    const out = {};
    for (const m of block[1].matchAll(/(--color-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
        out[m[1]] = m[2].trim();
    }
    // Dark overrides only what it changes, so it inherits the rest.
    return theme === 'dark' ? { ...tokensFor('light'), ...out } : out;
}

const THEMES = {
    light: tokensFor('light'),
    dark: tokensFor('dark'),
};

/** The opaque thing a translucent surface is painted on, per theme. */
const BASE = { light: '--color-card', dark: '--color-card' };

/**
 * Every text-on-surface pairing the design actually intends.
 *
 * Listed rather than derived from a cross product: most combinations are not
 * pairings anyone would write, and asserting them would fail on colours that
 * are never put together. Each entry is a claim that some component does — or
 * reasonably could — put this text on this surface.
 */
const PAIRINGS = [
    // Body text on every surface it lands on.
    ['--color-text-primary',   '--color-card'],
    ['--color-text-primary',   '--color-background'],
    ['--color-text-primary',   '--color-surface-muted'],
    ['--color-text-primary',   '--color-surface-sunken'],
    ['--color-text-primary',   '--color-surface-input'],
    ['--color-text-secondary', '--color-card'],
    ['--color-text-secondary', '--color-background'],
    ['--color-text-secondary', '--color-surface-muted'],
    ['--color-text-muted',     '--color-card'],
    ['--color-text-muted',     '--color-surface-muted'],

    // The callout triad, which is what this whole change added.
    ['--color-warning-text', '--color-warning-surface'],
    ['--color-danger-text',  '--color-danger-surface'],
    ['--color-success-text', '--color-success-surface'],
    ['--color-primary-text', '--color-primary-surface'],
    ['--color-primary-text', '--color-primary-light'],

    // A status panel sits on a card, so its text must clear the card too — a
    // 10% wash barely moves the background and cannot rescue a colour that
    // fails against what is underneath it.
    ['--color-warning-text', '--color-card'],
    ['--color-danger-text',  '--color-card'],
    ['--color-success-text', '--color-card'],
];

/**
 * Text that is deliberately quiet, held to the 3:1 large-text bar instead.
 *
 * `--color-text-faint` no longer has a class: the typography pass folded
 * `.text-faint` into `.text-meta`, which draws on `--color-text-muted` and
 * clears the full 4.5:1 — 282 sites of chrome that had been sitting at 2.43:1
 * in light mode.
 *
 * The token stays, and stays exempt, because it is still used for chart axes
 * and disabled states. Those are not body text and the large-text floor is the
 * right bar for them; what changed is that prose can no longer reach for it.
 */
const LARGE_TEXT_ONLY = new Set(['--color-text-faint']);

describe('the token blocks were actually found', () => {
    // A regex that silently matches the wrong block hands back a palette that
    // looks plausible and is simply the other theme's — which is exactly what
    // happened once, and every pairing still passed because light-on-light is
    // perfectly legible. Two cheap assertions make that failure loud.
    it('reads two DIFFERENT palettes', () => {
        expect(THEMES.light['--color-card']).toBeTruthy();
        expect(THEMES.dark['--color-card']).toBeTruthy();
        expect(THEMES.dark['--color-card']).not.toBe(THEMES.light['--color-card']);
    });

    it('does not mistake the @variant declaration for the dark block', () => {
        // Line 4 is `@variant dark (&:where([data-theme="dark"], …))`, which
        // contains the dark selector but declares no tokens.
        expect(THEMES.dark['--color-text-primary']).not.toBe(THEMES.light['--color-text-primary']);
    });
});

describe('every intended text/surface pairing is readable, in both themes', () => {
    for (const theme of ['light', 'dark']) {
        describe(theme, () => {
            for (const [fgTok, bgTok] of PAIRINGS) {
                it(`${fgTok} on ${bgTok}`, () => {
                    const t = THEMES[theme];
                    const fg = t[fgTok], bg = t[bgTok];
                    expect(fg, `${fgTok} is not defined`).toBeTruthy();
                    expect(bg, `${bgTok} is not defined`).toBeTruthy();

                    const ratio = ratioOf(fg, bg, t[BASE[theme]]);
                    expect(ratio, `could not parse ${fg} on ${bg}`).not.toBeNull();

                    const floor = LARGE_TEXT_ONLY.has(fgTok) ? AA_LARGE : AA_NORMAL;
                    expect(
                        Number(ratio.toFixed(2)),
                        `${fgTok} (${fg}) on ${bgTok} (${bg}) in ${theme} is ${ratio.toFixed(2)}:1, under ${floor}:1`,
                    ).toBeGreaterThanOrEqual(floor);
                });
            }
        });
    }
});

describe('the callout triad inverts between themes', () => {
    // The bug in one line. A light theme puts DARK text on a pale tint; a dark
    // theme must put LIGHT text on a dark wash. Carrying the light theme's text
    // colour across is exactly how amber-800 ended up on a dark panel.
    for (const intent of ['warning', 'danger', 'success']) {
        it(`${intent} text is dark in light mode and light in dark mode`, () => {
            const lum = (c) => {
                const { r, g, b } = parseColor(c);
                return (r + g + b) / 3;
            };
            const light = lum(THEMES.light[`--color-${intent}-text`]);
            const dark = lum(THEMES.dark[`--color-${intent}-text`]);
            expect(light).toBeLessThan(128);
            expect(dark).toBeGreaterThan(128);
        });
    }
});

// ── The half the token layer cannot see ─────────────────────────────────────

const SKIP_DIRS = new Set(['node_modules', 'dist', '__tests__', '.git']);

function jsxFiles(dir, acc = []) {
    for (const entry of readdirSync(dir)) {
        if (SKIP_DIRS.has(entry)) continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) jsxFiles(full, acc);
        else if (entry.endsWith('.jsx')) acc.push(full);
    }
    return acc;
}

/**
 * A light background written inline, with no dark counterpart.
 *
 * `bg-amber-50` and `bg-white` are fixed light colours. In dark mode the text
 * on them is light too, and the result is the invisible-input bug. A
 * `dark:bg-…` beside it means someone thought about it; nothing beside it means
 * nobody did.
 */
const LIGHT_BG = /\bbg-(?:white|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200))\b/g;

function offenders() {
    const found = [];
    for (const file of jsxFiles(join(ROOT, 'src'))) {
        const src = readFileSync(file, 'utf8');
        for (const line of src.split('\n')) {
            const hits = line.match(LIGHT_BG);
            // A dark: variant anywhere on the line means the pair was considered.
            if (hits && !/\bdark:bg-/.test(line)) {
                found.push(`${relative(ROOT, file)}: ${hits.join(' ')}`);
            }
        }
    }
    return found.sort();
}

/**
 * The backlog, held still.
 *
 * A count rather than a ban, and a warn-shaped rule rather than a wall: there
 * are already dozens of these and "a lint that fails on arrival is one nobody
 * runs" is this project's own stated position on exactly that trade-off.
 *
 * What it buys is the ratchet. Adding a new hardcoded light surface fails this
 * test and the message says which file; removing one fails it too, and the fix
 * is to lower the number — which makes the backlog a thing that only ever goes
 * down. Migrating a cluster onto `--color-warning-surface` and friends is how
 * it goes down.
 *
 * A LITERAL, not `offenders().length`, which is what the first version wrote —
 * a number derived from the thing it checks always equals itself, so the test
 * passed and could never have failed.
 *
 * 79 at the sweep that added this; RunsView holds 31 of them.
 */
const KNOWN_OFFENDERS = 74;

describe('hardcoded light surfaces', () => {
    it('does not grow', () => {
        const now = offenders();
        expect(
            now.length,
            now.length > KNOWN_OFFENDERS
                ? `New hardcoded light background with no dark: variant. Use a token — `
                  + `--color-warning-surface / --color-danger-surface / --color-success-surface, `
                  + `or --color-surface-muted for plain chrome.\n${now.join('\n')}`
                : `${KNOWN_OFFENDERS - now.length} fixed — lower KNOWN_OFFENDERS to ${now.length}.`,
        ).toBe(KNOWN_OFFENDERS);
    });
});

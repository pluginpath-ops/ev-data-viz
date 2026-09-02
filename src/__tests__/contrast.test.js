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
    // The FIRST matching block is not reliably the palette. `:root` is declared
    // four times in this stylesheet — the palette, the radius scale, the type
    // scale, and the magnitude-bar tokens — and taking match[0] made the light
    // palette come back EMPTY the moment a radius block was added above it.
    // Every block is collected and the ones declaring no `--color-*` are
    // skipped, so the parser depends on what a block CONTAINS rather than on
    // where it happens to sit in the file.
    const pattern = theme === 'dark'
        ? /\n\[data-theme="dark"\][^{;}]*\{([\s\S]*?)\n\}/g
        : /\n:root[^{;}]*\{([\s\S]*?)\n\}/g;

    const out = {};
    let found = false;
    for (const block of CSS.matchAll(pattern)) {
        const entries = [...block[1].matchAll(/(--color-[a-z0-9-]+)\s*:\s*([^;]+);/g)];
        if (!entries.length) continue;
        found = true;
        for (const m of entries) out[m[1]] = m[2].trim();
    }
    if (!found) throw new Error(`no ${theme} token block found in index.css`);
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

    // ── The re-skin's tiers ────────────────────────────────────────────────
    // The design handoff runs eight greys where the palette ran four. Each new
    // one is listed against the surfaces its screens actually paint it on.
    //
    // The handoff's own ninth value — a #5a6474 micro-label — is deliberately
    // ABSENT, and not by oversight: it measures 3.07:1 on the panel, and the
    // 9-10px uppercase labels it was drawn for cannot claim the large-text
    // allowance. The tier merged upward into --color-text-meta rather than
    // being exempted here. Exempting it would have been the easy fix and would
    // have taught this suite to lie.
    ['--color-text-value',        '--color-card'],
    ['--color-text-value',        '--color-surface-muted'],
    ['--color-text-value',        '--color-surface-sunken'],
    ['--color-text-header-label', '--color-card'],
    ['--color-text-header-label', '--color-surface-sunken'],
    ['--color-text-meta',         '--color-card'],
    ['--color-text-meta',         '--color-background'],
    ['--color-text-meta',         '--color-surface-muted'],

    // Links and accent text, on every panel they appear over.
    ['--color-text-link',   '--color-card'],
    ['--color-text-link',   '--color-surface-muted'],
    ['--color-text-accent', '--color-card'],

    // The purpose-built surfaces. Each is a row or a panel carrying ordinary
    // body text, so primary has to clear all of them.
    ['--color-text-primary', '--color-cluster'],
    ['--color-text-primary', '--color-popover'],
    ['--color-text-primary', '--color-pinned'],
    ['--color-text-primary', '--color-pinned-head'],
    ['--color-text-secondary', '--color-popover'],
    ['--color-text-secondary', '--color-pinned'],

    // The nav fill is the one surface here that is not a neutral: an active tab
    // and the sub-nav strip beneath it are both painted on it. It is DARK in
    // both themes, which is why it carries its own text tokens — pairing it
    // with --color-text-primary passes in dark and fails at 2.65:1 in light,
    // where "primary text" means near-black.
    ['--color-text-on-nav',   '--color-nav-active'],
    ['--color-text-nav-meta', '--color-nav-active'],
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

/**
 * Both themes declare the same token NAMES.
 *
 * Light is deferred during the re-skin: the design handoff draws dark only, and
 * light's values for anything the re-skin introduced are provisional
 * placeholders. What must not happen is a token reaching dark and never reaching
 * light at all — that one does not degrade to "an unpolished colour", it
 * degrades to no declaration, so the property falls back through the cascade to
 * whatever an ancestor happened to set, or to nothing.
 *
 * The pairings above cannot catch it: an undefined token fails only if someone
 * remembered to pair it. This is the check that does not need remembering, and
 * it is what keeps the eventual light pass a re-value rather than an excavation.
 */
/**
 * White on a FILLED control — the site's oldest unfixed contrast gap.
 *
 * Every `.btn-*` variant paints `color: white` on a solid `--color-<intent>`,
 * and most of those pairings have never cleared 4.5:1. It is not a re-skin
 * regression. Measured on `main` before the palette changed, ten of the
 * playground's live specimens were already failing, and the same eight token
 * pairings this counts were already under AA. The new palette moved every one
 * of them the right way in dark — warning 2.15 → 2.46, edit 2.28 → 2.66,
 * primary 3.68 → 3.81, danger 3.76 → 4.09 — and moved none of them wrong.
 *
 * (Two DID regress while the palette was being written, and both were caught
 * here rather than in review: --color-secondary at the handoff's #6b7a8f fell
 * to 4.38, and a solid danger read straight off the handoff's NOT-chip tint
 * fell to 3.49. Both were darkened. That is the argument for this block.)
 *
 * So this is a RATCHET rather than a pass/fail bar, on the same principle as
 * `hardcoded light surfaces` below. Asserting 4.5:1 outright would paint the
 * suite red on day one for a decision nobody has made yet, and a suite that is
 * always red stops being read. Asserting the COUNT holds the debt still and
 * makes fixing any one of them a visible, deliberate act.
 *
 * The real fix is a decision, not a tweak: either the fills darken (which moves
 * them off the handoff's pinned accents) or the labels get large-text metrics.
 * Neither belongs in the foundation phase.
 */
// `parseColor` handles hex, rgb/rgba and oklch — not CSS keywords, and the
// button rules say `color: white` literally.
const WHITE = 'rgb(255, 255, 255)';

const FILLED_CONTROLS = [
    '--color-primary',
    '--color-edit',
    '--color-danger',
    '--color-secondary',
    '--color-warning',
];

describe('white on a filled control', () => {
    // Pairings under 4.5:1 right now, across both themes. Lower this when one
    // is fixed; it fails on a rise AND on a fall, so neither goes unnoticed.
    const KNOWN_LOW = 8;

    it('does not grow', () => {
        const low = [];
        for (const theme of ['light', 'dark']) {
            for (const tok of FILLED_CONTROLS) {
                const t = THEMES[theme];
                const ratio = ratioOf(WHITE, t[tok], t[BASE[theme]]);
                expect(ratio, `could not parse white on ${tok}`).not.toBeNull();
                if (ratio < AA_NORMAL) low.push(`${theme} ${tok} ${ratio.toFixed(2)}:1`);
            }
        }
        expect(
            low.length,
            low.length > KNOWN_LOW
                ? `A filled control dropped below AA. Darken the fill, or leave the `
                  + `token alone.\n${low.join('\n')}`
                : `${KNOWN_LOW - low.length} fixed — lower KNOWN_LOW to ${low.length}.`
              + `\n${low.join('\n')}`,
        ).toBe(KNOWN_LOW);
    });
});

describe('the two themes declare the same tokens', () => {
    it('nothing is defined in one theme and missing from the other', () => {
        const onlyDark = Object.keys(THEMES.dark).filter(k => !(k in tokensFor('light')));
        const onlyLight = Object.keys(tokensFor('light')).filter(k => !(k in tokensFor('dark')));
        expect(
            { onlyDark, onlyLight },
            'Add the missing token to the other theme block. If it is a re-skin '
            + 'addition, give light a provisional value and mark it '
            + '`/* provisional — light pass */` so the light pass can find it.',
        ).toEqual({ onlyDark: [], onlyLight: [] });
    });
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
 * 79 at the sweep that added this, 74 after it, 71 once the re-skin's vehicle
 * card dropped the green `bg-green-100` visibility pill and the `bg-blue-50`
 * footer button for tokens, 69 once .badge-status gained real intents and
 * stopped every call site bringing its own bg-amber-50 / bg-red-50 cluster.
 * RunsView holds 31 of what is left.
 */
const KNOWN_OFFENDERS = 63;

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

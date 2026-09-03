/**
 * The playground's two guarantees.
 *
 * 1. COMPLETE — every class in an owned family is catalogued, or explicitly
 *    excused. A menu with items missing from it is worse than no menu, because
 *    the missing ones are exactly the divergent ones nobody remembered.
 *
 * 2. INERT — the page reads no data and performs no action. It is reachable by
 *    URL without a role, deliberately, and that is only safe while it stays a
 *    catalogue of appearances. The day a specimen gains a real action, "hidden
 *    by obscurity" stops being enough — so this asserts it instead of trusting
 *    a comment.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { OWNED_FAMILIES, NOT_CATALOGUED, SECTIONS, cataloguedClasses, DARK_OVERRIDE_CLASSES } from '../components/playground/catalogue';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CSS = readFileSync(join(ROOT, 'src', 'index.css'), 'utf8');

/**
 * Every class the stylesheet defines.
 *
 * Selector text is isolated first — everything between the previous `}` and the
 * next `{`, with comments stripped — and then every `.name` inside it counts.
 * Matching `.name` only at the start of a line misses the second class of a
 * compound selector, and `.btn.btn-sm` is exactly that: `btn-sm` looked
 * undefined, so a specimen using it was reported as an orphan.
 */
function definedClasses() {
    const withoutComments = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    const out = new Set();
    for (const m of withoutComments.matchAll(/(?:^|\}|;)([^{}]*)\{/g)) {
        const selector = m[1];
        // Skip at-rules — `@media (max-width: 60rem)` has no classes of its own,
        // and its nested rules are matched on their own pass.
        if (/@[a-z]/i.test(selector)) continue;
        for (const c of selector.matchAll(/\.([a-z][a-z0-9-]*)/g)) out.add(c[1]);
    }
    return out;
}

describe('the catalogue covers every control it claims to own', () => {
    const defined = [...definedClasses()];
    const catalogued = cataloguedClasses();

    for (const family of OWNED_FAMILIES) {
        it(`${family.label}: nothing missing`, () => {
            const missing = defined
                .filter(family.match)
                .filter(n => !catalogued.has(n) && !(n in NOT_CATALOGUED));

            expect(
                missing,
                `Defined in index.css but absent from the playground catalogue.\n`
                + `Add a specimen to SECTIONS, or an entry to NOT_CATALOGUED with a reason:\n`
                + missing.map(n => `  .${n}`).join('\n'),
            ).toEqual([]);
        });
    }

    it('excuses only classes that exist and are actually owned', () => {
        // A stale excuse hides a class that was renamed or deleted, and quietly
        // shrinks what the catalogue is checked against.
        for (const name of Object.keys(NOT_CATALOGUED)) {
            expect(defined, `.${name} is excused but no longer defined`).toContain(name);
            expect(
                OWNED_FAMILIES.some(f => f.match(name)),
                `.${name} is excused but is not in an owned family — the excuse does nothing`,
            ).toBe(true);
            expect(NOT_CATALOGUED[name].length, `.${name} needs a reason`).toBeGreaterThan(10);
        }
    });

    it('catalogues only classes that exist', () => {
        // The other direction: a specimen for a class the stylesheet no longer
        // has renders an unstyled box that looks like a design decision.
        const orphans = [...catalogued].filter(n => !definedClasses().has(n));
        expect(orphans, `Catalogued but not defined in index.css: ${orphans.join(', ')}`).toEqual([]);
    });
});

describe('the classes that cannot follow a themed subtree', () => {
    /**
     * Classes the stylesheet styles via `[data-theme="dark"] .foo`.
     *
     * Comments stripped FIRST. A comment explaining why a dark override once
     * existed still contains the selector, so scanning the raw text counted the
     * explanation as an occurrence — `.guide-chip` stayed on this list after its
     * last real rule was deleted, purely because the note about it survived. A
     * backlog metric that a paragraph of prose can inflate is not a metric.
     */
    const actual = new Set(
        [...CSS.replace(/\/\*[\s\S]*?\*\//g, '')
            .matchAll(/\[data-theme="dark"\]\s+\.([a-z][a-z0-9-]*)/g)].map(m => m[1]),
    );

    it('matches what the stylesheet actually does', () => {
        // Kept in step with index.css rather than remembered. A stale list marks
        // the wrong specimens and, worse, stops marking the right ones — and the
        // marker is the only thing telling a reader that the side-by-side view
        // is showing them the document theme rather than the pane's.
        const missing = [...actual].filter(c => !DARK_OVERRIDE_CLASSES.has(c));
        const stale = [...DARK_OVERRIDE_CLASSES].filter(c => !actual.has(c));

        expect(missing, `Gained a [data-theme="dark"] override — add to DARK_OVERRIDE_CLASSES, `
            + `or better, move it onto tokens: ${missing.join(', ')}`).toEqual([]);
        expect(stale, `No longer has a dark override — remove from DARK_OVERRIDE_CLASSES `
            + `(it moved onto tokens, which is the point): ${stale.join(', ')}`).toEqual([]);
    });

    it('is a backlog that should shrink, never grow', () => {
        // 17 when the marker was added, 15 after #277, 13 once the re-skin's
        // chrome phase rebuilt .btn-tab on tokens and deleted
        // .app-header-compact with the photo hero, 12 once .badge-default
        // became the mono DEF marker, 11 once the curve tier badges moved onto
        // .badge-micro's intents, 10 once the curve picker's selected row took
        // --color-popover. Lower it as classes move; a rise means a new class
        // was written the old way.
        expect(actual.size).toBeLessThanOrEqual(10);
    });
});

describe('the playground is inert', () => {
    const files = ['components/playground/Playground.jsx', 'components/playground/catalogue.js']
        .map(f => ({ f, src: readFileSync(join(ROOT, 'src', f), 'utf8') }));

    it('reads no application data', () => {
        // No context, no service, no fetch. A specimen is a class on an empty
        // element; the moment it needs a vehicle, this page is no longer safe
        // to serve without a role.
        for (const { f, src } of files) {
            for (const banned of ['useAppContext', 'DataService', 'dataService', 'supabase', 'fetch(']) {
                expect(src.includes(banned), `${f} references ${banned}`).toBe(false);
            }
        }
    });

    it('wires no specimen to an action', () => {
        // Specimens are rendered from data, and the data carries no handlers —
        // so a catalogue entry cannot smuggle one in.
        for (const section of SECTIONS) {
            for (const spec of section.specimens) {
                for (const key of Object.keys(spec)) {
                    expect(/^on[A-Z]/.test(key), `${spec.cls} declares a handler: ${key}`).toBe(false);
                }
                expect(typeof spec.cls).toBe('string');
            }
        }
    });

    it('is not linked from the navigation', () => {
        // Hidden by obscurity is a decision, and it only holds while nothing
        // points at it. A nav entry would make it a public page by accident.
        const app = readFileSync(join(ROOT, 'src', 'App.jsx'), 'utf8');
        const navLinks = app.match(/navigateTo\('playground'\)/g) ?? [];
        expect(navLinks).toEqual([]);
    });
});

describe('the catalogue is well formed', () => {
    it('has no duplicate specimens within a section', () => {
        for (const section of SECTIONS) {
            const keys = section.specimens.map(s => `${s.cls}|${s.label}`);
            expect(new Set(keys).size, `duplicate specimen in ${section.title}`).toBe(keys.length);
        }
    });

    it('gives every specimen a label', () => {
        for (const section of SECTIONS) {
            for (const spec of section.specimens) {
                expect(spec.label, `${spec.cls} has no label`).toBeTruthy();
            }
        }
    });
});

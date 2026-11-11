/**
 * The playground's two guarantees.
 *
 * 1. COMPLETE — every class in an owned family is cataloged, or explicitly
 *    excused. A menu with items missing from it is worse than no menu, because
 *    the missing ones are exactly the divergent ones nobody remembered.
 *
 * 2. INERT — the page reads no data and performs no action. It is reachable by
 *    URL without a role, deliberately, and that is only safe while it stays a
 *    catalog of appearances. The day a specimen gains a real action, "hidden
 *    by obscurity" stops being enough — so this asserts it instead of trusting
 *    a comment.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { OWNED_FAMILIES, NOT_CATALOGED, SECTIONS, catalogedClasses } from '../components/playground/catalog';

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

describe('the catalog covers every control it claims to own', () => {
    const defined = [...definedClasses()];
    const cataloged = catalogedClasses();

    for (const family of OWNED_FAMILIES) {
        it(`${family.label}: nothing missing`, () => {
            const missing = defined
                .filter(family.match)
                .filter(n => !cataloged.has(n) && !(n in NOT_CATALOGED));

            expect(
                missing,
                `Defined in index.css but absent from the playground catalog.\n`
                + `Add a specimen to SECTIONS, or an entry to NOT_CATALOGED with a reason:\n`
                + missing.map(n => `  .${n}`).join('\n'),
            ).toEqual([]);
        });
    }

    it('excuses only classes that exist and are actually owned', () => {
        // A stale excuse hides a class that was renamed or deleted, and quietly
        // shrinks what the catalog is checked against.
        for (const name of Object.keys(NOT_CATALOGED)) {
            expect(defined, `.${name} is excused but no longer defined`).toContain(name);
            expect(
                OWNED_FAMILIES.some(f => f.match(name)),
                `.${name} is excused but is not in an owned family — the excuse does nothing`,
            ).toBe(true);
            expect(NOT_CATALOGED[name].length, `.${name} needs a reason`).toBeGreaterThan(10);
        }
    });

    it('catalogs only classes that exist', () => {
        // The other direction: a specimen for a class the stylesheet no longer
        // has renders an unstyled box that looks like a design decision.
        const orphans = [...cataloged].filter(n => !definedClasses().has(n));
        expect(orphans, `Cataloged but not defined in index.css: ${orphans.join(', ')}`).toEqual([]);
    });
});

describe('no rule is written against the document theme', () => {
    /**
     * `[data-theme="dark"] .foo` cannot follow a themed subtree: a `.foo` inside
     * a `[data-theme="light"]` pane is still inside `html[data-theme="dark"]`
     * and keeps the dark styling. The difference between themes belongs in a
     * token. There were 17 of these rules once; the last went when light mode
     * came back (#296), and this keeps them out.
     *
     * Comments are stripped first, so a note that quotes the selector does not
     * count as a rule.
     */
    it('index.css has no [data-theme="dark"] .foo selector', () => {
        const found = [...CSS.replace(/\/\*[\s\S]*?\*\//g, '')
            .matchAll(/\[data-theme="(?:dark|light)"\]\s+\.([a-z][a-z0-9-]*)/g)].map(m => m[1]);
        expect(found, `Move the difference into a token: ${found.join(', ')}`).toEqual([]);
    });
});

describe('the playground is inert', () => {
    // specimens.jsx is on this list because it CAN hold live components — the
    // popover specimen is one. That is exactly when an inertness guarantee
    // stops being free and has to be checked.
    const files = ['components/playground/Playground.jsx', 'components/playground/catalog.js',
        'components/playground/specimens.jsx']
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
        // so a catalog entry cannot smuggle one in.
        for (const section of SECTIONS) {
            for (const spec of section.specimens) {
                for (const key of Object.keys(spec)) {
                    expect(/^on[A-Z]/.test(key), `${spec.cls} declares a handler: ${key}`).toBe(false);
                }
                // A specimen names either the class it renders, or — for a
                // composite, whose markup lives in specimens.jsx — the key of
                // the renderer plus the classes it claims to cover.
                if (spec.composite) {
                    expect(typeof spec.composite, 'a composite needs a key').toBe('string');
                    expect(Array.isArray(spec.covers) && spec.covers.length > 0,
                        `${spec.composite} must declare what it covers`).toBe(true);
                } else {
                    expect(typeof spec.cls).toBe('string');
                }
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

describe('the catalog is well formed', () => {
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

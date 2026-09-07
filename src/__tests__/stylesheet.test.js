/**
 * The stylesheet ledger, asserted.
 *
 * The probes, their counts and the reasoning behind both live in
 * `scripts/cssProbes.js` — one file, so that adding a probe, recording a count
 * and writing down why a match is legitimate are the same edit. This suite is
 * deliberately thin: its whole job is to make the ledger FAIL when it stops
 * describing the stylesheet.
 *
 * Read the numbers with `npm run css`, and the classes behind one of them with
 * `npm run css <probe>`.
 *
 * `toBe`, not `toBeLessThanOrEqual`, for the same reason the drift ledger uses
 * it: a cap absorbs cleanups silently, and six months later nobody can tell
 * whether the backlog shrank or the probe broke.
 */
import { describe, it, expect } from 'vitest';
import { CONSTRUCTED, LEDGER, definedClasses, measure } from '../../scripts/cssProbes.js';

describe('the stylesheet ledger describes index.css', () => {
    for (const probe of measure()) {
        it(`${probe.key}: ${probe.count}`, () => {
            const sample = probe.found.slice(0, 12)
                .map(f => `  ${f.label}${f.detail ? `   ${f.detail}` : ''}`).join('\n');
            const more = probe.found.length > 12
                ? `\n  …and ${probe.found.length - 12} more — npm run css ${probe.key}` : '';

            expect(
                probe.actual,
                probe.actual > probe.count
                    ? `${probe.key} rose by ${probe.actual - probe.count}. ${probe.what}\n`
                      + `Where it should go instead: ${probe.fix}\n`
                      + `If the rise is justified, raise the count in scripts/cssProbes.js `
                      + `and say why in the PR.\n${sample}${more}`
                    : `${probe.key} fell by ${probe.count - probe.actual} — you cleared some. `
                      + `Lower the count in scripts/cssProbes.js to ${probe.actual}.`,
            ).toBe(probe.count);
        });
    }
});

describe('the ledger stays honest', () => {
    it('every probe says what it counts and where the fix goes', () => {
        for (const probe of LEDGER) {
            expect(probe.what.length, `${probe.key} needs a reason`).toBeGreaterThan(30);
            expect(probe.fix.length, `${probe.key} needs a fix`).toBeGreaterThan(10);
        }
    });

    it('every CONSTRUCTED excuse names a class that still exists', () => {
        // A stale excuse hides a class that was renamed or deleted, and quietly
        // shrinks what the unreferenced probe is checked against.
        const defined = definedClasses();
        for (const name of Object.keys(CONSTRUCTED)) {
            expect(defined, `.${name} is excused but no longer defined`).toContain(name);
            expect(
                CONSTRUCTED[name].length,
                `.${name} needs the template that builds it, not just an excuse`,
            ).toBeGreaterThan(20);
        }
    });
});

/**
 * The drift ledger, asserted.
 *
 * The probes, their counts and the reasoning behind both live in
 * `scripts/driftProbes.js` — one file, so that adding a probe, recording a
 * count and writing down why it is legitimate are the same edit. This suite is
 * deliberately thin: its whole job is to make the ledger FAIL when it stops
 * describing the codebase.
 *
 * Read the numbers with `npm run drift`. Read the sites behind one of them
 * with `npm run drift <probe>`.
 *
 * Why `toBe` and not `toBeLessThanOrEqual`: a cap absorbs cleanups silently.
 * You migrate nine badges onto tokens, the number falls, nothing happens, and
 * six months later nobody can tell whether the backlog shrank or the probe
 * broke. `toBe` makes the fall as loud as the rise, and the fix for a fall is
 * to write the new number down — which is how the ledger stays a record of
 * where this codebase actually is rather than where it was when someone last
 * remembered to look.
 */
import { describe, it, expect } from 'vitest';
import { LEDGER, EXEMPT, measure } from '../../scripts/driftProbes.js';

describe('the drift ledger describes the codebase', () => {
    for (const probe of measure()) {
        it(`${probe.key}: ${probe.count}`, () => {
            const sample = probe.found.slice(0, 12)
                .map(f => `  ${f.file}:${f.line}  ${f.hit}`).join('\n');
            const more = probe.found.length > 12
                ? `\n  …and ${probe.found.length - 12} more — npm run drift ${probe.key}` : '';

            expect(
                probe.actual,
                probe.actual > probe.count
                    ? `${probe.key} rose by ${probe.actual - probe.count}. `
                      + `${probe.what}\nWhere it should go instead: ${probe.fix}\n`
                      + `If the rise is justified, raise the count in scripts/driftProbes.js `
                      + `and say why in the PR.\n${sample}${more}`
                    : `${probe.key} fell by ${probe.count - probe.actual} — `
                      + `you cleared some. Lower the count in scripts/driftProbes.js `
                      + `to ${probe.actual}.`,
            ).toBe(probe.count);
        });
    }
});

describe('the ledger stays honest', () => {
    it('every probe carries a reason, not just a number', () => {
        // A bare integer teaches the next reader nothing about whether it is
        // bad, and a ledger nobody can read is a ledger nobody lowers.
        const bare = LEDGER.filter(p => !p.what?.trim() || !p.fix?.trim());
        expect(bare.map(p => p.key), 'Give it a `what` and a `fix`.').toEqual([]);
    });

    it('every exemption names a probe that exists', () => {
        // An exemption for a deleted probe silently stops applying to anything,
        // and reads forever as though it is still doing work.
        const keys = new Set(LEDGER.map(p => p.key));
        const orphans = EXEMPT.filter(e => !keys.has(e.probe));
        expect(orphans.map(e => `${e.probe} · ${e.file}`)).toEqual([]);
    });

    it('every exemption still matches something', () => {
        // The real failure mode of an allowlist: the code moves, the entry
        // stops matching, and the exemption becomes a comment that looks like
        // a guarantee. Re-running each probe WITHOUT its exemptions must find
        // more than running with them.
        for (const e of [...EXEMPT]) {
            const withExempt = measure().find(p => p.key === e.probe).actual;
            // Removed and put back at the SAME index — a push would reorder the
            // list, and the next iteration would be measuring a different one.
            const at = EXEMPT.indexOf(e);
            EXEMPT.splice(at, 1);
            const without = measure().find(p => p.key === e.probe).actual;
            EXEMPT.splice(at, 0, e);
            expect(
                without,
                `The exemption "${e.probe} · ${e.file}" no longer matches anything. `
                + `The code it excused has moved or gone — delete the entry.`,
            ).toBeGreaterThan(withExempt);
        }
    });
});

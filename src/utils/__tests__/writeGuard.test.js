import { describe, it, expect } from 'vitest';
import { createWriteGuard } from '../writeGuard';

// The startup restore of the vehicle selection, replayed the way it failed: a
// Charging Curves link (?r=23,81&v=19) opened with the Cybertruck ([18]) saved.
// React.StrictMode runs initializeApp twice in development; both read [18]
// before the link wrote [19], and the second one landed after the link did.
function replayStartup(guard) {
    let selection = [];
    const restore = (saved) => {
        const at = guard.stamp();
        return () => { if (!guard.wroteSince(at)) selection = saved; };
    };
    const writeFromLink = (ids) => { guard.note(); selection = ids; };

    const first  = restore([18]);
    const second = restore([18]);
    first();                  // loading ends
    writeFromLink([19]);      // App applies the link's v=/r=
    second();                 // the stale init lands
    return selection;
}

describe('a restore that a write overtook does not land', () => {
    it("keeps the link's selection when a stale init lands after it", () => {
        expect(replayStartup(createWriteGuard())).toEqual([19]);
    });

    it('is the guard that saves it — unguarded, the saved selection wins', () => {
        const unguarded = { note() {}, stamp: () => 0, wroteSince: () => false };
        expect(replayStartup(unguarded)).toEqual([18]);
    });

    it('lands when nothing wrote in between', () => {
        const guard = createWriteGuard();
        guard.note();                          // writes BEFORE the read are fine
        const at = guard.stamp();
        expect(guard.wroteSince(at)).toBe(false);
        guard.note();
        expect(guard.wroteSince(at)).toBe(true);
    });
});

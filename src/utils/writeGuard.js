/**
 * Tells a slow read whether a write overtook it.
 *
 * A read that starts, awaits, and then sets state assumes nothing wrote that
 * state in between. The startup restore of the vehicle selection made that
 * assumption and was wrong: a link's `v=` / `r=` is applied the moment loading
 * ends, and a second `initializeApp` still in flight — React.StrictMode runs
 * mount effects twice in development, and sign-in re-runs it — landed after
 * it with the selection it had read from localStorage BEFORE the link wrote
 * there. The link's vehicles were replaced by the saved ones, and the chart
 * then pruned the link's runs as belonging to no selected vehicle.
 *
 *     const at = guard.stamp();        // before the await
 *     const saved = await read();
 *     if (!guard.wroteSince(at)) set(saved);
 *
 * and every write calls `guard.note()`.
 */
export function createWriteGuard() {
    let writes = 0;
    return {
        /** Record a write. */
        note() { writes += 1; },
        /** A stamp to hand back to `wroteSince` once the read returns. */
        stamp() { return writes; },
        /** Whether any write happened after `stamp` was taken. */
        wroteSince(stamp) { return writes !== stamp; },
    };
}

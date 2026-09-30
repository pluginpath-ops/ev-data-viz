/**
 * The line under a bulk-import progress bar: what is being written, how far
 * along, how long it has taken and how long it is likely to still take.
 *
 * The estimate is the running average per item times the items left, so it
 * only appears once at least one item has finished and is deliberately coarse
 * ("~3 min") — a group's write is 5-10 sequential requests and their cost
 * varies, so a precise countdown would be false precision.
 */

const fmtDuration = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    return m < 10 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${m} min`;
};

/**
 * @param {{ done: number, total: number, name: string|null, startedAt: number }} p
 * @param {number} [now]  injectable clock for tests
 */
export function importProgressLabel({ done, total, name, startedAt }, now = Date.now()) {
    const elapsed = now - startedAt;
    const parts = [`${done} of ${total} written`];
    if (name) parts.push(`now ${name}`);
    parts.push(`${fmtDuration(elapsed)} elapsed`);
    if (done > 0 && done < total) {
        parts.push(`~${fmtDuration((elapsed / done) * (total - done))} left`);
    }
    return parts.join(' · ');
}

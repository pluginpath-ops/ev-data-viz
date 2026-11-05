/**
 * When a loading indicator is allowed to appear (#453).
 *
 * A chart whose data is already cached flips `loading` true and false inside a
 * frame or two. An indicator that follows it paints a flash of spinner on every
 * quick change, which reads as a glitch rather than as feedback. So the
 * indicator waits: it shows only once the load has run longer than this, and a
 * load that finishes first never shows it at all.
 *
 * The delay is a courtesy to fast loads, never a stand-in for state. The
 * indicator still needs a real `loading` — see hooks/useDelayedLoading.js.
 */
export const LOADING_INDICATOR_DELAY_MS = 250;

/**
 * Whether the indicator should be on screen.
 *
 * @param {boolean} loading    The real state: is a fetch in flight?
 * @param {number}  elapsedMs  How long that load has been running.
 * @param {number}  delayMs    How long to wait before showing anything.
 */
export function isLoadingIndicatorVisible(loading, elapsedMs, delayMs = LOADING_INDICATOR_DELAY_MS) {
    return Boolean(loading) && elapsedMs >= delayMs;
}

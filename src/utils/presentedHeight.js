/**
 * How tall a chart draws when it is presented rather than operated.
 *
 * The pop-out fills its window, so a presented chart is a screenful; Home draws
 * several side by side, each in a box (#448). One CSS variable serves both:
 * `--presented-h` is the height of the frame a chart is shown in. The pop-out
 * never sets it, so it falls back to the viewport and nothing changes there;
 * Home's panel sets it to the height it wants.
 *
 * Charge Stop stacks two charts, so each takes 45% of the frame.
 */
export const PRESENTED_HEIGHT = 'calc(var(--presented-h, 100vh) - 2rem)';
export const PRESENTED_HALF_HEIGHT = 'calc(var(--presented-h, 100vh) * 0.45)';

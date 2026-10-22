/**
 * What a plot's frame says about itself: the subtitle's counts and whether the
 * legend is worth a row.
 *
 * The leading counts of a plot's subtitle — "4 runs · 3 vehicles".
 *
 * They answer "how much is on this chart", which a reader sees by looking, and
 * they cost a phone's width. So the subtitle leads with the conditions and the
 * counts come back only when Full Labels is checked (`chartConfig.verboseLabels`):
 * the same switch that restores every atom of a series name, for the same
 * reason — a chart cropped out of context has to say what it is made of. The
 * subtitle captions the PNG export, so the export follows the toggle too.
 */

export const countNoun = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/**
 * @param {boolean} verboseLabels   `chartConfig.verboseLabels`
 * @param {Array<[number, string]>} counts   [[4, 'run'], [3, 'vehicle']]
 * @returns {string[]}  the count phrases when Full Labels is on, else []
 */
export function countParts(verboseLabels, counts) {
    if (!verboseLabels) return [];
    return counts.map(([n, noun]) => countNoun(n, noun));
}

/**
 * Whether a Chart.js legend has anything to say. One dataset's legend is a
 * swatch repeating the axis title ("Range (mi)" beside a y-axis titled
 * "Range (mi)"), and datasets that all share a label cannot be told apart by
 * it. Two or more distinct labels is the only case the legend earns its row.
 *
 * @param {Array<{label?: string}>} datasets
 */
export function legendWorthShowing(datasets) {
    if (!datasets || datasets.length < 2) return false;
    return new Set(datasets.map(d => d.label)).size > 1;
}

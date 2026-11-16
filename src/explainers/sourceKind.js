import { isTopicHref } from './parseExplainer';

/** File types worth naming; any other web address is just "Web". */
const FILE_TYPES = new Set(['pdf', 'csv', 'xls', 'xlsx', 'zip', 'json']);

/**
 * What a source's link opens, for the tag after it in the Sources list:
 * "PDF" (or another file type, by the address's extension), "Web", or
 * "Explainer" for another explainer page (a bare topic slug). Null for a
 * source with no link (arithmetic, EVBench's own code).
 */
export function sourceKind(url) {
    if (!url) return null;
    if (isTopicHref(url)) return 'Explainer';
    let path;
    try { path = new URL(url).pathname; } catch { return 'Web'; }
    const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
    return ext && FILE_TYPES.has(ext) ? ext.toUpperCase() : 'Web';
}

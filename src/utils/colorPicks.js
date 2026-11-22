/**
 * Hand-set colors, held in `chartConfig.colorPicks` so they outlive the view
 * that drew them: a sub-tab switch, the pop-out, the chart link and a featured
 * comparison all carry them.
 *
 * They used to live inside useStickyChartColors, so leaving a sub-tab dropped
 * every pick and a link could not say what color anything was.
 *
 * Shape: { [chartMode]: { key, map } }
 *   chartMode  each chart keeps its own picks, as each view always did — a
 *              charging test's pick on Charging Curves says nothing about
 *              Range & Efficiency
 *   key        the vehicle set the picks were made for (`vehicleSetKey`); a
 *              pick only counts while that set is selected, so a different
 *              comparison starts clean
 *   map        { [runId or pair key]: '#rrggbb' }
 *
 * Pure module — no React.
 */

export const NO_PICKS = Object.freeze({});

/** The selected vehicles as a set: order does not make a different comparison. */
export function vehicleSetKey(vehicleIds) {
    return (vehicleIds ?? []).map(String).sort().join(',');
}

/** One chart's picks, if they were made for this vehicle set; else none. */
export function picksFor(colorPicks, chart, setKey) {
    const entry = colorPicks?.[chart];
    return entry && entry.key === setKey ? entry.map : NO_PICKS;
}

/**
 * `colorPicks` with one chart's map replaced by `update(current)`. A map made
 * for another vehicle set counts as empty. Same object when nothing changes.
 */
export function withPicks(colorPicks, chart, setKey, update) {
    const current = picksFor(colorPicks, chart, setKey);
    const next = update(current);
    if (next === current && colorPicks?.[chart]?.key === setKey) return colorPicks;
    return { ...(colorPicks ?? {}), [chart]: { key: setKey, map: next } };
}

// ── In a link ────────────────────────────────────────────────────────────────

const HEX = /^[0-9a-f]{3,8}$/i;

/**
 * `{ id: '#rrggbb' }` as `id:rrggbb,id:rrggbb`. Ids may hold `::` (a pair key)
 * and `_` (an inherited test), so the color is read from the last `:`.
 * Only the ids in `onlyIds`, when given. '' when there is nothing to write.
 */
export function encodeColorMap(map, onlyIds = null) {
    const keep = onlyIds ? new Set(onlyIds.map(String)) : null;
    return Object.entries(map ?? {})
        .filter(([id, color]) => color && (!keep || keep.has(String(id))))
        .map(([id, color]) => `${id}:${String(color).replace(/^#/, '')}`)
        .join(',');
}

/** The reverse of `encodeColorMap`. Anything that is not a hex color is dropped. */
export function decodeColorMap(raw) {
    const out = {};
    for (const part of String(raw ?? '').split(',')) {
        const at = part.lastIndexOf(':');
        if (at <= 0) continue;
        const hex = part.slice(at + 1);
        if (HEX.test(hex)) out[part.slice(0, at)] = `#${hex.toLowerCase()}`;
    }
    return out;
}

/** A view's `setColorPicks`: writes through chartConfig. Null where the view cannot write. */
export function colorPicksSetter(setChartConfig) {
    if (!setChartConfig) return null;
    return update => setChartConfig(prev => {
        const next = update(prev.colorPicks);
        return next === prev.colorPicks ? prev : { ...prev, colorPicks: next };
    });
}

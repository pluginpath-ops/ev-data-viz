/**
 * The axes an explainer's tests preview can draw, keyed as Charging Curves
 * keys them (ChargingView.jsx axisOptions), so one `x=`/`y=` in the tag
 * drives both the preview and the link. The chart view has more (EPA range,
 * C-rate, range rate, frame); a key not here still goes into the link, and
 * the preview falls back to SoC against charge rate and says so.
 *
 * Values are as stored, imperial: miles and °F.
 */
export const PREVIEW_AXES = {
    soc:         { label: 'State of charge', unit: '%',   field: 'soc',         fixed: [0, 100] },
    deltaSoc:    { label: 'SoC added',       unit: '%',   field: 'soc',         delta: true },
    chargeRate:  { label: 'Charge rate',     unit: 'kW',  field: 'chargeRate' },
    time:        { label: 'Time',            unit: 'min', field: 'time' },
    range:       { label: 'Range (tested)',  unit: 'mi',  field: 'range' },
    deltaRange:  { label: 'Range added',     unit: 'mi',  field: 'range',       delta: true },
    temperature: { label: 'Temperature',     unit: '°F',  field: 'temperature' },
};

export const DEFAULT_AXES = { x: 'soc', y: 'chargeRate' };

/** A run's points as [x, y] pairs for two axis keys, skipping gaps. */
export function axisPoints(points, xKey, yKey) {
    const read = (key) => {
        const axis = PREVIEW_AXES[key];
        const first = points.find(p => p[axis.field] != null)?.[axis.field] ?? 0;
        return (p) => (p[axis.field] == null ? null : p[axis.field] - (axis.delta ? first : 0));
    };
    const fx = read(xKey);
    const fy = read(yKey);
    return points.map(p => [fx(p), fy(p)]).filter(([x, y]) => x != null && y != null);
}

/** A round upper bound for an axis, and its tick step. */
export function niceScale(max) {
    if (!(max > 0)) return { max: 1, step: 1 };
    const raw = max / 5;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw);
    return { max: Math.ceil(max / step) * step, step };
}

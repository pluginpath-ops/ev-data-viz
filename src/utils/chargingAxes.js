import { distanceLabel } from './unitConversions';

/**
 * Range basis: which figure the range axes and the range-rate axes rest on. The
 * picker lists one "Range" and one "Range Added"; the basis says whether that
 * is the tested range or the EPA range. The stored axis keys stay as they were
 * (`range`/`rangeEpa`, `deltaRange`/`deltaRangeEpa`) so old links open.
 * `rangeRate` and `rangeRateHr` have one key whatever the basis.
 */
export const RANGE_BASES = {
    tested: { label: 'Tested' },
    epa:    { label: 'EPA' },
};
export const DEFAULT_RANGE_BASIS = 'tested';
const RANGE_BASIS_KEYS = Object.keys(RANGE_BASES);

const EPA_KEY_OF = { range: 'rangeEpa', deltaRange: 'deltaRangeEpa' };
const TESTED_KEY_OF = Object.fromEntries(Object.entries(EPA_KEY_OF).map(([t, e]) => [e, t]));

/** `key` as it is written under `basis`: a range key swaps, any other stays. */
export function axisForBasis(key, basis) {
    if (basis === 'epa') return EPA_KEY_OF[key] ?? key;
    return TESTED_KEY_OF[key] ?? key;
}

/** The basis a link without `rb` meant: EPA if it plots an EPA range axis. */
export const basisOfAxes = (axes) =>
    axes.some(k => k in TESTED_KEY_OF) ? 'epa' : DEFAULT_RANGE_BASIS;

/**
 * The axes Charging Curves can plot, grouped the way the axis picker lists
 * them. One list, so the picker, the axis titles, the link's validity check and
 * the tests all read the same names.
 *
 * Each entry carries two names on purpose. `label` is the axis's FULL name,
 * unit included ("Range Rate (mi/hr)"): it titles the axis and the frame, where
 * nothing else says what the numbers are. `name` is what the picker shows under
 * its group heading ("mi/hr" under Charging speed), where the group already
 * supplies the noun.
 *
 * `value` is the key chartConfig holds and the link writes (`x`, `y`, `y2`).
 * Temperature and Frame were axes until the picker was grouped, and SoC Added
 * sat under Range added until the owner dropped it; they are not
 * offered now, and `chargingAxisOr` is what keeps a link that names one opening.
 */
export function chargingAxisOptions(units, basis = DEFAULT_RANGE_BASIS) {
    const dl = distanceLabel(units);
    const b = RANGE_BASES[basis]?.label ?? RANGE_BASES[DEFAULT_RANGE_BASIS].label;
    return [
        { group: 'Time',           value: 'time',         name: 'Time',        unit: 'min',     label: 'Time (min)' },
        { group: 'Charging speed', value: 'chargeRate',   name: 'kW',          unit: '',        label: 'Charge Rate (kW)' },
        { group: 'Charging speed', value: 'rangeRate',    name: `${dl}/min`,   unit: '',        label: `${b} Range Rate (${dl}/min)` },
        { group: 'Charging speed', value: 'rangeRateHr',  name: `${dl}/hr`,    unit: '',        label: `${b} Range Rate (${dl}/hr)` },
        { group: 'Charging speed', value: 'socRate',      name: 'SoC/min',     unit: '',        label: 'SoC Rate (%/min)' },
        { group: 'Charging speed', value: 'cRate',        name: 'C-rate',      unit: '',        label: 'C-Rate (~kW ÷ battery)' },
        { group: 'Battery',        value: 'soc',          name: 'SoC',         unit: '%',       label: 'State of Charge (%)' },
        { group: 'Battery',        value: axisForBasis('range', basis),      name: 'Range',       unit: dl, label: `${b} Range (${dl})` },
        { group: 'Battery',        value: axisForBasis('deltaRange', basis), name: 'Range Added', unit: dl, label: `${b} Range Added (${dl})` },
    ];
}

const KEYS = new Set(RANGE_BASIS_KEYS.flatMap(basis => chargingAxisOptions('imperial', basis).map(o => o.value)));

/** Whether `key` is an axis Charging Curves still offers. */
export const isChargingAxis = (key) => KEYS.has(key);

/** `key` if it is an offered axis, else `fallback`: a link or a saved
 *  comparison written when Temperature or Frame were axes opens on the default
 *  instead of a chart with nothing to plot. */
export const chargingAxisOr = (key, fallback = null) => (isChargingAxis(key) ? key : fallback);

/** The options as [{ group, options }], in the list's own order. */
export function groupAxes(options) {
    const groups = [];
    for (const o of options) {
        let g = groups.find(x => x.group === o.group);
        if (!g) groups.push(g = { group: o.group, options: [] });
        g.options.push(o);
    }
    return groups;
}

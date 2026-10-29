import { distanceLabel } from './unitConversions';

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
 * Temperature and Frame were axes until the picker was grouped; they are not
 * offered now, and `chargingAxisOr` is what keeps a link that names one opening.
 */
export function chargingAxisOptions(units) {
    const dl = distanceLabel(units);
    return [
        { group: 'Time',           value: 'time',         name: 'Time',        unit: 'min',     label: 'Time (min)' },
        { group: 'Charging speed', value: 'chargeRate',   name: 'kW',          unit: '',        label: 'Charge Rate (kW)' },
        { group: 'Charging speed', value: 'rangeRate',    name: `${dl}/min`,   unit: '',        label: `Range Rate (${dl}/min)` },
        { group: 'Charging speed', value: 'rangeRateHr',  name: `${dl}/hr`,    unit: '',        label: `Range Rate (${dl}/hr)` },
        { group: 'Charging speed', value: 'socRate',      name: 'SoC/min',     unit: '',        label: 'SoC Rate (%/min)' },
        { group: 'Charging speed', value: 'cRate',        name: 'C-rate',      unit: '',        label: 'C-Rate (~kW ÷ battery)' },
        { group: 'Range',          value: 'soc',          name: 'SoC',         unit: '%',       label: 'State of Charge (%)' },
        { group: 'Range',          value: 'range',        name: 'Tested',      unit: dl,        label: `Range - Tested (${dl})` },
        { group: 'Range',          value: 'rangeEpa',     name: 'EPA',         unit: dl,        label: `Range - EPA (${dl})` },
        { group: 'Range added',    value: 'deltaSoc',     name: 'SoC',         unit: '%',       label: 'SoC Added (%)' },
        { group: 'Range added',    value: 'deltaRange',   name: 'Tested',      unit: dl,        label: `Range Added - Tested (${dl})` },
        { group: 'Range added',    value: 'deltaRangeEpa', name: 'EPA',        unit: dl,        label: `Range Added - EPA (${dl})` },
    ];
}

const KEYS = new Set(chargingAxisOptions('imperial').map(o => o.value));

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

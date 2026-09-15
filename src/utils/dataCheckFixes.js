/**
 * What a curator can do about a Data Checks finding, from the panel (#321).
 *
 * Three kinds of fix, by what settles the finding:
 *
 *   moves    a value out of a retiring column into the spec field that says
 *            what it is — vehicles.battery into Usable or Gross (#325 step 2),
 *            vehicles.range into Expected EPA Range (#324 step 2) — or discarded.
 *            The spec is written first and the column cleared only once that
 *            succeeded, so a failed write never loses the value.
 *   fields   the spec fields a check compares, edited in place
 *   EPA      the vehicle's EPA section, where links, the primary configuration
 *            and the curator fields live. The primary is also chosen in place.
 *
 * Pure module: no data access, no React. The panel does the writing.
 */

import { SPEC_CATEGORIES } from './vehicleSpecSchema';

/** The spec fields each check compares, as [category, field]. */
const CHECK_FIELDS = {
    'tested-vs-label':     [['charging', 'battery_usable_kwh'], ['powertrain', 'battery_gross_kwh']],
    'usable-over-gross':   [['charging', 'battery_usable_kwh'], ['powertrain', 'battery_gross_kwh']],
    'buffer-outside':      [['charging', 'battery_usable_kwh'], ['powertrain', 'battery_gross_kwh']],
    'test-weight-offset':  [['performance', 'weight_lbs']],
    'drive-vs-epa':        [['powertrain', 'drive_type']],
    'voltage-vs-epa':      [['charging', 'battery_nominal_voltage_v']],
    'claimed-060-quicker': [['performance', 'zero_to_60_mph_sec']],
    'expected-vs-label':   [['range', 'expected_epa_mi'], ['range', 'expected_epa_basis']],
};

/** Checks whose other half is on the vehicle's EPA section: a link, a label, a test. */
export const EPA_SECTION_CHECKS = new Set([
    'range-vs-label', 'label-spread', 'range-no-label', 'tested-vs-label', 'tested-spread',
    'test-weight-offset', 'drive-vs-epa', 'voltage-vs-epa', 'expected-vs-label',
]);

/** Tests & Data → EPA for one vehicle, as the URL App.jsx restores. */
export const epaSectionHref = (vehicleId) => `?tab=runs&vid=${vehicleId}&sub=epa`;

/**
 * The spec fields that settle a check, each with its schema definition so it
 * can be edited with the same input the spec editor uses.
 *
 * @returns {Array<{ category, field, def }>}
 */
export function checkFields(checkKey) {
    return (CHECK_FIELDS[checkKey] ?? []).map(([category, field]) => ({
        category,
        field,
        def: SPEC_CATEGORIES.find(c => c.key === category)?.fields.find(f => f.key === field) ?? null,
    }));
}

/** `specs` with some fields of one category replaced, and nothing else touched. */
export function withSpecValues(specs, category, values) {
    return { ...(specs ?? {}), [category]: { ...(specs?.[category] ?? {}), ...values } };
}

/**
 * The one-click moves out of `vehicles.battery` and `vehicles.range` a finding
 * offers, built from the finding's own evidence — the values it was judged on.
 *
 * @returns {Array<{
 *   key, label, title,
 *   spec: { category, values } | null,   what to write first, if anything
 *   clear: 'battery'|'range',            the column to clear after
 * }>}
 */
export function columnMoves(finding) {
    const e = finding?.evidence ?? {};

    if (finding?.check === 'battery-unsorted' && e.battery) {
        const into = (name, category, field, current) => ({
            key: `battery-${name.toLowerCase()}`,
            // Naming the value it replaces: a manufacturer's label is not
            // something to overwrite without seeing it.
            label: current != null ? `Replace ${name} ${current} with ${e.battery}` : `${e.battery} kWh is ${name}`,
            title: `Write ${e.battery} kWh to ${name}, then clear vehicles.battery.`,
            spec: { category, values: { [field]: e.battery } },
            clear: 'battery',
        });
        return [
            into('Usable', 'charging', 'battery_usable_kwh', e.usable),
            into('Gross', 'powertrain', 'battery_gross_kwh', e.gross),
            { key: 'battery-discard', label: 'Discard', title: 'Clear vehicles.battery. Usable and Gross are unchanged.', spec: null, clear: 'battery' },
        ];
    }

    if (finding?.check === 'range-no-label' && e.range) {
        const expected = (basis) => ({
            key: `range-expected-${basis.toLowerCase().replace(/\s+/g, '-')}`,
            label: `${e.range} mi is Expected EPA · ${basis}`,
            title: `Write ${e.range} mi to Expected EPA Range with basis ${basis}, then clear vehicles.range.`,
            spec: { category: 'range', values: { expected_epa_mi: e.range, expected_epa_basis: basis } },
            clear: 'range',
        });
        return [
            expected('Manufacturer'),
            expected('Independent test'),
            { key: 'range-discard', label: 'Discard', title: 'Clear vehicles.range.', spec: null, clear: 'range' },
        ];
    }

    if (finding?.check === 'range-vs-label' && e.range) {
        return [{
            key: 'range-discard',
            label: `Discard ${e.range} mi`,
            title: 'Clear vehicles.range. The site already uses the EPA label; if the label is the wrong one, fix the link on the EPA section instead.',
            spec: null,
            clear: 'range',
        }];
    }

    return [];
}

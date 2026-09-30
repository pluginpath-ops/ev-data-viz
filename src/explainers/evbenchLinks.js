/**
 * Links from an explainer into EVBench's own data, as real hrefs. A plain
 * link, not an import: the explainers stay on their side of the boundary
 * (eslint.config.js), and App.jsx restores the view from the URL.
 */

/**
 * Charging Curves for some charging tests, in the URL shape App.jsx reads
 * (its pending URL state): r= the runs, v= the vehicles they belong to, x=/y=
 * the axes. v= is optional to the app, but a link built from the data carries
 * it rather than relying on the app to work it out.
 */
export function chargingTestsHref({ runIds, vehicleIds = [], x = 'soc', y = 'chargeRate' }) {
    const p = new URLSearchParams({ tab: 'efficiency', r: runIds.join(',') });
    const vehicles = [...new Set(vehicleIds.filter(v => v != null))];
    if (vehicles.length) p.set('v', vehicles.join(','));
    p.set('x', x);
    p.set('y', y);
    return '?' + p.toString();
}

/**
 * Modeled Efficiency for some vehicles' EPA links, in the URL shape App.jsx
 * reads: epa_m= the links, v= their vehicles (the chart draws only selected
 * vehicles), epa_ya= the y-axis, epa_ov= the real-world overlay, on by default
 * so the tests the preview shows are there when the chart opens.
 */
export function modeledEfficiencyHref({ mappingIds, vehicleIds = [], y = 'mi_kwh', overlay = 'corrected' }) {
    const p = new URLSearchParams({ tab: 'epatested', m: 'epacurves' });
    const vehicles = [...new Set(vehicleIds.filter(v => v != null))];
    if (vehicles.length) p.set('v', vehicles.join(','));
    p.set('epa_m', mappingIds.join(','));
    p.set('epa_ya', y);
    if (overlay) p.set('epa_ov', overlay);
    return '?' + p.toString();
}

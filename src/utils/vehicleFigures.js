/**
 * The two figures calculations read — capacity and range — each resolved from
 * one place, with the source it came from (#323, #324).
 *
 * ── Why ─────────────────────────────────────────────────────────────────────
 *
 * `vehicles.battery` and `vehicles.range` are hand-typed columns nothing defines.
 * Battery is Usable on some vehicles and Gross on others; range matches none of
 * the vehicle's EPA labels on 20 of the 39 that carry both. Seven readers used
 * them, and disagreed about what battery even was. They now read these.
 *
 * ── socWindowKwh: the energy between the car's own 0% and 100% ──────────────
 *
 * Every calculation that turns %SoC into kWh wants that energy. It is neither
 * manufacturer label, so it is named for what it is:
 *
 *   epa-tested   EPA's measured DC energy, driving the pack from full to
 *                shutdown on the primary configuration — the one figure that
 *                IS the car's own 0–100%. Used only while it sits within
 *                tolerance of the nearer of Usable and Gross (or there is no
 *                label to hold it against): outside it, on today's data, the
 *                wrong configuration is linked. Never inherited — a trim linked
 *                to its own configuration has its own.
 *   usable       the manufacturer's usable capacity
 *   gross        the manufacturer's gross capacity; reads high
 *   unsorted     `vehicles.battery`, not yet sorted into Usable or Gross (#325).
 *                Kept so no chart loses a vehicle before curation catches up;
 *                this tier goes when the column does.
 *
 * ── epaRangeMi ──────────────────────────────────────────────────────────────
 *
 *   epa-label    the primary configuration's label, which the Fuel Economy
 *                Guide fills. City and highway come with it.
 *   expected     no label: a curator's Expected EPA Range, with its basis
 *                (Manufacturer, Independent test)
 *   unsorted     `vehicles.range`, which no EPA label confirms (#324 step 2)
 *
 * Several configurations and no primary is not a tier: nothing is picked
 * silently. Their labels come back as `spanMi` for display, and the figure
 * falls through to the tiers below — unless every label agrees, when there is
 * nothing to pick.
 *
 * Worked out when vehicles reach the app (AppContext), never stored: a copy
 * would go stale the moment a primary, a spec or a link changed.
 *
 * Pure module: no data access, no React.
 */

import { resolveEffectiveSpecs } from './specHelpers';
import { epaConfigurationFigures, primaryEpaMapping } from './epaConfiguration';
import { TESTED_CAPACITY_TOLERANCE_PCT } from '../constants/epa';
import { distanceValue, distanceUnit } from './unitConversions';

// Absent stays absent: Number(null) is 0, and a 0 kWh pack is a figure the data
// never gave.
const positive = (v) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
};

/** Each capacity basis, as it is shown. */
export const SOC_WINDOW_BASIS = {
    'epa-tested': { label: 'EPA tested', note: 'Energy EPA measured driving the pack from full to shutdown, on the primary configuration.' },
    usable:       { label: 'Usable',     note: "The manufacturer's usable capacity." },
    gross:        { label: 'Gross',      note: "The manufacturer's gross capacity. No usable figure is recorded, so calculations from it read high." },
    unsorted:     { label: 'unsorted',   note: 'From vehicles.battery, not yet sorted into Usable or Gross.' },
};

/** Each range basis, as it is shown. */
export const EPA_RANGE_BASIS = {
    'epa-label': { label: 'EPA',          note: "The primary EPA configuration's label." },
    expected:    { label: 'Expected EPA', note: 'No EPA label yet. A curator’s expected EPA range.' },
    unsorted:    { label: 'unsorted',     note: 'From vehicles.range, which no EPA label confirms.' },
};

/**
 * Does EPA tested agree with the manufacturer's labels, under a rule?
 *
 *   nearer   within tolerance of Usable or Gross, whichever is closer — a
 *            normal 3–10% buffer means it cannot sit within 5% of both
 *   each     within tolerance of every label (Data Checks offers it to compare)
 *
 * @param {number} testedKwh
 * @param {Array<{name, kwh}>} labels  Usable and/or Gross, whichever exist; not empty
 * @returns {{ ok: boolean, nearest: {name, kwh, pct}, offsets }}
 */
export function testedAgreement(testedKwh, labels, tolerancePct, rule = 'nearer') {
    const offsets = labels.map(l => ({ ...l, pct: (Math.abs(testedKwh - l.kwh) / l.kwh) * 100 }));
    const nearest = offsets.reduce((a, b) => (b.pct < a.pct ? b : a));
    const ok = rule === 'each'
        ? offsets.every(o => o.pct <= tolerancePct)
        : nearest.pct <= tolerancePct;
    return { ok, nearest, offsets };
}

/**
 * The energy between the car's own 0% and 100%, and where it came from.
 *
 * @param {Object} vehicle
 * @param {Array}  vehicles  the whole fleet, for spec inheritance
 * @returns {{ kwh: number|null, basis: string|null, testedKwh: number|null, testedSetAside: boolean }}
 *          `testedSetAside` — an EPA tested figure exists but disagreed with the
 *          labels, so a lower tier was used
 */
export function resolveSocWindow(vehicle, vehicles = [], { tolerancePct = TESTED_CAPACITY_TOLERANCE_PCT } = {}) {
    const specs  = vehicle ? resolveEffectiveSpecs(vehicle, vehicles) : {};
    const usable = positive(specs?.charging?.battery_usable_kwh);
    const gross  = positive(specs?.powertrain?.battery_gross_kwh);

    const pick = primaryEpaMapping(vehicle?.epa_mappings);
    const testedKwh = pick ? epaConfigurationFigures(pick.mapping.epaGroup).testedKwh : null;
    const labels = [usable && { name: 'Usable', kwh: usable }, gross && { name: 'Gross', kwh: gross }].filter(Boolean);
    const testedAgrees = testedKwh != null
        && (!labels.length || testedAgreement(testedKwh, labels, tolerancePct).ok);

    const found = (kwh, basis) => ({ kwh, basis, testedKwh, testedSetAside: testedKwh != null && !testedAgrees });
    // EPA files energy to the watt-hour (79.9942 kWh); every other capacity here
    // is typed to a tenth, and a card printing four decimals claims a precision
    // the comparison never had.
    if (testedAgrees) return found(Math.round(testedKwh * 10) / 10, 'epa-tested');
    if (usable)       return found(usable, 'usable');
    if (gross)        return found(gross, 'gross');
    const legacy = positive(vehicle?.battery);
    if (legacy)       return found(legacy, 'unsorted');
    return found(null, null);
}

/**
 * The vehicle's EPA range, and where it came from.
 *
 * @returns {{
 *   mi: number|null, basis: string|null,
 *   cityMi: number|null, hwyMi: number|null,   only with an EPA label
 *   spanMi: [number, number]|null,             several labels, none primary
 *   expectedSource: string|null,               the Expected EPA Range's basis
 * }}
 */
export function resolveEpaRange(vehicle, vehicles = []) {
    const links = (vehicle?.epa_mappings ?? []).filter(m => m.epaGroup);
    const pick = primaryEpaMapping(links);
    const none = { mi: null, basis: null, cityMi: null, hwyMi: null, spanMi: null, expectedSource: null };

    const fromLabel = (group) => ({
        ...none,
        mi: positive(group.label_range_published),
        basis: 'epa-label',
        cityMi: positive(group.label_city_range_mi),
        hwyMi:  positive(group.label_hwy_range_mi),
    });

    let spanMi = null;
    if (pick) {
        if (positive(pick.mapping.epaGroup.label_range_published)) return fromLabel(pick.mapping.epaGroup);
    } else {
        const labelled = links.filter(m => positive(m.epaGroup.label_range_published));
        const values = [...new Set(labelled.map(m => positive(m.epaGroup.label_range_published)))].sort((a, b) => a - b);
        // Every configuration reads the same: there is nothing to choose.
        if (values.length === 1) return fromLabel(labelled[0].epaGroup);
        if (values.length > 1) spanMi = [values[0], values[values.length - 1]];
    }

    const specs = vehicle ? resolveEffectiveSpecs(vehicle, vehicles) : {};
    const expected = positive(specs?.range?.expected_epa_mi);
    if (expected) {
        return { ...none, mi: expected, basis: 'expected', spanMi, expectedSource: specs.range.expected_epa_basis || null };
    }
    const legacy = positive(vehicle?.range);
    if (legacy) return { ...none, mi: legacy, basis: 'unsorted', spanMi };
    return { ...none, spanMi };
}

/**
 * What a chart says about the resolved figures behind a series.
 *
 * One vehicle's C-rate can divide by EPA tested while the next divides by a
 * Gross figure that reads high; plotted side by side, nothing said so. A chart
 * asks only for the figures its plotted value actually depends on, so a SoC
 * curve names nothing and a C-rate curve names its capacity.
 *
 * @param {Object} vehicle   as AppContext provides it (withVehicleFigures)
 * @param {{capacity?: boolean, range?: boolean}} uses
 * @param {'imperial'|'metric'} [units]
 * @returns {Array<{ figure: 'capacity'|'range', short: string, line: string }>}
 *          `short` for a legend or badge ("125.1 kWh EPA tested"), `line` for a
 *          tooltip ("Capacity: 125.1 kWh, EPA tested"); a figure the vehicle
 *          lacks is left out
 */
export function figureSources(vehicle, { capacity = false, range = false } = {}, units = 'imperial') {
    const out = [];
    if (capacity && vehicle?.socWindowKwh > 0) {
        const basis = SOC_WINDOW_BASIS[vehicle.socWindowBasis]?.label ?? 'unknown';
        const value = `${vehicle.socWindowKwh} kWh`;
        out.push({ figure: 'capacity', basis, short: `${value} ${basis}`, line: `Capacity: ${value}, ${basis}` });
    }
    if (range && vehicle?.epaRangeMi > 0) {
        const source = vehicle.epaRange?.expectedSource;
        const basis = `${EPA_RANGE_BASIS[vehicle.epaRangeBasis]?.label ?? 'unknown'}${source ? ` (${source})` : ''}`;
        const value = `${Math.round(distanceValue(vehicle.epaRangeMi, units))} ${distanceUnit(units)}`;
        out.push({ figure: 'range', basis, short: `${value} ${basis}`, line: `EPA range: ${value}, ${basis}` });
    }
    return out;
}

/** The Spec Chart / Scatter fields that ARE a resolved figure (specHelpers.makeVehicleFields). */
const FIELD_FIGURE = {
    'vehicle.socWindowKwh': 'capacity',
    'vehicle.epaRangeMi':   'range',
};

/**
 * The source of a spec field's value, when that field is a resolved figure;
 * null for every ordinary spec field, which has one home and needs no word.
 */
export function fieldFigureSource(vehicle, fieldKey, units = 'imperial') {
    const figure = FIELD_FIGURE[fieldKey];
    return figure ? (figureSources(vehicle, { [figure]: true }, units)[0] ?? null) : null;
}

/**
 * The fleet with both figures attached, as the app reads it.
 *
 *   socWindowKwh, socWindowBasis     from resolveSocWindow
 *   epaRangeMi, epaRangeBasis        from resolveEpaRange
 *   epaRange                         the whole range answer (city, highway, span)
 */
export function withVehicleFigures(vehicles = []) {
    return vehicles.map(vehicle => {
        const soc = resolveSocWindow(vehicle, vehicles);
        const range = resolveEpaRange(vehicle, vehicles);
        return {
            ...vehicle,
            socWindowKwh: soc.kwh,
            socWindowBasis: soc.basis,
            epaRangeMi: range.mi,
            epaRangeBasis: range.basis,
            epaRange: range,
        };
    });
}

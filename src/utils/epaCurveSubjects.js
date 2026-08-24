/**
 * Certification records as chart subjects (#237).
 *
 * `EpaCurvesView` plots curve-per-MAPPING: it walks selected vehicles, follows
 * `epa_mappings` to a certification group, and hands the group to
 * `buildEpaCurveFromModel`. The maths never sees the vehicle — it contributes a
 * label, a colour, and a battery fallback.
 *
 * So a certification group can be a subject on its own, and 210 of 211 carry
 * the coefficients a curve needs. This module is that subject: what to call it,
 * what energy to give it, and — the part that matters — how much of the result
 * is measured and how much is assumed.
 *
 * Deliberately NOT a synthetic vehicle. A vehicle is an identity with runs,
 * specs and pairings; inventing one for a certification record would make every
 * selector, colour map and URL parameter in the app learn about a thing that
 * has none of those.
 */
import { resolvePrimaryCoeffs, deriveDrivetrainEta, pickDerivationTest } from './epaDerivations';

const num = (v) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

/**
 * How much of a curve is measurement.
 *
 * The shape of every curve is real: road-load coefficients are the lab's own
 * numbers and 210 of 211 groups carry them. What varies is the ENERGY, and the
 * energy is what turns a consumption curve into a range curve.
 *
 *   measured    η back-solved from this group's own phases, and usable energy
 *               taken from the DC actually discharged to depletion. 73 groups.
 *   nominal     the same coefficients, but η is the default constant and the
 *               energy is the guide's gross pack — voltage x amp-hours, which
 *               ran a few percent above measured usable on every pack checked.
 *               The shape is measured; the range is an estimate. 108 groups.
 *   shape       coefficients and nothing else. Consumption against speed is
 *               real; there is no energy, so there is no range at all. 29.
 *
 * Named rather than scored because the difference is categorical: a nominal
 * curve is not a less precise measurement, it is a measured shape scaled by a
 * borrowed number.
 */
export const CURVE_TIERS = [
    { key: 'measured', label: 'Measured energy',
      hint: 'η derived from this record’s own test phases, and usable energy from the DC discharged to depletion. Range and consumption are both grounded in this vehicle’s lab numbers.' },
    { key: 'nominal', label: 'Nominal energy',
      hint: 'Measured road load, but η is the model default and the energy is the Fuel Economy Guide’s gross pack — voltage × amp-hours, a few percent above real usable capacity. The curve’s shape is measured; its range is an estimate.' },
    { key: 'shape', label: 'Shape only',
      hint: 'Road-load coefficients and nothing else. Consumption against speed is real; with no energy there is no range to plot.' },
];
export const tierByKey = (key) => CURVE_TIERS.find(t => t.key === key) ?? null;

/** The energy a curve should use, and where it came from. */
export function resolveCurveEnergy(group) {
    const explicit = num(group?.useable_kwh);
    if (explicit != null) return { kwh: explicit, source: 'curator' };

    // Procedure decides. Proc 86 is a short cycle whose DC energy is not a pack
    // capacity — it is where the 0.037 charger efficiency came from.
    const test = pickDerivationTest(group?.epa_tests || []);
    const measured = num(test?.total_dc_energy_kwh);
    if (measured != null) return { kwh: measured, source: 'measured' };

    const nominal = num(group?.epa_fe_guide?.nominal_pack_kwh);
    if (nominal != null) return { kwh: nominal, source: 'nominal' };

    return { kwh: null, source: null };
}

/**
 * One certification group as a plottable subject, or null if it cannot be one.
 *
 * A group with no coefficients has no curve at all — one of 211 — and is
 * returned as null rather than as an empty subject, so a caller cannot offer it
 * and then draw nothing.
 */
export function curveSubject(group) {
    const coeffs = resolvePrimaryCoeffs(group);
    if (!coeffs) return null;

    const eta = deriveDrivetrainEta(group);
    const etaMeasured = eta?.source !== 'estimated';
    const energy = resolveCurveEnergy(group);

    const tier = energy.kwh == null ? 'shape'
        : (etaMeasured && (energy.source === 'measured' || energy.source === 'curator')) ? 'measured'
            : 'nominal';

    const guide = group.epa_fe_guide ?? null;
    return {
        key: group.test_group_id,
        group,
        // The guide's carline is the fuller name where a link exists — it names
        // the wheel variant, which the represented-vehicle name usually does not.
        label: guide?.carline || group.display_name || group.epa_carline_name || group.test_group_id,
        sublabel: [group.model_year, guide?.division || group.make].filter(Boolean).join(' '),
        useableKwh: energy.kwh,
        energySource: energy.source,
        etaValue: eta?.value ?? null,
        etaMeasured,
        tier,
        // Range needs energy; consumption never does.
        canPlotRange: energy.kwh != null,
    };
}

/** Every group that can be plotted, best-grounded first. */
export function curveSubjects(groups) {
    const rank = Object.fromEntries(CURVE_TIERS.map((t, i) => [t.key, i]));
    return (groups ?? [])
        .map(curveSubject)
        .filter(Boolean)
        .sort((a, b) => rank[a.tier] - rank[b.tier] || a.label.localeCompare(b.label));
}

/** How many subjects sit in each tier, for the filter's counts. */
export function tierCounts(subjects) {
    const out = Object.fromEntries(CURVE_TIERS.map(t => [t.key, 0]));
    for (const s of subjects) out[s.tier] += 1;
    return out;
}

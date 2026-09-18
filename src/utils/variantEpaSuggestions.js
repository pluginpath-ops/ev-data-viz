/**
 * EPA configurations to suggest for a variant, from its source (#341).
 *
 * ── Why suggestions, not inheritance ────────────────────────────────────────
 *
 * #341 first proposed that a variant READ its source's configuration for EPA
 * tested capacity and EPA range, the way it reads the source's photo. Built and
 * checked against the live data, all three variants it would have filled in got
 * the wrong range: a variant exists because something differs, and what differs
 * (battery, drive, wheels, body) almost always means a different certification.
 * A wrong figure is worse than none. So the figures stay empty, and the source
 * is used where it genuinely helps: telling the curator where to look.
 *
 * ── Where the variant's own certification usually is ───────────────────────
 *
 * Next to its source's. Measured on the three: the ZDX Type S's configuration
 * is `ZDX AWD TYPE S` (278 mi) beside the A-Spec's `ZDX AWD` (304), and the
 * Blazer RS AWD's is `BLAZER EV AWD` (283) beside the LT FWD's `BLAZER EV`
 * (312). So candidates are the same make and model year as the source's
 * configurations, narrowed to the same model, and ranked by how many of the
 * words that set the VARIANT apart from its source (`Type S`, `RS AWD`) appear
 * in the carline or drive.
 *
 * The source's own configurations come after, for the variant that really does
 * share one.
 *
 * ── Battery size, where the names run out ───────────────────────────────────
 *
 * EPA often names every configuration of a model the same — five `Ioniq 5`s,
 * told apart only by test group ID — and the pack is what differs. So after
 * the words, a configuration whose EPA tested capacity sits within tolerance of
 * the nearer of the vehicle's own Usable and Gross ranks first: the same rule,
 * and the same knob, `resolveSocWindow` uses to accept EPA tested at all.
 *
 * ── A vehicle with no source to go on ───────────────────────────────────────
 *
 * Not a variant, or one whose whole chain has nothing linked — the Leaf S+, the
 * EX60 P10. The vehicles that most need a suggestion are the ones nobody in the
 * family has linked yet, so the vehicle stands in for its own source: its make,
 * model year and model pick the candidates, and every word of its name and trim
 * beyond the make and model ranks them.
 *
 * Nothing here is stored. The chain is walked on each render, and linking a
 * suggestion writes the same mapping a search does.
 *
 * Pure module: no data access, no React.
 */

import { epaConfigurationFigures } from './epaConfiguration';
import { sameMake } from './feGuideMatch';
import { testedAgreement } from './vehicleFigures';
import { resolveEffectiveSpecs } from './specHelpers';
import { TESTED_CAPACITY_TOLERANCE_PCT } from '../constants/epa';

const tokens = (value) => String(value ?? '').toLowerCase().match(/[a-z0-9]+/g) ?? [];
const years = (value) => (String(value ?? '').match(/\d{4}/g) ?? []).map(Number);
const linkedGroups = (v) => (v?.epa_mappings ?? []).map(m => m.epaGroup).filter(Boolean);

/** Shown before the rest are tucked away: enough to hold the answer, few enough to scan. */
export const SUGGESTION_LIMIT = 5;

/**
 * The nearest vehicle up the inheritance chain with configurations linked. Null
 * when the vehicle has no source, or no source in the chain links any.
 *
 * The vehicle's own links do not end it. The suggestions stay after one is
 * linked: a variant spanning wheel sizes links several, and the list is where
 * the curator finds the next.
 *
 * Stops at a missing source and at a cycle, as the other inheritance walks do.
 */
export function suggestionSource(vehicle, vehicles = []) {
    if (!vehicle || vehicle.spec_source_vehicle_id == null) return null;
    const byId = new Map(vehicles.map(v => [v.id, v]));
    const seen = new Set([vehicle.id]);
    let next = byId.get(vehicle.spec_source_vehicle_id);
    while (next && !seen.has(next.id)) {
        if (linkedGroups(next).length) return next;
        seen.add(next.id);
        next = next.spec_source_vehicle_id != null ? byId.get(next.spec_source_vehicle_id) : null;
    }
    return null;
}

/**
 * What to fetch candidates by: the source configurations' makes and model
 * years, or the vehicle's own make and its links' years when there is no
 * source. The vehicle's own year and one either side are added: a variant is
 * sometimes the next model year of the car it was made from, and our model
 * years and EPA's often disagree by one.
 */
export function candidateQuery(variant, source = null) {
    // With no source, the vehicle's own links set the years too: the IONIQ5 is
    // recorded as 2025 and certified as 2024, and its siblings are 2024s.
    const groups = linkedGroups(source ?? variant);
    const ownMake = variant?.manufacturer?.name || variant?.make;
    return {
        makes: [...new Set(source ? groups.map(g => g.make) : [ownMake])].filter(Boolean),
        // A year either side of the vehicle's own: model years in our records and
        // in EPA's drift by one, and the IONIQ5 Base (2025) sits between EPA's
        // 2024 and 2026 Ioniq 5s with no 2025 of its own. The ranking still puts
        // the exact year first — year orders here, it does not exclude, as in
        // feGuideMatch.
        years: [...new Set([
            ...groups.map(g => Number(g.model_year)),
            ...years(variant?.year).flatMap(y => [y - 1, y, y + 1]),
        ].filter(Boolean))].sort((a, b) => a - b),
    };
}

/**
 * The words that name what the vehicle is, minus the ones it shares with its
 * source — or, with no source, minus its make and model, which every candidate
 * already shares.
 */
function distinguishingTokens(variant, source) {
    const own = tokens([variant.name, variant.trim, variant.model].join(' '));
    const shared = source
        ? [source.name, source.trim, source.model]
        : [variant.model, variant.make, variant.manufacturer?.name];
    const theirs = new Set(tokens(shared.join(' ')));
    return [...new Set(own.filter(t => !theirs.has(t)))];
}

/**
 * Does a configuration belong to the same model as the source (or, with none,
 * the vehicle itself)? Every word of its model must be in the carline — `Blazer` in `BLAZER EV AWD`,
 * `Ioniq 5` in `Ioniq 5` and not in `Ioniq 6`. With no model recorded, any
 * word shared with a source configuration's carline will do.
 */
function sameModel(group, basis) {
    const carline = new Set(tokens(group.epa_carline_name));
    const model = tokens(basis.model);
    if (model.length) return model.every(t => carline.has(t));
    const sourceWords = new Set(linkedGroups(basis).flatMap(g => tokens(g.epa_carline_name)));
    return [...carline].some(t => sourceWords.has(t));
}

const positive = (v) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * The vehicle's own pack figures, through spec inheritance, to hold a
 * configuration's EPA tested against: Usable and Gross, whichever exist.
 *
 * Not EPA tested, which may be read from the very configuration being judged.
 * Not the unsorted `vehicles.battery` either: it is Usable on some vehicles and
 * Gross on others, and a ranking that trusted it would push the right
 * configuration down on a figure nobody has confirmed. With neither label, the
 * pack simply does not rank.
 */
export function packLabels(vehicle, vehicles = []) {
    const specs = vehicle ? resolveEffectiveSpecs(vehicle, vehicles) : {};
    const usable = positive(specs?.charging?.battery_usable_kwh);
    const gross = positive(specs?.powertrain?.battery_gross_kwh);
    return [usable && { name: 'Usable', kwh: usable }, gross && { name: 'Gross', kwh: gross }].filter(Boolean);
}

/** How a configuration's EPA tested sits against the vehicle's pack, or null with nothing to compare. */
function packFit(testedKwh, labels, tolerancePct) {
    if (testedKwh == null || !labels.length) return null;
    const { ok, nearest } = testedAgreement(testedKwh, labels, tolerancePct);
    return { ok, label: nearest.name, kwh: nearest.kwh, pct: nearest.pct };
}

/**
 * The suggestions for a variant, in the order they are shown.
 *
 * @param {Object} variant     the vehicle the suggestions are for
 * @param {Object|null} source  from suggestionSource; null ranks by the vehicle's own make and model
 * @param {Array}  candidates  epa_test_groups rows fetched by candidateQuery
 * @param {Object} [options]
 * @param {Array<{name, kwh}>} [options.labels]  the vehicle's pack figures (packLabels)
 * @param {number} [options.tolerancePct]
 * @returns {Array<{ group, figures, fromSource: boolean, linked: boolean, matched: string[], pack: {ok, label, kwh, pct}|null }>}
 *          `figures` as epaConfigurationFigures gives them; `fromSource` marks
 *          a configuration the source itself links; `linked` one the variant
 *          already links, kept in its place so the list does not reshuffle
 *          under a click; `matched` is the variant's distinguishing words found
 *          in the carline or drive; `pack` is how EPA tested sits against the
 *          vehicle's nearer pack figure, null with nothing to compare
 */
export function rankSuggestions(variant, source = null, candidates = [], { labels = [], tolerancePct = TESTED_CAPACITY_TOLERANCE_PCT } = {}) {
    if (!variant) return [];
    const sourceGroups = linkedGroups(source);
    const sourceIds = new Set(sourceGroups.map(g => g.test_group_id));
    const makes = source ? sourceGroups.map(g => g.make) : candidateQuery(variant).makes;
    const distinct = distinguishingTokens(variant, source);
    const variantYears = new Set(years(variant.year));
    const variantIds = new Set(linkedGroups(variant).map(g => g.test_group_id));

    const siblings = candidates
        .filter(g => !sourceIds.has(g.test_group_id))
        .filter(g => makes.some(m => sameMake(m, g.make)))
        .filter(g => sameModel(g, source ?? variant))
        .map(group => {
            const words = new Set(tokens(`${group.epa_carline_name} ${group.drive ?? ''} ${group.display_name ?? ''}`));
            const figures = epaConfigurationFigures(group);
            return {
                group,
                figures,
                pack: packFit(figures.testedKwh, labels, tolerancePct),
                fromSource: false,
                linked: variantIds.has(group.test_group_id),
                matched: distinct.filter(t => words.has(t)),
                sameYear: variantYears.has(Number(group.model_year)),
            };
        })
        // Most distinguishing words first; then a pack that fits; then the
        // variant's own model year; then the nearer pack; then the shorter
        // carline — the plainer name is the base configuration, and a longer
        // one adds a trim this variant has not said it has.
        .sort((a, b) => (b.matched.length - a.matched.length)
            || (Boolean(b.pack?.ok) - Boolean(a.pack?.ok))
            || (b.sameYear - a.sameYear)
            || ((a.pack?.pct ?? Infinity) - (b.pack?.pct ?? Infinity))
            || String(a.group.epa_carline_name ?? '').length - String(b.group.epa_carline_name ?? '').length);

    const own = sourceGroups.map(group => {
        const figures = epaConfigurationFigures(group);
        return {
            group, figures, fromSource: true,
            linked: variantIds.has(group.test_group_id), matched: [],
            pack: packFit(figures.testedKwh, labels, tolerancePct),
        };
    });

    return [
        ...siblings.map(({ sameYear: _sameYear, ...s }) => s),
        ...own,
    ];
}

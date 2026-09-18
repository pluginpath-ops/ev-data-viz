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
 * Nothing here is stored. The chain is walked on each render, and linking a
 * suggestion writes the same mapping a search does.
 *
 * Pure module: no data access, no React.
 */

import { epaConfigurationFigures } from './epaConfiguration';
import { sameMake } from './feGuideMatch';

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
 * years. The variant's own year is added, since a variant is sometimes the next
 * model year of the car it was made from.
 */
export function candidateQuery(variant, source) {
    const groups = linkedGroups(source);
    return {
        makes: [...new Set(groups.map(g => g.make).filter(Boolean))],
        years: [...new Set([...groups.map(g => Number(g.model_year)), ...years(variant?.year)].filter(Boolean))],
    };
}

/** The words that name what the variant is, minus the ones it shares with its source. */
function distinguishingTokens(variant, source) {
    const own = tokens([variant.name, variant.trim, variant.model].join(' '));
    const theirs = new Set(tokens([source.name, source.trim, source.model].join(' ')));
    return [...new Set(own.filter(t => !theirs.has(t)))];
}

/**
 * Does a configuration belong to the same model as the source? Every word of
 * the source's model must be in the carline — `Blazer` in `BLAZER EV AWD`,
 * `Ioniq 5` in `Ioniq 5` and not in `Ioniq 6`. With no model recorded, any
 * word shared with a source configuration's carline will do.
 */
function sameModel(group, source) {
    const carline = new Set(tokens(group.epa_carline_name));
    const model = tokens(source.model);
    if (model.length) return model.every(t => carline.has(t));
    const sourceWords = new Set(linkedGroups(source).flatMap(g => tokens(g.epa_carline_name)));
    return [...carline].some(t => sourceWords.has(t));
}

/**
 * The suggestions for a variant, in the order they are shown.
 *
 * @param {Object} variant     the vehicle the suggestions are for
 * @param {Object} source      from suggestionSource
 * @param {Array}  candidates  epa_test_groups rows fetched by candidateQuery
 * @returns {Array<{ group, figures, fromSource: boolean, linked: boolean, matched: string[] }>}
 *          `figures` as epaConfigurationFigures gives them; `fromSource` marks
 *          a configuration the source itself links; `linked` one the variant
 *          already links, kept in its place so the list does not reshuffle
 *          under a click; `matched` is the variant's distinguishing words found
 *          in the carline or drive
 */
export function rankSuggestions(variant, source, candidates = []) {
    if (!variant || !source) return [];
    const sourceGroups = linkedGroups(source);
    const sourceIds = new Set(sourceGroups.map(g => g.test_group_id));
    const makes = sourceGroups.map(g => g.make);
    const distinct = distinguishingTokens(variant, source);
    const variantYears = new Set(years(variant.year));
    const variantIds = new Set(linkedGroups(variant).map(g => g.test_group_id));

    const siblings = candidates
        .filter(g => !sourceIds.has(g.test_group_id))
        .filter(g => makes.some(m => sameMake(m, g.make)))
        .filter(g => sameModel(g, source))
        .map(group => {
            const words = new Set(tokens(`${group.epa_carline_name} ${group.drive ?? ''} ${group.display_name ?? ''}`));
            return {
                group,
                figures: epaConfigurationFigures(group),
                fromSource: false,
                linked: variantIds.has(group.test_group_id),
                matched: distinct.filter(t => words.has(t)),
                sameYear: variantYears.has(Number(group.model_year)),
            };
        })
        // Most distinguishing words first, then the variant's own model year,
        // then the shorter carline — the plainer name is the base configuration,
        // and a longer one adds a trim this variant has not said it has.
        .sort((a, b) => (b.matched.length - a.matched.length)
            || (b.sameYear - a.sameYear)
            || String(a.group.epa_carline_name ?? '').length - String(b.group.epa_carline_name ?? '').length);

    const own = sourceGroups.map(group => ({
        group, figures: epaConfigurationFigures(group), fromSource: true,
        linked: variantIds.has(group.test_group_id), matched: [],
    }));

    return [
        ...siblings.map(({ sameYear: _sameYear, ...s }) => s),
        ...own,
    ];
}

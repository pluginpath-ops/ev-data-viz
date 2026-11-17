/**
 * Home electricity rate plans with time-of-use prices: the Electricity rates
 * card's one-click plans (owner, 2026-11-17). A starting point a reader edits
 * to match their bill, not a feed: each says when it was read and where.
 *
 * REVISIT BY 2027-06: utilities move these prices every year or two. Re-read
 * each `source`, update the prices and `asOf`; a plan's hours rarely move.
 *
 * Shape. A plan has a summer and a winter season (the tab's own Season, not
 * the utility's months). Each season names up to three tiers, dearest first —
 * `tiers: [high, mid, low]`, each plan's own words, null where the plan has no
 * such tier — with a price per tier in $/kWh (an unused tier repeats a used
 * one's price, so a stray hour still prices sensibly), and two 24-letter hour
 * maps, `weekday` and `weekend` (calendar Saturday and Sunday): letter i is
 * the hour from i:00, H / M / L for the tier.
 *
 * Prices are what each source printed for a kWh, all-in where it said so;
 * `note` says what a figure leaves out. Monthly fixed charges are never in:
 * they are paid with or without an EV.
 *
 * APPEND ONLY: the Cost to Drive key stores a plan by its place in this list
 * (via the `rate` field's values).
 *
 * Leaf module: imports nothing, so the key codec can read it.
 */

/** The tiers' letters in an hour map, dearest first; a tier's index in `tiers` and `prices`. */
export const TIER_LETTERS = ['H', 'M', 'L'];

/** Custom plans' tier names (owner, 2026-11-17). */
export const CUSTOM_TIER_NAMES = ['Peak', 'Off-peak', 'Super off-peak'];

/** The same tiers and hours all year, prices by season. */
const allYear = (tiers, weekday, weekend, summer, winter = summer) => ({
    summer: { tiers, prices: summer, weekday, weekend },
    winter: { tiers, prices: winter, weekday, weekend },
});

/** A weekend map from a weekday map with its peak priced as the tier below. */
const noPeak = (map) => map.replaceAll('H', 'M');

export const RATE_PLANS = [
    {
        key: 'pge-ev2a', label: 'PG&E EV2-A', region: 'Northern California', asOf: '2026-11',
        source: 'https://www.pge.com/en/account/rate-plans/electric-vehicles.html',
        note: 'Winter off-peak taken as summer’s: PG&E’s page gives none.',
        seasons: allYear(['Peak', 'Partial peak', 'Off-peak'],
            'LLLLLLLLLLLLLLLMHHHHHMMM', 'LLLLLLLLLLLLLLLMHHHHHMMM',
            [0.54, 0.43, 0.23], [0.41, 0.39, 0.23]),
    },
    {
        key: 'sce-prime', label: 'SCE TOU-D-PRIME', region: 'Southern California', asOf: '2026-11',
        source: 'https://www.sce.com/residential/rates/electric-vehicle-plans',
        note: null,
        seasons: {
            summer: {
                tiers: ['On-peak', 'Mid-peak', 'Off-peak'], prices: [0.61, 0.39, 0.26],
                weekday: 'LLLLLLLLLLLLLLLLHHHHHLLL', weekend: 'LLLLLLLLLLLLLLLLMMMMMLLL',
            },
            winter: {
                tiers: ['Mid-peak', 'Off-peak', 'Super off-peak'], prices: [0.45, 0.30, 0.24],
                weekday: 'MMMMMMMMLLLLLLLLHHHHHMMM', weekend: 'MMMMMMMMLLLLLLLLHHHHHMMM',
            },
        },
    },
    {
        key: 'sdge-ev-tou-5', label: 'SDG&E EV-TOU-5', region: 'San Diego', asOf: '2026-04',
        source: 'https://www.sdge.com/sites/default/files/regulatory/4-1-26%20Schedule%20EV-TOU-5%20Total%20Rates%20Table.pdf',
        note: 'Super off-peak midday hours in March and April are left out.',
        seasons: allYear(['On-peak', 'Off-peak', 'Super off-peak'],
            'LLLLLLMMMMMMMMMMHHHHHMMM', 'LLLLLLMMMMMMMMMMHHHHHMMM',
            [0.80, 0.51, 0.13], [0.53, 0.48, 0.12]),
    },
    {
        key: 'tx-free-nights', label: 'Texas free nights', region: 'Texas (typical retail plan)', asOf: '2026-11',
        source: 'https://www.powertochoose.org/',
        note: 'A typical shape, not one company’s plan: free 9 pm to 5 am, about 30¢ by day. Check your plan’s Electricity Facts Label.',
        seasons: allYear([null, 'Day', 'Free nights'],
            'LLLLLMMMMMMMMMMMMMMMMLLL', 'LLLLLMMMMMMMMMMMMMMMMLLL',
            [0.30, 0.30, 0]),
    },
    {
        key: 'gpc-overnight', label: 'Georgia Power Overnight Advantage', region: 'Georgia', asOf: '2026-11',
        source: 'https://georgiapower.com/residential/rate-plans/overnight-advantage.html',
        note: 'Energy charge only: fuel, taxes and fees are extra.',
        seasons: {
            summer: {
                tiers: ['On-peak', 'Off-peak', 'Super off-peak'], prices: [0.30, 0.10, 0.02],
                weekday: 'LLLLLLLMMMMMMMHHHHHMMMML', weekend: 'LLLLLLLMMMMMMMMMMMMMMMML',
            },
            winter: {
                tiers: [null, 'Off-peak', 'Super off-peak'], prices: [0.10, 0.10, 0.02],
                weekday: 'LLLLLLLMMMMMMMMMMMMMMMML', weekend: 'LLLLLLLMMMMMMMMMMMMMMMML',
            },
        },
    },
    {
        key: 'duke-progress-rtoud', label: 'Duke Energy Progress R-TOUD', region: 'North Carolina', asOf: '2026-09',
        source: 'https://qmerit.com/locations/north-carolina/',
        note: 'Read from a summary of Duke’s tariff; winter on-peak taken as 6–9 am.',
        seasons: {
            summer: {
                tiers: ['On-peak', 'Off-peak', 'Discount'], prices: [0.14, 0.06, 0.04],
                weekday: 'MLLLLLMMMMMMMMMMMMHHHMMM', weekend: noPeak('MLLLLLMMMMMMMMMMMMHHHMMM'),
            },
            winter: {
                tiers: ['On-peak', 'Off-peak', 'Discount'], prices: [0.14, 0.06, 0.04],
                weekday: 'MLLMMMHHHMMLLLLLMMMMMMMM', weekend: noPeak('MLLMMMHHHMMLLLLLMMMMMMMM'),
            },
        },
    },
    {
        key: 'dominion-off-peak', label: 'Dominion Off-Peak Plan', region: 'Virginia', asOf: '2026-11',
        source: 'https://www.dominionenergy.com/virginia/rates-and-tariffs/off-peak-plan',
        note: 'Includes distribution, generation, transmission and riders.',
        seasons: {
            summer: {
                tiers: ['On-peak', 'Off-peak', 'Super off-peak'], prices: [0.31, 0.15, 0.13],
                weekday: 'LLLLLMMMMMMMMMMHHHMMMMMM', weekend: noPeak('LLLLLMMMMMMMMMMHHHMMMMMM'),
            },
            winter: {
                tiers: ['On-peak', 'Off-peak', 'Super off-peak'], prices: [0.27, 0.16, 0.15],
                weekday: 'LLLLLMHHHMMMMMMMMHHHMMMM', weekend: noPeak('LLLLLMHHHMMMMMMMMHHHMMMM'),
            },
        },
    },
    {
        key: 'coned-tou', label: 'Con Edison time of use', region: 'New York City', asOf: '2026-11',
        source: 'https://www.coned.com/en/accounts-billing/your-bill/time-of-use',
        note: 'Con Edison’s time-of-use prices plus about 10¢ for supply (an estimate). Summer weekday 2–6 pm super-peak left out.',
        seasons: allYear(['Peak', null, 'Off-peak'],
            'LLLLLLLLHHHHHHHHHHHHHHHH', 'LLLLLLLLHHHHHHHHHHHHHHHH',
            [0.38, 0.15, 0.15], [0.27, 0.15, 0.15]),
    },
    {
        key: 'comed-dtod', label: 'ComEd delivery time of day', region: 'Chicago area', asOf: '2026-03',
        source: 'https://www.citizensutilityboard.org/wp-content/uploads/2025/12/ComEdDeliveryTOD.pdf',
        note: 'Single-family delivery prices plus ComEd’s 10.1¢ price to compare and about 2¢ of other charges (an estimate).',
        seasons: allYear(['Mid-day peak', 'Morning and evening', 'Overnight'],
            'LLLLLLMMMMMMMHHHHHHMMLLL', 'LLLLLLMMMMMMMHHHHHHMMLLL',
            [0.23, 0.16, 0.15]),
    },
    {
        key: 'dte-tod', label: 'DTE Time of Day', region: 'Michigan', asOf: '2026-11',
        source: 'https://www.dteenergy.com/us/en/residential/service-request/pricing/rate-options/residential-pricing-options.html',
        note: 'Base rates: the power supply cost recovery surcharge is extra.',
        seasons: allYear(['Peak', null, 'Off-peak'],
            'LLLLLLLLLLLLLLLHHHHLLLLL', 'LLLLLLLLLLLLLLLLLLLLLLLL',
            [0.24, 0.18, 0.18], [0.20, 0.18, 0.18]),
    },
    {
        key: 'xcel-co-tou', label: 'Xcel Energy time of use', region: 'Colorado', asOf: '2026-06',
        source: 'https://puc.colorado.gov/time-of-use-rates',
        note: 'Base energy rates: riders are extra.',
        seasons: allYear(['On-peak', null, 'Off-peak'],
            'LLLLLLLLLLLLLLLLLHHHHLLL', 'LLLLLLLLLLLLLLLLLLLLLLLL',
            [0.21, 0.08, 0.08], [0.18, 0.07, 0.07]),
    },
];

/** A plan by key, or null. */
export const ratePlan = (key) => RATE_PLANS.find(p => p.key === key) ?? null;

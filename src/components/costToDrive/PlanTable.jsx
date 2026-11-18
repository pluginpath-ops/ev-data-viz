/**
 * The Weekly Charging Plan's week as a table, through the shared table parts
 * (components/tables): the same headers and cells as the vehicle table and the
 * FE Guide table, each figure with its unit beside it.
 *
 * Transposed (owner, 2026-11-07): a column a day, so it sits under the chart
 * with the days in the chart's order, and a row a figure. The three fast-
 * charging rows are outlined in orange, the chart’s stop color. It replaced
 * the day strip, whose boxes said the same things again.
 */
import { dollars, minutesText, weekTimeText, homeTierOrder } from '../../utils/costToDrive';
import SortHeader from '../tables/SortHeader';
import TableCell from '../tables/TableCell';

const TYPE_NAMES = { D: 'Daily', L: 'Long day', O: 'Off' };
const DASH = '—';
/** A clock time from an hour of the day, fractional: "4:10 am". */
const clockText = (h) => weekTimeText(h % 24).slice(4);
/** Dollars and cents: the rate rows split a night of a few dollars, so whole dollars read "$0". */
const centsText = (n) => `$${n.toFixed(2)}`;

/**
 * A row a figure: its name, each day's cell, and whether it is a fast-charging
 * row. Owner, 2026-11-07: home first, then fast; the % written in the figure,
 * not beside it in the unit style, and no notes under the cells, so every cell
 * is one plain line. A night the plug-in window cut short is marked with an
 * asterisk on its time, explained under the table. A week that carries a
 * shortfall marks Sunday's fast cells with †, the stop a month, explained
 * under the table in the fast rows' orange.
 */
const ROWS = [
    { key: 'type', label: 'Day type', cell: (d) => ({ text: TYPE_NAMES[d.type] }) },
    { key: 'home', label: 'Home adds', cell: (d) => ({ text: d.night.added >= 0.5 ? `+${Math.round(d.night.added)}%` : DASH }) },
    { key: 'start', label: 'Starts at', cell: (d) => ({ text: `${Math.round(d.startSoc)}%` }) },
    {
        // When the night ends: the battery full, or the plug-in window over.
        key: 'ready', label: 'Ready at',
        cell: (d) => (d.night.added >= 0.5
            ? { text: clockText(d.night.ranOut ? d.night.window.to : d.night.fullAt), mark: d.night.ranOut ? '*' : '' }
            : { text: DASH }),
    },
    {
        // The charger's margin: the plug-in window the charger did not use —
        // with a time-of-use plan, some of it waiting for the cheap hours.
        // None where the window cut the night short, as the * says.
        key: 'spare', label: 'Spare plug-in time',
        cell: (d) => (d.night.added >= 0.5
            ? (d.night.ranOut ? { text: 'None', mark: '*' } : { text: minutesText(Math.max(0, d.night.window.to - d.night.window.from - d.night.hours) * 60) })
            : { text: DASH }),
    },
    { key: 'homeCost', label: 'Home cost', cell: (d) => ({ text: d.night.added >= 0.5 ? dollars(d.night.homeCost) : DASH }) },
    // Here, on a time-of-use plan: each rate's time and cost (tierRows).
    {
        // What a kWh cost that night on average, on a time-of-use plan only
        // (owner, 2026-11-17).
        key: 'homeRate', label: 'Aggregate rate', tou: true,
        cell: (d) => ({ text: d.night.added >= 0.5 && d.night.homeKwh > 0 ? `${Math.round(d.night.homeCost / d.night.homeKwh * 100)}¢/kWh` : DASH }),
    },
    {
        key: 'stops', label: 'Fast stops', fast: true,
        cell: (d) => ({ text: d.stops.length ? `${d.stops.length}${d.stops.some(x => x.planned) ? ' planned' : ''}` : (d.plannedSkipped ? 'skipped' : DASH) }),
    },
    {
        key: 'fastMin', label: 'Fast time', fast: true,
        cell: (d) => { const m = d.stops.reduce((t, x) => t + x.minutes, 0); return { text: m ? minutesText(m) : DASH }; },
    },
    {
        key: 'fastCost', label: 'Fast cost', fast: true,
        cell: (d) => { const c = d.stops.reduce((t, x) => t + x.cost, 0); return { text: c ? dollars(c) : DASH }; },
    },
];
const FAST_KEYS = ROWS.filter(r => r.fast).map(r => r.key);

/** The stop a month, as a fast row's figure: "1 a month", "25 min/mo", "$9/mo". */
const MONTHLY_TEXT = {
    stops: () => '1 a month',
    fastMin: (m) => `${minutesText(m.minutes)}/mo`,
    fastCost: (m) => `${dollars(m.cost)}/mo`,
};
const MONTHLY_MARK = '†';

/**
 * Sunday's fast cell when the week carries a shortfall (owner, 2026-11-18):
 * the stop a month where Sunday has none of its own, marked † either way and
 * explained under the table.
 */
const withMonthly = (cell, key, monthly) => (cell.text === DASH
    ? { text: MONTHLY_TEXT[key](monthly), mark: MONTHLY_MARK }
    : { ...cell, mark: MONTHLY_MARK });

/** Hours a night charged in tier `t`. */
const tierHours = (night, t) => (night.tierSpans ?? []).filter(x => x.tier === t).reduce((h, x) => h + x.to - x.from, 0);

/**
 * On a time-of-use plan, a time row and a cost row for each rate the week
 * charged in, cheapest first, as the bars stack (owner, 2026-11-17).
 */
function tierRows(week) {
    const tiers = week.rateTiers;
    if (!tiers) return [];
    return homeTierOrder(tiers)
        .filter(t => week.days.some(d => (d.night.tierKwh?.[t] ?? 0) > 0))
        .flatMap(t => [
            {
                key: `tierTime-${t}`, label: `${tiers.names[t]} time`,
                cell: (d) => { const h = tierHours(d.night, t); return { text: h * 60 >= 1 ? minutesText(h * 60) : DASH }; },
            },
            {
                key: `tierCost-${t}`, label: `${tiers.names[t]} cost`,
                cell: (d) => { const c = d.night.tierCost?.[t] ?? 0; return { text: c >= 0.005 ? centsText(c) : DASH }; },
            },
        ]);
}

/** Home cost in cents too when the rate rows split it, so they add up to it. */
const HOME_COST_CENTS = {
    key: 'homeCost', label: 'Home cost',
    cell: (d) => ({ text: d.night.added >= 0.5 ? centsText(d.night.homeCost) : DASH }),
};

export default function PlanTable({ week, settings }) {
    const split = tierRows(week);
    const at = ROWS.findIndex(r => r.key === 'homeCost');
    const rows = split.length
        ? [...ROWS.slice(0, at), HOME_COST_CENTS, ...split, ...ROWS.slice(at + 1)]
        : ROWS;
    const shown = rows.filter(r => !r.tou || settings.rate !== 'flat');
    const cols = [
        { key: 'figure', label: '', holds: 'noted-figures' },
        ...week.days.map(d => ({ key: d.day, label: d.day, numeric: true })),
    ];
    return (
        <div className="guide-table-container">
            <table className="guide-table plan-table">
                <thead>
                    <tr>{cols.map(c => <SortHeader key={c.key} col={c} />)}</tr>
                </thead>
                <tbody>
                    {shown.map(r => {
                        const edge = !r.fast ? '' : r.key === FAST_KEYS[0] ? ' is-fast-first' : r.key === FAST_KEYS.at(-1) ? ' is-fast-last' : '';
                        return (
                            <tr key={r.key} className={r.fast ? `is-fast${edge}` : undefined}>
                                <TableCell text={r.label} className="plan-table-label" />
                                {week.days.map((d, i) => {
                                    const c = r.fast && week.monthly && i === week.days.length - 1
                                        ? withMonthly(r.cell(d), r.key, week.monthly)
                                        : r.cell(d);
                                    return <TableCell key={d.day} numeric {...c} />;
                                })}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            {week.days.some(d => d.night.ranOut) && (
                <p className="text-note plan-table-footnote">
                    * Stopped by your plug-in schedule (driving days {clockText(settings.plugFrom)} to {clockText(settings.plugUntil)}; days
                    off {clockText(settings.offFrom)} to {clockText(settings.offUntil)}) before reaching its limit.
                </p>
            )}
            {week.monthly && (
                <p className="text-note plan-table-footnote is-fast">
                    {MONTHLY_MARK} Home charging leaves the week {week.monthly.shortPct.toFixed(1)}% short of Monday
                    morning. One fast stop a month makes it up: {Math.round(week.monthly.fromSoc)}% to
                    {' '}{Math.round(week.monthly.toSoc)}%, {minutesText(week.monthly.minutes)}, {dollars(week.monthly.cost)}.
                    It is not on the chart, but its share is in the week&rsquo;s fast time and cost.
                </p>
            )}
        </div>
    );
}

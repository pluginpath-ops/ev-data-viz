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
import { dollars, minutesText, weekTimeText } from '../../utils/costToDrive';
import SortHeader from '../tables/SortHeader';
import TableCell from '../tables/TableCell';

const TYPE_NAMES = { D: 'Daily', L: 'Long day', O: 'Off' };
const DASH = '—';
/** A clock time from an hour of the day, fractional: "4:10 am". */
const clockText = (h) => weekTimeText(h % 24).slice(4);

/**
 * A row a figure: its name, each day's cell, and whether it is a fast-charging
 * row. Owner, 2026-11-07: home first, then fast; the unit in the row's name
 * rather than beside each figure, and no notes under the cells, so every cell
 * is one plain line.
 */
const ROWS = [
    { key: 'type', label: 'Day type', cell: (d) => ({ text: TYPE_NAMES[d.type] }) },
    { key: 'home', label: 'Home adds (%)', cell: (d) => ({ text: d.night.added >= 0.5 ? `+${Math.round(d.night.added)}` : DASH }) },
    { key: 'start', label: 'Starts at (%)', cell: (d) => ({ text: String(Math.round(d.startSoc)) }) },
    {
        // When the night ends: the battery full, or the plug-in window over.
        key: 'ready', label: 'Ready at',
        cell: (d, s) => ({ text: d.night.added >= 0.5 ? clockText(d.night.ranOut ? s.plugUntil : d.night.fullAt) : DASH }),
    },
    { key: 'homeCost', label: 'Home cost', cell: (d, s, homeCost) => ({ text: d.night.added >= 0.5 ? dollars(homeCost(d.night)) : DASH }) },
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

export default function PlanTable({ week, settings }) {
    // A night's cost: the week's home cost by its share of what the nights
    // added, since every night is bought at one price through one charger.
    const nightsAdded = week.days.reduce((t, d) => t + d.night.added, 0);
    const homeCost = (night) => (nightsAdded > 0 ? week.homeCost * night.added / nightsAdded : 0);
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
                    {ROWS.map(r => {
                        const edge = !r.fast ? '' : r.key === FAST_KEYS[0] ? ' is-fast-first' : r.key === FAST_KEYS.at(-1) ? ' is-fast-last' : '';
                        return (
                            <tr key={r.key} className={r.fast ? `is-fast${edge}` : undefined}>
                                <TableCell text={r.label} className="plan-table-label" />
                                {week.days.map(d => {
                                    const c = r.cell(d, settings, homeCost);
                                    return <TableCell key={d.day} numeric {...c} />;
                                })}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

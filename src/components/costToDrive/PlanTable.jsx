/**
 * The Weekly Charging Plan's week as a table, through the shared table parts
 * (components/tables): the same headers and cells as the vehicle table and the
 * FE Guide table, each figure with its unit beside it.
 *
 * Transposed (owner, 2026-11-07): a column a day, so it sits under the chart
 * with the days in the chart's order, and a row a figure. The three fast-
 * charging rows are outlined in orange, the chart's stop color. It replaced
 * the day strip, whose boxes said the same things again.
 */
import { dollars, minutesText, weekTimeText } from '../../utils/costToDrive';
import SortHeader from '../tables/SortHeader';
import TableCell from '../tables/TableCell';

const TYPE_NAMES = { D: 'Daily', L: 'Long day', O: 'Off' };
const DASH = '—';
/** A clock time from an hour of the day, fractional: "4:10 am". */
const clockText = (h) => weekTimeText(h % 24).slice(4);

/** A row a figure: its name, each day's cell, and whether it is a fast-charging row. */
const ROWS = [
    { key: 'type', label: 'Day type', cell: (d) => ({ text: TYPE_NAMES[d.type] }) },
    { key: 'miles', label: 'Miles', cell: (d) => (d.miles ? { text: String(d.miles), unit: 'mi', numeric: true } : { text: DASH, numeric: true }) },
    { key: 'start', label: 'Starts at', cell: (d) => ({ text: String(Math.round(d.startSoc)), unit: '%', numeric: true }) },
    {
        key: 'stops', label: 'Fast stops', fast: true,
        cell: (d) => ({ text: d.stops.length ? String(d.stops.length) : DASH, numeric: true, note: d.plannedSkipped ? 'planned, skipped' : (d.stops.some(s => s.planned) ? 'planned' : null) }),
    },
    {
        key: 'fastMin', label: 'Fast time', fast: true,
        cell: (d) => { const m = d.stops.reduce((t, s) => t + s.minutes, 0); return { text: m ? minutesText(m) : DASH, numeric: true }; },
    },
    {
        key: 'fastCost', label: 'Fast cost', fast: true,
        cell: (d) => { const c = d.stops.reduce((t, s) => t + s.cost, 0); return { text: c ? dollars(c) : DASH, numeric: true }; },
    },
    {
        key: 'home', label: 'Home adds',
        cell: (d) => (d.night.added >= 0.5 ? { text: `+${Math.round(d.night.added)}`, unit: '%', numeric: true } : { text: DASH, numeric: true }),
    },
    {
        key: 'end', label: 'Ready at',
        // When: full, or the end of the plug-in window when the night ran out.
        cell: (d, s) => ({
            text: String(Math.round(d.night.endSoc)), unit: '%', numeric: true,
            note: d.night.added >= 0.5 ? clockText(d.night.ranOut ? s.plugUntil : d.night.fullAt) : null,
        }),
    },
];
const FAST_KEYS = ROWS.filter(r => r.fast).map(r => r.key);

export default function PlanTable({ week, settings }) {
    const cols = [
        { key: 'figure', label: '', holds: 'short-values' },
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
                                    const c = r.cell(d, settings);
                                    return <TableCell key={d.day} {...c} />;
                                })}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

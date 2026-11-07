/**
 * The Weekly Charging Plan as a table, a row a day, through the shared table
 * parts (components/tables): the same headers and cells as the vehicle table
 * and the FE Guide table, each figure with its unit beside it. Seven rows in
 * week order, so there is nothing to sort.
 */
import { dollars, minutesText } from '../../utils/costToDrive';
import SortHeader from '../tables/SortHeader';
import TableCell from '../tables/TableCell';

const TYPE_NAMES = { D: 'Daily', L: 'Long day', O: 'Off' };
const DASH = '—';

const COLUMNS = [
    { key: 'day', label: 'Day', holds: 'short-values' },
    { key: 'type', label: 'Day type', holds: 'short-values' },
    { key: 'miles', label: 'Miles', numeric: true },
    { key: 'start', label: 'Starts at', numeric: true },
    { key: 'stops', label: 'Fast stops', numeric: true },
    { key: 'fastMin', label: 'Fast time', numeric: true },
    { key: 'fastCost', label: 'Fast cost', numeric: true },
    { key: 'home', label: 'Home adds', numeric: true },
    { key: 'end', label: 'Ready at', numeric: true },
];

export default function PlanTable({ week }) {
    return (
        <div className="guide-table-container">
            <table className="guide-table">
                <thead>
                    <tr>{COLUMNS.map(c => <SortHeader key={c.key} col={c} />)}</tr>
                </thead>
                <tbody>
                    {week.days.map((d) => {
                        const fastMin = d.stops.reduce((t, s) => t + s.minutes, 0);
                        const fastCost = d.stops.reduce((t, s) => t + s.cost, 0);
                        return (
                            <tr key={d.day}>
                                <TableCell text={d.day} />
                                <TableCell text={TYPE_NAMES[d.type]} />
                                <TableCell numeric text={d.miles ? String(d.miles) : DASH} unit={d.miles ? 'mi' : null} />
                                <TableCell numeric text={String(Math.round(d.startSoc))} unit="%" />
                                <TableCell numeric text={d.stops.length ? String(d.stops.length) : DASH}
                                           note={d.plannedSkipped ? 'planned, skipped' : null} />
                                <TableCell numeric text={fastMin ? minutesText(fastMin) : DASH} />
                                <TableCell numeric text={fastCost ? dollars(fastCost) : DASH} />
                                <TableCell numeric text={d.night.added >= 0.5 ? `+${Math.round(d.night.added)}` : DASH}
                                           unit={d.night.added >= 0.5 ? '%' : null}
                                           note={d.night.ranOut ? 'night ran out' : null} />
                                <TableCell numeric text={String(Math.round(d.night.endSoc))} unit="%" />
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

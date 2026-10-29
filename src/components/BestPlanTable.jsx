import { useAppContext } from '../context/AppContext';
import { formatTime } from '../utils/roadTripSimulation';
import { OPT_SPEED_MPH, NEAR_BEST_MIN } from '../utils/tripOptimizer';
import { convDistance, distanceLabel, fmtSpeed, speedLabel } from '../utils/unitConversions';

/**
 * Trip Optimizer's answer, one row per plotted trip: the best travel speed and
 * stop plan the grid found, what that means at a charger (arrive at, leave
 * with), how much it saves over the plan in the sidebar, and every plan within
 * NEAR_BEST_MIN of it.
 *
 * The last column is the one to read. The optimum is nearly always broad, and
 * a span of speeds a driver can hold is better advice than one exact figure —
 * which the grid's steps would not support anyway.
 *
 * @param {Array<{ entry, grid, yours, name }>} rows
 *   `grid` from RoadTripView's optimizerGrids (null when its data has not
 *   loaded), `yours` the simulation of the sidebar's own plan.
 * @param {'distance'|'time'} mode  what a stop plan is: distance added or minutes
 * @param {number} speed            your speed, mph
 * @param {number} stopSetting      your stop plan: mi per stop, or minutes
 * @param {number} totalDistance    the trip, mi
 */
export default function BestPlanTable({ rows, mode, speed, stopSetting, totalDistance }) {
    const { units } = useAppContext();
    const dl = distanceLabel(units);
    const sl = speedLabel(units);

    const stopText = v => (mode === 'time' ? `${v} min` : `${Math.round(convDistance(v, units))} ${dl}`);
    const span = (lo, hi, fmt) => (lo === hi ? fmt(lo) : `${fmt(lo)}–${fmt(hi)}`);
    const speedNum = mph => Math.round(convDistance(mph, units));
    const avgSpeed = totalMin => (convDistance(totalDistance, units) / (totalMin / 60)).toFixed(1);

    return (
        <div className="card">
            <h3 className="section-title">Best plan</h3>
            <div className="best-plan-table-container">
                <table className="best-plan-table">
                    <thead>
                        <tr>
                            <th>Vehicle / Run</th>
                            <th>Best speed · stop plan</th>
                            <th>Charge window</th>
                            <th>Trip time</th>
                            <th>vs your plan</th>
                            <th>Within {NEAR_BEST_MIN} min</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(({ entry, grid, yours, name }) => {
                            if (!grid) return null;
                            if (!grid.best) {
                                return (
                                    <tr key={entry.key}>
                                        <td><RowName entry={entry} name={name} /></td>
                                        <td colSpan={5} className="text-meta">No plan on the grid finishes this trip without charging past 95%.</td>
                                    </tr>
                                );
                            }
                            const { best, near, stops, window: w } = grid;
                            const bestMph = OPT_SPEED_MPH[best.si];
                            const yoursDone = yours && yours.completed !== false;
                            const saves = yoursDone ? Math.round(yours.totalTimeMin - best.total) : null;
                            // A best plan on the edge of the grid is the search's limit,
                            // not the car's: past it may be quicker still.
                            const edge = [
                                best.si === OPT_SPEED_MPH.length - 1 && 'the fastest speed searched',
                                best.si === 0 && 'the slowest speed searched',
                                best.ti === stops.length - 1 && 'the longest stop searched',
                                best.ti === 0 && 'the shortest stop searched',
                            ].filter(Boolean);
                            return (
                                <tr key={entry.key}>
                                    <td><RowName entry={entry} name={name} /></td>
                                    <td>
                                        <div className="best-plan-figure">{fmtSpeed(bestMph, units)} · {stopText(stops[best.ti])} per stop</div>
                                        {edge.length > 0 && (
                                            <div className="text-meta">at {edge.join(' and ')}: past it may be faster still</div>
                                        )}
                                    </td>
                                    <td>
                                        {w.stops > 0 ? (
                                            <>
                                                <div className="best-plan-figure">{w.arriveSoc}% → {w.leaveSoc}%</div>
                                                <div className="text-meta">{w.stops} stop{w.stops === 1 ? '' : 's'}, on average</div>
                                            </>
                                        ) : <div className="text-meta">no stops</div>}
                                    </td>
                                    <td>
                                        <div className="best-plan-figure">{formatTime(best.total)}</div>
                                        <div className="text-meta">avg {avgSpeed(best.total)} {sl}</div>
                                    </td>
                                    <td>
                                        {saves == null ? (
                                            <div className="text-meta">yours does not finish</div>
                                        ) : saves > 0 ? (
                                            <div className="best-plan-saving">{formatTime(saves)} faster</div>
                                        ) : (
                                            <div className="best-plan-figure">yours is as fast</div>
                                        )}
                                        <div className="text-meta">yours: {fmtSpeed(speed, units)} · {stopText(stopSetting)}</div>
                                    </td>
                                    <td>
                                        <div className="best-plan-figure">
                                            {span(OPT_SPEED_MPH[near.speeds[0]], OPT_SPEED_MPH[near.speeds[1]], speedNum)} {sl}
                                        </div>
                                        <div className="text-meta">
                                            {span(stops[near.stops[0]], stops[near.stops[1]], stopText)} per stop · {near.count} plans
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <p className="text-note">
                Searched every {fmtSpeed(1, units)} from {fmtSpeed(45, units)} to {fmtSpeed(100, units)}, against
                every {mode === 'time' ? '2.5 minutes' : stopText(10)} of charge per stop, so read the best plan
                to the nearest step.
                The span is every plan within {NEAR_BEST_MIN} minutes of the best: not always a rectangle,
                so not every pair inside it qualifies.
            </p>
        </div>
    );
}

/** The row's series swatch, vehicle and run, as Road Trip's results table names them. */
function RowName({ entry, name }) {
    return (
        <div className="best-plan-name">
            <span className="series-swatch" style={{ backgroundColor: entry.color }} />
            <div>
                <div className="best-plan-figure">{name}</div>
                <div className="text-meta">{entry.label}</div>
            </div>
        </div>
    );
}

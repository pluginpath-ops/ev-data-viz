/**
 * The five EPA drive cycles as speed ranges — which two a vehicle actually
 * drove, and which three the 0.7 factor stands in for (#206).
 *
 * This is the evidence for the sentence above it. "Adjusted downward for
 * conditions not tested" is a claim; showing that US06 reaches 80 mph, SC03
 * runs at 95°F with the A/C on and Cold FTP at 20°F — none of them driven —
 * is the reason to believe it.
 *
 * Each bar spans 0 to that cycle's peak speed, with a tick at its average. The
 * gap between tick and bar end is the point: even the highway cycle averages
 * 48.3 mph despite touching 60.
 */
import { DRIVE_CYCLES, FIVE_CYCLE_KEYS } from '../../constants/epa';

// Headroom above US06's 80.3 mph peak so the fastest bar isn't flush the edge.
const AXIS_MAX_MPH = 90;
const TICKS = [0, 20, 40, 60, 80];

export default function EpaCycleSpeedChart({ ranCycleKeys = [] }) {
    const ran = new Set(ranCycleKeys);

    return (
        <div className="cycle-chart">
            {FIVE_CYCLE_KEYS.map(key => {
                const c = DRIVE_CYCLES[key];
                const wasRun = ran.has(key);
                return (
                    <div key={key} className="cycle-row">
                        <div className="cycle-row-label">
                            <span className="font-semibold text-secondary">{c.label}</span>
                            {/* Naming the underlying trace is what connects the
                                vocabulary: a cert record says UDDS and HWY, the
                                label says FTP-75 city and HWFET highway, and
                                they are the same driving. */}
                            <span className="text-xs text-faint">
                                {c.schedule} · {c.tempF}°F, {c.condition}
                            </span>
                        </div>

                        <div className="cycle-row-track">
                            <div
                                className={`cycle-bar ${wasRun ? 'cycle-bar-run' : 'cycle-bar-substituted'}`}
                                style={{ width: `${(c.maxMph / AXIS_MAX_MPH) * 100}%` }}
                                title={`${c.label}: peak ${c.maxMph} mph, average ${c.avgMph} mph`}
                            >
                                <span
                                    className="cycle-bar-tick"
                                    style={{ left: `${(c.avgMph / c.maxMph) * 100}%` }}
                                />
                            </div>
                        </div>
                    </div>
                );
            })}

            <div className="cycle-row">
                <div className="cycle-row-label" />
                <div className="cycle-row-track cycle-axis">
                    {TICKS.map(t => (
                        <span key={t} className="cycle-axis-tick" style={{ left: `${(t / AXIS_MAX_MPH) * 100}%` }}>
                            {t}{t === TICKS[TICKS.length - 1] ? ' mph' : ''}
                        </span>
                    ))}
                </div>
            </div>

            <div className="cycle-legend">
                <span><i className="cycle-swatch cycle-bar-run" /> Driven in this test</span>
                <span><i className="cycle-swatch cycle-bar-substituted" /> Not driven — replaced by the 0.7 factor</span>
                <span><i className="cycle-swatch-tick" /> Average speed</span>
            </div>
        </div>
    );
}

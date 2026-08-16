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
 *
 * The 65–75 mph band is the same reference the EPA curve chart draws, and it is
 * what makes the speed argument land — it falls outside every cycle but US06,
 * and US06 is one of the three that was never driven.
 *
 * One grid, so the band can be a single element spanning every row rather than
 * five segments that have to be kept in alignment by hand.
 */
import { DRIVE_CYCLES, FIVE_CYCLE_KEYS, HIGHWAY_BAND_MPH } from '../../constants/epa';

// Headroom above US06's 80.3 mph peak so the fastest bar isn't flush the edge.
const AXIS_MAX_MPH = 90;
const TICKS = [0, 20, 40, 60, 80];

const pctOfAxis = (mph) => (mph / AXIS_MAX_MPH) * 100;

export default function EpaCycleSpeedChart({ ranCycleKeys = [] }) {
    const ran = new Set(ranCycleKeys);
    const [bandLo, bandHi] = HIGHWAY_BAND_MPH;

    return (
        <div className="cycle-chart">
            {/* Every cell is placed EXPLICITLY. Auto-placement is not an option
                here: the band below is an explicitly-placed item, and the grid
                algorithm places those first, so under auto-flow it reserved
                column 2 for five rows and pushed every bar into the label
                column. Explicit placement everywhere lets the band overlap
                instead of displace. */}
            {FIVE_CYCLE_KEYS.map((key, i) => {
                const c = DRIVE_CYCLES[key];
                const wasRun = ran.has(key);
                return [
                    <div key={`${key}-label`} className="cycle-row-label"
                        style={{ gridColumn: 1, gridRow: i + 1 }}>
                        <span className="font-semibold text-secondary">{c.label}</span>
                        {/* Naming the underlying trace is what connects the
                            vocabulary: a cert record says UDDS and HWY, the
                            label says FTP-75 city and HWFET highway, and
                            they are the same driving. */}
                        <span className="text-xs text-faint">
                            {c.schedule} · {c.tempF}°F, {c.condition}
                        </span>
                    </div>,
                    <div key={`${key}-track`} className="cycle-row-track"
                        style={{ gridColumn: 2, gridRow: i + 1 }}>
                        <div
                            className={`cycle-bar ${wasRun ? 'cycle-bar-run' : 'cycle-bar-substituted'}`}
                            style={{ width: `${pctOfAxis(c.maxMph)}%` }}
                            title={`${c.label}: peak ${c.maxMph} mph, average ${c.avgMph} mph`}
                        >
                            <span
                                className="cycle-bar-tick"
                                style={{ left: `${(c.avgMph / c.maxMph) * 100}%` }}
                            />
                        </div>
                    </div>,
                ];
            })}

            {/* Placed over the track column across every cycle row. A grid item
                rather than an absolute overlay, so it stays aligned with the
                bars for free. */}
            <div
                className="cycle-band"
                aria-hidden="true"
                style={{
                    left:  `${pctOfAxis(bandLo)}%`,
                    width: `${pctOfAxis(bandHi) - pctOfAxis(bandLo)}%`,
                }}
            />

            <div className="cycle-row-label" style={{ gridColumn: 1, gridRow: 6 }} />
            <div className="cycle-row-track cycle-axis" style={{ gridColumn: 2, gridRow: 6 }}>
                {TICKS.map(t => (
                    <span key={t} className="cycle-axis-tick" style={{ left: `${pctOfAxis(t)}%` }}>
                        {t}{t === TICKS[TICKS.length - 1] ? ' mph' : ''}
                    </span>
                ))}
            </div>

            <div className="cycle-row-label" style={{ gridColumn: 1, gridRow: 7 }} />
            <div className="cycle-axis-title" style={{ gridColumn: 2, gridRow: 7 }}>
                Range of speeds tested
            </div>

            <div className="cycle-legend">
                <span><i className="cycle-swatch cycle-bar-run" /> Driven in this test</span>
                <span><i className="cycle-swatch cycle-bar-substituted" /> Not driven — replaced by the 0.7 factor</span>
                <span><i className="cycle-swatch-tick" /> Average speed</span>
                <span>
                    <i className="cycle-swatch-band" /> {bandLo}–{bandHi} mph — where an independent
                    highway test is run
                </span>
            </div>
        </div>
    );
}

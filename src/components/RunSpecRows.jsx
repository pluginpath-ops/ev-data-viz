import { fmtSpeed, fmtTemp, fmtDistance, calcEff, effLabel as getEffLabel, speedBasisNote } from '../utils/unitConversions';
import { runKindFrom } from '../utils/runUtils';

/**
 * A run's numbers, grouped by what they mean rather than run together.
 *
 * These were one long dot-separated line that wrapped wherever the card
 * happened to end, so speed could sit beside efficiency and a temperature
 * could start a line on its own. Nothing was wrong, but nothing was findable
 * either — the eye had no anchor.
 *
 * Three bands, in the order a test is actually thought about:
 *
 *   design      what the test was set up to do — speed held, SoC window
 *   conditions  what the day imposed — temperature, wind, altitude, terrain
 *   results     what came out — distance, energy, efficiency
 *
 * The split also happens to match how the correction works: conditions are the
 * inputs it prices, results are what it re-prices. A reader comparing two tests
 * can put the condition rows side by side and see immediately why the results
 * differ.
 *
 * A band with nothing in it is not rendered, so a charging test with no
 * conditions recorded does not leave an empty rail.
 *
 * ── Every figure is now a LABELLED cell (re-skin phase 8) ────────────────────
 *
 * The values used to be bare — `72 °F`, `4,800 ft`, `↗ 1,240 ft gain` — leaning
 * on units and emoji to say what each one was. That works while you already
 * know the card; it does not survive two runs side by side, where `4,800 ft`
 * and `1,240 ft` are an altitude and a climb and nothing on screen says which.
 * Each cell now carries its own name above its value, and the cells sit on an
 * auto-fit track grid: as many columns as the run actually records, no padding
 * columns for the fields it does not.
 *
 * ── And the colours are gone ─────────────────────────────────────────────────
 *
 * Speed was amber, temperature orange, wind cyan, distance green, energy and
 * efficiency blue — seven hues across three rows where no hue meant anything,
 * which is the exact pattern the re-skin exists to remove. A reading is a
 * reading; the one distinction worth a colour is whether it can be trusted at
 * face value, so a qualified figure is marked and everything else is neutral.
 */

/** A figure that was not recorded. Shown, not omitted: the correction skips
 *  exactly these, and silence looked like zero. */
const Missing = ({ what }) => (
    <span className="run-cell-missing" title={`No ${what} recorded — correction skips this axis`}>—</span>
);

function Band({ label, cells }) {
    if (!cells.length) return null;
    return (
        <div className="run-band">
            {/* A solid rail, at a weight that can be read. It was faint text in
                a fixed-width column, which made the band names the quietest
                thing on a card whose whole structure they define. */}
            <span className="run-band-label">{label}</span>
            <div className="run-band-cells">
                {cells.map(c => (
                    <div
                        key={c.key}
                        className={`run-cell${c.tone ? ` is-${c.tone}` : ''}`}
                        title={c.title}
                    >
                        <span className="run-cell-label">{c.label}</span>
                        <span className="run-cell-value">{c.value}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default function RunSpecRows({ run, units, socRange, fieldMeta = [], calcKwhByRun, onCheckKwh }) {
    const kind = runKindFrom(run);
    const isRange = kind === 'range';

    // ── Design: what the test was set up to do ───────────────────────────────
    const design = [];
    if (isRange) {
        if (run.speed_mph != null) {
            design.push({
                key: 'spd',
                label: 'Speed held',
                value: fmtSpeed(run.speed_mph, units),
                // A cycle average where the column means a held setpoint: true,
                // but not comparable to a steady-state test, and the speed
                // correction is skipped for it.
                tone: run.speed_basis === 'mixed' ? 'qualified' : undefined,
                title: run.speed_basis === 'mixed'
                    ? 'Average over a varying-speed cycle, not a held setpoint. Not comparable to a steady-state test, and speed correction is skipped for it.'
                    : undefined,
            });
        } else {
            design.push({
                key: 'spd',
                label: 'Speed held',
                value: `${fmtSpeed(70, units)} est.`,
                tone: 'qualified',
                title: 'Set Speed (mph) in run metadata for accurate efficiency',
            });
        }
        if (speedBasisNote(run)) {
            design.push({
                key: 'basis', label: 'Basis', value: speedBasisNote(run), tone: 'qualified',
                title: 'Average over a varying-speed cycle, not a held setpoint.',
            });
        }
    }
    // A charging run's stored start_soc/end_soc came from the 046 split and
    // describe the DISCHARGE, so they read backwards and sometimes disagree with
    // the run entirely. Its data points are the measurement; prefer them.
    if (!isRange && socRange) {
        design.push({
            key: 'soc', label: 'SoC window · measured',
            value: `${Math.round(socRange.min)} → ${Math.round(socRange.max)} %`,
            title: "Measured from this run's data points",
        });
    } else if (run.start_soc != null && run.end_soc != null) {
        design.push({
            key: 'soc', label: 'SoC window',
            value: `${run.start_soc} → ${run.end_soc} %`,
            title: isRange ? undefined : 'From the run record — its data points have not loaded yet',
        });
    }

    // ── Conditions: what the day imposed ─────────────────────────────────────
    const conditions = [];

    if (run.temperature_f != null) {
        conditions.push({ key: 'tmp', label: 'Temp', value: fmtTemp(run.temperature_f, units) });
    } else if (isRange) {
        conditions.push({ key: 'tmp', label: 'Temp', value: <Missing what="temperature" /> });
    }

    if (run.avg_wind_speed_mph != null) {
        conditions.push({
            key: 'wind', label: 'Wind',
            value: fmtSpeed(run.avg_wind_speed_mph, units)
                + (run.wind_direction_deg != null ? ` @ ${run.wind_direction_deg}°` : ''),
            title: run.wind_direction_deg != null
                ? `${run.wind_direction_deg}° vs travel (0°=tailwind, 180°=headwind)`
                : 'Direction not recorded',
        });
    } else if (isRange) {
        conditions.push({ key: 'wind', label: 'Wind', value: <Missing what="wind" /> });
    }

    // Altitude and elevation gain are both in feet and mean different things.
    // Each said which it was with an emoji; now the cell label does it.
    if (run.altitude_ft != null) {
        conditions.push({
            key: 'alt', label: 'Altitude', value: `${Math.round(run.altitude_ft).toLocaleString()} ft`,
            title: 'Elevation the test was run at — drives air density, and so aero drag.',
        });
    } else if (isRange) {
        conditions.push({ key: 'alt', label: 'Altitude', value: <Missing what="altitude" /> });
    }

    // Elevation gain is a property of a ROUTE. A charging test does not drive
    // one, so the field is meaningless there however it got populated.
    if (isRange) {
        conditions.push(run.elevation_gain_ft != null
            ? {
                key: 'gain', label: 'Elev gain',
                value: `${Math.round(run.elevation_gain_ft).toLocaleString()} ft`,
                title: 'Net climb over the route — drives the potential-energy term.',
            }
            : { key: 'gain', label: 'Elev gain', value: <Missing what="elevation gain" /> });
    }

    const software = run.softwareVersion || run.software_version;
    if (software) {
        conditions.push({
            key: 'sw', label: 'Software', value: software,
            title: 'Vehicle software version at the time of the test',
        });
    }

    // The notes field is literally called `conditions` in the schema, and that is
    // what it holds — "overnight, 20in AT tyres", "lots of elevation gain/loss".
    // It belongs beside the measured conditions rather than on a line of its
    // own, and last because it is the one cell with no fixed shape.
    if (run.conditions) {
        conditions.push({ key: 'notes', label: 'Notes', value: run.conditions, tone: 'prose' });
    }

    // ── Results: what came out ───────────────────────────────────────────────
    const results = [];
    if (isRange) {
        if (run.distance_miles != null) {
            results.push({ key: 'dist', label: 'Distance', value: fmtDistance(run.distance_miles, units) });
        }
        if (run.energy_kwh != null) {
            results.push({
                key: 'kwh', label: 'Energy out', value: `${run.energy_kwh} kWh`,
                title: 'Energy out (measured at vehicle)',
            });
        }
        if (run.energy_kwh != null && run.distance_miles != null) {
            results.push({
                key: 'eff', label: 'Efficiency',
                value: `${calcEff(run.distance_miles, run.energy_kwh, 'mi_kwh', units)} ${getEffLabel('mi_kwh', units)}`,
            });
        }
    } else {
        results.push({
            key: 'pts', label: 'Data points',
            value: (run.dataPointCount ?? run.data?.length ?? 0).toLocaleString(),
        });

        // Which columns the data actually carries, and which were estimated.
        // One cell, not one per column: they are a set, and six cells of two
        // characters each would take a third of the grid to say "SoC kW Time".
        const present = fieldMeta.filter(f => (run.populated_fields || []).includes(f.key));
        if (present.length) {
            results.push({
                key: 'cols', label: 'Columns',
                value: (
                    <span className="run-cell-tags">
                        {present.map(f => {
                            const isCalc = (run.calculated_fields || []).includes(f.key);
                            return (
                                <span
                                    key={f.key}
                                    className={`badge-micro${isCalc ? ' is-qualified' : ''}`}
                                    title={isCalc ? `${f.title} (estimated from rated range)` : f.title}
                                >
                                    {isCalc ? `~${f.label}` : f.label}
                                </span>
                            );
                        })}
                    </span>
                ),
            });
        }

        if (run.charge_energy_kwh != null) {
            results.push({
                key: 'kwhin', label: 'Energy in', value: `${run.charge_energy_kwh} kWh`,
                title: 'Energy in (measured at charger or vehicle)',
            });
        }

        // The kWh cross-check stays with the figure it checks.
        if (onCheckKwh && run.charge_energy_kwh != null && (run.dataPointCount ?? 0) > 1) {
            const check = calcKwhByRun?.[run.id];
            if (!check) {
                results.push({
                    key: 'cmp', label: 'Cross-check',
                    value: (
                        <button type="button" onClick={() => onCheckKwh(run)} className="run-cell-action"
                            title="Calculate kWh from data points and compare">
                            Compare ↔
                        </button>
                    ),
                });
            } else if (check.loading) {
                results.push({ key: 'cmp', label: 'Cross-check', value: 'Calculating…' });
            } else if (check.kwh != null) {
                const pct = Math.abs(run.charge_energy_kwh - check.kwh) / Math.max(run.charge_energy_kwh, check.kwh) * 100;
                // Agreement is the expected case and takes the neutral badge —
                // an intent is for the few that are actually saying something is
                // wrong. Only the disagreement is coloured.
                results.push({
                    key: 'cmp', label: 'Cross-check',
                    tone: pct > 5 ? 'warning' : undefined,
                    title: `Calculated from data points: ${check.kwh} kWh`,
                    value: `${pct > 5 ? '⚠ ' : '✓ '}${check.kwh} kWh · ${pct.toFixed(1)} %`,
                });
            }
        }
    }

    if (!design.length && !conditions.length && !results.length) return null;

    return (
        <div className="run-bands">
            <Band label="Design"     cells={design} />
            <Band label="Conditions" cells={conditions} />
            <Band label="Results"    cells={results} />
        </div>
    );
}

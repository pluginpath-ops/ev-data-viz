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
 * Three rows, in the order a test is actually thought about:
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
 * A row with nothing in it is not rendered, so a charging test with no
 * conditions recorded does not leave an empty band.
 */

const Item = ({ children, title, className = 'text-secondary' }) => (
    <span className={className} title={title}>{children}</span>
);

// A missing condition is shown as a gap rather than omitted, so the row keeps
// its shape from card to card and an unrecorded figure is visibly unrecorded
// — the correction skips exactly these, and silence looked like zero.
const Missing = ({ what }) => (
    <span className="text-faint" title={`No ${what} recorded — correction skips this axis`}>—</span>
);

function Row({ label, items }) {
    if (!items.length) return null;
    return (
        <div className="run-spec-row">
            <span className="run-spec-label">{label}</span>
            <span className="run-spec-items">
                {items.map((item, i) => <span key={i} className="run-spec-item">{item}</span>)}
            </span>
        </div>
    );
}

export default function RunSpecRows({ run, units, socRange, fieldMeta = [], calcKwhByRun, onCheckKwh }) {
    const kind = runKindFrom(run);
    const isRange = kind === 'range';

    // ── Design: what the test was set up to do ───────────────────────────────
    const design = [];
    if (isRange) {
        design.push(run.speed_mph != null
            ? <Item key="spd" className={run.speed_basis === 'mixed' ? 'text-amber-600' : 'text-secondary'}>
                  {fmtSpeed(run.speed_mph, units)}
              </Item>
            : <Item key="spd" className="text-amber-600"
                    title="Set Speed (mph) in run metadata for accurate efficiency">
                  {fmtSpeed(70, units)} (est.)
              </Item>);
        if (speedBasisNote(run)) {
            design.push(
                <Item key="basis" className="text-amber-600"
                      title="Average over a varying-speed cycle, not a held setpoint. Not comparable to a steady-state test, and speed correction is skipped for it.">
                    {speedBasisNote(run)}
                </Item>);
        }
    }
    // A charging run's stored start_soc/end_soc came from the 046 split and
    // describe the DISCHARGE, so they read backwards and sometimes disagree with
    // the run entirely. Its data points are the measurement; prefer them.
    if (!isRange && socRange) {
        design.push(
            <Item key="soc" title="Measured from this run's data points">
                SoC {Math.round(socRange.min)}→{Math.round(socRange.max)}%
            </Item>);
    } else if (run.start_soc != null && run.end_soc != null) {
        design.push(
            <Item key="soc"
                  title={isRange ? undefined : 'From the run record — its data points have not loaded yet'}>
                SoC {run.start_soc}→{run.end_soc}%
            </Item>);
    }

    // ── Conditions: what the day imposed ─────────────────────────────────────
    const conditions = [];

    if (run.temperature_f != null) {
        conditions.push(<Item key="tmp" className="text-orange-700">{fmtTemp(run.temperature_f, units)}</Item>);
    } else if (isRange) {
        conditions.push(<span key="tmp">🌡 <Missing what="temperature" /></span>);
    }

    if (run.avg_wind_speed_mph != null) {
        conditions.push(
            <Item key="wind" className="text-cyan-700"
                  title={run.wind_direction_deg != null
                      ? `${run.wind_direction_deg}° vs travel (0°=tailwind, 180°=headwind)`
                      : 'Direction not recorded'}>
                💨 {fmtSpeed(run.avg_wind_speed_mph, units)}
                {run.wind_direction_deg != null ? ` @ ${run.wind_direction_deg}°` : ''}
            </Item>);
    } else if (isRange) {
        conditions.push(<span key="wind">💨 <Missing what="wind" /></span>);
    }

    // Altitude and elevation gain are both in feet and mean different things, so
    // each says which it is rather than relying on the reader to infer it.
    if (run.altitude_ft != null) {
        conditions.push(
            <Item key="alt" className="text-secondary"
                  title="Elevation the test was run at — drives air density, and so aero drag.">
                ⛰ {Math.round(run.altitude_ft)} ft
            </Item>);
    } else if (isRange) {
        conditions.push(<span key="alt">⛰ <Missing what="altitude" /></span>);
    }

    // Elevation gain is a property of a ROUTE. A charging test does not drive
    // one, so the field is meaningless there however it got populated.
    if (isRange) {
        conditions.push(run.elevation_gain_ft != null
            ? <Item key="gain" className="text-secondary"
                    title="Net climb over the route — drives the potential-energy term.">
                  ↗ {Math.round(run.elevation_gain_ft)} ft gain
              </Item>
            : <span key="gain">↗ <Missing what="elevation gain" /> gain</span>);
    }
    // The notes field is literally called `conditions` in the schema, and that is
    // what it holds — "overnight, 20in AT tyres", "lots of elevation gain/loss".
    // It belongs beside the measured conditions rather than on a line of its own.
    if (run.conditions) {
        conditions.push(<Item key="notes" className="text-muted italic">{run.conditions}</Item>);
    }
    const software = run.softwareVersion || run.software_version;
    if (software) {
        conditions.push(
            <Item key="sw" className="text-muted" title="Vehicle software version at the time of the test">
                sw {software}
            </Item>);
    }

    // ── Results: what came out ───────────────────────────────────────────────
    const results = [];
    if (isRange) {
        if (run.distance_miles != null) {
            results.push(<Item key="dist" className="text-green-700">{fmtDistance(run.distance_miles, units)}</Item>);
        }
        if (run.energy_kwh != null) {
            results.push(<Item key="kwh" className="text-blue-700" title="Energy out (measured at vehicle)">{run.energy_kwh} kWh out</Item>);
        }
        if (run.energy_kwh != null && run.distance_miles != null) {
            results.push(
                <Item key="eff" className="text-blue-700">
                    {calcEff(run.distance_miles, run.energy_kwh, 'mi_kwh', units)} {getEffLabel('mi_kwh', units)}
                </Item>);
        }
    } else {
        results.push(<Item key="pts">{run.dataPointCount ?? run.data?.length ?? 0} data points</Item>);
        // Which columns the data actually carries, and which were estimated.
        for (const f of fieldMeta.filter(f => (run.populated_fields || []).includes(f.key))) {
            const isCalc = (run.calculated_fields || []).includes(f.key);
            results.push(
                <span key={`field-${f.key}`}
                    title={isCalc ? `${f.title} (estimated from rated range)` : f.title}
                    className={`px-2 py-0.5 text-xs rounded-full font-medium border ${isCalc ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-blue-50 text-blue-700 border-blue-200'}`}>
                    {isCalc ? `~${f.label}` : f.label}
                </span>);
        }
        if (run.charge_energy_kwh != null) {
            results.push(<Item key="kwhin" className="text-blue-700" title="Energy in (measured at charger or vehicle)">{run.charge_energy_kwh} kWh in</Item>);
        }
        // The kWh cross-check stays with the figure it checks.
        if (onCheckKwh && run.charge_energy_kwh != null && (run.dataPointCount ?? 0) > 1) {
            const check = calcKwhByRun?.[run.id];
            if (!check) {
                results.push(
                    <button key="cmp" onClick={() => onCheckKwh(run)}
                        className="text-faint hover:text-secondary border border-[var(--color-border)] rounded px-1.5 py-0.5 transition-colors text-xs"
                        title="Calculate kWh from data points and compare">Compare ↔</button>);
            } else if (check.loading) {
                results.push(<Item key="cmp" className="text-faint text-xs">Calculating…</Item>);
            } else if (check.kwh != null) {
                const pct = Math.abs(run.charge_energy_kwh - check.kwh) / Math.max(run.charge_energy_kwh, check.kwh) * 100;
                results.push(
                    <span key="cmp" title={`Calculated from data points: ${check.kwh} kWh`}
                        className={`text-xs px-1.5 py-0.5 rounded border font-medium ${pct > 5 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-green-50 text-green-700 border-green-200'}`}>
                        {pct > 5 ? '⚠️ ' : '✓ '}data: {check.kwh} kWh ({pct.toFixed(1)}%)
                    </span>);
            }
        }
    }

    if (!design.length && !conditions.length && !results.length) return null;

    return (
        <div className="run-spec-rows">
            <Row label="Design"     items={design} />
            <Row label="Conditions" items={conditions} />
            <Row label="Results"    items={results} />
        </div>
    );
}

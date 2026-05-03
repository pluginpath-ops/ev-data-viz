import { useEffect, useRef, useMemo, useState } from 'react';
import Chart from 'chart.js/auto';
import { useTheme } from '../hooks/useTheme';
import { useAppContext } from '../context/AppContext';
import { convSpeed, speedLabel, distanceLabel } from '../utils/unitConversions';
import { vehicleColor, vehicleLabel, resolveEffectiveSpecs } from '../utils/specHelpers';
import { PALETTE } from '../utils/specHelpers';
import {
    buildEpaCurve, resolveUseableKwh, resolveUseableKwhSource,
    resolveCoeffs, calibrateEfficiency,
    HWFET_AVG_MPH, HIGHWAY_BAND_MPH,
} from '../utils/epaPhysics';
import AxisScaleControls from './AxisScaleControls';
import InfoIcon from './InfoIcon';
import { EPA_EXPLAINERS } from '../utils/epaExplainers';

// ── Reference line / highway band plugin ─────────────────────────────────────

/**
 * Draws the highway speed band and two reference speed lines after Chart.js
 * renders its datasets. Follows the same afterDraw pattern as barGroupPlugin
 * and makeBarPlugin in other chart views.
 */
function makeReferencePlugin(bandMph, units, isDark) {
    return {
        id: 'epaReferenceLines',
        afterDraw(chart) {
            const { ctx, chartArea: area, scales } = chart;
            if (!area || !scales.x) return;

            const x = v => scales.x.getPixelForValue(convSpeed(v, units));
            const textColor = isDark ? 'rgba(226,232,240,0.6)' : 'rgba(107,114,128,0.8)';
            const bandColor = isDark ? 'rgba(59,130,246,0.07)' : 'rgba(59,130,246,0.06)';

            ctx.save();

            // 65–75 mph highway band
            const xBand0 = x(bandMph[0]);
            const xBand1 = x(bandMph[1]);
            ctx.fillStyle = bandColor;
            ctx.fillRect(xBand0, area.top, xBand1 - xBand0, area.bottom - area.top);

            // Band label
            ctx.font = '9px system-ui, sans-serif';
            ctx.fillStyle = textColor;
            ctx.textAlign = 'center';
            ctx.fillText('Hwy', (xBand0 + xBand1) / 2, area.top + 10);

            ctx.restore();
        },
    };
}

// ── Speed callout plugin ──────────────────────────────────────────────────────

/**
 * Draws filled dots + range labels on each curve at specified reference speeds.
 *
 * The label always shows range (mi or km) regardless of the current Y axis, so
 * users see "what range does this speed translate to?" in any view mode.
 * Labels only appear when useableKwh is available (rangeMi != null).
 */
function makeCalloutPlugin(calloutMphs, yAxis, units, isDark) {
    return {
        id: 'epaCallouts',
        afterDatasetsDraw(chart) {
            const { ctx, chartArea: area, scales, data } = chart;
            if (!area || !scales.x || !scales.y) return;

            data.datasets.forEach((ds) => {
                const curve = ds._curve;
                if (!curve?.length) return;

                const color = ds.borderColor;

                calloutMphs.forEach((targetMph) => {
                    // Find nearest curve point to this reference speed
                    const pt = curve.reduce((best, p) =>
                        Math.abs(p.mph - targetMph) < Math.abs(best.mph - targetMph) ? p : best
                    , curve[0]);
                    if (!pt) return;

                    const xVal = convSpeed(targetMph, units);
                    const yVal = convertYValue(getYValue(pt, yAxis), yAxis, units);
                    if (yVal == null) return;

                    const px = scales.x.getPixelForValue(xVal);
                    const py = scales.y.getPixelForValue(yVal);
                    if (px < area.left || px > area.right || py < area.top || py > area.bottom) return;

                    ctx.save();

                    // Filled dot on the curve
                    ctx.beginPath();
                    ctx.arc(px, py, 4.5, 0, Math.PI * 2);
                    ctx.fillStyle = color;
                    ctx.fill();
                    ctx.strokeStyle = isDark ? 'rgba(15,23,42,0.9)' : 'rgba(255,255,255,0.9)';
                    ctx.lineWidth = 1.5;
                    ctx.stroke();

                    // Range label — only when rangeMi is available
                    if (pt.rangeMi != null) {
                        const rangeDisplay = units === 'metric'
                            ? `${(pt.rangeMi * 1.60934).toFixed(0)} km`
                            : `${pt.rangeMi.toFixed(0)} mi`;

                        ctx.font = '10px system-ui, sans-serif';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'alphabetic';

                        const textW = ctx.measureText(rangeDisplay).width;
                        const labelY = py - 9;

                        // Pill background for legibility over other curves
                        const padX = 3, padY = 2;
                        ctx.fillStyle = isDark ? 'rgba(15,23,42,0.82)' : 'rgba(255,255,255,0.88)';
                        ctx.beginPath();
                        ctx.roundRect(
                            px - textW / 2 - padX, labelY - 10 - padY,
                            textW + padX * 2, 11 + padY * 2, 3
                        );
                        ctx.fill();

                        ctx.fillStyle = color;
                        ctx.fillText(rangeDisplay, px, labelY);
                    }

                    ctx.restore();
                });
            });
        },
    };
}

// ── Y-axis mode config ────────────────────────────────────────────────────────

const Y_MODES = [
    { key: 'kwh100mi', label: 'kWh/100mi' },
    { key: 'mi_kwh',   label: 'mi/kWh'    },
    { key: 'mpge',     label: 'MPGe'       },
    { key: 'range_mi', label: 'Range (mi)' },
];

function getYValue(point, yAxis) {
    switch (yAxis) {
        case 'kwh100mi': return point.kwh100mi;
        case 'mi_kwh':   return point.miPerKwh;
        case 'mpge':     return point.mpge;
        case 'range_mi': return point.rangeMi;
        default:         return point.kwh100mi;
    }
}

function yAxisLabel(yAxis, units) {
    if (yAxis === 'range_mi') return `Range (${distanceLabel(units)})`;
    if (units === 'metric') {
        if (yAxis === 'kwh100mi') return 'kWh/100km';
        if (yAxis === 'mi_kwh')   return 'km/kWh';
    }
    if (yAxis === 'kwh100mi') return 'kWh/100mi';
    if (yAxis === 'mi_kwh')   return 'mi/kWh';
    if (yAxis === 'mpge')     return 'MPGe';
    return '';
}

/** Convert a Y value from imperial to metric for display. */
function convertYValue(val, yAxis, units) {
    if (val == null) return null;
    if (units !== 'metric') return val;
    if (yAxis === 'kwh100mi') return val / 1.60934;  // kWh/100mi → kWh/100km
    if (yAxis === 'mi_kwh')   return val * 1.60934;  // mi/kWh → km/kWh
    if (yAxis === 'range_mi') return val * 1.60934;  // mi → km
    return val; // MPGe stays as-is
}

// ── Confidence badge ──────────────────────────────────────────────────────────

const CONFIDENCE_COLORS = {
    verified: 'text-green-700 bg-green-50 border-green-200 dark:text-green-300 dark:bg-green-900/30 dark:border-green-700',
    likely:   'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-900/30 dark:border-amber-700',
    inferred: 'text-gray-500 bg-gray-50 border-gray-200 dark:text-gray-400 dark:bg-gray-800/40 dark:border-gray-600',
};

function ConfidenceBadge({ confidence }) {
    return (
        <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${CONFIDENCE_COLORS[confidence] || CONFIDENCE_COLORS.inferred}`}>
            {confidence}
        </span>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * EpaCurvesView — "EPA Curves" chart sub-tab.
 *
 * Renders theoretical steady-state efficiency vs speed curves derived from
 * EPA road-load coefficients for each selected vehicle that has an EPA test
 * group linked. Vehicles without a mapping are listed in an empty-state callout.
 *
 * Props:
 *   vehicles           {Array}    — full vehicles array from context (with epa_mappings)
 *   selectedVehicleIds {Array}    — currently selected vehicle IDs
 *   epaConfig          {object}   — { yAxis, xMin, xMax, yMin, yMax }
 *   setEpaConfig       {function}
 *   presentationMode   {boolean}  — strips controls for popout window
 */
export default function EpaCurvesView({
    vehicles,
    selectedVehicleIds,
    epaConfig,
    setEpaConfig,
    presentationMode = false,
}) {
    const { units } = useAppContext();
    const { isDark } = useTheme();
    const canvasRef = useRef(null);
    const chartRef  = useRef(null);
    const [imageCopied, setImageCopied] = useState(false);

    const { yAxis, xMin, xMax, yMin, yMax } = epaConfig;

    // Resolve selected vehicles that have EPA data vs those that don't
    const selectedVehicles = useMemo(() => {
        return selectedVehicleIds
            .map(id => vehicles.find(v => v.id === id))
            .filter(Boolean);
    }, [vehicles, selectedVehicleIds]);

    const vehiclesWithEpa    = selectedVehicles.filter(v => v.epa_mappings?.length > 0);
    const vehiclesWithoutEpa = selectedVehicles.filter(v => !v.epa_mappings?.length);

    // Build curve datasets: one per vehicle-mapping combination
    const datasets = useMemo(() => {
        const result = [];
        vehiclesWithEpa.forEach((vehicle, vi) => {
            // Resolve inherited specs so battery_usable_kwh from a parent vehicle is visible
            const effectiveVehicle = {
                ...vehicle,
                specs: resolveEffectiveSpecs(vehicle, vehicles),
            };
            vehicle.epa_mappings.forEach((mapping, mi) => {
                const { epaGroup, confidence } = mapping;
                if (!epaGroup) return;
                const useableKwh       = resolveUseableKwh(epaGroup, effectiveVehicle);
                const useableKwhSource = resolveUseableKwhSource(epaGroup, effectiveVehicle);
                const curve            = buildEpaCurve(epaGroup, useableKwh);
                if (!curve.length) return;

                const baseColor = vehicle.color || PALETTE[vi % PALETTE.length];
                // Use a slightly lighter alpha for additional mappings on the same vehicle
                const color = mi === 0 ? baseColor : baseColor + 'bb';
                // Prefer display_name (friendly) over raw EPA carline name for labels
                const epaLabel = epaGroup.display_name || epaGroup.epa_carline_name;
                const label = vehiclesWithEpa.length > 1 || mi > 0
                    ? `${vehicleLabel(vehicle)}${vehicle.epa_mappings.length > 1 ? ` (${epaLabel})` : ''}`
                    : vehicleLabel(vehicle);

                result.push({
                    label,
                    data: curve.map(pt => ({
                        x: convSpeed(pt.mph, units),
                        y: convertYValue(getYValue(pt, yAxis), yAxis, units),
                    })).filter(pt => pt.y != null),
                    borderColor: color,
                    backgroundColor: color + '22',
                    borderWidth: 2,
                    borderDash: [6, 4],            // dashed = theoretical (vs solid empirical runs)
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    tension: 0.3,
                    // Store metadata for tooltip
                    _vehicleId:        vehicle.id,
                    _mappingId:        mapping.id,
                    _confidence:       confidence,
                    _epaGroup:         epaGroup,
                    _useableKwh:       useableKwh,
                    _useableKwhSource: useableKwhSource,
                    _curve:            curve,       // full curve for tooltip lookup
                });
            });
        });
        return result;
    }, [vehiclesWithEpa, vehicles, yAxis, units]);

    // Build / rebuild chart whenever deps change
    useEffect(() => {
        if (!canvasRef.current) return;
        if (chartRef.current) {
            chartRef.current.destroy();
            chartRef.current = null;
        }
        if (!datasets.length) return;

        const tickColor   = isDark ? 'rgb(226,232,240)'         : 'rgb(107,114,128)';
        const gridColor   = isDark ? 'rgba(100,116,139,0.35)'   : 'rgba(229,231,235,0.8)';
        const legendColor = isDark ? 'rgb(241,245,249)'         : 'rgb(55,65,81)';

        const refPlugin      = makeReferencePlugin(HIGHWAY_BAND_MPH, units, isDark);
        const calloutPlugin  = makeCalloutPlugin([70, 80], yAxis, units, isDark);

        chartRef.current = new Chart(canvasRef.current, {
            type: 'line',
            plugins: [refPlugin, calloutPlugin],
            data: { datasets },
            options: {
                animation: false,
                responsive: true,
                maintainAspectRatio: false,
                parsing: false,
                scales: {
                    x: {
                        type: 'linear',
                        title: { display: true, text: `Speed (${speedLabel(units)})`, color: tickColor },
                        min: xMin ?? convSpeed(5,   units),
                        max: xMax ?? convSpeed(120, units),
                        ticks: { color: tickColor },
                        grid:  { color: gridColor },
                    },
                    y: {
                        title: { display: true, text: yAxisLabel(yAxis, units), color: tickColor },
                        min:   yMin ?? undefined,
                        max:   yMax ?? undefined,
                        ticks: { color: tickColor },
                        grid:  { color: gridColor },
                    },
                },
                plugins: {
                    legend: {
                        display:  datasets.length > 1,
                        labels: { color: legendColor, usePointStyle: true, pointStyleWidth: 16 },
                    },
                    tooltip: {
                        callbacks: {
                            title(items) {
                                const spd = items[0]?.parsed.x;
                                return `${spd?.toFixed(1)} ${speedLabel(units)}`;
                            },
                            label(item) {
                                const ds = item.dataset;
                                const curve = ds._curve;
                                const speedMph = units === 'metric'
                                    ? item.parsed.x / 1.60934
                                    : item.parsed.x;
                                const pt = curve?.reduce((best, p) =>
                                    Math.abs(p.mph - speedMph) < Math.abs(best.mph - speedMph) ? p : best
                                , curve[0]);
                                if (!pt) return ds.label;

                                // Format the value for whichever Y axis is active
                                let valStr = '';
                                if (yAxis === 'kwh100mi') {
                                    valStr = pt.kwh100mi != null
                                        ? `${(units === 'metric' ? pt.kwh100mi / 1.60934 : pt.kwh100mi).toFixed(1)} ${units === 'metric' ? 'kWh/100km' : 'kWh/100mi'}`
                                        : '—';
                                } else if (yAxis === 'mi_kwh') {
                                    valStr = pt.miPerKwh != null
                                        ? `${(units === 'metric' ? pt.miPerKwh * 1.60934 : pt.miPerKwh).toFixed(2)} ${units === 'metric' ? 'km/kWh' : 'mi/kWh'}`
                                        : '—';
                                } else if (yAxis === 'mpge') {
                                    valStr = pt.mpge != null ? `${pt.mpge.toFixed(1)} MPGe` : '—';
                                } else if (yAxis === 'range_mi') {
                                    valStr = pt.rangeMi != null
                                        ? `${(units === 'metric' ? pt.rangeMi * 1.60934 : pt.rangeMi).toFixed(0)} ${distanceLabel(units)}`
                                        : '—';
                                }

                                return `${ds.label}: ${valStr}`;
                            },
                        },
                        mode: 'index',
                        intersect: false,
                    },
                },
            },
        });

        return () => {
            chartRef.current?.destroy();
            chartRef.current = null;
        };
    }, [datasets, yAxis, units, isDark, xMin, xMax, yMin, yMax]);

    // ── PNG copy ──────────────────────────────────────────────────────────────
    const handleCopyPng = async () => {
        if (!chartRef.current) return;
        const canvas = chartRef.current.canvas;
        const bg = isDark ? 'rgb(8,12,28)' : '#ffffff';
        const tmp = document.createElement('canvas');
        tmp.width  = canvas.width;
        tmp.height = canvas.height;
        const ctx2 = tmp.getContext('2d');
        ctx2.fillStyle = bg;
        ctx2.fillRect(0, 0, tmp.width, tmp.height);
        ctx2.drawImage(canvas, 0, 0);
        try {
            const blob = await new Promise(res => tmp.toBlob(res, 'image/png'));
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            setImageCopied(true);
            setTimeout(() => setImageCopied(false), 2000);
        } catch {
            // Fallback: open in new tab
            window.open(tmp.toDataURL('image/png'));
        }
    };

    // ── Render ────────────────────────────────────────────────────────────────

    // Empty state: no vehicles selected
    if (selectedVehicleIds.length === 0) {
        return (
            <div>
                <h2 className="page-title mb-6">EPA Efficiency Curves</h2>
                <div className="empty-state">
                    <p className="text-lg">No vehicles selected. Select vehicles from the Vehicles tab to view their EPA curves.</p>
                </div>
            </div>
        );
    }

    return (
        <div>
            {!presentationMode && (
                <div className="flex items-center gap-3 mb-4">
                    <h2 className="page-title mb-0">
                        EPA Efficiency Curves
                        <InfoIcon text={EPA_EXPLAINERS.steadyStateCurve} position="below" />
                    </h2>
                    <button
                        type="button"
                        onClick={handleCopyPng}
                        disabled={!datasets.length}
                        className={`chart-copy-btn ml-auto ${imageCopied ? 'chart-copy-btn-active' : ''}`}
                    >
                        {imageCopied ? '✓ Copied!' : '📋 Copy PNG'}
                    </button>
                </div>
            )}

            {/* Y-axis mode toggle */}
            {!presentationMode && (
                <div className="chart-toggles mb-4">
                    <span className="text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>Y axis:</span>
                    <div className="chart-type-buttons">
                        {Y_MODES.map(m => (
                            <button
                                key={m.key}
                                type="button"
                                className={`btn btn-sm ${yAxis === m.key ? 'btn-primary' : 'btn-secondary'}`}
                                onClick={() => setEpaConfig(p => ({ ...p, yAxis: m.key }))}
                            >
                                {m.label}
                            </button>
                        ))}
                    </div>
                    <div className="flex items-center gap-1.5 ml-4 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                        <span className="inline-block w-8 border-t-2 border-dashed border-indigo-400" />
                        <span>Theoretical (EPA road load)</span>
                        <InfoIcon text={EPA_EXPLAINERS.hwfetCalibration} />
                    </div>
                </div>
            )}

            {/* Chart canvas */}
            {datasets.length > 0 ? (
                <div className="specs-chart-card">
                    <div style={{ height: presentationMode ? 'calc(100vh - 120px)' : 480 }}>
                        <canvas ref={canvasRef} />
                    </div>
                    {!presentationMode && (
                        <div className="mt-3 flex flex-wrap gap-4 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                            <span>
                                <span className="font-medium">Shaded band</span> — 65–75 mph typical highway
                            </span>
                            <span>
                                <span className="font-medium">● Dots</span> — range at 70 &amp; 80 mph
                            </span>
                        </div>
                    )}
                    {!presentationMode && (
                        <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
                            <AxisScaleControls
                                xMin={xMin} xMax={xMax} yMin={yMin} yMax={yMax}
                                xAxisLabel={`Speed (${speedLabel(units)})`}
                                yAxisLabel={yAxisLabel(yAxis, units)}
                                onChange={(key, value) => setEpaConfig(p => ({ ...p, [key]: value }))}
                            />
                        </div>
                    )}
                </div>
            ) : (
                <div className="empty-state">
                    <p>No EPA test group data available for the selected vehicles.</p>
                    <p className="text-sm mt-2" style={{ color: 'var(--color-text-muted)' }}>
                        Link an EPA test group via Edit Vehicle to enable this chart.
                    </p>
                </div>
            )}

            {/* Vehicles without EPA data */}
            {vehiclesWithoutEpa.length > 0 && !presentationMode && (
                <div className="mt-4 p-3 rounded-lg text-sm" style={{ background: 'var(--color-surface-muted)', color: 'var(--color-text-secondary)' }}>
                    <span className="font-medium">No EPA data:</span>{' '}
                    {vehiclesWithoutEpa.map(v => vehicleLabel(v)).join(', ')}
                    {' '}— link an EPA test group via Edit Vehicle.
                </div>
            )}

            {/* Per-vehicle metadata summary */}
            {vehiclesWithEpa.length > 0 && !presentationMode && (
                <div className="mt-4 space-y-2">
                    {vehiclesWithEpa.map(vehicle =>
                        vehicle.epa_mappings.map(mapping => {
                            const { epaGroup, confidence } = mapping;
                            if (!epaGroup) return null;
                            const { a, b, c } = resolveCoeffs(epaGroup);
                            const hwfetKwh = epaGroup.hwfet_unadj_kwh_100mi ?? epaGroup.hwfet_adj_kwh_100mi;
                            const eta = (a != null)
                                ? calibrateEfficiency(a, b, c, hwfetKwh)
                                : null;
                            const hwfetSource = epaGroup.hwfet_unadj_kwh_100mi != null ? 'unadj'
                                              : epaGroup.hwfet_adj_kwh_100mi    != null ? 'adj'
                                              : null;
                            // Use effective (inherited) specs so battery_usable_kwh from
                            // a parent vehicle is visible when the child hasn't set it.
                            const effectiveVehicle = {
                                ...vehicle,
                                specs: resolveEffectiveSpecs(vehicle, vehicles),
                            };
                            const useableKwh       = resolveUseableKwh(epaGroup, effectiveVehicle);
                            const useableKwhSource = resolveUseableKwhSource(epaGroup, effectiveVehicle);
                            return (
                                <div
                                    key={mapping.id}
                                    className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 rounded-lg text-xs"
                                    style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}
                                >
                                    <span className="font-medium">{vehicleLabel(vehicle)}</span>
                                    <span style={{ color: 'var(--color-text-muted)' }}>
                                        {epaGroup.display_name
                                            ? <><span className="font-medium" style={{ color: 'var(--color-text-secondary)' }}>{epaGroup.display_name}</span> · <span className="italic">{epaGroup.epa_carline_name}</span></>
                                            : epaGroup.epa_carline_name
                                        }
                                        {' '}· {epaGroup.model_year} · {epaGroup.test_group_id}
                                    </span>
                                    <ConfidenceBadge confidence={confidence} />
                                    {epaGroup.label_combined_mpge && epaGroup.label_combined_mpge < 500 && (
                                        <span style={{ color: 'var(--color-text-secondary)' }}>
                                            EPA rated: {epaGroup.label_combined_mpge} MPGe
                                            {epaGroup.label_method && <> · {epaGroup.label_method}<InfoIcon text={EPA_EXPLAINERS.labelMethod} /></>}
                                        </span>
                                    )}
                                    {eta != null && (
                                        <span style={{ color: 'var(--color-text-muted)' }}>
                                            η<sub>eff</sub>: {(eta * 100).toFixed(1)}%
                                            {hwfetSource === 'unadj' && (
                                                <> · calibrated from HWFET unadj ({epaGroup.hwfet_unadj_kwh_100mi?.toFixed(1)} kWh/100mi)<InfoIcon text={EPA_EXPLAINERS.unadjVsAdj} /></>
                                            )}
                                            {hwfetSource === 'adj' && (
                                                <> · calibrated from HWFET adj ({epaGroup.hwfet_adj_kwh_100mi?.toFixed(1)} kWh/100mi)<InfoIcon text={EPA_EXPLAINERS.unadjVsAdj} /></>
                                            )}
                                            {hwfetSource === null && (
                                                <> · default fallback (no HWFET data)<InfoIcon text={EPA_EXPLAINERS.hwfetCalibration} /></>
                                            )}
                                        </span>
                                    )}
                                    {useableKwh && (
                                        <span style={{ color: 'var(--color-text-muted)' }}>
                                            {Number(useableKwh).toFixed(1)} kWh
                                            {useableKwhSource === 'EPA'   && ' (EPA useable)'}
                                            {useableKwhSource === 'spec'  && ' (useable, from specs)'}
                                            {useableKwhSource === 'gross' && ' (gross — useable not set)'}
                                        </span>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            )}
        </div>
    );
}

import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import Chart from 'chart.js/auto';
import { useTheme } from '../hooks/useTheme';
import { useAppContext } from '../context/AppContext';
import { convSpeed, speedLabel, distanceLabel } from '../utils/unitConversions';
import { vehicleLabel, resolveEffectiveSpecs } from '../utils/specHelpers';
import { PALETTE } from '../utils/specHelpers';
import { resolveChartColors } from '../utils/colorUtils';
import {
    resolveUseableKwh, resolveUseableKwhSource,
    HIGHWAY_BAND_MPH, MPG_E_CONVERSION,
} from '../utils/epaPhysics';
import { buildEpaCurveFromModel, resolveCurveEta, resolvePrimaryCoeffs, correctMeasuredConsumption, STANDARD_TEMP_F, DEFAULT_ACCESSORY_W } from '../utils/epaDerivations';
import { filterRangeRuns } from '../utils/runUtils';
import AxisScaleControls from './AxisScaleControls';
import InfoIcon from './InfoIcon';
import { EPA_EXPLAINERS } from '../utils/epaExplainers';
import ChartInfoBubble from './ChartInfoBubble';
import EpaMethodologyDiagram from './epa/EpaMethodologyDiagram';
import EpaCertificationPaths from './epa/EpaCertificationPaths';
import EpaCycleSpeedChart from './epa/EpaCycleSpeedChart';
import CollapsibleSection from './CollapsibleSection';
import { TWO_CYCLE_KEYS } from '../constants/epa';
import { buildMethodologyModel } from '../utils/epaMethodology';
import { epaRecordFromGroup, NO_RECORD_REASONS } from '../utils/epaRecordFromGroup';
import { methodologyTitle, methodologySubtitle } from '../utils/epaSectionLabels';
import AutoColorToggle from './AutoColorToggle';
import { useRunSelection } from '../hooks/useRunSelection';
import ViewingConditions, { useViewingConditions } from './epa/ViewingConditions';


// ── Highway band plugin ───────────────────────────────────────────────────────

/**
 * Draws the 65–75 mph highway band after Chart.js renders its datasets.
 * Follows the same afterDraw pattern as barGroupPlugin / makeBarPlugin.
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

            const xBand0 = x(bandMph[0]);
            const xBand1 = x(bandMph[1]);
            ctx.fillStyle = bandColor;
            ctx.fillRect(xBand0, area.top, xBand1 - xBand0, area.bottom - area.top);

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
 * Pass an empty array to disable without removing the code.
 *
 * To re-enable: pass [70, 80] (or any mph values) at the call site.
 */
function makeCalloutPlugin(calloutMphs, yAxis, units, isDark) {
    return {
        id: 'epaCallouts',
        afterDatasetsDraw(chart) {
            if (!calloutMphs.length) return;
            const { ctx, chartArea: area, scales, data } = chart;
            if (!area || !scales.x || !scales.y) return;

            data.datasets.forEach((ds) => {
                const curve = ds._curve;
                if (!curve?.length) return;

                const color = ds.borderColor;

                calloutMphs.forEach((targetMph) => {
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
                    ctx.beginPath();
                    ctx.arc(px, py, 4.5, 0, Math.PI * 2);
                    ctx.fillStyle = color;
                    ctx.fill();
                    ctx.strokeStyle = isDark ? 'rgba(15,23,42,0.9)' : 'rgba(255,255,255,0.9)';
                    ctx.lineWidth = 1.5;
                    ctx.stroke();

                    if (pt.rangeMi != null) {
                        const rangeDisplay = units === 'metric'
                            ? `${(pt.rangeMi * 1.60934).toFixed(0)} km`
                            : `${pt.rangeMi.toFixed(0)} mi`;

                        ctx.font = '10px system-ui, sans-serif';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'alphabetic';

                        const textW = ctx.measureText(rangeDisplay).width;
                        const labelY = py - 9;
                        const padX = 3, padY = 2;
                        ctx.fillStyle = isDark ? 'rgba(15,23,42,0.82)' : 'rgba(255,255,255,0.88)';
                        ctx.beginPath();
                        ctx.roundRect(px - textW / 2 - padX, labelY - 10 - padY, textW + padX * 2, 11 + padY * 2, 3);
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
    { key: 'wh_mi',    label: 'Wh/mi'     },
    { key: 'mi_kwh',   label: 'mi/kWh'    },
    { key: 'mpge',     label: 'MPGe'       },
    { key: 'range_mi', label: 'Range (mi)' },
];

function getYValue(point, yAxis) {
    switch (yAxis) {
        case 'kwh100mi': return point.kwh100mi;
        case 'wh_mi':    return point.kwh100mi != null ? point.kwh100mi * 10 : null;
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
        if (yAxis === 'wh_mi')    return 'Wh/km';
        if (yAxis === 'mi_kwh')   return 'km/kWh';
    }
    if (yAxis === 'kwh100mi') return 'kWh/100mi';
    if (yAxis === 'wh_mi')    return 'Wh/mi';
    if (yAxis === 'mi_kwh')   return 'mi/kWh';
    if (yAxis === 'mpge')     return 'MPGe';
    return '';
}

function convertYValue(val, yAxis, units) {
    if (val == null) return null;
    if (units !== 'metric') return val;
    if (yAxis === 'kwh100mi') return val / 1.60934;
    if (yAxis === 'wh_mi')    return val / 1.60934; // Wh/mi → Wh/km
    if (yAxis === 'mi_kwh')   return val * 1.60934;
    if (yAxis === 'range_mi') return val * 1.60934;
    return val;
}

// ── Confidence badge ──────────────────────────────────────────────────────────

const CONFIDENCE_COLORS = {
    verified: 'text-green-700 bg-green-50 border-green-200 dark:text-green-300 dark:bg-green-900/30 dark:border-green-700',
    likely:   'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-900/30 dark:border-amber-700',
    inferred: 'text-muted bg-[var(--color-surface-muted)] border-[var(--color-border)]',
};

function ConfidenceBadge({ confidence }) {
    return (
        <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${CONFIDENCE_COLORS[confidence] || CONFIDENCE_COLORS.inferred}`}>
            {confidence}
        </span>
    );
}


// ── Default color for a mapping ───────────────────────────────────────────────

function defaultMappingColor(vehicle, vehicleIdx, mappingIdx) {
    const base = vehicle.color || PALETTE[vehicleIdx % PALETTE.length];
    return mappingIdx === 0 ? base : base + 'bb';
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * EpaCurvesView — "EPA Curves" chart sub-tab.
 *
 * Layout mirrors ChargingView:
 *   1. Chart Options card  — Y-axis toggles, axis scale controls, collapsible
 *      per-mapping selector with color pickers and metadata
 *   2. Chart card          — canvas
 *   3. Below chart         — legend note, Copy URL, Copy PNG
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
    autoColor = true,
    setChartConfig = null,
}) {
    const { units } = useAppContext();
    const { isDark } = useTheme();
    const canvasRef = useRef(null);
    const chartRef  = useRef(null);

    // ── UI state ──────────────────────────────────────────────────────────────
    const [selectorExpanded, setSelectorExpanded] = useState(false);
    const [urlCopied,        setUrlCopied]        = useState(false);
    const [imageCopied,      setImageCopied]      = useState(false);
    // Altitude, temperature, and accessory load are viewing conditions (like the
    // unit toggle): they scale the plotted curve at plot time for ALL curves.
    // Never persisted; never affect stored coefficients, accessory fields, or
    // the standard-condition η.
    // Viewing conditions — altitude, temperature, accessory load, wind, grade.
    // Shared with the certification-anchored curves (#237) rather than kept
    // here, so the two cannot compute air density differently.
    const conditions = useViewingConditions();
    const {
        densityRatio, densityAdjusted, accessoryAdjusted, accessoryOverrideWNum,
        windAdjusted, windSpeedMphNum, windDirectionDegNum,
        gradeGainFtNum, gradeDistanceMilesNum, gradeAdjusted,
    } = conditions.derived;

    // Overlay real-world range-test points on top of the curve. null = off.
    // 'corrected' scales each point (temp, wind, and elevation gain/loss) to
    // the viewing conditions above, so it's comparable to the curve as
    // currently displayed. 'uncorrected' plots the raw measured value as
    // recorded — not a valid comparison across different test conditions,
    // but useful to see the true recorded data.
    const [overlayMode, setOverlayMode] = useState(null); // null | 'corrected' | 'uncorrected'


    const { yAxis, xMin, xMax, yMin, yMax } = epaConfig;

    // ── Vehicle lists ─────────────────────────────────────────────────────────

    const selectedVehicles = useMemo(() =>
        selectedVehicleIds.map(id => vehicles.find(v => v.id === id)).filter(Boolean),
    [vehicles, selectedVehicleIds]);

    const vehiclesWithEpa    = selectedVehicles.filter(v => v.epa_mappings?.length > 0);
    const vehiclesWithoutEpa = selectedVehicles.filter(v => !v.epa_mappings?.length);

    /**
     * Which curves are drawn (#221).
     *
     * This was a local `hiddenMappings` set — opt-OUT, owned by the component —
     * and every consequence of that was a bug. It started empty in a pop-out, so
     * curves switched off came back. Nothing pruned it when a vehicle left the
     * selection, so re-selecting that vehicle restored curves the reader had
     * hidden, with nothing on screen to say why. It survived neither a reload
     * nor a tab switch. And it was the opposite bookkeeping from the four charts
     * already sharing `useRunSelection`.
     *
     * The hook's contract is `{ key, vehicleId, groupId }` and it never reads a
     * run field, so the substitution is total: the mapping id is both key and
     * group. `groupId` being the key makes CARRY a no-op, which is right — CARRY
     * exists for a run being repinned, and an EPA mapping has no such event.
     *
     * Controlled, so the selection lives in `epaConfig` beside the axis and
     * bounds. That is what carries it into the URL and over the BroadcastChannel
     * to the pop-out, which is where the original bug showed.
     */
    const selectableRows = useMemo(
        () => vehiclesWithEpa.flatMap(v =>
            (v.epa_mappings ?? [])
                // A mapping with no group draws nothing. Selecting it would put
                // a key in the selection that no row can clear, and PRUNE would
                // strip it on the next render — a toggle that appears to fail.
                .filter(m => m.epaGroup)
                .map(m => ({ key: m.id, vehicleId: v.id, groupId: m.id }))),
        [vehiclesWithEpa],
    );

    const setSelectedMappings = useCallback(
        (next) => setEpaConfig(prev => ({ ...prev, selectedMappings: next })),
        [setEpaConfig],
    );
    const {
        selected: selectedMappings,
        toggle: toggleMapping,
        setVehicle: setVehicleMappings,
    } = useRunSelection(selectableRows, {
        value: epaConfig.selectedMappings ?? [],
        onChange: setSelectedMappings,
    });

    // A Set rather than repeated `.includes`: the curve builder tests every
    // mapping on every rebuild.
    const shown = useMemo(() => new Set(selectedMappings), [selectedMappings]);

    // Colours move into epaConfig for the same reason the selection does — a
    // pop-out was losing them. Memoised because `?? {}` allocates, and a fresh
    // object every render invalidates every dependency array holding it.
    const mappingColors = useMemo(() => epaConfig.mappingColors ?? {}, [epaConfig.mappingColors]);
    const setMappingColors = useCallback(
        (updater) => setEpaConfig(prev => ({
            ...prev,
            mappingColors: typeof updater === 'function' ? updater(prev.mappingColors ?? {}) : updater,
        })),
        [setEpaConfig],
    );


    // ── Vehicle color map (Okabe-Ito when autoColor) ──────────────────────────
    // EPA curves are per-vehicle (not per-run), so we resolve colors at the
    // vehicle level.  We treat each vehicle as a "run" with .id and .color so
    // resolveChartColors can do its ΔE work.
    const vehicleColorMap = useMemo(
        () => resolveChartColors(vehiclesWithEpa, {}, autoColor ? 'auto' : 'manual'),
        [vehiclesWithEpa, autoColor]
    );

    // ── Datasets ──────────────────────────────────────────────────────────────
    const { datasets, missingWeightWarnings } = useMemo(() => {
        const result = [];
        const missingWeightWarnings = [];
        vehiclesWithEpa.forEach((vehicle, vi) => {
            const effectiveVehicle = {
                ...vehicle,
                specs: resolveEffectiveSpecs(vehicle, vehicles),
            };
            vehicle.epa_mappings.forEach((mapping, mi) => {
                const { epaGroup, confidence } = mapping;
                if (!epaGroup) return;
                if (!shown.has(mapping.id)) return;

                // An elevation adjustment needs the group's own EPA equivalent test
                // weight (see gradeEnergyKwh100mi) — some imports never captured it.
                // Rather than silently drawing an unadjusted curve as if there were
                // no grade, drop the curve (and its overlay) entirely and flag it.
                if (gradeAdjusted && !resolvePrimaryCoeffs(epaGroup)?.equivTestWeightLbs) {
                    missingWeightWarnings.push({
                        vehicleName: vehicleLabel(vehicle),
                        epaLabel: epaGroup.display_name || epaGroup.epa_carline_name,
                    });
                    return;
                }

                const useableKwh       = resolveUseableKwh(epaGroup, effectiveVehicle);
                const useableKwhSource = resolveUseableKwhSource(epaGroup, effectiveVehicle);
                const curve            = buildEpaCurveFromModel(epaGroup, useableKwh, densityRatio, accessoryOverrideWNum, windSpeedMphNum, windDirectionDegNum, gradeGainFtNum, gradeDistanceMilesNum);
                if (!curve.length) return;

                // Color: user override → vehicleColorMap/vehicle color → palette (with alpha for 2nd+ mapping)
                const baseColor = vehicleColorMap[vehicle.id] || vehicle.color || PALETTE[vi % PALETTE.length];
                const autoBase  = mi === 0 ? baseColor : baseColor + 'bb';
                const color = mappingColors[mapping.id] ?? autoBase;
                const epaLabel = epaGroup.display_name || epaGroup.epa_carline_name;
                const baseLabel = vehiclesWithEpa.length > 1 || mi > 0
                    ? `${vehicleLabel(vehicle)}${vehicle.epa_mappings.length > 1 ? ` (${epaLabel})` : ''}`
                    : vehicleLabel(vehicle);
                // Subtle "adjusted" marker on each curve's legend entry (density or accessory load).
                const label = (densityAdjusted || accessoryAdjusted || windAdjusted || gradeAdjusted) ? `${baseLabel} ▲` : baseLabel;

                result.push({
                    label,
                    data: curve.map(pt => ({
                        x: convSpeed(pt.mph, units),
                        y: convertYValue(getYValue(pt, yAxis), yAxis, units),
                    })).filter(pt => pt.y != null),
                    borderColor:     color,
                    backgroundColor: color + '22',
                    borderWidth:     2,
                    borderDash:      [6, 4],
                    pointRadius:     0,
                    pointHoverRadius: 4,
                    tension:         0.3,
                    _vehicleId:        vehicle.id,
                    _mappingId:        mapping.id,
                    _confidence:       confidence,
                    _epaGroup:         epaGroup,
                    _useableKwh:       useableKwh,
                    _useableKwhSource: useableKwhSource,
                    _curve:            curve,
                });

                // ── Real-world overlay: this vehicle's own range-test runs, plotted as
                // scatter points. 'corrected' scales each point (temp, wind, and
                // elevation gain/loss — see correctMeasuredConsumption) to the same
                // viewing conditions as the curve above; 'uncorrected' plots the raw
                // measured value as recorded.
                if (overlayMode) {
                    const viewConditions = {
                        densityRatio,
                        accessoryOverrideW:     accessoryOverrideWNum,
                        windSpeedMph:           windSpeedMphNum,
                        windDirectionDeg:       windDirectionDegNum,
                        elevationGainFt:        gradeGainFtNum,
                        elevationDistanceMiles: gradeDistanceMilesNum,
                    };
                    const overlayPoints = filterRangeRuns(vehicle.runs)
                        .filter(r => !r._inherited && r.speed_mph != null && r.distance_miles > 0 && r.energy_kwh != null)
                        .map(run => {
                            const measuredKwh100mi = (run.energy_kwh / run.distance_miles) * 100;
                            let kwh100mi = measuredKwh100mi;
                            if (overlayMode === 'corrected') {
                                const runConditions = {
                                    temperatureF:     run.temperature_f,
                                    altitudeFt:       run.altitude_ft,
                                    windSpeedMph:     run.avg_wind_speed_mph,
                                    windDirectionDeg: run.wind_direction_deg,
                                    elevationGainFt:  run.elevation_gain_ft,
                                    distanceMiles:    run.distance_miles,
                                };
                                kwh100mi = correctMeasuredConsumption(epaGroup, run.speed_mph, measuredKwh100mi, runConditions, viewConditions);
                                if (kwh100mi == null) return null;
                            }
                            const miPerKwh = 100 / kwh100mi;
                            const pt = {
                                mph: run.speed_mph,
                                kwh100mi,
                                miPerKwh,
                                mpge:    miPerKwh * MPG_E_CONVERSION,
                                rangeMi: useableKwh > 0 ? useableKwh / (kwh100mi / 100) : null,
                            };
                            return {
                                x: convSpeed(pt.mph, units),
                                y: convertYValue(getYValue(pt, yAxis), yAxis, units),
                            };
                        })
                        .filter(p => p && p.y != null);

                    if (overlayPoints.length) {
                        result.push({
                            type:            'scatter',
                            label:           `${baseLabel} (real-world${overlayMode === 'uncorrected' ? ', uncorrected' : ''})`,
                            data:            overlayPoints,
                            backgroundColor: color,
                            borderColor:     color,
                            pointRadius:     5,
                            pointHoverRadius: 7,
                            pointStyle:      overlayMode === 'uncorrected' ? 'triangle' : 'circle',
                            showLine:        false,
                            _vehicleId:      vehicle.id,
                            _mappingId:      mapping.id,
                            _isOverlay:      true,
                        });
                    }
                }
            });
        });
        return { datasets: result, missingWeightWarnings };
    }, [vehiclesWithEpa, vehicles, yAxis, units, shown, mappingColors, vehicleColorMap, densityRatio, densityAdjusted, accessoryOverrideWNum, accessoryAdjusted, windSpeedMphNum, windDirectionDegNum, windAdjusted, gradeGainFtNum, gradeDistanceMilesNum, gradeAdjusted, overlayMode]);

    // ── Chart build / rebuild ─────────────────────────────────────────────────
    useEffect(() => {
        if (!canvasRef.current) return;
        if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }
        if (!datasets.length) return;

        const tickColor   = isDark ? 'rgb(226,232,240)'       : 'rgb(107,114,128)';
        const gridColor   = isDark ? 'rgba(100,116,139,0.35)' : 'rgba(229,231,235,0.8)';
        const legendColor = isDark ? 'rgb(241,245,249)'       : 'rgb(55,65,81)';

        const refPlugin     = makeReferencePlugin(HIGHWAY_BAND_MPH, units, isDark);
        // Speed callouts disabled — labels overlap with multiple curves.
        // Re-enable by restoring [70, 80] (or any mph values) here.
        const calloutPlugin = makeCalloutPlugin([], yAxis, units, isDark);

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
                        display: datasets.length > 1,
                        labels: {
                            color: legendColor,
                            // Curve datasets get a short line swatch; the real-world
                            // overlay (a scatter dataset) gets a dot/triangle swatch
                            // matching its actual point marker — previously every
                            // dataset used a line swatch regardless of type, so the
                            // overlay's legend entry didn't match its plotted dots.
                            usePointStyle: true,
                            generateLabels(chart) {
                                return chart.data.datasets.map((ds, i) => {
                                    const isPointDataset = ds.type === 'scatter';
                                    return {
                                        text:        ds.label,
                                        fontColor:   legendColor,
                                        pointStyle:  isPointDataset ? (ds.pointStyle || 'circle') : 'line',
                                        fillStyle:   isPointDataset ? ds.backgroundColor : 'transparent',
                                        strokeStyle: ds.borderColor,
                                        lineWidth:   ds.borderWidth ?? 2,
                                        hidden:      !chart.isDatasetVisible(i),
                                        datasetIndex: i,
                                    };
                                });
                            },
                        },
                    },
                    tooltip: {
                        callbacks: {
                            title(items) {
                                const spd = items[0]?.parsed.x;
                                return `${spd?.toFixed(1)} ${speedLabel(units)}`;
                            },
                            label(item) {
                                const ds = item.dataset;
                                if (ds._isOverlay) {
                                    // Overlay points are already corrected/converted at build
                                    // time (see the datasets useMemo) — use the plotted value
                                    // directly rather than re-deriving from a curve.
                                    const decimals = yAxis === 'range_mi' ? 0 : yAxis === 'mi_kwh' ? 2 : 1;
                                    return `${ds.label}: ${item.parsed.y?.toFixed(decimals)} ${yAxisLabel(yAxis, units)}`;
                                }
                                const curve = ds._curve;
                                const speedMph = units === 'metric'
                                    ? item.parsed.x / 1.60934
                                    : item.parsed.x;
                                const pt = curve?.reduce((best, p) =>
                                    Math.abs(p.mph - speedMph) < Math.abs(best.mph - speedMph) ? p : best
                                , curve[0]);
                                if (!pt) return ds.label;

                                let valStr = '';
                                if (yAxis === 'kwh100mi') {
                                    valStr = pt.kwh100mi != null
                                        ? `${(units === 'metric' ? pt.kwh100mi / 1.60934 : pt.kwh100mi).toFixed(1)} ${units === 'metric' ? 'kWh/100km' : 'kWh/100mi'}`
                                        : '—';
                                } else if (yAxis === 'wh_mi') {
                                    const wh = pt.kwh100mi != null ? pt.kwh100mi * 10 : null;
                                    valStr = wh != null
                                        ? `${(units === 'metric' ? wh / 1.60934 : wh).toFixed(1)} ${units === 'metric' ? 'Wh/km' : 'Wh/mi'}`
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
                        mode: 'nearest',
                        intersect: false,
                    },
                },
            },
        });

        return () => { chartRef.current?.destroy(); chartRef.current = null; };
    }, [datasets, yAxis, units, isDark, xMin, xMax, yMin, yMax]);

    // ── Copy PNG ──────────────────────────────────────────────────────────────
    const handleCopyPng = async () => {
        if (!chartRef.current) return;
        const canvas = chartRef.current.canvas;
        const bg  = isDark ? 'rgb(8,12,28)' : '#ffffff';
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
            window.open(tmp.toDataURL('image/png'));
        }
    };

    // ── Copy URL ──────────────────────────────────────────────────────────────
    const handleCopyUrl = () => {
        navigator.clipboard.writeText(window.location.href).then(() => {
            setUrlCopied(true);
            setTimeout(() => setUrlCopied(false), 2000);
        });
    };

    // ── Total visible mapping count (for selector badge) ──────────────────────
    /**
     * The methodology diagram, per visible EPA configuration of the selected
     * vehicles — the same set the chart above plots, so the two never disagree
     * about which configurations are on screen.
     *
     * Entries with no model are KEPT and carry their reason. Most linked groups
     * cannot produce a derivation yet, and dropping them silently would leave a
     * curator with a shorter list than they selected and no idea why — which is
     * the state this section was in when it ran on sample records.
     */
    const methodologyEntries = useMemo(() => {
        const out = [];
        for (const vehicle of vehiclesWithEpa) {
            for (const mapping of vehicle.epa_mappings ?? []) {
                const { epaGroup } = mapping;
                if (!epaGroup) continue;
                if (!shown.has(mapping.id)) continue;

                const vehicleName = vehicleLabel(vehicle);
                const epaLabel = epaGroup.display_name || epaGroup.epa_carline_name || null;
                const { record, reason } =
                    epaRecordFromGroup(epaGroup, { vehicleName, configuration: epaLabel });

                // A record can still fail the model — the adapter checks its
                // inputs are present, not that they resolve to a consumption.
                const model = record ? buildMethodologyModel(record) : null;

                out.push({
                    key: mapping.id,
                    vehicleName,
                    epaLabel,
                    // Always carried, because it is the only identifier that
                    // cannot degrade — see methodologyTitle.
                    testGroupId: epaGroup.test_group_id ?? null,
                    modelYear: epaGroup.model_year ?? null,
                    configCount: (vehicle.epa_mappings ?? []).filter(m => m.epaGroup).length,
                    model,
                    reason: model ? null : (reason ?? 'no-derivation'),

                });
            }
        }
        return out;
    }, [vehiclesWithEpa, shown]);

    const methodologyModels = methodologyEntries.filter(e => e.model);
    const methodologyGaps   = methodologyEntries.filter(e => !e.model);

    const totalMappings = vehiclesWithEpa.reduce((n, v) => n + (v.epa_mappings?.length ?? 0), 0);
    const visibleCount  = selectedMappings.length;

    // ── Empty state ───────────────────────────────────────────────────────────
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

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div>
            {/* ── Chart Options card ────────────────────────────────────────── */}
            {!presentationMode && (
                <div className="card mb-6">
                    {/* Y-axis toggle + Auto Color */}
                    <div className="chart-toggles mb-4">
                        <span className="text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                            Y axis: <InfoIcon text={EPA_EXPLAINERS.steadyStateCurve} position="right" className="ml-1" />
                        </span>
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
                        <div className="flex items-center gap-1.5">
                            <span className="text-sm font-medium flex items-center" style={{ color: 'var(--color-text-secondary)' }}>
                                Overlay Real World Tests
                                <InfoIcon
                                    tooltipClassName="info-icon-tooltip--wide"
                                    position="right"
                                    className="ml-1"
                                >
                                    <p>Plot this vehicle's own range-test points on top of its curve.</p>
                                    <p className="mt-1.5"><strong>Corrected:</strong> scaled by temperature, wind, and elevation gain/loss to match the curve's current viewing conditions above — an apples-to-apples comparison.</p>
                                    <p className="mt-1.5"><strong>Uncorrected:</strong> the raw measured value as recorded, unadjusted — not a valid comparison across different test conditions, but useful to see the true recorded data.</p>
                                </InfoIcon>
                            </span>
                            <button
                                type="button"
                                className={`btn btn-sm ${overlayMode === 'corrected' ? 'btn-primary' : 'btn-secondary'}`}
                                onClick={() => setOverlayMode(m => m === 'corrected' ? null : 'corrected')}
                            >
                                Corrected
                            </button>
                            <button
                                type="button"
                                className={`btn btn-sm ${overlayMode === 'uncorrected' ? 'btn-primary' : 'btn-secondary'}`}
                                onClick={() => setOverlayMode(m => m === 'uncorrected' ? null : 'uncorrected')}
                            >
                                Uncorrected
                            </button>
                        </div>
                        {/* The viewing-condition controls, shared with the
                            certification-anchored curves (#237). The overlay above
                            stays here: it plots a VEHICLE's own range runs, which
                            that view has no way to reach. */}
                    </div>

                    <ViewingConditions conditions={conditions} />


                    {missingWeightWarnings.length > 0 && (
                        <div className="chart-warning-banner">
                            ⚠ Elevation Gain/Loss can't be applied for {missingWeightWarnings.map(w => `${w.vehicleName} (${w.epaLabel})`).join(', ')} — no EPA equivalent test weight on file. That curve is hidden while an elevation adjustment is active.
                        </div>
                    )}

                    {/* Collapsible EPA test selector */}
                    {vehiclesWithEpa.length > 0 && (
                        <div className="mt-4">
                            <div className="run-selector-bar">
                            <button
                                onClick={() => setSelectorExpanded(p => !p)}
                                className="run-selector-header"
                            >
                                <span style={{ display: 'inline-block', transform: selectorExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>&#9660;</span>
                                Select Vehicle Tests to Display
                                <span className="text-sm font-normal text-muted">({visibleCount} of {totalMappings} shown)</span>
                            </button>
                            {setChartConfig && (
                                <div className="run-selector-actions">
                                    <AutoColorToggle autoColor={autoColor} setChartConfig={setChartConfig} />
                                </div>
                            )}
                            </div>

                            {selectorExpanded && (
                                <div className="mt-3">
                                    <div className="runs-list">
                                        {vehiclesWithEpa.map((vehicle, vi) => {
                                            const effectiveVehicle = {
                                                ...vehicle,
                                                specs: resolveEffectiveSpecs(vehicle, vehicles),
                                            };
                                            return (
                                                <div key={vehicle.id} className="vehicle-run-group" style={{ borderColor: 'var(--color-primary)' }}>
                                                    <div className="flex items-center gap-2 mb-2">
                                                        <h4 className="text-sm font-semibold text-secondary">
                                                            {vehicleLabel(vehicle)}
                                                        </h4>
                                                        {/* Bulk helpers, same as the shared run selector: a vehicle
                                                            can carry a dozen EPA configurations, and ticking them
                                                            one at a time is the common complaint. */}
                                                        <button
                                                            type="button"
                                                            onClick={() => setVehicleMappings(vehicle.id, true)}
                                                            className="run-bulk-link"
                                                        >
                                                            all
                                                        </button>
                                                        <span className="text-faint text-xs select-none">/</span>
                                                        <button
                                                            type="button"
                                                            onClick={() => setVehicleMappings(vehicle.id, false)}
                                                            className="run-bulk-link"
                                                        >
                                                            none
                                                        </button>
                                                    </div>
                                                    <div className="run-items">
                                                        {vehicle.epa_mappings.map((mapping, mi) => {
                                                            const { epaGroup, confidence } = mapping;
                                                            if (!epaGroup) return null;
                                                            const isVisible  = shown.has(mapping.id);
                                                            const baseVehicleColor = vehicleColorMap[vehicle.id] || vehicle.color || PALETTE[vi % PALETTE.length];
                                                            const color      = mappingColors[mapping.id] ?? (mi === 0 ? baseVehicleColor : baseVehicleColor + 'bb').replace(/[0-9a-f]{2}$/i, '');
                                                            // Strip any alpha suffix for the color input
                                                            const pickerColor = (mappingColors[mapping.id] ?? baseVehicleColor).slice(0, 7);

                                                            // η from the DC-side curator derivation (proc 77 → 84 → estimated),
                                                            // with provenance + sanity flags.
                                                            const etaResult = resolveCurveEta(epaGroup);
                                                            const eta = etaResult.value;
                                                            const useableKwh       = resolveUseableKwh(epaGroup, effectiveVehicle);
                                                            const useableKwhSource = resolveUseableKwhSource(epaGroup, effectiveVehicle);
                                                            const epaLabel = epaGroup.display_name || epaGroup.epa_carline_name;

                                                            return (
                                                                <div
                                                                    key={mapping.id}
                                                                    className={`flex items-start gap-2 ${!isVisible ? 'opacity-50' : ''}`}
                                                                >
                                                                    {/* Checkbox */}
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={isVisible}
                                                                        onChange={() => toggleMapping(mapping.id)}
                                                                        className="w-4 h-4 mt-0.5 shrink-0"
                                                                    />
                                                                    {/* Color picker */}
                                                                    <input
                                                                        type="color"
                                                                        value={pickerColor}
                                                                        onChange={e => setMappingColors(prev => ({ ...prev, [mapping.id]: e.target.value }))}
                                                                        onClick={e => e.stopPropagation()}
                                                                        className="w-8 h-6 border-0 rounded cursor-pointer shrink-0"
                                                                        title="Change curve color"
                                                                    />
                                                                    {/* Label + metadata */}
                                                                    <div className="run-label min-w-0">
                                                                        <span className="font-medium">{epaLabel}</span>
                                                                        <span className="text-sm text-muted ml-2">{epaGroup.model_year} · {epaGroup.test_group_id}</span>
                                                                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                                                                            <ConfidenceBadge confidence={confidence} />
                                                                            {epaGroup.label_combined_mpge && epaGroup.label_combined_mpge < 500 ? (
                                                                                <span>EPA rated: {epaGroup.label_combined_mpge} MPGe</span>
                                                                            ) : epaGroup.label_hwy_mpge && epaGroup.label_hwy_mpge < 500 ? (
                                                                                <span title="Highway-only (proc 84); no combined MCT test">
                                                                                    EPA hwy: {epaGroup.label_hwy_mpge} MPGe
                                                                                </span>
                                                                            ) : null}
                                                                            {eta != null && (
                                                                                <span>
                                                                                    η<sub>eff</sub>: {!etaResult.certain && '~'}{(eta * 100).toFixed(1)}%
                                                                                    {etaResult.source === 'measured'          && <> · HWFET DC</>}
                                                                                    {etaResult.source === 'measured-fallback' && <> · Hwy DC (proc 84)</>}
                                                                                    {etaResult.source === 'estimated'         && <> · default η</>}
                                                                                    <InfoIcon text={EPA_EXPLAINERS.hwfetCalibration} />
                                                                                    {etaResult.flags?.includes('eta-out-of-band') && (
                                                                                        <span title="Back-solved η outside the 75–92% sanity band — check phase data"> ⚠</span>
                                                                                    )}
                                                                                </span>
                                                                            )}
                                                                            {useableKwh && (
                                                                                <span>
                                                                                    {Number(useableKwh).toFixed(1)} kWh
                                                                                    {useableKwhSource === 'EPA'   && ' (EPA)'}
                                                                                    {useableKwhSource === 'spec'  && ' (spec)'}
                                                                                    {useableKwhSource === 'gross' && ' (gross)'}
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* Vehicles without EPA data */}
                                    {vehiclesWithoutEpa.length > 0 && (
                                        <div className="mt-2 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                                            <span className="font-medium">No EPA data:</span>{' '}
                                            {vehiclesWithoutEpa.map(v => vehicleLabel(v)).join(', ')}
                                            {' '}— link a test group via Edit Vehicle.
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* All selected vehicles lack EPA data */}
                    {vehiclesWithEpa.length === 0 && vehiclesWithoutEpa.length > 0 && (
                        <div className="mt-4 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                            No EPA test group linked for the selected vehicles. Link one via Edit Vehicle.
                        </div>
                    )}
                </div>
            )}

            {/* ── Chart card ────────────────────────────────────────────────── */}
            {datasets.length > 0 ? (
                <div className="card mb-4">
                    <div style={{ height: presentationMode ? 'calc(100vh - 2rem)' : 500 }}>
                        <canvas ref={canvasRef} />
                    </div>

                    {!presentationMode && (
                        <>
                            {/* Legend note */}
                            <div className="mt-3 flex flex-wrap gap-4 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                                <span>
                                    <span className="font-medium">Shaded band</span> — 65–75 mph typical highway
                                </span>
                            </div>

                            {/* Action buttons */}
                            <div className="mt-3 flex items-center gap-3 flex-wrap">
                                <button
                                    onClick={handleCopyUrl}
                                    className={`chart-copy-btn ${urlCopied ? 'chart-copy-btn-active' : ''}`}
                                    title="Copy link to this chart view"
                                >
                                    {urlCopied ? '✓ Copied!' : '🔗 Copy URL'}
                                </button>
                                <button
                                    onClick={handleCopyPng}
                                    disabled={!datasets.length}
                                    className={`chart-copy-btn ${imageCopied ? 'chart-copy-btn-active' : ''}`}
                                    title="Copy chart as PNG"
                                >
                                    {imageCopied ? '✓ Copied to clipboard!' : '📋 Copy Chart as PNG'}
                                </button>
                            </div>
                        </>
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

            {/* ── Axis scale controls (card provided by AxisScaleControls) ──── */}
            {!presentationMode && datasets.length > 0 && (
                <AxisScaleControls
                    xMin={xMin} xMax={xMax} yMin={yMin} yMax={yMax}
                    xAxisLabel={`Speed (${speedLabel(units)})`}
                    yAxisLabel={yAxisLabel(yAxis, units)}
                    onChange={(key, value) => setEpaConfig(p => ({ ...p, [key]: value }))}
                />
            )}

            {/* Where the label range comes from (#206, connected in #222).
                One section per EPA configuration of the selected vehicles, built
                from the stored cert records rather than the two transcribed
                samples this was reviewed against.

                Sections start collapsed: this is reference material a reader
                opens on purpose, and expanded by default it buried the chart
                above it. */}
            {!presentationMode && (
                <div className="card mt-6">
                    <h3 className="text-lg font-semibold mb-1">EPA range methodology</h3>
                    <p className="text-sm text-faint mb-2">
                        How each selected vehicle&apos;s label range was produced, from its own
                        certification record. Where a Fuel Economy Guide row is linked, this uses
                        EPA&apos;s adjustment factor for that configuration and shows the flat
                        0.7 shortcut beside it.
                    </p>

                    <CollapsibleSection title="How the EPA range is produced">
                        <EpaCertificationPaths
                            models={methodologyModels.map(e => e.model)}
                        />

                        {/* What the factor stands in for. Lives with the paths
                            table because it explains the ADJUSTMENT, not any one
                            vehicle — so it is stated once rather than per car. */}
                        <div className="epa-methodology-cycles">
                            <h4 className="text-sm font-semibold text-secondary mb-1">
                                What the adjustment factor replaces
                            </h4>
                            <p className="text-xs text-muted mb-3">
                                A two-cycle test drives the top two. The other three are the
                                conditions EPA would otherwise measure directly — the factor is a
                                blanket 30% reduction standing in for all of them, the same number
                                for every vehicle.
                            </p>
                            <EpaCycleSpeedChart ranCycleKeys={TWO_CYCLE_KEYS} />
                        </div>
                    </CollapsibleSection>

                    {methodologyModels.map((entry) => (
                        <CollapsibleSection
                            key={entry.key}
                            title={methodologyTitle(entry)}
                            subtitle={methodologySubtitle(entry)}
                        >
                            {/* A derivation built on inferred phase types is a
                                weaker claim than one built on curated types, and
                                the reader is entitled to know which they have.
                                Fixable, too: the types are editable in Tests & Data. */}
                            <EpaMethodologyDiagram model={entry.model} />
                        </CollapsibleSection>
                    ))}

                    {/* Named, not hidden. A configuration that cannot be derived
                        is a gap in the data with a specific cause, and most of
                        these are one curator action away from resolving. */}
                    {methodologyGaps.length > 0 && (
                        <div className="mt-3">
                            <p className="text-xs font-medium text-secondary mb-1">
                                No derivation for {methodologyGaps.length} configuration
                                {methodologyGaps.length === 1 ? '' : 's'}:
                            </p>
                            <ul className="text-xs text-muted list-disc pl-5">
                                {methodologyGaps.map(({ key, vehicleName, epaLabel, reason }) => (
                                    <li key={key}>
                                        <span className="text-secondary">
                                            {vehicleName}{epaLabel ? ` · ${epaLabel}` : ''}
                                        </span>
                                        {' — '}
                                        {NO_RECORD_REASONS[reason]
                                            ?? 'Its figures do not resolve into a complete label derivation.'}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {methodologyEntries.length === 0 && (
                        <p className="text-sm text-muted">
                            None of the selected vehicles has an EPA test group linked. Link one from
                            Tests &amp; Data to see how its label range was produced.
                        </p>
                    )}
                </div>
            )}

            {/* Always last on the page — the convention every other chart view
                already follows. */}
            {!presentationMode && <ChartInfoBubble chartKey="epacurves" />}
        </div>
    );
}

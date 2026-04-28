import { useState, useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';
import ZoomPlugin from 'chartjs-plugin-zoom';
Chart.defaults.font.size = 13;
Chart.register(ZoomPlugin);
import { dataService } from '../services/DataService';
import RunSelector from './RunSelector';
import RangeChartView from './RangeChartView';
import AxisScaleControls from './AxisScaleControls';
import { runTooltipLines } from '../utils/tooltipHelpers';
import { vehicleLabel } from '../utils/specHelpers';
import { useAppContext } from '../context/AppContext';
import { useTheme } from '../hooks/useTheme';
import { convDistance, convTemp, distanceLabel, tempLabel } from '../utils/unitConversions';

export default function ChargingView({ vehicles, selectedVehicleIds, chartConfig, setChartConfig, onUpdateRunColor, chartMode, presentationMode = false }) {
    const { units } = useAppContext();
    const { isDark } = useTheme();
    const chartRef = useRef(null);
    const chartInstance = useRef(null);
    const [runDataCache, setRunDataCache] = useState({});
    const [loadingData, setLoadingData] = useState(false);
    const [copied, setCopied] = useState(false);
    const [chartImage, setChartImage] = useState(null);
    const [imageCopied, setImageCopied] = useState(false);

    // Preserve the user's pill order
    const selectedVehicles = selectedVehicleIds.map(id => vehicles.find(v => v.id === id)).filter(Boolean);

    const handleColorChange = (vehicleId, runId, color) => {
        onUpdateRunColor(vehicleId, runId, color);
    };

    // Ref so the auto-select effect can read chartMode without it being a dep
    // (avoids changing the deps array size, which React disallows mid-session).
    const chartModeRef = useRef(chartMode);
    chartModeRef.current = chartMode;

    // Tracks which vehicle IDs have already had auto-selection applied IN THE
    // CURRENT MODE. Cleared on mode switch so entering Range (or Charging) always
    // triggers a fresh auto-select — the old mode's runs may be entirely invalid here.
    // - Empty on mount/mode-change → all vehicles treated as new.
    // - Vehicle removed → evicted → re-adding it auto-selects again.
    // - Vehicle initialized + user deselects within same mode → no forced re-add.
    const autoSelectedRef = useRef(new Set());
    const lastModeRef     = useRef(chartMode);

    // Auto-select runs when vehicle selection, run list, or chart mode changes.
    // chartMode is in deps so the effect fires on Charging ↔ Range tab switch.
    // Safe against infinite loops: state update only fires when newRuns !== currentRuns.
    useEffect(() => {
        const mode        = chartModeRef.current;
        const currentRuns = chartConfig.selectedRuns;
        const currentVehicleIdSet = new Set(selectedVehicleIds.map(String));

        // Mode switch → wipe initialized set so each vehicle gets a fresh auto-select.
        // (Runs valid in charging mode may not exist in range mode and vice-versa.)
        if (mode !== lastModeRef.current) {
            autoSelectedRef.current.clear();
            lastModeRef.current = mode;
        }

        // Evict any vehicle that left the selection so re-adding it auto-selects fresh.
        autoSelectedRef.current.forEach(id => {
            if (!currentVehicleIdSet.has(id)) autoSelectedRef.current.delete(id);
        });

        if (mode === 'charging') {
            const chargingRuns = selectedVehicles.flatMap(v => (v.runs || []).filter(r => r.has_charging !== false));
            const validRunIds  = new Set(chargingRuns.map(r => String(r.id)));
            const kept         = currentRuns.filter(id => validRunIds.has(String(id)));
            const added        = [];

            selectedVehicles.forEach(vehicle => {
                const vid           = String(vehicle.id);
                const vChargingRuns = (vehicle.runs || []).filter(r => r.has_charging !== false);
                if (!vChargingRuns.length) { autoSelectedRef.current.add(vid); return; }

                const hasRun = kept.some(id => vChargingRuns.some(r => String(r.id) === String(id)));
                if (hasRun) {
                    // Valid run already selected (e.g. URL-restored) — mark done, keep it.
                    autoSelectedRef.current.add(vid);
                } else if (!autoSelectedRef.current.has(vid)) {
                    // First time we see this vehicle with nothing selected — auto-pick default.
                    const defaultRun = vChargingRuns.find(r => r.isDefault);
                    const pick = defaultRun || [...vChargingRuns].sort((a, b) => new Date(b.date) - new Date(a.date))[0];
                    if (pick) added.push(pick.id);
                    autoSelectedRef.current.add(vid); // mark done (attempt made)
                }
                // else: vehicle already initialized, user deliberately has nothing selected — leave it.
            });

            const newRuns = [...kept, ...added];
            if (newRuns.join(',') !== currentRuns.join(',')) {
                setChartConfig(prev => ({ ...prev, selectedRuns: newRuns }));
            }

        } else if (mode === 'range') {
            const allRangeIds = selectedVehicles.flatMap(v =>
                (v.runs || []).filter(r => r.has_range).map(r => r.id)
            );
            const validSet = new Set(allRangeIds.map(String));
            const kept     = currentRuns.filter(id => validSet.has(String(id)));
            const keptSet  = new Set(kept.map(String));
            const added    = [];

            selectedVehicles.forEach(vehicle => {
                const vid        = String(vehicle.id);
                const vRangeRuns = (vehicle.runs || []).filter(r => r.has_range);
                if (!vRangeRuns.length) { autoSelectedRef.current.add(vid); return; }

                const hasAny = vRangeRuns.some(r => keptSet.has(String(r.id)));
                if (hasAny) {
                    autoSelectedRef.current.add(vid);
                } else if (!autoSelectedRef.current.has(vid)) {
                    vRangeRuns.forEach(r => added.push(r.id));
                    autoSelectedRef.current.add(vid);
                }
            });

            const newRuns = [...kept, ...added];
            if (newRuns.join(',') !== currentRuns.join(',')) {
                setChartConfig(prev => ({ ...prev, selectedRuns: newRuns }));
            }
        }
    }, [selectedVehicleIds, chartConfig.selectedRuns, chartMode]);

    // Lazy-load data_points for newly selected runs
    useEffect(() => {
        const fetchMissingData = async () => {
            const missingIds = chartConfig.selectedRuns.filter(id => !(id in runDataCache));
            if (missingIds.length === 0) return;
            setLoadingData(true);
            const updates = {};
            // Build a flat lookup of all runs across all selected vehicles
            const allRuns = vehicles.flatMap(v => v.runs || []);
            for (const runId of missingIds) {
                try {
                    let runData;
                    if (dataService.useSupabase) {
                        const run = allRuns.find(r => String(r.id) === String(runId));
                        if (run?._inherited) {
                            runData = await dataService.getRunData(run._realRunId, run._scalingFactor ?? 1);
                        } else {
                            runData = await dataService.getRunData(runId);
                        }

                        // If this charging run has no range values at all, derive them
                        // on the fly from the vehicle's range test via SoC interpolation.
                        if (runData.length > 0 && !runData.some(p => p.range != null)) {
                            const parentVehicle = vehicles.find(v =>
                                v.runs?.some(r => String(r.id) === String(runId))
                            );
                            const rangeRun =
                                parentVehicle?.runs?.find(r => !r._inherited && r.has_range && r.isDefault) ??
                                parentVehicle?.runs?.find(r => !r._inherited && r.has_range);
                            if (rangeRun) {
                                try {
                                    const lookup = await dataService.buildRangePerSocLookup(rangeRun.id);
                                    if (lookup) {
                                        runData = runData.map(p => ({
                                            ...p,
                                            range: p.soc != null ? lookup(p.soc) : null,
                                        }));
                                    }
                                } catch (_) { /* non-fatal — chart will just lack range axis */ }
                            }
                        }
                    } else {
                        // localStorage: find run.data inline
                        for (const v of vehicles) {
                            const run = v.runs?.find(r => r.id === runId);
                            if (run) { runData = run.data || []; break; }
                        }
                    }
                    updates[runId] = runData ?? [];
                } catch (err) {
                    console.error(`Failed to load data for run ${runId}:`, err);
                    updates[runId] = [];
                }
            }
            setRunDataCache(prev => ({ ...prev, ...updates }));
            setLoadingData(false);
        };
        fetchMissingData();
    }, [chartConfig.selectedRuns]);

    const dl = distanceLabel(units);
    const axisOptions = [
        { value: 'soc',           label: 'State of Charge (%)' },
        { value: 'deltaSoc',      label: 'SoC Added (%)' },
        { value: 'chargeRate',    label: 'Charge Rate (kW)' },
        { value: 'time',          label: 'Time (min)' },
        { value: 'range',         label: `Range - Tested (${dl})` },
        { value: 'deltaRange',    label: `Range Added - Tested (${dl})` },
        { value: 'rangeEpa',      label: `Range - EPA (${dl})` },
        { value: 'deltaRangeEpa', label: `Range Added - EPA (${dl})` },
        { value: 'temperature',   label: `Temperature (${tempLabel(units)})` },
        { value: 'cRate',         label: 'C-Rate  (~kW ÷ battery)' },
        { value: 'rangeRate',     label: `Range Rate (${dl}/min)` },
        { value: 'frame',         label: 'Frame' },
    ];

    const chartPresets = [
        { emoji: '⚡', name: 'Rate vs SoC',            x: 'soc',  y: 'chargeRate', y2: null       },
        { emoji: '🛣️', name: 'Range vs Time',           x: 'time', y: 'range',      y2: 'rangeEpa' },
        { emoji: '⏱️', name: 'Rate vs Time',            x: 'time', y: 'chargeRate', y2: null       },
        { emoji: '📊', name: 'Rate + SoC vs Time',      x: 'time', y: 'chargeRate', y2: 'deltaSoc'   },
        { emoji: '📊', name: 'Rate + Range vs Time',    x: 'time', y: 'chargeRate', y2: 'deltaRange' },
    ];

    // Convert a stored (imperial) field value to the current unit system for display.
    const DISTANCE_AXES = new Set(['range', 'deltaRange', 'rangeEpa', 'deltaRangeEpa', 'rangeRate']);
    const convertAxisValue = (value, fieldKey) => {
        if (value == null) return null;
        if (DISTANCE_AXES.has(fieldKey)) return convDistance(value, units);
        if (fieldKey === 'temperature')  return convTemp(value, units);
        return value;
    };

    /**
     * Get the value for a field key, computing virtual fields (cRate, rangeRate)
     * on-the-fly from stored chargeRate + vehicle metadata.
     * vehicleBattery = kWh, vehicleRange = rated miles
     */
    const getFieldValue = (point, fieldKey, vehicleBattery, vehicleRange) => {
        if (fieldKey === 'cRate') {
            return (point.chargeRate != null && vehicleBattery)
                ? Math.round((point.chargeRate / vehicleBattery) * 1000) / 1000
                : null;
        }
        if (fieldKey === 'rangeRate') {
            // miles per minute: (rated_range / battery_kWh) × charge_kW ÷ 60
            return (point.chargeRate != null && vehicleRange && vehicleBattery)
                ? Math.round((vehicleRange / vehicleBattery) * point.chargeRate / 60 * 1000) / 1000
                : null;
        }
        return point[fieldKey] ?? null;
    };

    // ── Race mode helpers ────────────────────────────────────────────────────

    const raceActive = chartConfig.raceMode && chartConfig.xAxis === 'time';
    const raceThreshold = chartConfig.raceThreshold ?? 10;

    /**
     * Returns null if the run can participate in race mode, or a short reason
     * string if it must be excluded.  Only meaningful when raceActive is true.
     */
    const getRaceExclusionReason = (runId) => {
        if (!raceActive) return null;
        const data = runDataCache[runId];
        if (!data) return null; // not yet loaded — don't flag prematurely
        if (!data.some(p => p.time != null)) return 'no time data';
        const anchor = data.findIndex(p => p.soc != null && p.soc >= raceThreshold);
        if (anchor === -1) return `never reaches ${raceThreshold}% SoC`;
        return null;
    };

    /**
     * Returns the time offset (minutes) subtracted from a participating run,
     * or null if the run is excluded / data not yet loaded.
     * An offset of 0 means the data started right at the threshold — nothing trimmed.
     */
    const getRaceOffset = (runId) => {
        if (!raceActive) return null;
        const data = runDataCache[runId];
        if (!data) return null;
        const anchor = data.findIndex(p => p.soc != null && p.soc >= raceThreshold);
        if (anchor === -1) return null;
        const t = data[anchor].time;
        return t ?? null;
    };

    /**
     * Augment each data point with cumulative delta fields computed from the
     * first valid reading in the array.  Must be called AFTER any race-mode
     * slice so that deltas start at 0 at the session / race anchor.
     * vehicleRange (EPA rated miles) is used to compute on-the-fly EPA range fields.
     */
    const augmentDeltas = (data, vehicleRange) => {
        const baseRange    = data.find(p => p.range != null)?.range ?? null;
        const baseSoc      = data.find(p => p.soc   != null)?.soc   ?? null;
        const baseEpaRange = baseSoc != null && vehicleRange
            ? Math.round((baseSoc / 100) * vehicleRange * 10) / 10
            : null;
        return data.map(p => {
            const epaRange = p.soc != null && vehicleRange
                ? Math.round((p.soc / 100) * vehicleRange * 10) / 10
                : null;
            return {
                ...p,
                deltaRange: baseRange != null && p.range != null
                    ? Math.round((p.range - baseRange) * 10) / 10
                    : null,
                deltaSoc: baseSoc != null && p.soc != null
                    ? Math.round((p.soc - baseSoc) * 10) / 10
                    : null,
                rangeEpa: epaRange,
                deltaRangeEpa: baseEpaRange != null && epaRange != null
                    ? Math.round((epaRange - baseEpaRange) * 10) / 10
                    : null,
            };
        });
    };

    // ── Chart rendering ───────────────────────────────────────────────────────

    useEffect(() => {
        if (!chartRef.current) return;
        setChartImage(null); // clear stale preview whenever chart redraws

        const ctx = chartRef.current.getContext('2d');

        if (chartInstance.current) {
            chartInstance.current.destroy();
        }

        const allSelectedRuns = [];
        selectedVehicles.forEach(vehicle => {
            if (vehicle.runs) {
                vehicle.runs.forEach(run => {
                    if (chartConfig.selectedRuns.includes(run.id)) {
                        allSelectedRuns.push({
                            ...run,
                            vehicleName: vehicleLabel(vehicle),
                            vehicleBattery: vehicle.battery ?? null,
                            vehicleRange: vehicle.range ?? null,
                        });
                    }
                });
            }
        });

        // Count active runs per vehicle to decide whether to include run name in label
        const runsPerVehicle = {};
        allSelectedRuns.forEach(r => {
            runsPerVehicle[r.vehicleName] = (runsPerVehicle[r.vehicleName] || 0) + 1;
        });
        const runLabel = (run) => runsPerVehicle[run.vehicleName] > 1
            ? `${run.vehicleName} - ${run.name}`
            : run.vehicleName;

        const datasets = allSelectedRuns.flatMap((run) => {
            const rawData = runDataCache[run.id] ?? run.data ?? [];
            const { vehicleBattery, vehicleRange } = run;
            const color = run.color || '#3b82f6';

            // 1. Apply race-mode trim (slice from anchor; exclude if ineligible)
            let workingData = rawData;
            let timeOffset  = 0;
            if (raceActive) {
                const anchor = rawData.findIndex(p => p.soc != null && p.soc >= raceThreshold);
                if (anchor === -1) return [];
                const anchorTime = rawData[anchor].time;
                if (anchorTime == null) return [];
                timeOffset   = anchorTime;
                workingData  = rawData.slice(anchor);
            }

            // 2. Augment with cumulative delta fields (start at 0 from first point)
            workingData = augmentDeltas(workingData, vehicleRange);

            // 3. X value mapper
            const getX = raceActive
                ? (d) => (d.time != null ? Math.round((d.time - timeOffset) * 10) / 10 : null)
                : (d) => convertAxisValue(getFieldValue(d, chartConfig.xAxis, vehicleBattery, vehicleRange), chartConfig.xAxis);

            // 4. Y1 dataset
            const y1Points = workingData
                .map(d => ({ x: getX(d), y: convertAxisValue(getFieldValue(d, chartConfig.yAxis, vehicleBattery, vehicleRange), chartConfig.yAxis) }))
                .filter(p => p.x != null && p.y != null);
            if (y1Points.length === 0) return [];

            const showPts = chartConfig.showPoints || false;

            const result = [{
                label:            runLabel(run),
                data:             y1Points,
                backgroundColor:  color,
                borderColor:      color,
                pointRadius:      showPts ? 3 : 0,
                pointHoverRadius: showPts ? 5 : 0,
                showLine:         chartConfig.showLine ?? true,
                tension:          0.1,
                yAxisID:          'y',
                runMeta:          run,
            }];

            // 5. Y2 dataset (hidden from legend; dashed line + triangle points)
            if (chartConfig.y2Axis) {
                const y2Points = workingData
                    .map(d => ({ x: getX(d), y: convertAxisValue(getFieldValue(d, chartConfig.y2Axis, vehicleBattery, vehicleRange), chartConfig.y2Axis) }))
                    .filter(p => p.x != null && p.y != null);
                if (y2Points.length > 0) {
                    result.push({
                        label:            `${runLabel(run)} (right)`,
                        data:             y2Points,
                        backgroundColor:  color,
                        borderColor:      color,
                        pointRadius:      showPts ? 4 : 0,
                        pointHoverRadius: showPts ? 6 : 0,
                        pointStyle:       'triangle',
                        showLine:         chartConfig.showLine ?? true,
                        borderDash:       chartConfig.showLine ? [6, 3] : undefined,
                        tension:          0.1,
                        yAxisID:          'y2',
                    });
                }
            }

            return result;
        });

        // Axis labels
        const xLabel  = raceActive
            ? `Time from ${raceThreshold}% SoC (min)`
            : (axisOptions.find(a => a.value === chartConfig.xAxis)?.label  || chartConfig.xAxis);
        const yLabel  = axisOptions.find(a => a.value === chartConfig.yAxis)?.label  || chartConfig.yAxis;
        const y2Label = chartConfig.y2Axis
            ? (axisOptions.find(a => a.value === chartConfig.y2Axis)?.label || chartConfig.y2Axis)
            : '';

        const stripUnits = s => s.replace(/\s*\(.*?\)$/, '');
        const chartTitle = raceActive
            ? `${stripUnits(yLabel)} from ${raceThreshold}% SoC`
            : `${stripUnits(yLabel)} vs ${stripUnits(xLabel)}`;

        const tickColor   = isDark ? 'rgb(148,163,184)' : 'rgb(107,114,128)';
        const gridColor   = isDark ? 'rgba(51,65,85,0.6)' : 'rgba(229,231,235,0.8)';
        const legendColor = isDark ? 'rgb(148,163,184)' : 'rgb(55,65,81)';

        chartInstance.current = new Chart(ctx, {
            type: 'scatter',
            data: { datasets },
            options: {
                animation: false,
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: { display: true, text: chartTitle, font: { size: 14, weight: 'bold' }, color: legendColor },
                    legend: {
                        position: 'top',
                        labels: {
                            color: legendColor,
                            // Y2 datasets share color+style with their Y1 pair — hide duplicates
                            filter: (item, data) => data.datasets[item.datasetIndex].yAxisID !== 'y2',
                        },
                    },
                    tooltip: {
                        displayColors: false,
                        callbacks: {
                            title(ctx) {
                                const run = ctx[0]?.dataset?.runMeta;
                                if (!run) return undefined;
                                return runLabel(run);
                            },
                            label(ctx) {
                                const xl = axisOptions.find(a => a.value === chartConfig.xAxis)?.label ?? 'X';
                                const yl = axisOptions.find(a => a.value === chartConfig.yAxis)?.label ?? 'Y';
                                return [`${xl}: ${ctx.parsed.x}`, `${yl}: ${ctx.parsed.y}`];
                            },
                            afterLabel(ctx) {
                                return runTooltipLines(ctx.dataset?.runMeta, [], units);
                            },
                        },
                    },
                    zoom: {
                        zoom: {
                            drag: { enabled: true, backgroundColor: 'rgba(59,130,246,0.08)', borderColor: '#3b82f6', borderWidth: 1 },
                            mode: 'xy',
                        },
                    },
                },
                scales: {
                    x: {
                        title: { display: true, text: xLabel, color: legendColor },
                        ticks: { color: tickColor },
                        grid:  { color: gridColor },
                        ...(chartConfig.xMin != null ? { min: chartConfig.xMin } : {}),
                        ...(chartConfig.xMax != null ? { max: chartConfig.xMax } : {}),
                    },
                    y: {
                        title: { display: true, text: yLabel, color: legendColor },
                        ticks: { color: tickColor },
                        grid:  { color: gridColor },
                        ...(chartConfig.yMin != null ? { min: chartConfig.yMin } : {}),
                        ...(chartConfig.yMax != null ? { max: chartConfig.yMax } : {}),
                    },
                    ...(chartConfig.y2Axis ? {
                        y2: {
                            type:     'linear',
                            display:  true,
                            position: 'right',
                            title:    { display: true, text: y2Label, color: legendColor },
                            ticks:    { color: tickColor },
                            grid:     { drawOnChartArea: false, color: gridColor },
                            ...(chartConfig.y2Min != null ? { min: chartConfig.y2Min } : {}),
                            ...(chartConfig.y2Max != null ? { max: chartConfig.y2Max } : {}),
                        },
                    } : {}),
                }
            }
        });

        return () => {
            if (chartInstance.current) {
                chartInstance.current.destroy();
            }
        };
    }, [chartConfig, selectedVehicles, runDataCache, units, isDark]);

    // ── PNG export ───────────────────────────────────────────────────────────
    const handleExportImage = async () => {
        if (!chartInstance.current) return;
        const src = chartInstance.current.canvas;
        const offscreen = document.createElement('canvas');
        offscreen.width = src.width;
        offscreen.height = src.height;
        const ctx2 = offscreen.getContext('2d');
        ctx2.fillStyle = isDark ? 'rgb(30,41,59)' : '#ffffff';
        ctx2.fillRect(0, 0, offscreen.width, offscreen.height);
        ctx2.drawImage(src, 0, 0);
        const dataUrl = offscreen.toDataURL('image/png');
        setChartImage(dataUrl);
        // Try writing directly to clipboard (Chrome/Edge; Safari requires user gesture)
        try {
            const blob = await (await fetch(dataUrl)).blob();
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            setImageCopied(true);
            setTimeout(() => setImageCopied(false), 2500);
        } catch {
            // Clipboard image write not supported — image is shown inline for manual copy
        }
    };

    // ── Render ────────────────────────────────────────────────────────────────

    if (chartMode === 'range') {
        return (
            <RangeChartView
                selectedVehicles={selectedVehicles}
                selectedRuns={chartConfig.selectedRuns}
                setChartConfig={setChartConfig}
                onUpdateRunColor={onUpdateRunColor}
                presentationMode={presentationMode}
            />
        );
    }

    return (
        <div>
            {/* ── Top card: presets, axis selectors, run selector — hidden in presentation mode ── */}
            {!presentationMode && <div className="card mb-6">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="section-title">Chart Options — Charging Performance</h3>
                </div>

                {/* Presets */}
                <div className="flex flex-wrap gap-2 mb-6">
                    {chartPresets.map(preset => (
                        <button
                            key={preset.name}
                            onClick={() => setChartConfig({ ...chartConfig, xAxis: preset.x, yAxis: preset.y, y2Axis: preset.y2 ?? null })}
                            className="btn text-sm"
                            style={{ backgroundColor: 'var(--color-primary-light)', color: 'var(--color-primary-text)' }}
                        >
                            {preset.emoji} {preset.name}
                        </button>
                    ))}
                </div>

                {/* Axis selectors */}
                <div className="axis-selectors">
                    <div>
                        <label className="block font-medium mb-2">X-Axis:</label>
                        <select
                            value={chartConfig.xAxis}
                            onChange={(e) => setChartConfig({ ...chartConfig, xAxis: e.target.value })}
                            className="border p-2 rounded w-full"
                        >
                            {axisOptions.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block font-medium mb-2">Left Axis (Y):</label>
                        <select
                            value={chartConfig.yAxis}
                            onChange={(e) => setChartConfig({ ...chartConfig, yAxis: e.target.value })}
                            className="border p-2 rounded w-full"
                        >
                            {axisOptions.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block font-medium mb-2">Right Axis (Y2):</label>
                        <select
                            value={chartConfig.y2Axis ?? ''}
                            onChange={(e) => setChartConfig({ ...chartConfig, y2Axis: e.target.value || null })}
                            className="border p-2 rounded w-full"
                        >
                            <option value="">— None —</option>
                            {axisOptions.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* ── Line / points toggles ── */}
                <div className="chart-toggles">
                    <label className="toggle-label">
                        <input
                            type="checkbox"
                            checked={chartConfig.showLine ?? true}
                            onChange={e => {
                                // Must keep at least one of line/points enabled
                                if (!e.target.checked && !chartConfig.showPoints) return;
                                setChartConfig({ ...chartConfig, showLine: e.target.checked });
                            }}
                            className="w-4 h-4"
                        />
                        <span className="text-sm font-medium">Connect points with lines</span>
                    </label>
                    <label className="toggle-label">
                        <input
                            type="checkbox"
                            checked={chartConfig.showPoints || false}
                            onChange={e => {
                                // Must keep at least one of line/points enabled
                                if (!e.target.checked && !chartConfig.showLine) return;
                                setChartConfig({ ...chartConfig, showPoints: e.target.checked });
                            }}
                            className="w-4 h-4"
                        />
                        <span className="text-sm font-medium">Show points</span>
                    </label>
                </div>

                {/* ── Collapsible run selector ── */}
                <RunSelector
                    vehicles={selectedVehicles}
                    selectedRunIds={chartConfig.selectedRuns}
                    onToggleRun={runId => setChartConfig(prev => ({
                        ...prev,
                        selectedRuns: prev.selectedRuns.includes(runId)
                            ? prev.selectedRuns.filter(id => id !== runId)
                            : [...prev.selectedRuns, runId],
                    }))}
                    onUpdateRunColor={handleColorChange}
                    runFilter={r => r.has_charging !== false}
                    emptyMessage="No charging test records"
                    renderRunMeta={run => {
                        const exclusionReason = getRaceExclusionReason(run.id);
                        const offset = getRaceOffset(run.id);
                        const noTrim = offset !== null && offset === 0;
                        return (
                            <>
                                {run.isDefault && (
                                    <span className="badge-default ml-2"
                                        style={{ backgroundColor: 'var(--color-primary-light)', color: 'var(--color-primary-text)' }}>
                                        Default
                                    </span>
                                )}
                                {exclusionReason && (
                                    <span className="badge-status bg-amber-50 text-amber-700 border-amber-200" title={`Hidden in race mode: ${exclusionReason}`}>
                                        ⚠ {exclusionReason}
                                    </span>
                                )}
                                {!exclusionReason && offset !== null && (
                                    noTrim ? (
                                        <span className="badge-status bg-red-50 text-red-700 border-red-200" title="Data starts at or above the threshold — no time was trimmed">
                                            no offset
                                        </span>
                                    ) : (
                                        <span className="badge-status bg-gray-100 text-gray-500 border-gray-200" title={`${offset} min of pre-threshold data trimmed`}>
                                            −{offset} min offset
                                        </span>
                                    )
                                )}
                            </>
                        );
                    }}
                />
            </div>}

            {/* ── Chart canvas ── */}
            <div className="card mb-4">
                {loadingData && (
                    <div className="text-center py-4 text-gray-500 text-sm">Loading run data...</div>
                )}
                <div style={{ height: presentationMode ? 'calc(100vh - 2rem)' : '500px' }}>
                    <canvas ref={chartRef}></canvas>
                </div>

                {/* Export / share buttons */}
                <div className="mt-3 flex items-center gap-3 flex-wrap">
                    <button
                        onClick={() => chartInstance.current?.resetZoom()}
                        className="chart-copy-btn"
                        title="Reset zoom to full view"
                    >
                        🔍 Reset Zoom
                    </button>
                    <button
                        onClick={() => {
                            navigator.clipboard.writeText(window.location.href).then(() => {
                                setCopied(true);
                                setTimeout(() => setCopied(false), 2000);
                            });
                        }}
                        className={`chart-copy-btn ${copied ? 'chart-copy-btn-active' : ''}`}
                        title="Copy link to this chart view"
                    >
                        {copied ? '✓ Copied!' : '🔗 Copy URL'}
                    </button>
                    <button
                        onClick={handleExportImage}
                        className={`chart-copy-btn ${imageCopied ? 'chart-copy-btn-active' : ''}`}
                        title="Export chart as PNG"
                    >
                        {imageCopied ? '✓ Copied to clipboard!' : '📋 Copy Chart as PNG'}
                    </button>
                    {chartImage && (
                        <button
                            onClick={() => setChartImage(null)}
                            className="chart-copy-btn"
                        >
                            ✕ Dismiss preview
                        </button>
                    )}
                </div>

                <p className="text-xs text-gray-400 mt-1">Drag to box-zoom · Reset Zoom to restore</p>

                {/* Inline image preview — right-click/long-press to copy or save */}
                {chartImage && (
                    <div className="mt-3">
                        <p className="text-xs text-gray-400 mb-1.5">Right-click or long-press to copy / save</p>
                        <img
                            src={chartImage}
                            alt="Chart export"
                            className="w-full rounded border border-gray-200"
                        />
                    </div>
                )}
            </div>

            {/* ── Controls below chart: scale inputs + line toggle + race mode — hidden in presentation mode ── */}
            {!presentationMode && <div className="card mb-6">

                <AxisScaleControls
                    xMin={chartConfig.xMin}  xMax={chartConfig.xMax}
                    yMin={chartConfig.yMin}  yMax={chartConfig.yMax}
                    y2Min={chartConfig.y2Min} y2Max={chartConfig.y2Max}
                    onChange={(key, val) => setChartConfig(prev => ({ ...prev, [key]: val }))}
                    showY2={!!chartConfig.y2Axis}
                />

                {/* ── Race mode panel — only visible when X = Time ── */}
                {chartConfig.xAxis === 'time' && (
                    <div className={`race-mode-panel ${chartConfig.raceMode ? 'bg-indigo-50 border-indigo-200' : 'bg-gray-50 border-gray-200'}`}>
                        <div className="flex flex-wrap items-center gap-3">
                            <label className="toggle-label">
                                <input
                                    type="checkbox"
                                    checked={chartConfig.raceMode || false}
                                    onChange={e => setChartConfig({ ...chartConfig, raceMode: e.target.checked })}
                                    className="w-4 h-4 accent-indigo-600"
                                />
                                <span className="font-medium text-sm">Race mode</span>
                            </label>

                            {chartConfig.raceMode && (
                                <>
                                    <span className="text-sm text-gray-600">Start at:</span>
                                    {/* Quick-select chips */}
                                    <div className="flex gap-1 flex-wrap">
                                        {[5, 10, 15, 20].map(pct => (
                                            <button
                                                key={pct}
                                                onClick={() => setChartConfig({ ...chartConfig, raceThreshold: pct })}
                                                className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                                                    chartConfig.raceThreshold === pct
                                                        ? 'bg-indigo-600 text-white border-indigo-600'
                                                        : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-400'
                                                }`}
                                            >
                                                {pct}%
                                            </button>
                                        ))}
                                        {/* Freeform input */}
                                        <div className="flex items-center gap-1">
                                            <input
                                                type="number"
                                                value={chartConfig.raceThreshold ?? 10}
                                                onChange={e => {
                                                    const v = parseInt(e.target.value, 10);
                                                    if (!isNaN(v) && v >= 0 && v <= 100) {
                                                        setChartConfig({ ...chartConfig, raceThreshold: v });
                                                    }
                                                }}
                                                className="w-14 px-1 py-0.5 border rounded text-xs text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                                min="0" max="100"
                                            />
                                            <span className="text-xs text-gray-500">%</span>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                        {chartConfig.raceMode && (
                            <p className="mt-1.5 text-xs text-indigo-700">
                                Each run is shifted so its {raceThreshold}% SoC point lands at t = 0.
                                Runs without time data or that never reach {raceThreshold}% SoC are hidden.
                            </p>
                        )}
                    </div>
                )}
            </div>}

            {!presentationMode && chartConfig.selectedRuns.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                    <p className="text-lg">Select runs to display on the chart</p>
                </div>
            )}
        </div>
    );
}

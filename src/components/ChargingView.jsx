import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
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
import { buildSeriesLabels } from '../utils/seriesLabel';
import VerboseLabelToggle from './VerboseLabelToggle';
import CorrectionControl from './CorrectionControl';
import { minimumCommonSoc, alignmentExclusion, alignmentOffset, alignSeries, overExtrapolated, clampSoc } from '../utils/socAlignment';
import { sessionFor } from '../utils/testSessions';
import { correctionFactor } from '../utils/conditionCorrection';
import AutoColorToggle from './AutoColorToggle';
import { useAppContext } from '../context/AppContext';
import { useTheme } from '../hooks/useTheme';
import { useRunSelection } from '../hooks/useRunSelection';
import { convDistance, convTemp, distanceLabel, tempLabel } from '../utils/unitConversions';
import { filterChargingRuns, filterRangeRuns, isChargingRun, isRangeRun } from '../utils/runUtils';
import { rangePartnersOfCharging, setChargingPartner } from '../utils/pairings';
import { resolveRangeSource, epaRangeOption, isEpaPartnerId, EPA_PARTNER_ID } from '../utils/rangeSource';
import { copyChartAsPng, chartToPngDataUrl } from '../utils/chartUtils';
import LoadingSpinner from './LoadingSpinner';
import { useStickyChartColors } from '../hooks/useStickyChartColors';
import ChartInfoBubble from './ChartInfoBubble';

// A charging line is told apart by its vehicle and its test. One atom, since a
// series here is a single run rather than a pairing of two.
const RUN_ATOMS = [{ key: 'test', of: s => s.run?.name }];

export default function ChargingView({ vehicles, selectedVehicleIds, chartConfig, setChartConfig, chartMode, pairings = {}, setPairings = () => {}, presentationMode = false }) {
    const { units, testSessions } = useAppContext();
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

    // Chart-side colour edits are a SESSION OVERRIDE, never a database write.
    // The durable colour is edited in Tests & Data; changing it while reading a
    // chart would edit stored data for every visitor, and a stored value could
    // not honour the reset rules the override follows.
    const handleColorChange = (_vehicleId, runId, color) => setColorOverride(runId, color);

    // ── Which runs are plotted ────────────────────────────────────────────────
    //
    // Selection behaviour is the shared hook (hooks/useRunSelection.js), the same
    // one Charge Compare and Road Trip use. This view had its own copy — prune,
    // bootstrap-once and mode-reset written again by hand — which is the
    // duplication #176 exists to end.
    //
    // CONTROLLED, unlike the other two: this selection is URL-synced through
    // `chartConfig.selectedRuns` in App, so App stays the owner and the hook only
    // decides what the next value should be.
    const selectionRows = useMemo(
        () => selectedVehicles.flatMap(v =>
            (chartMode === 'range' ? filterRangeRuns(v.runs) : filterChargingRuns(v.runs))
                .map(run => ({ key: run.id, vehicleId: v.id, groupId: run.id, run }))
        ),
        [selectedVehicles, chartMode]
    );

    // Charging arrives with ONE curve per vehicle — its default test, else its
    // most recent. A dozen overlapping curves is not a chart, and the per-vehicle
    // "all" link is there for when you want the rest.
    //
    // Range arrives with all of them: those are bars, not curves, and a vehicle's
    // own tests are usually the comparison being made.
    const bootstrapRuns = useCallback((vehicleId, vehicleRows) => {
        if (chartMode === 'range') return vehicleRows.map(r => r.key);
        const pick = vehicleRows.find(r => r.run.isDefault)
            ?? [...vehicleRows].sort((a, b) => new Date(b.run.date) - new Date(a.run.date))[0];
        return pick ? [pick.key] : [];
    }, [chartMode]);

    // Charging and Range are different populations, not the same rows filtered:
    // a charging run has no counterpart in range mode. `resetKey` is what tells
    // the hook to treat every vehicle as new on the switch, which is the job the
    // hand-rolled `autoSelectedRef.current.clear()` used to do.
    const { selected: selectedRuns, toggle: toggleRun } = useRunSelection(selectionRows, {
        value:    chartConfig.selectedRuns,
        onChange: next => setChartConfig(prev => ({ ...prev, selectedRuns: next })),
        shouldBootstrap: bootstrapRuns,
        resetKey: chartMode,
    });

    // Resolve display colors for all selected runs.
    // In 'manual' mode only default-blue runs get nudged; in 'auto' mode all
    // runs get Okabe-Ito assignment with hue-family bias toward their stored color.
    // Sticky in auto mode: toggling a run adds or removes ONE colour instead of
    // re-solving the whole set and shuffling every series (hooks/useStickyChartColors).
    const colorableRuns = useMemo(
        () => selectedVehicles.flatMap(v =>
            (v.runs || []).filter(r => selectedRuns.includes(r.id))
        ),
        [selectedVehicles, selectedRuns]
    );
    const { colorMap, setColorOverride } = useStickyChartColors(colorableRuns, {
        autoColor: chartConfig.autoColor,
        resetKey: selectedVehicleIds.join(','),
    });

    // A pairing change invalidates cached range values: the derived range is
    // baked into the cached points, so without this the axis would keep showing
    // the previous partner's numbers until the run was reselected.
    const prevPairingsRef = useRef(pairings);
    useEffect(() => {
        const prev = prevPairingsRef.current;
        prevPairingsRef.current = pairings;
        if (prev === pairings) return;
        // Values are charging-run ids, which are exactly this cache's keys.
        const affected = new Set(
            [...Object.values(prev || {}).flat(), ...Object.values(pairings || {}).flat()].map(String)
        );
        if (!affected.size) return;
        setRunDataCache(cache => {
            const next = {};
            let evicted = false;
            for (const [id, data] of Object.entries(cache)) {
                if (affected.has(String(id))) { evicted = true; continue; }
                next[id] = data;
            }
            return evicted ? next : cache;
        });
    }, [pairings]);

    // Lazy-load data_points for newly selected runs.
    //
    // Keyed on what is MISSING, not on the selection: a pairing change evicts
    // cached runs (their derived range is stale), and keying on the selection
    // alone meant nothing refetched them — the series vanished until some
    // unrelated toggle changed the selection and happened to trigger this.
    const missingRunIds = selectedRuns.filter(id => !(id in runDataCache));
    useEffect(() => {
        const fetchMissingData = async () => {
            const missingIds = selectedRuns.filter(id => !(id in runDataCache));
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
                            runData = await dataService.getRunData(run._realRunId, run._efficiencyFactor ?? 1, run._capacityFactor ?? 1);
                        } else {
                            runData = await dataService.getRunData(runId);
                        }

                        // Range axis, resolved on the same ranking as every other
                        // chart (utils/rangeSource.js):
                        //
                        //   pairing → default range test → recorded range column
                        //
                        // A range test now outranks the recorded column outright,
                        // not just when one was explicitly paired. The recorded
                        // values are themselves mostly estimates — usually the car's
                        // guess-o-meter — so they carry no more authority than a
                        // figure derived from a measured range test, and treating
                        // them as more authoritative was the anomaly.
                        if (runData.length > 0) {
                            const parentVehicle = vehicles.find(v =>
                                v.runs?.some(r => String(r.id) === String(runId))
                            );
                            const pairedRangeIds = rangePartnersOfCharging(pairings, runId);
                            const own = (parentVehicle?.runs || []).filter(r => !r._inherited && isRangeRun(r));
                            const pairedRange = pairedRangeIds.length
                                ? (isEpaPartnerId(pairedRangeIds[0])
                                    ? EPA_PARTNER_ID
                                    : own.find(r => String(r.id) === pairedRangeIds[0]) ?? null)
                                : null;

                            // Deliberately UNCORRECTED here. This runs once per
                            // run, when its data points are fetched, so a
                            // correction baked in now would never respond to the
                            // dropdown and toggling a run would reuse the cache.
                            // Correction is a single multiplier, so it is applied
                            // at render time instead — see rangeFactorFor.
                            const src = resolveRangeSource(run ?? { id: runId }, {
                                vehicle: parentVehicle,
                                explicitPairing: pairedRange,
                            });

                            // 'recorded' and 'none' mean no range test won — leave
                            // the run's own column alone.
                            if (src.miPerSoc != null) {
                                let lookup = null;
                                // A range test WITH its own SoC/range time series gives
                                // the real, non-linear shape; prefer it. Most range
                                // tests are scalar (distance + SoC bounds), so the
                                // linear miPerSoc model is the usual path.
                                if (src.sourceRun?.id && !isEpaPartnerId(src.sourceRun.id)) {
                                    try {
                                        lookup = await dataService.buildRangePerSocLookup(src.sourceRun.id);
                                    } catch (_) { /* fall through to linear */ }
                                }
                                const rangeAt = lookup
                                    ? (soc) => lookup(soc)
                                    : (soc) => Math.round(soc * src.miPerSoc * 10) / 10;
                                runData = runData.map(p => ({
                                    ...p,
                                    range: p.soc != null ? rangeAt(p.soc) : null,
                                }));
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
    }, [missingRunIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // The correction factor for a run's RANGE axis, recomputed on every render so
    // the dropdown takes effect immediately. Cheap and synchronous: the pairing
    // resolution it repeats is plain object lookups.
    //
    // Applied as a multiplier rather than by re-deriving the points, which also
    // makes it reach the buildRangePerSocLookup path — that returns a range test's
    // own measured curve and never passes through miPerSoc, so a correction
    // applied there would have been silently skipped.
    const rangeFactorFor = (runId) => {
        const mode = chartConfig.correctionMode ?? 'none';
        if (mode === 'none') return 1;
        const parentVehicle = vehicles.find(v => v.runs?.some(r => String(r.id) === String(runId)));
        if (!parentVehicle) return 1;
        const own = (parentVehicle.runs || []).filter(r => !r._inherited && isRangeRun(r));
        const pairedIds = rangePartnersOfCharging(pairings, runId);
        const pairedRange = pairedIds.length
            ? (isEpaPartnerId(pairedIds[0]) ? EPA_PARTNER_ID : own.find(r => String(r.id) === pairedIds[0]) ?? null)
            : null;
        const run = (parentVehicle.runs || []).find(r => String(r.id) === String(runId));
        // Resolve first to learn WHICH range test supplied the miles, then price
        // that test's own conditions — the charging run's conditions are
        // irrelevant, it did not measure any distance.
        const src = resolveRangeSource(run ?? { id: runId }, {
            vehicle: parentVehicle,
            explicitPairing: pairedRange,
        });
        const sourceRun = src.sourceRun;
        if (!sourceRun) return 1;
        const session = sessionFor(testSessions, sourceRun);
        return correctionFactor({
            speedMph:     sourceRun.speed_mph,
            speedBasis:   sourceRun.speed_basis,
            altitudeFt:   sourceRun.altitude_ft   ?? session?.altitude_ft,
            temperatureF: sourceRun.temperature_f ?? session?.temperature_f,
        }, { mode }).factor;
    };

    // Range-derived axes only. EPA axes are a published spec, not a measurement,
    // so correcting them would be inventing a figure nobody measured.
    const CORRECTABLE_AXES = new Set(['range', 'deltaRange']);

    /** Scale a value only when the axis is a measured range figure. */
    // Rounded to one decimal, matching the precision the uncorrected path always
    // produced (Math.round(soc * miPerSoc * 10) / 10). Multiplying by the factor
    // otherwise turns a clean 202.4 into 202.71828…, which the axis and tooltip
    // both then display in full — precision the measurement never had.
    const scaleRange = (value, axis, k) =>
        (k !== 1 && value != null && CORRECTABLE_AXES.has(axis))
            ? Math.round(value * k * 10) / 10
            : value;

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

    // Alignment is ON by default on the time axis, and only means anything
    // there. Unaligned, every run starts at zero however much charge it began
    // with, so the chart compares nothing — that is a misleading default rather
    // than merely a different one. `alignRaw` is the escape hatch for someone
    // who genuinely wants logger time.
    const isTimeAxis  = chartConfig.xAxis === 'time';
    const raceActive  = isTimeAxis && !chartConfig.alignRaw;

    // The lowest SoC every selected run actually reaches. A fixed default —
    // 10% for a long time here — silently drops every run that started above
    // it; this drops none, because by construction they all reach it.
    const commonSoc = useMemo(() => {
        const series = (selectedRuns || [])
            .map(id => runDataCache[id])
            .filter(Boolean);
        return minimumCommonSoc(series);
    }, [selectedRuns, runDataCache]);

    // An explicit choice wins; otherwise follow the data as the selection changes.
    const raceThreshold = chartConfig.raceThreshold ?? commonSoc ?? 10;

    // Runs drawn partly outside their own data, and by how much. Under the
    // limit this is a defensible short projection; past it, it is a guess
    // wearing a measurement's clothes and the chart says so.
    const stretchedRuns = useMemo(() => {
        if (!raceActive) return [];
        const out = [];
        for (const vehicle of selectedVehicles) {
            for (const run of vehicle.runs || []) {
                if (!selectedRuns.includes(run.id)) continue;
                const aligned = alignSeries(runDataCache[run.id], raceThreshold);
                if (overExtrapolated(aligned)) out.push({ name: run.name, gap: Math.round(aligned.gap) });
            }
        }
        return out;
    }, [raceActive, raceThreshold, selectedVehicles, selectedRuns, runDataCache]);

    const trimmedRuns = useMemo(() => {
        if (!raceActive) return [];
        const out = [];
        for (const vehicle of selectedVehicles) {
            for (const run of vehicle.runs || []) {
                if (!selectedRuns.includes(run.id)) continue;
                const aligned = alignSeries(runDataCache[run.id], raceThreshold);
                if (aligned?.rampTrimmed > 0) out.push({ name: run.name, n: aligned.rampTrimmed });
            }
        }
        return out;
    }, [raceActive, raceThreshold, selectedVehicles, selectedRuns, runDataCache]);

    const excludedRuns = useMemo(() => {
        if (!raceActive) return [];
        const out = [];
        for (const vehicle of selectedVehicles) {
            for (const run of vehicle.runs || []) {
                if (!selectedRuns.includes(run.id)) continue;
                const reason = alignmentExclusion(runDataCache[run.id], raceThreshold);
                if (reason) out.push({ name: run.name, reason });
            }
        }
        return out;
    }, [raceActive, raceThreshold, selectedVehicles, selectedRuns, runDataCache]);

    /**
     * Returns null if the run can participate in race mode, or a short reason
     * string if it must be excluded.  Only meaningful when raceActive is true.
     */
    const getRaceExclusionReason = (runId) => {
        if (!raceActive) return null;
        return alignmentExclusion(runDataCache[runId], raceThreshold);
    };

    /**
     * Returns the time offset (minutes) subtracted from a participating run,
     * or null if the run is excluded / data not yet loaded.
     * An offset of 0 means the data started right at the threshold — nothing trimmed.
     */
    const getRaceOffset = (runId) => {
        if (!raceActive) return null;
        return alignmentOffset(runDataCache[runId], raceThreshold);
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
                    if (selectedRuns.includes(run.id)) {
                        allSelectedRuns.push({
                            ...run,
                            vehicle,
                            vehicleName: vehicleLabel(vehicle),
                            vehicleBattery: vehicle.battery ?? null,
                            vehicleRange: vehicle.range ?? null,
                        });
                    }
                });
            }
        });

        // Name each line by what tells it apart from the others plotted. This is
        // the surface with the least context of any chart here — the legend is
        // the only thing identifying a curve — so no atoms are declared supplied.
        const seriesLabels = buildSeriesLabels(
            allSelectedRuns.map(r => ({ key: r.id, vehicle: r.vehicle, run: r })),
            { atoms: RUN_ATOMS },
        );
        const runLabel = (run) => {
            const l = seriesLabels.get(run.id);
            if (!l) return run.vehicleName;
            return chartConfig.verboseLabels ? l.full : l.short;
        };

        const datasets = allSelectedRuns.flatMap((run) => {
            const rawData = runDataCache[run.id] ?? run.data ?? [];
            const { vehicleBattery, vehicleRange } = run;
            // One multiplier for this run's range axes, so the dropdown takes
            // effect without refetching. Declared before getX and the point
            // mapping that read it.
            const rangeK = rangeFactorFor(run.id);
            const color = colorMap[run.id] || run.color || '#3b82f6';

            // 1. Apply race-mode trim (slice from anchor; exclude if ineligible)
            let workingData = rawData;
            let timeOffset  = 0;
            if (raceActive) {
                // Interpolates the threshold crossing rather than snapping to
                // the next sample, so every curve is at the same SoC at t = 0
                // even when a run is coarsely sampled — see alignSeries.
                const aligned = alignSeries(rawData, raceThreshold);
                if (!aligned) return [];
                timeOffset  = aligned.offset;
                workingData = aligned.points;
            }

            // 2. Augment with cumulative delta fields (start at 0 from first point)
            workingData = augmentDeltas(workingData, vehicleRange);

            // 3. X value mapper
            const getX = raceActive
                ? (d) => (d.time != null ? Math.round((d.time - timeOffset) * 10) / 10 : null)
                : (d) => convertAxisValue(scaleRange(getFieldValue(d, chartConfig.xAxis, vehicleBattery, vehicleRange), chartConfig.xAxis, rangeK), chartConfig.xAxis);

            // 4. Y1 dataset
            const y1Points = workingData
                .map(d => ({ x: getX(d), y: convertAxisValue(scaleRange(getFieldValue(d, chartConfig.yAxis, vehicleBattery, vehicleRange), chartConfig.yAxis, rangeK), chartConfig.yAxis) }))
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
                    .map(d => ({ x: getX(d), y: convertAxisValue(scaleRange(getFieldValue(d, chartConfig.y2Axis, vehicleBattery, vehicleRange), chartConfig.y2Axis, rangeK), chartConfig.y2Axis) }))
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

        const tickColor   = isDark ? 'rgb(226,232,240)' : 'rgb(107,114,128)';
        const gridColor   = isDark ? 'rgba(100,116,139,0.4)' : 'rgba(229,231,235,0.8)';
        const legendColor = isDark ? 'rgb(241,245,249)' : 'rgb(55,65,81)';

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
    }, [chartConfig, selectedVehicles, runDataCache, units, isDark, colorMap]);

    // ── PNG export ───────────────────────────────────────────────────────────
    const handleExportImage = async () => {
        if (!chartInstance.current) return;
        const bgColor = isDark ? 'rgb(8,12,28)' : '#ffffff';
        try {
            const dataUrl = await copyChartAsPng(chartInstance.current, bgColor);
            setChartImage(dataUrl);
            setImageCopied(true);
            setTimeout(() => setImageCopied(false), 2500);
        } catch {
            // Clipboard API not supported — render inline for manual save
            setChartImage(chartToPngDataUrl(chartInstance.current));
        }
    };

    // ── Render ────────────────────────────────────────────────────────────────

    if (chartMode === 'range') {
        return (
            <RangeChartView
                selectedVehicles={selectedVehicles}
                selectedRuns={selectedRuns}
                toggleRun={toggleRun}
                setChartConfig={setChartConfig}
                presentationMode={presentationMode}
                autoColor={chartConfig.autoColor ?? false}
                verboseLabels={chartConfig.verboseLabels ?? false}
                correctionMode={chartConfig.correctionMode ?? 'none'}
            />
        );
    }

    return (
        <div>
            {/* ── Top card: presets, axis selectors, run selector — hidden in presentation mode ── */}
            {!presentationMode && <div className="card mb-6">
                {loadingData && <LoadingSpinner message="Loading run data…" />}
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
                        <label className="axis-label">X-Axis:</label>
                        <select
                            value={chartConfig.xAxis}
                            onChange={(e) => setChartConfig({ ...chartConfig, xAxis: e.target.value })}
                            className="axis-select"
                        >
                            {axisOptions.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="axis-label">Left Axis (Y):</label>
                        <select
                            value={chartConfig.yAxis}
                            onChange={(e) => setChartConfig({ ...chartConfig, yAxis: e.target.value })}
                            className="axis-select"
                        >
                            {axisOptions.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="axis-label">Right Axis (Y2):</label>
                        <select
                            value={chartConfig.y2Axis ?? ''}
                            onChange={(e) => setChartConfig({ ...chartConfig, y2Axis: e.target.value || null })}
                            className="axis-select"
                        >
                            <option value="">— None —</option>
                            {axisOptions.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* Alignment is a property of the time axis, so it belongs with
                    the axis selectors rather than in a panel below the chart
                    that had to be found and switched on. It sits under them and
                    indented: it modifies X, it is not a fourth axis. */}
                {isTimeAxis && (
                    <div className="axis-align-row">
                        <label className="text-sm font-medium text-secondary" htmlFor="align-soc">
                            Align start at:
                        </label>
                        <span className="flex items-center gap-1.5">
                            <input
                                id="align-soc"
                                type="number"
                                min="0" max="100"
                                value={chartConfig.raceThreshold ?? (commonSoc ?? '')}
                                placeholder={commonSoc != null ? String(commonSoc) : '10'}
                                onChange={e => setChartConfig({
                                    ...chartConfig,
                                    raceThreshold: e.target.value === '' ? null : clampSoc(e.target.value, commonSoc ?? 10),
                                })}
                                disabled={chartConfig.alignRaw}
                                className="soc-input disabled:opacity-50"
                            />
                            <span className="text-sm text-secondary">% SoC</span>
                        </span>
                        {commonSoc != null && chartConfig.raceThreshold == null && (
                            <span className="text-xs text-faint" title="The lowest SoC every selected run actually reaches — no run is dropped at this value.">
                                lowest common
                            </span>
                        )}
                        <label className="toggle-label">
                            <input
                                type="checkbox"
                                checked={!!chartConfig.alignRaw}
                                onChange={e => setChartConfig({ ...chartConfig, alignRaw: e.target.checked })}
                                className="w-4 h-4"
                            />
                            <span className="text-sm text-secondary" title="Show each run's own elapsed time from the start of the test. Runs will start at zero regardless of the SoC they began at, so the curves are not comparable.">
                                Raw test time (not comparable)
                            </span>
                        </label>
                    </div>
                )}

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
                    headerActions={<>
                        <CorrectionControl mode={chartConfig.correctionMode ?? 'none'} setChartConfig={setChartConfig} />
                        <AutoColorToggle autoColor={chartConfig.autoColor ?? false} setChartConfig={setChartConfig} />
                        <VerboseLabelToggle verbose={chartConfig.verboseLabels ?? false} setChartConfig={setChartConfig} />
                    </>}
                    vehicles={selectedVehicles}
                    selectedRunIds={selectedRuns}
                    onToggleRun={toggleRun}
                    onUpdateRunColor={handleColorChange}
                    runFilter={isChargingRun}
                    colorMap={colorMap}
                    emptyMessage="No charging test records"
                    pairMode
                    singlePartner
                    pairings={pairings}
                    primaryLabel="Charging:"
                    partnerLabel="Range:"
                    partnerRunsFor={vehicle => {
                        const epa = epaRangeOption(vehicle);
                        return epa ? [...filterRangeRuns(vehicle.runs), epa] : filterRangeRuns(vehicle.runs);
                    }}
                    partnerIdFor={run => rangePartnersOfCharging(pairings, run.id)[0] ?? null}
                    resolvePartner={(chargingRun, vehicle) =>
                        resolveRangeSource(chargingRun, { vehicle })}
                    onSetPartner={(chargingId, _old, newRangeId) =>
                        setPairings(prev => setChargingPartner(prev, chargingId, newRangeId))}
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
                                        <span className="badge-status bg-[var(--color-surface-sunken)] text-muted border-[var(--color-border)]" title={`${offset} min of pre-threshold data trimmed`}>
                                            −{offset} min offset
                                        </span>
                                    )
                                )}
                            </>
                        );
                    }}
                />
            </div>}

            {/* Runs the alignment could not include, named on the chart itself.
                The selector carries a badge, but that only helps someone who
                opens the selector — and a screenshot shows neither. A chart
                silently missing a car is the failure worth designing against. */}
            {raceActive && (excludedRuns.length > 0 || stretchedRuns.length > 0) && (
                <div className="roadtrip-warning mb-3">
                    {excludedRuns.map(({ name, reason }) => (
                        <p key={name}>⚠ {name}: not aligned — {reason}</p>
                    ))}
                    {stretchedRuns.map(({ name, gap }) => (
                        <p key={name}>
                            ⚠ {name}: estimated {gap}% of SoC below its own data to reach {raceThreshold}%
                        </p>
                    ))}
                    {excludedRuns.length > 0 && (
                        <p className="text-xs mt-1">
                            Lower “Align start at” to include them, or switch to raw test time.
                        </p>
                    )}
                    {stretchedRuns.length > 0 && (
                        <p className="text-xs mt-1">
                            Raise “Align start at” to stay inside the measured data.
                        </p>
                    )}
                </div>
            )}

            {/* Points held back from the plot, said plainly. A chart quietly
                missing its first samples is the same failure as one quietly
                missing a car. */}
            {raceActive && trimmedRuns.length > 0 && (
                <p className="text-xs text-faint mb-2"
                   title="A session opens with the charger and the BMS negotiating power upward, below what the car can take. Those samples describe the plug rather than the car, and they only appear in runs whose logging started at plug-in — so comparing with them in place penalises exactly those runs.">
                    Opening charge ramp excluded from{' '}
                    {trimmedRuns.map(t => `${t.name} (${t.n} point${t.n === 1 ? '' : 's'})`).join(', ')}
                    {' '}· switch to raw test time to see every sample
                </p>
            )}

            {/* ── Chart canvas ── */}
            <div className="card mb-4">
                {loadingData && (
                    <div className="text-center py-4 text-secondary text-sm">Loading run data...</div>
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

                <p className="text-xs text-faint mt-1">Drag to box-zoom · Reset Zoom to restore</p>

                {/* Inline image preview — right-click/long-press to copy or save */}
                {chartImage && (
                    <div className="mt-3">
                        <p className="text-xs text-faint mb-1.5">Right-click or long-press to copy / save</p>
                        <img
                            src={chartImage}
                            alt="Chart export"
                            className="w-full rounded border border-[var(--color-border)]"
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
                    card={false}
                />

                {/* What the alignment did, stated on the chart's own controls.
                    Previously this only appeared once race mode was switched
                    on; now that it is the default, saying nothing would leave a
                    shifted axis unexplained. */}
                {isTimeAxis && (
                    <p className={`mt-2 text-xs ${raceActive ? 'text-indigo-700' : 'text-amber-700'}`}>
                        {raceActive
                            ? `Each run is shifted so its ${raceThreshold}% SoC point lands at t = 0`
                              + (chartConfig.raceThreshold == null && commonSoc != null
                                  ? ' — the lowest SoC every selected run reaches.'
                                  : '.')
                            : 'Raw logger time: each run starts at zero whatever SoC it began at, so the curves are not directly comparable.'}
                    </p>
                )}
            </div>}

            {!presentationMode && selectedRuns.length === 0 && (
                <div className="text-center py-12 text-secondary">
                    <p className="text-lg">Select runs to display on the chart</p>
                </div>
            )}

            {!presentationMode && <ChartInfoBubble chartKey="charging" />}
        </div>
    );
}

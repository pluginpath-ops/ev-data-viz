/**
 * The starting state of every chart's settings, in one place.
 *
 * App owns the live copies (one set for the whole site, shared by every chart
 * tab). A featured comparison needs the same defaults somewhere that is not a
 * `useState` initializer: Home draws each of a comparison's charts from its own
 * saved settings laid over these, and opening a chart applies them over a clean
 * slate so the previous chart's tweaks do not leak into it (#448).
 *
 * Each function returns a FRESH object, since the configs hold arrays and maps
 * that a caller must be free to replace without touching the defaults.
 */
import { VEHICLE_PALETTE } from './colorUtils';
import { NO_VEHICLE_BASES } from './vehicleBase';
import { DEFAULT_CORRECTION_TARGET, DEFAULT_READER_MODE } from './correctionSettings';
import { DEFAULT_ASSUMPTIONS } from './vehicleTable';
import { DEFAULT_RANGE_CHART_TYPE, DEFAULT_EFFICIENCY_UNIT, DEFAULT_COMPARE_ORIENTATION } from './chartUrlState';

export function defaultChartConfig() {
    return {
        xAxis: 'soc',
        yAxis: 'chargeRate',
        y2Axis: null,
        selectedRuns: [],
        // Time-axis alignment is on by default (#195): unaligned, every run
        // starts at zero whatever SoC it began at, which compares nothing.
        // alignRaw is the opt-out.
        alignRaw: false,
        // null means "follow the data" — the lowest SoC every selected run
        // actually reaches. A fixed 10 looked like a default and behaved like a
        // decision, drawing a run that began at 25% from t=0 alongside runs that
        // began at 10%.
        raceThreshold: null,
        // Every chart's axis limits, keyed by chart and holding only the charts
        // someone has set (utils/axisLimits.js). Here, not in each view, so the
        // link, the pop-out and a Home panel carry them (#478).
        axisLimits: {},
        showLine:   true,
        showPoints: false,
        // Where series colors come from: each vehicle's curated color by
        // default, or a SERIES_PALETTES id to assign from that set instead.
        seriesPalette: VEHICLE_PALETTE,
        // Whether hand-set colors are in force over that base. Choosing a
        // palette parks them; selecting Hand-set brings them back.
        handSet: false,
        // { [vehicleId]: hex } — a color asked of one car for this session
        // (utils/vehicleBase.js). Lives here so the pop-out window gets it with
        // the rest of the chart's state.
        vehicleBases: NO_VEHICLE_BASES,
        // The vehicle table's assumptions (utils/vehicleTable.js): the charge
        // window, the stop distance, electricity prices. Here so the table and
        // the spec chart, which plots its calculated columns, share one set.
        assumptions:    { ...DEFAULT_ASSUMPTIONS },
        // What the spec chart plots: the 'selection', or 'all' the vehicles the
        // filters leave (#450).
        specScope:      'selection',
        specsField:     null,   // selected column key for the spec chart's bars (a table column, #450)
        // Range & Efficiency's chart type and efficiency unit. Held here, not in
        // the view, so a link — and the pop-out — draw the chart the sender saw.
        rangeChartType: DEFAULT_RANGE_CHART_TYPE,
        effUnit:        DEFAULT_EFFICIENCY_UNIT,
        scatterXField:  null,   // selected X column key for the spec chart's scatter
        scatterYField:  null,   // selected Y column key for the spec chart's scatter
        // The reader's correction (utils/correctionSettings.js): what every
        // chart corrects range for, and the conditions every corrected figure
        // — the vehicle table's composite range included — is corrected to.
        correctionMode:   DEFAULT_READER_MODE,
        correctionTarget: DEFAULT_CORRECTION_TARGET,
    };
}

export function defaultCompareConfig() {
    return {
        xMinutes: 15, mMiles: 150, startSoc: 10,
        // Held here, not in the view, so a link can reopen Charge Stop as it
        // was left: bars lying down or standing, and which pairs are plotted.
        orientation: DEFAULT_COMPARE_ORIENTATION,
        selected: [],   // pair keys; the view fills it on first sight of a vehicle
    };
}

export function defaultRoadTripConfig() {
    return {
        mode: 'distance', startSoc: 90, minSoc: 10, destinationMinSoc: 10,
        legDistance: 150, chargeTime: 30,
        totalDistance: 500, speed: 70,
        overhead: 5,              // per-stop overhead minutes (applies to EV and ICE)
        yAxis: 'chargeTime',      // 'distance' | 'chargeTime' | 'byTest'
        xAxis: 'totalTime',       // 'totalTime' | 'driveTime' — Road Trip's timeline
        sweepYAxis: 'totalTime',  // 'totalTime' | 'driveTime' | 'chargeTime' | 'avgSpeed' (Trip Optimizer)
        // Trip Optimizer's own. A trip long enough for several stops, or the
        // optimum is mostly an artifact of where the one or two stops land.
        optimizerDistance: 700,
        // The map first: it answers both settings at once, which is what the
        // tab is for; the sweeps are its slices, a click away.
        optimizerChart: 'map',    // 'map' | 'speed' | 'tripDist' (charge per stop)
        bestPlan: true,           // each sweep point takes the best of the other setting
        // The speeds the BEST plan may use. The fastest is still drawn, and
        // labelled as such: 95 mph wins on a fast charger, and nobody should
        // be told to drive it.
        optimizerSpeedMin: 55,
        optimizerSpeedMax: 80,
        towingMode: false,        // override all vehicle efficiencies with a fixed trailer-system value
        towingEfficiency: 1.5,    // mi/kWh for the whole vehicle+trailer system
        towingRefSpeedMph: 70,    // speed at which towingEfficiency was measured
        perRun: {},               // { [runId]: { minSoc?, legDistance?, chargeTime? } } — per-run overrides
    };
}

export function defaultEpaConfig() {
    return {
        yAxis: 'kwh100mi',
        // Which curves are drawn, and any colors overridden for them (#221).
        // Held here rather than inside EpaCurvesView so they reach the URL and
        // the pop-out, exactly as every other chart's selection does.
        selectedMappings: [], mappingColors: {},
        // The real-world overlay (null | 'corrected' | 'uncorrected'). Here, not
        // in the view, so a link can open the chart with its tests showing: an
        // explainer's modeled-efficiency card links in with epa_ov=corrected.
        overlay: null,
    };
}


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
        xMin: null,
        xMax: null,
        yMin: 0,
        yMax: null,
        y2Min: null,
        y2Max: null,
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
        specsField:     null,   // selected field key for Spec Chart mode
        // Range & Efficiency's chart type and efficiency unit. Held here, not in
        // the view, so a link — and the pop-out — draw the chart the sender saw.
        rangeChartType: DEFAULT_RANGE_CHART_TYPE,
        effUnit:        DEFAULT_EFFICIENCY_UNIT,
        scatterXField:  null,   // selected X field key for Spec Scatter mode
        scatterYField:  null,   // selected Y field key for Spec Scatter mode
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
        xAxis: 'totalTime',       // 'totalTime' | 'driveTime' | 'speed' | 'tripDist'
        sweepYAxis: 'totalTime',  // 'totalTime' | 'driveTime' | 'chargeTime' (sweep modes only)
        towingMode: false,        // override all vehicle efficiencies with a fixed trailer-system value
        towingEfficiency: 1.5,    // mi/kWh for the whole vehicle+trailer system
        towingRefSpeedMph: 70,    // speed at which towingEfficiency was measured
        perRun: {},               // { [runId]: { minSoc?, legDistance?, chargeTime? } } — per-run overrides
    };
}

export function defaultEpaConfig() {
    return {
        yAxis: 'kwh100mi', xMin: null, xMax: null, yMin: null, yMax: null,
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


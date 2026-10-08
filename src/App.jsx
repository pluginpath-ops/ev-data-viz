import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { VEHICLE_PALETTE } from './utils/colorUtils';
import { useAppContext } from './context/AppContext';
import { useChartSync } from './hooks/useChartSync';
import { ScaleSyncContext } from './hooks/useSyncedScale';
import { useHeaderHeight } from './hooks/useHeaderHeight';
import AppNav from './components/shell/AppNav';
import SubTabStrip from './components/shell/SubTabStrip';
import AuthModal from './components/AuthModal';
import VehiclesView from './components/VehiclesView';
import RunsView, { RUNS_SUBTAB_IDS, DEFAULT_RUNS_SUBTAB } from './components/RunsView';
import ChargingView from './components/ChargingView';
import ChargeCompareView from './components/ChargeCompareView';
import RoadTripView from './components/RoadTripView';
import PopoutView from './components/PopoutView';
import VehicleTable from './components/VehicleTable';
import { testHref } from './utils/testDetails';
import { VEHICLE_TABLE_PARAM_PREFIX } from './utils/vehicleTable';
import SpecsChartView from './components/SpecsChartView';
import SpecsScatterView from './components/SpecsScatterView';
import EpaCurvesView from './components/EpaCurvesView';
import PerformanceCompareView from './components/PerformanceCompareView';
import PerformanceCurveView from './components/PerformanceCurveView';
import AdminView, { ADMIN_SUBTAB_IDS, DEFAULT_ADMIN_SUBTAB } from './components/AdminView';
import Playground from './components/playground/Playground';
import { explorerStateFromUrl } from './components/epa/curves/EpaCurveExplorer';
import EpaSection, { EPA_SUBTABS, DEFAULT_EPA_SUBTAB, epaSubtabFromParam } from './components/epa/EpaSection';
import { DEFAULT_CHART_MODE, ALL_CHART_MODES, TOP_CHART_CATEGORIES, categoryForMode, categoryByKey, isChartCategory, modeNeedsSelection, entryModeFor, navTabFor, chartModesUnder, navItemForMode } from './constants/chartNav';
import SpecChartKind from './components/SpecChartKind';
import { NavigationContext } from './context/NavigationContext';
import { platformHref } from './utils/platforms';
import { decodeVehicleFilters, encodeVehicleFilters } from './utils/vehicleFilters';
import ReferenceSection, { REFERENCE_SUBTABS, DEFAULT_REFERENCE_SUBTAB, referenceSubtabFromParam } from './components/reference/ReferenceSection';
import { encodePairings, decodePairings, prunePairings } from './utils/pairings';
import { isEpaPartnerId } from './utils/rangeSource';
import { applyVehicleBases, withVehicleBase, NO_VEHICLE_BASES } from './utils/vehicleBase';
import { VehicleBaseContext } from './context/VehicleBaseContext';
import VehicleSwatch from './components/VehicleSwatch';

/* SubTabStrip speaks `key`; the EPA registry has always spoken `id`, and it is
   read by name in several places, so it is mapped here rather than renamed. */
// EPA's own sub-tabs are its "All EVs" section (#338); the chart modes drawn
// under it form a "Selected vehicles" section after them.
const EPA_STRIP_ITEMS = EPA_SUBTABS.map(t => ({ key: t.id, label: t.label, description: t.description, group: 'All EVs' }));
// Vehicles & Specs' own sub-nav section (#338); its "Specifications & Data"
// section is the chart modes drawn under it (chartNav.js `navParent`).
const REFERENCE_STRIP_ITEMS = REFERENCE_SUBTABS.map(t => ({ key: t.id, label: t.label, description: t.description }));
const VEHICLES_STRIP_ITEMS = [
    { key: 'card', label: 'Cards', group: 'Summary' },
    { key: 'list', label: 'List',  group: 'Summary' },
];

/**
 * Views that never read the vehicle selection.
 *
 * Tests & Data takes ONE vehicle (`currentActiveVehicle`, which comes from
 * `activeVehicle` and not from the selection); the EPA section takes no vehicle
 * props at all; Admin and the playground take none either. On all four, the
 * chips describe a choice that changes nothing on the screen showing them.
 *
 * That matters more than it sounds, because the strip lives inside the STICKY
 * header — as the note beside it says, every row it occupies is taken off every
 * screen below it for good. Measured on a 375px phone with six vehicles picked:
 * 77px, which is 46% of the header and 9.5% of the viewport, spent saying
 * nothing.
 *
 * Hiding is not clearing. The selection survives the trip and the chips are
 * back the moment a view uses them again.
 */
const SELECTION_INERT_VIEWS = new Set(['runs', 'epa', 'reference', 'admin', 'playground']);

export default function App() {
    const {
        vehicles,
        selectedVehicles,
        user,
        userRole,
        isAdmin,
        isContributor,
        canCreate,
        canEdit,
        canDelete,
        canPublish,
        loading,
        toggleVehicleSelection,
        removeVehicleSelection,
        clearAllSelections,
        setVehicleSelection,
        addVehicle,
        updateVehicle,
        reorderVehicles,
        duplicateVehicle,
        createVariant,
        deleteVehicle,
        duplicateRun,
        addRun,
        updateRun,
        setDefaultRun,
        deleteRun,
        tags,
        createTag,
        syncVehicleTags,
        uploadVehicleImage,
        toggleVehicleVisibility,
        replaceRunData,
        mergeRunData,
        getUsersForAdmin,
        setUserRole,
        signOut,
        initializeApp,
        appNotification,
        clearNotification,
        updateVehicleSpecs,
        specCustomFieldSuggestions,
        copyRunToVehicle,
        units,
        toggleUnits,
    } = useAppContext();

    // Auto-dismiss notifications after 6 s
    useEffect(() => {
        if (!appNotification) return;
        const t = setTimeout(clearNotification, 6000);
        return () => clearTimeout(t);
    }, [appNotification, clearNotification]);
    // Measured, not hardcoded — see hooks/useHeaderHeight.
    const headerRef = useHeaderHeight();


    const [activeVehicle, setActiveVehicle] = useState(null);
    const [view, setView] = useState('vehicles');
    // Which Runs-tab sub-tab is showing (Charging & Range / Inherited /
    // Performance / EPA). Lifted out of RunsView so it can be persisted in the
    // URL the same way activeVehicle is.
    const [runsSubtab, setRunsSubtab] = useState(DEFAULT_RUNS_SUBTAB);
    // The test a link pointed at (?tab=runs&run=…), which Tests & Data scrolls
    // to and marks once, then hands back. Only a link sets it.
    const [focusRunId, setFocusRunId] = useState(null);
    // Stable, because Tests & Data's landing effect depends on it: a new
    // function each render would re-scroll and restart its timer every time.
    const clearFocusRun = useCallback(() => setFocusRunId(null), []);
    // Same lift for the Admin tab's sub-tabs (Roles / EPA Data / Fuel Economy
    // Guide / Model Constants / Interface Settings).
    const [adminSubtab, setAdminSubtab] = useState(DEFAULT_ADMIN_SUBTAB);
    // And for EPA (Browse / Label Statistics / Certification Statistics /
    // Modeled Efficiency), which used to own its own state and draw its
    // own sub-nav below the header — the one section whose sub-tabs did not sit
    // in the header with everything else.
    const [epaSubtab, setEpaSubtab] = useState(DEFAULT_EPA_SUBTAB);

    // Keep activeVehicle in sync with vehicles state. Computed early (rather
    // than just before render) so the URL-sync effects below can depend on it.
    const currentActiveVehicle = activeVehicle
        ? vehicles.find(v => v.id === activeVehicle.id) || activeVehicle
        : null;

    // Persist Vehicles tab UI state across tab switches so filters/sort/page
    // are restored when the user returns.
    const [vehiclesViewState, setVehiclesViewState] = useState(() => ({
        textFilter: '',
        tagFilterStates: {},
        mfgFilterStates: {},
        modelFilter: new Set(),
        sortBy: 'default',
        vehiclePage: 1,
    }));
    const [dragOverIdx, setDragOverIdx] = useState(null); // pill drop-indicator position
    const [chartMode, setChartMode] = useState('charging'); // 'charging' | 'range' | 'compare' | 'epacurves' | …
    const [compareConfig, setCompareConfig] = useState({ xMinutes: 15, mMiles: 150, startSoc: 10 });
    // Which range test supplies the miles for which charging test. Global to the
    // chart session rather than per-view, so two charts on one screen can never
    // disagree about what "range" means. See utils/pairings.js.
    const [pairings, setPairings] = useState({});
    // The EPA curve explorer's selection, Y axis and viewing conditions, reported
    // up by the explorer while it is open so a pop-out can follow it (#259).
    // null when it is not on screen. A pop-out is seeded from its own URL, so it
    // draws the explorer from the first frame instead of waiting for a message.
    const [epaExplorer, setEpaExplorer] = useState(() => {
        const p = new URLSearchParams(window.location.search);
        return p.get('popout') === '1' && p.get('tab') === 'epa' && p.get('sub') === 'curves'
            ? { ...explorerStateFromUrl(), conditions: null }
            : null;
    });
    // Axis limits of the chart on screen, for the charts that keep them locally
    // (see useSyncedScale). Reported by that chart in the main tab; received by a
    // pop-out.
    const [viewScale, setViewScale] = useState(null);
    const [epaConfig, setEpaConfig] = useState({
        yAxis: 'kwh100mi', xMin: null, xMax: null, yMin: null, yMax: null,
        // Which curves are drawn, and any colors overridden for them (#221).
        // Held here rather than inside EpaCurvesView so they reach the URL and
        // the pop-out, exactly as every other chart's selection does.
        selectedMappings: [], mappingColors: {},
        // The real-world overlay (null | 'corrected' | 'uncorrected'). Here, not
        // in the view, so a link can open the chart with its tests showing: an
        // explainer's modeled-efficiency card links in with epa_ov=corrected.
        overlay: null,
    });
    const [roadTripConfig, setRoadTripConfig] = useState({
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
    });
    const [chartConfig, setChartConfig] = useState({
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
        scatterXField:  null,   // selected X field key for Spec Scatter mode
        scatterYField:  null,   // selected Y field key for Spec Scatter mode
    });
    // The vehicles as the charts should draw them: a session base replaces the
    // vehicle's color on the copy, so every chart, sidebar accent and swatch
    // that reads `vehicle.color` follows without knowing a second layer exists.
    const vehicleBases = chartConfig.vehicleBases ?? NO_VEHICLE_BASES;
    const chartVehicles = useMemo(
        () => applyVehicleBases(vehicles, vehicleBases), [vehicles, vehicleBases]);
    const vehicleBaseApi = useMemo(() => ({
        bases: vehicleBases,
        setBase: (vehicleId, color) => setChartConfig(prev => ({
            ...prev, vehicleBases: withVehicleBase(prev.vehicleBases, vehicleId, color),
        })),
        canSave: (vehicle) => Boolean(canEdit?.(vehicle)),
        save: async (vehicle, color) => {
            await updateVehicle(vehicle.id, { color });
            setChartConfig(prev => ({
                ...prev, vehicleBases: withVehicleBase(prev.vehicleBases, vehicle.id, null),
            }));
        },
    }), [vehicleBases, canEdit, updateVehicle]);

    // Each chart category is its own top-level tab, so `view` holds the category
    // key directly ('efficiency', 'specifications', …) and this is non-null
    // exactly when one of them is showing.
    const activeChartCategory = categoryByKey(view);

    // Remember the last mode used in each category so switching away and back
    // returns you where you were rather than resetting to the first sub-tab. A
    // ref, not state — it's read during a click handler, never rendered.
    const lastModeByCategory = useRef({});
    // The chart mode last shown under a parent tab (Vehicles & Specs' Table,
    // EPA's selected-vehicles Modeled Efficiency), or null when the tab's own view was. Clicking
    // the tab returns there rather than to its first item (#338).
    const lastModeUnderTab = useRef({});
    // A vehicle's page is the last place under Vehicles & Specs while it shows.
    useEffect(() => {
        if (view === 'runs') lastModeUnderTab.current.vehicles = 'runs';
    }, [view]);
    // Cards or List (#338): a sub-nav item now, so App owns it.
    const [vehiclesMode, setVehiclesMode] = useState('card');
    // Vehicles & Specs' filters (#338): one set for Cards, List and Table, so
    // switching views never changes which vehicles show. Read from the link
    // the page opened on (vehicleFilters.js reads the table's old vt_ ones too).
    const [vehicleFilters, setVehicleFilters] = useState(() => decodeVehicleFilters(window.location.search));
    // Reference's sub-tab (#338): Platforms or Explainers.
    const [referenceSubtab, setReferenceSubtab] = useState(DEFAULT_REFERENCE_SUBTAB);
    // The platform whose page is showing under Reference › Platforms (#354), or null for the list.
    const [referencePlatformId, setReferencePlatformId] = useState(null);
    // The explainer showing under Reference › Explainers (#355), by slug, or null for the list.
    const [referenceTopic, setReferenceTopic] = useState(null);

    const handleChartModeChange = (newMode) => {
        const categoryKey = categoryForMode(newMode).key;
        // Push a history entry so "back" can return to the previous chart mode.
        history.pushState(
            { view: categoryKey, chartMode: newMode },
            '',
            `?tab=${categoryKey}&m=${newMode}`, // URL sync effect replaces with full params
        );
        lastModeByCategory.current[categoryKey] = newMode;
        const parentTab = categoryForMode(newMode).navParent;
        if (parentTab) lastModeUnderTab.current[parentTab] = newMode;
        setView(categoryKey);
        setChartMode(newMode);
        // Only on an actual mode change. Clearing unconditionally emptied the
        // chart when you clicked the sub-tab you were already on, and nothing
        // refilled it — the charts re-bootstrap on a mode CHANGE, which this was
        // not. One click on the active tab left you with no series and no way
        // back but reselecting by hand.
        //
        // Not an early return from this function: the top nav calls it with the
        // category's remembered mode, which is frequently the current one, and
        // bailing there stops the view switching at all.
        if (newMode !== chartMode) {
            setChartConfig(prev => ({ ...prev, selectedRuns: [] }));
        }
    };

    /** Enter a chart category tab, restoring whichever mode you last used in it. */
    const navigateToChartCategory = (categoryKey) => {
        const category = categoryByKey(categoryKey);
        if (!category) return;
        const mode = entryModeFor(category, lastModeByCategory.current[categoryKey], selectedVehicles.length > 0);
        if (mode) handleChartModeChange(mode);
    };

    const { isPopout, sendState } = useChartSync({
        chartMode, chartConfig, selectedVehicles, compareConfig, roadTripConfig, epaConfig, pairings, epaExplorer, viewScale,
        setChartMode, setChartConfig, setVehicleSelection, setCompareConfig, setRoadTripConfig, setEpaConfig, setPairings, setEpaExplorer, setViewScale,
    });

    /**
     * Open a test in Tests & Data from a figure that rests on it — the vehicle
     * table's tested cells (testDetails.js TestReference). A history entry, so
     * Back returns to the table where the reader was.
     */
    const openTest = useCallback((ref) => {
        const v = vehicles.find(x => String(x.id) === String(ref.vehicleId));
        if (!v) return;
        const sub = RUNS_SUBTAB_IDS.includes(ref.sub) ? ref.sub : DEFAULT_RUNS_SUBTAB;
        history.pushState({ view: 'runs', vehicleId: v.id, subtab: sub }, '', testHref(ref));
        setActiveVehicle(v);
        setRunsSubtab(sub);
        setFocusRunId(ref.runId ?? null);
        setView('runs');
        window.scrollTo(0, 0);
    }, [vehicles]);

    // Navigate to a new top-level view and push a browser history entry so the
    // back button works within the app instead of exiting to the auth page.
    const navigateTo = useCallback((newView) => {
        // Re-entering the category you're already in keeps the full query string
        // (axes, selections) rather than resetting it to a bare tab param.
        const url = isChartCategory(newView) && window.location.search.includes(`tab=${newView}`)
            ? window.location.search
            : `?tab=${newView}`;
        history.pushState({ view: newView, chartMode }, '', url);
        setView(newView);
    }, [chartMode]);

    /**
     * A header tab that is not a chart category. Returns to the chart mode last
     * shown under it, if there was one and it can still show; else its own view.
     */
    const navigateToTab = (tab) => {
        const mode = lastModeUnderTab.current[tab];
        // The vehicle's page is a place under Vehicles & Specs too (#338).
        if (mode === 'runs') {
            navigateTo(currentActiveVehicle ? 'runs' : tab);
            return;
        }
        const modeDef = mode ? categoryForMode(mode).modes.find(m => m.key === mode) : null;
        if (modeDef && (selectedVehicles.length > 0 || !modeNeedsSelection(modeDef))) {
            handleChartModeChange(mode);
            return;
        }
        navigateTo(tab);
    };

    /**
     * A platform's page, from anywhere a platform is named (#354). A history
     * entry, so Back returns to the card, table or View Specs it came from.
     */
    const openPlatform = (id) => {
        history.pushState({ view: 'reference', subtab: DEFAULT_REFERENCE_SUBTAB, platformId: String(id) }, '', platformHref(id));
        setReferenceSubtab(DEFAULT_REFERENCE_SUBTAB);
        setReferencePlatformId(String(id));
        setView('reference');
        window.scrollTo(0, 0);
    };

    /** A Reference sub-tab's top level (the platform list, or Explainers), or one explainer. */
    const openReference = (subtab, topic = null) => {
        const url = subtab === DEFAULT_REFERENCE_SUBTAB ? '?tab=reference'
            : `?tab=reference&sub=${subtab}${topic ? `&topic=${encodeURIComponent(topic)}` : ''}`;
        history.pushState({ view: 'reference', subtab, platformId: null, topic }, '', url);
        setReferenceSubtab(subtab);
        setReferencePlatformId(null);
        setReferenceTopic(topic);
        setView('reference');
    };

    /** An explainer, from anywhere an ExplainerLink sits (#355). A history entry, like openPlatform. */
    const openExplainer = (slug) => {
        openReference('explainers', slug);
        window.scrollTo(0, 0);
    };

    /** Show the opened vehicle's page (#338). */
    const openVehiclePage = () => navigateTo('runs');

    /**
     * Close the opened vehicle (#338): it leaves the header, Vehicles & Specs
     * stops returning to it, and if its page is showing, the reader goes back
     * to Vehicles & Specs.
     */
    const closeVehicle = () => {
        if (lastModeUnderTab.current.vehicles === 'runs') lastModeUnderTab.current.vehicles = null;
        if (view === 'runs') navigateTo('vehicles');
        setActiveVehicle(null);
    };

    const [pendingEditVehicle, setPendingEditVehicle] = useState(null);
    const [showAuthModal, setShowAuthModal] = useState(false);
    const pendingUrlState = useRef(null);
    const urlApplied = useRef(false);
    // Vehicle id / sub-tab to restore on the Runs tab (?tab=runs&vid=…&sub=…)
    // once vehicles load.
    const pendingRunsVehicleId = useRef(null);
    const pendingRunsSubtab = useRef(null);
    const pendingRunsRunId = useRef(null);
    // Whether to land on the Admin tab (?tab=admin&sub=…) once the user's role
    // has loaded, and which sub-tab to restore.
    const pendingAdminView = useRef(false);
    const pendingAdminSubtab = useRef(null);

    // ── Parse URL on mount ──────────────────────────────────────────────────
    useEffect(() => {
        const p = new URLSearchParams(window.location.search);
        const rawTab = p.get('tab');

        // ── Legacy URL shapes ───────────────────────────────────────────────
        // Charts used to be one tab with the categories nested under it
        // (?tab=chart&m=…), and before that Compare Specs was its own top-level
        // tab (?tab=specs). Both still circulate in shared links, so rewrite
        // them onto the category that now owns that mode rather than dropping
        // the visitor on Vehicles with no explanation.
        if (rawTab === 'chart' || rawTab === 'specs') {
            const mode = rawTab === 'specs'
                ? 'specstable'
                : (ALL_CHART_MODES.includes(p.get('m')) ? p.get('m') : DEFAULT_CHART_MODE);
            const categoryKey = categoryForMode(mode).key;
            p.set('tab', categoryKey);
            p.set('m', mode);
            history.replaceState({ view: categoryKey, chartMode: mode }, '', '?' + p.toString());
            // Fall through so the rest of the query string (vehicles, axes) is
            // still parsed — these links carry more than just the tab.
        }

        const tab = p.get('tab');
        if (tab === 'runs') {
            const vid = p.get('vid');
            if (vid) pendingRunsVehicleId.current = isNaN(Number(vid)) ? vid : Number(vid);
            const sub = p.get('sub');
            if (RUNS_SUBTAB_IDS.includes(sub)) pendingRunsSubtab.current = sub;
            if (p.get('run')) pendingRunsRunId.current = p.get('run');
            return;
        }
        // Unlinked, but a real route: nothing here needs a role or a selection
        // resolved first, because the page reads no data at all.
        if (tab === 'playground') {
            setView('playground');
            return;
        }
        if (tab === 'reference') {
            setReferenceSubtab(referenceSubtabFromParam(p.get('sub')));
            setReferencePlatformId(p.get('pid') || null);
            setReferenceTopic(p.get('topic') || null);
            setView('reference');
            return;
        }
        if (tab === 'epa') {
            // Nothing to wait for — the guide loads its own data and needs no
            // vehicle, role or selection resolved first, so the sub-tab is set
            // here rather than parked on a ref the way runs and admin need.
            setEpaSubtab(epaSubtabFromParam(p.get('sub')));
            setView('epa');
            return;
        }
        if (tab === 'admin') {
            pendingAdminView.current = true;
            const sub = p.get('sub');
            if (ADMIN_SUBTAB_IDS.includes(sub)) pendingAdminSubtab.current = sub;
            return;
        }
        if (!isChartCategory(tab)) return;
        pendingUrlState.current = {
            vehicleIds:    (p.get('v')?.split(',').filter(Boolean) || []).map(id => isNaN(Number(id)) ? id : Number(id)),
            runIds:        (p.get('r')?.split(',').filter(Boolean) || []).map(id => isNaN(Number(id)) ? id : Number(id)),
            xAxis:         p.get('x')  || null,
            yAxis:         p.get('y')  || null,
            y2Axis:        p.get('y2') || null,
            alignRaw:      p.get('raw') === '1',
            raceThreshold: p.get('rt')  ? Number(p.get('rt'))  : null,
            xMin:  p.get('xn')  !== null && p.get('xn')  !== '' ? Number(p.get('xn'))  : null,
            xMax:  p.get('xx')  !== null && p.get('xx')  !== '' ? Number(p.get('xx'))  : null,
            yMin:  p.get('yn')  !== null && p.get('yn')  !== '' ? Number(p.get('yn'))  : 0,
            yMax:  p.get('yx')  !== null && p.get('yx')  !== '' ? Number(p.get('yx'))  : null,
            y2Min: p.get('y2n') !== null && p.get('y2n') !== '' ? Number(p.get('y2n')) : null,
            y2Max: p.get('y2x') !== null && p.get('y2x') !== '' ? Number(p.get('y2x')) : null,
            showLine:   p.get('line') !== '0', // default to true if not present, false if explicitly set to 0
            showPoints: p.get('pts') === '1', // default to false if not present, true if explicitly set to 1
            compositeSpread: p.get('cspread') !== '0',
            // Guard against a stale or hand-edited ?m= — an unknown mode would
            // otherwise fall through to the charging chart with no indication why.
            chartMode:     ALL_CHART_MODES.includes(p.get('m')) ? p.get('m') : DEFAULT_CHART_MODE,
            scatterXField: p.get('scx') || null,
            scatterYField: p.get('scy') || null,
        };

        // Charge Compare config
        const cmpSoc  = p.get('cmp_soc');
        const cmpMins = p.get('cmp_mins');
        const cmpMi   = p.get('cmp_mi');
        if (cmpSoc != null || cmpMins != null || cmpMi != null) {
            setCompareConfig(prev => ({
                ...prev,
                ...(cmpSoc  != null && { startSoc: Number(cmpSoc)  }),
                ...(cmpMins != null && { xMinutes: Number(cmpMins) }),
                ...(cmpMi   != null && { mMiles:   Number(cmpMi)   }),
            }));
        }

        // Pairings — global across chart modes, so read unconditionally.
        const pairsParam = p.get('pairs');
        if (pairsParam) setPairings(decodePairings(pairsParam));

        // Road Trip config
        const n = (key) => { const v = p.get(key); return v != null ? Number(v) : null; };
        const rtOverride = {
            ...(p.get('rt_m')  && { mode:             p.get('rt_m')           }),
            ...(n('rt_ss') != null && { startSoc:     n('rt_ss')               }),
            ...(n('rt_ms') != null && { minSoc:        n('rt_ms')               }),
            ...(n('rt_ld') != null && { legDistance:   n('rt_ld')               }),
            ...(n('rt_ct') != null && { chargeTime:    n('rt_ct')               }),
            ...(n('rt_td') != null && { totalDistance: n('rt_td')               }),
            ...(n('rt_sp') != null && { speed:         n('rt_sp')               }),
            ...(n('rt_oh') != null && { overhead:      n('rt_oh')               }),
            ...(p.get('rt_ya') && { yAxis:              p.get('rt_ya')          }),
            ...(p.get('rt_xa') && { xAxis:              p.get('rt_xa')          }),
            ...(p.get('rt_sya') && { sweepYAxis:         p.get('rt_sya')         }),
            ...(p.get('rt_tw') === '1' && { towingMode: true                    }),
            ...(n('rt_te') != null && { towingEfficiency:   n('rt_te')          }),
            ...(n('rt_tr') != null && { towingRefSpeedMph:  n('rt_tr')          }),
        };
        if (Object.keys(rtOverride).length > 0) setRoadTripConfig(prev => ({ ...prev, ...rtOverride }));

        // Modeled Efficiency · selected vehicles (EPA Curves) config
        const epaYa = p.get('epa_ya');
        const epaSel = p.get('epa_m');
        const epaOverride = {};
        if (epaYa) epaOverride.yAxis = epaYa;
        const epaOv = p.get('epa_ov');
        if (epaOv === 'corrected' || epaOv === 'uncorrected') epaOverride.overlay = epaOv;
        if (epaSel) {
            // Mapping ids are numeric; `filter(Boolean)` runs BEFORE the map
            // because Number('') is 0 and 0 is finite, so `epa_m=` alone would
            // decode to a selection of the mapping with id zero.
            epaOverride.selectedMappings = epaSel.split(',').filter(Boolean)
                .map(Number).filter(Number.isFinite);
        }
        if (Object.keys(epaOverride).length > 0) setEpaConfig(prev => ({ ...prev, ...epaOverride }));
    }, []);

    // ── Handle browser back/forward ─────────────────────────────────────────
    useEffect(() => {
        const onPopState = (e) => {
            // Only act on history entries we created (they carry a state object).
            // If state is null the user has navigated outside our app — let the
            // browser handle it naturally.
            if (!e.state?.view) return;
            setView(e.state.view);
            // Back and Forward return to a page, not to a link's moment of arrival.
            setFocusRunId(null);
            // Restore chart mode without clearing runs — auto-select re-initialises
            // them for the restored mode automatically.
            if (e.state.chartMode) setChartMode(e.state.chartMode);
            if (e.state.view === 'runs' && e.state.vehicleId != null) {
                const v = vehicles.find(v => v.id === e.state.vehicleId);
                if (v) setActiveVehicle(v);
                if (RUNS_SUBTAB_IDS.includes(e.state.subtab)) setRunsSubtab(e.state.subtab);
            }
            if (e.state.view === 'reference') {
                setReferenceSubtab(referenceSubtabFromParam(e.state.subtab));
                setReferencePlatformId(e.state.platformId ?? null);
                setReferenceTopic(e.state.topic ?? null);
            }
            if (e.state.view === 'admin' && ADMIN_SUBTAB_IDS.includes(e.state.subtab)) {
                setAdminSubtab(e.state.subtab);
            }
        };
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, [vehicles]); // vehicles needed to resolve vehicleId back to a vehicle object

    // ── Apply pending URL state once data has loaded ────────────────────────
    useEffect(() => {
        if (loading || urlApplied.current || !pendingUrlState.current) return;
        urlApplied.current = true;
        const s = pendingUrlState.current;

        // Derive vehicle IDs from run IDs, then merge with any explicit v= IDs
        // (v= carries vehicles that have no runs selected)
        const runIdSet = new Set(s.runIds.map(String));
        const fromRuns = vehicles
            .filter(v => (v.runs || []).some(r => runIdSet.has(String(r.id))))
            .map(v => v.id);
        const vehicleIds = [...new Set([...s.vehicleIds, ...fromRuns])];
        if (vehicleIds.length > 0) setVehicleSelection(vehicleIds);
        if (s.chartMode) setChartMode(s.chartMode);

        setChartConfig(prev => ({
            ...prev,
            ...(s.xAxis         && { xAxis: s.xAxis }),
            ...(s.yAxis         && { yAxis: s.yAxis }),
            ...(s.y2Axis        && { y2Axis: s.y2Axis }),
            ...(s.runIds.length  > 0 && s.chartMode === 'charging' && { selectedRuns: s.runIds }),
            alignRaw:      s.alignRaw,
            raceThreshold: s.raceThreshold,
            xMin:          s.xMin,
            xMax:          s.xMax,
            yMin:          s.yMin,
            yMax:          s.yMax,
            y2Min:         s.y2Min ?? null,
            y2Max:         s.y2Max ?? null,
            showLine:      s.showLine ?? true, // default to true if not present, false if explicitly set to 0
            showPoints:    s.showPoints ?? false, // default to false if not present, true if explicitly set to 1
            compositeSpread: s.compositeSpread ?? true,
            ...(s.scatterXField && { scatterXField: s.scatterXField }),
            ...(s.scatterYField && { scatterYField: s.scatterYField }),
        }));
        // Land on the category that owns the restored mode.
        setView(categoryForMode(s.chartMode).key);
    }, [loading]);

    // ── Restore the active vehicle + sub-tab on the Runs tab from ?vid=&sub= ──
    useEffect(() => {
        if (loading || pendingRunsVehicleId.current == null) return;
        const id = pendingRunsVehicleId.current;
        pendingRunsVehicleId.current = null;
        const sub = pendingRunsSubtab.current;
        pendingRunsSubtab.current = null;
        const runId = pendingRunsRunId.current;
        pendingRunsRunId.current = null;
        const v = vehicles.find(v => v.id === id);
        if (v) {
            setActiveVehicle(v);
            setView('runs');
            if (RUNS_SUBTAB_IDS.includes(sub)) setRunsSubtab(sub);
            if (runId) setFocusRunId(runId);
        }
    }, [loading, vehicles]);

    // ── Restore the Admin tab + sub-tab from ?tab=admin&sub= ────────────────
    // Gated on isAdmin rather than a lookup, since there's no per-item id here
    // — just a permission check that resolves once the user's role has loaded.
    useEffect(() => {
        if (loading || !pendingAdminView.current) return;
        pendingAdminView.current = false;
        const sub = pendingAdminSubtab.current;
        pendingAdminSubtab.current = null;
        if (isAdmin) {
            setView('admin');
            if (ADMIN_SUBTAB_IDS.includes(sub)) setAdminSubtab(sub);
        }
    }, [loading, isAdmin]);

    // ── Keep URL in sync while on a chart category tab ──────────────────────
    useEffect(() => {
        if (isPopout) return;   // pop-out doesn't manage its own URL
        if (!isChartCategory(view)) return;
        const p = new URLSearchParams();
        p.set('tab', view);
        if (chartMode === 'charging' && chartConfig.selectedRuns.length > 0)  p.set('r', chartConfig.selectedRuns.join(','));
        // Include v= only for selected vehicles that have no runs in r (run-less selections)
        const runVehicleIds = new Set(
            vehicles
                .filter(v => (v.runs || []).some(r => chartConfig.selectedRuns.includes(r.id)))
                .map(v => String(v.id))
        );
        const runlessVehicles = selectedVehicles.filter(id => !runVehicleIds.has(String(id)));
        if (runlessVehicles.length > 0)           p.set('v', runlessVehicles.join(','));
        p.set('x', chartConfig.xAxis);
        p.set('y', chartConfig.yAxis);
        if (chartConfig.y2Axis)                   p.set('y2',   chartConfig.y2Axis);
        if (chartConfig.alignRaw)                 p.set('raw', '1');
        if (chartConfig.raceThreshold != null)    p.set('rt',   String(chartConfig.raceThreshold));
        if (chartConfig.xMin != null)             p.set('xn',   String(chartConfig.xMin));
        if (chartConfig.xMax != null)             p.set('xx',   String(chartConfig.xMax));
        if (chartConfig.yMin != null && chartConfig.yMin !== 0) p.set('yn', String(chartConfig.yMin));
        if (chartConfig.yMax != null)             p.set('yx',   String(chartConfig.yMax));
        if (chartConfig.y2Min != null)            p.set('y2n',  String(chartConfig.y2Min));
        if (chartConfig.y2Max != null)            p.set('y2x',  String(chartConfig.y2Max));
        if (chartConfig.showLine === false)       p.set('line',   '0'); // default to true if not present, false if explicitly set to 0
        if (chartConfig.showPoints)               p.set('pts',    '1');
        if (chartConfig.compositeSpread === false) p.set('cspread', '0');
        if (chartMode !== 'charging')             p.set('m', chartMode);

        // Charge Compare options
        if (chartMode === 'compare') {
            p.set('cmp_soc',  compareConfig.startSoc);
            p.set('cmp_mins', compareConfig.xMinutes);
            p.set('cmp_mi',   compareConfig.mMiles);
        }

        // Pairings apply to every chart mode, so they are written whenever any
        // exist rather than being scoped to one tab. Omitted when empty so an
        // untouched chart keeps a clean URL.
        const pairsEncoded = encodePairings(pairings);
        if (pairsEncoded) p.set('pairs', pairsEncoded);

        // Road Trip options
        if (chartMode === 'roadtrip') {
            const rt = roadTripConfig;
            p.set('rt_m',  rt.mode);
            p.set('rt_ss', rt.startSoc);
            p.set('rt_ms', rt.minSoc);
            p.set('rt_ld', rt.legDistance);
            p.set('rt_ct', rt.chargeTime);
            p.set('rt_td', rt.totalDistance);
            p.set('rt_sp', rt.speed);
            p.set('rt_oh', rt.overhead);
            p.set('rt_ya',  rt.yAxis);
            p.set('rt_xa',  rt.xAxis);
            if (rt.sweepYAxis !== 'totalTime')     p.set('rt_sya', rt.sweepYAxis);
            if (rt.towingMode)                    p.set('rt_tw', '1');
            if (rt.towingMode) {
                p.set('rt_te', rt.towingEfficiency);
                p.set('rt_tr', rt.towingRefSpeedMph);
            }
        }

        // Spec Scatter options
        if (chartMode === 'specscatter') {
            if (chartConfig.scatterXField) p.set('scx', chartConfig.scatterXField);
            if (chartConfig.scatterYField) p.set('scy', chartConfig.scatterYField);
        }

        // Modeled Efficiency · selected vehicles (EPA Curves) options
        if (chartMode === 'epacurves') {
            if (epaConfig.yAxis && epaConfig.yAxis !== 'kwh100mi') p.set('epa_ya', epaConfig.yAxis);
            // Written whenever anything is selected. Without it the curves a
            // link was sent to show are whatever BOOTSTRAP happens to pick on
            // the recipient's machine.
            if (epaConfig.selectedMappings?.length) p.set('epa_m', epaConfig.selectedMappings.join(','));
            if (epaConfig.overlay) p.set('epa_ov', epaConfig.overlay);
        }

        // The vehicle table writes its own columns, sort and filters (vt_*);
        // carry them over rather than wiping them on every selection change.
        if (chartMode === 'specstable') {
            for (const [key, value] of new URLSearchParams(window.location.search)) {
                if (key.startsWith(VEHICLE_TABLE_PARAM_PREFIX)) p.append(key, value);
            }
            // Vehicles & Specs' filters, the same parameters Cards and List write (#338).
            for (const [key, value] of encodeVehicleFilters(vehicleFilters)) p.set(key, value);
        }

        history.replaceState({ view, chartMode }, '', '?' + p.toString());
    }, [view, chartConfig, selectedVehicles, chartMode, vehicles, compareConfig, roadTripConfig, epaConfig, pairings, vehicleFilters]);

    // ── Keep URL in sync while on the Runs tab ──────────────────────────────
    // Mirrors the chart-tab sync above: a refresh or shared link on ?tab=runs
    // needs the vehicle id (and sub-tab) to know what to show, since both
    // otherwise live only in React state.
    useEffect(() => {
        if (isPopout) return;
        if (view !== 'runs' || !currentActiveVehicle) return;
        const p = new URLSearchParams();
        p.set('tab', 'runs');
        p.set('vid', currentActiveVehicle.id);
        if (runsSubtab !== DEFAULT_RUNS_SUBTAB) p.set('sub', runsSubtab);
        // Kept while the link's test is still being shown, so a refresh
        // before it lands lands on it too.
        if (focusRunId != null) p.set('run', focusRunId);
        history.replaceState(
            { view: 'runs', vehicleId: currentActiveVehicle.id, subtab: runsSubtab },
            '',
            '?' + p.toString(),
        );
    }, [isPopout, view, currentActiveVehicle, runsSubtab, focusRunId]);

    // ── Keep URL in sync while on the EPA tab ───────────────────────────────
    // This one PRESERVES the existing query string rather than rebuilding it,
    // which is the opposite of the runs and admin effects above and deliberate:
    // each EPA sub-view writes its own filter, sort, page and selection
    // parameters, so a fresh URLSearchParams here would wipe out whatever the
    // view had just put there. Only `tab` and `sub` belong to this effect.
    useEffect(() => {
        if (isPopout) return;
        if (view !== 'epa') return;
        const p = new URLSearchParams(window.location.search);
        p.set('tab', 'epa');
        p.set('sub', epaSubtab);
        history.replaceState({ view: 'epa', subtab: epaSubtab }, '', '?' + p.toString());
    }, [isPopout, view, epaSubtab]);

    // ── Keep URL in sync while on Vehicles & Specs' Cards or List (#338) ────
    // Only the filters: the tab alone otherwise. The table writes its own
    // parameters, and the chart-tab effect carries the filters for it.
    useEffect(() => {
        if (isPopout) return;
        if (view !== 'vehicles') return;
        // Not while the app is loading (#386). `view` starts as 'vehicles' and
        // only becomes the tab the URL named once the restore effects have run,
        // so this fired first and replaced the whole query with `?tab=vehicles` —
        // taking with it every parameter a view reads for itself once it mounts
        // (the curve explorer's `c`, for one). Nothing is lost by waiting: the
        // filters decode from the URL, and a genuine Vehicles view is written by
        // the first change to it.
        if (loading) return;
        const p = new URLSearchParams();
        p.set('tab', 'vehicles');
        for (const [k, v] of encodeVehicleFilters(vehicleFilters)) p.set(k, v);
        history.replaceState({ view: 'vehicles', chartMode }, '', '?' + p.toString());
    // chartMode rides in the history state only; it does not decide the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isPopout, view, vehicleFilters]);

    // ── Keep URL in sync while on the Reference tab (#338) ──────────────────
    useEffect(() => {
        if (isPopout) return;
        if (view !== 'reference') return;
        const p = new URLSearchParams();
        p.set('tab', 'reference');
        if (referenceSubtab !== DEFAULT_REFERENCE_SUBTAB) p.set('sub', referenceSubtab);
        else if (referencePlatformId != null) p.set('pid', referencePlatformId);
        if (referenceSubtab === 'explainers' && referenceTopic) p.set('topic', referenceTopic);
        history.replaceState({ view: 'reference', subtab: referenceSubtab, platformId: referencePlatformId, topic: referenceTopic }, '', '?' + p.toString());
    }, [isPopout, view, referenceSubtab, referencePlatformId, referenceTopic]);

    // ── Keep URL in sync while on the Admin tab ─────────────────────────────
    useEffect(() => {
        if (isPopout) return;
        if (view !== 'admin' || !isAdmin) return;
        const p = new URLSearchParams();
        p.set('tab', 'admin');
        if (adminSubtab !== DEFAULT_ADMIN_SUBTAB) p.set('sub', adminSubtab);
        history.replaceState(
            { view: 'admin', subtab: adminSubtab },
            '',
            '?' + p.toString(),
        );
    }, [isPopout, view, isAdmin, adminSubtab]);

    // ── Drop pairings for runs that are no longer on screen ─────────────────
    // A pairing referencing a deselected vehicle's run would otherwise ride along
    // in the URL forever and silently resurrect if that vehicle came back.
    // Waits for vehicles to load so the first render can't prune a URL-restored
    // map against an empty list.
    useEffect(() => {
        if (!vehicles.length) return;
        const liveRunIds = vehicles
            .filter(v => selectedVehicles.includes(v.id))
            .flatMap(v => (v.runs || []).map(r => r.id));
        // EPA rated range is a valid pairing side with no run behind it, so its
        // per-vehicle ids would otherwise be pruned as unknown on every change.
        for (const v of vehicles) {
            if (selectedVehicles.includes(v.id) && v.epaRangeMi > 0) liveRunIds.push(`epa:${v.id}`);
        }
        setPairings(prev => {
            const pruned = prunePairings(prev, liveRunIds);
            // Same-value guard: returning a fresh object every time would retrigger
            // the URL and broadcast effects on every render.
            return Object.keys(pruned).length === Object.keys(prev).length ? prev : pruned;
        });
    }, [selectedVehicles, vehicles]);

    // ── Broadcast chart state to any open pop-out windows ───────────────────
    useEffect(() => {
        sendState();
    }, [chartMode, chartConfig, selectedVehicles, compareConfig, epaConfig, pairings, epaExplorer, viewScale, sendState]);

    // The header tab a view is shown under (#338): a vehicle's page (the
    // `runs` view) is under Vehicles & Specs; a chart category drawn under
    // another tab is under that tab.
    const headerTab = view === 'runs' ? 'vehicles' : navTabFor(view);

    // A non-chart tab whose sub-nav also carries chart modes (#338), or null.
    const parentStrip = {
        epa:      { tab: 'epa',      items: EPA_STRIP_ITEMS,      active: epaSubtab,    select: setEpaSubtab },
        vehicles: { tab: 'vehicles', items: VEHICLES_STRIP_ITEMS, active: vehiclesMode, select: setVehiclesMode },
        reference: { tab: 'reference', items: REFERENCE_STRIP_ITEMS, active: referenceSubtab,
            // A sub-tab opens its own top level: Platforms is the list.
            select: (key) => { setReferenceSubtab(key); setReferencePlatformId(null); setReferenceTopic(null); } },
    }[headerTab] ?? null;

    // Who holds axis limits that live inside a chart: the main tab reports them,
    // a pop-out receives them (useSyncedScale).
    const scaleSync = useMemo(
        () => ({ synced: isPopout ? viewScale : null, report: isPopout ? null : setViewScale }),
        [isPopout, viewScale],
    );

    // Where the pop-out is offered: any chart mode, and the EPA curve explorer,
    // which is a sub-tab rather than a mode but follows the same channel (#259).
    const showsPopout = Boolean(activeChartCategory) || (view === 'epa' && epaSubtab === 'curves');

    // The pop-out, at the right end of whichever sub-nav a chart mode is drawn in.
    const popoutButton = (
        <button
            type="button"
            onClick={() => window.open(
                window.location.origin + window.location.pathname + window.location.search + '&popout=1',
                'evbench-popout',
                `width=${window.screen.availWidth},height=${window.screen.availHeight},left=0,top=0`
            )}
            className="btn btn-primary"
            title="Open chart in a separate window for presentation"
        >
            ⧉ Open in new window
        </button>
    );

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--color-background)' }}>
                <div className="text-center">
                    <div className="text-6xl mb-4">&#9889;</div>
                    <div className="text-2xl font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Loading EV Data...</div>
                </div>
            </div>
        );
    }

    if (isPopout) {
        return (
            <ScaleSyncContext.Provider value={scaleSync}>
            <PopoutView
                vehicles={chartVehicles}
                selectedVehicles={selectedVehicles}
                chartMode={chartMode}
                chartConfig={chartConfig}
                setChartConfig={setChartConfig}
                compareConfig={compareConfig}
                roadTripConfig={roadTripConfig}
                epaConfig={epaConfig}
                pairings={pairings}
                epaExplorer={epaExplorer}
            />
            </ScaleSyncContext.Provider>
        );
    }

    return (
        <ScaleSyncContext.Provider value={scaleSync}>
        <NavigationContext.Provider value={{ openPlatform, openExplainer }}>
        <VehicleBaseContext.Provider value={vehicleBaseApi}>
            {showAuthModal && (
                <AuthModal
                    onClose={() => setShowAuthModal(false)}
                    onAuthSuccess={() => {
                        setShowAuthModal(false);
                        initializeApp();
                    }}
                />
            )}
            <div className="min-h-screen flex flex-col">
                {/* ── Chrome ──
                  * One 50px bar. The photo hero and the compact title bar it
                  * replaced are gone; see components/shell/AppNav for why. */}
                <nav className="app-nav" ref={headerRef}>
                    <AppNav
                        view={headerTab}
                        chartCategories={TOP_CHART_CATEGORIES}
                        openedVehicle={currentActiveVehicle}
                        openedActive={view === 'runs'}
                        onOpenVehicle={openVehiclePage}
                        onCloseVehicle={closeVehicle}
                        onHome={navigateTo}
                        hasSelection={selectedVehicles.length > 0}
                        isAdmin={isAdmin}
                        user={user}
                        userRole={userRole}
                        units={units}
                        onToggleUnits={toggleUnits}
                        onNavigate={navigateToTab}
                        onNavigateChartCategory={navigateToChartCategory}
                        onSignIn={() => setShowAuthModal(true)}
                        onSignOut={signOut}
                    />

                    {/* Sub-nav for whichever section has one. Every section's
                      * sub-tabs are drawn HERE, on the active tab's own fill,
                      * so a sub-tab reads as being inside its parent rather
                      * than as a second row of buttons on the page.
                      *
                      * The strip's right end is where a section's own controls
                      * belong — the popout button is a control OF the chart
                      * views, not a peer of their tabs. */}
                    {parentStrip ? (
                        // A tab's own sub-tabs, then the chart modes drawn under
                        // it (#338): EPA's Selected vehicles section, Vehicles & Specs'
                        // Table and Chart. A sub-tab stays on the tab's view; a
                        // chart mode goes to its category and keeps its chips
                        // and pop-out.
                        <SubTabStrip
                            items={[
                                ...parentStrip.items,
                                ...chartModesUnder(parentStrip.tab).map(m => ({
                                    ...m,
                                    disabled: selectedVehicles.length === 0 && modeNeedsSelection(m),
                                    hint: 'Select a vehicle first',
                                })),
                            ]}
                            // On a vehicle's page no item is current: the header's
                            // opened vehicle is.
                            activeKey={view === parentStrip.tab ? parentStrip.active : view === 'runs' ? null : navItemForMode(chartMode)}
                            onSelect={(key) => {
                                if (chartModesUnder(parentStrip.tab).some(m => m.key === key)) {
                                    // Chart stands for both spec charts: re-entering it
                                    // keeps whichever one was showing.
                                    handleChartModeChange(key === navItemForMode(chartMode) ? chartMode : key);
                                    return;
                                }
                                lastModeUnderTab.current[parentStrip.tab] = null;
                                if (view !== parentStrip.tab) navigateTo(parentStrip.tab);
                                parentStrip.select(key);
                            }}
                            end={showsPopout && popoutButton}
                        />
                    ) : (
                        <SubTabStrip
                            items={(activeChartCategory?.modes ?? []).map(m => ({
                                ...m,
                                // A chart with nothing to plot is not somewhere to go.
                                disabled: selectedVehicles.length === 0 && modeNeedsSelection(m),
                            }))}
                            activeKey={chartMode}
                            onSelect={handleChartModeChange}
                            end={showsPopout && popoutButton}
                        />
                    )}
                    {!SELECTION_INERT_VIEWS.has(view) && <div className="selected-strip">
                        <div className="page-container py-2">
                        {/* Selected vehicles row.
                          * The chips are CAPPED at two rows and scroll past
                          * that. This strip is inside the sticky header, so
                          * every chip it grows by is taken off every screen
                          * below it for good — a fifteen-vehicle selection used
                          * to pin a third of a phone viewport, and the chart
                          * sidebar sizes itself against this height. The label
                          * and Clear all sit outside the scroller so the way
                          * out of a large selection never scrolls away. */}
                        <div className="selected-strip-row">
                            <span className="text-micro">Selected</span>
                            {selectedVehicles.length === 0 ? (
                                <span className="text-meta">None</span>
                            ) : (
                                <>
                                    <div className="selected-chip-scroll">
                                    {selectedVehicles.map((vehicleId, idx) => {
                                        const vehicle = vehicles.find(v => v.id === vehicleId);
                                        if (!vehicle) return null;
                                        // dropIdx is computed from cursor position on each pill:
                                        // left half → insert before (idx), right half → insert after (idx+1)
                                        const getDropIdx = (e) => {
                                            const rect = e.currentTarget.getBoundingClientRect();
                                            return e.clientX > rect.left + rect.width / 2 ? idx + 1 : idx;
                                        };
                                        return (
                                            <div key={vehicleId} className="flex items-center">
                                                {/* Drop indicator before this pill */}
                                                {dragOverIdx === idx && (
                                                    <div className="w-0.5 h-6 bg-blue-500 rounded mr-1 shrink-0" />
                                                )}
                                                <div
                                                    draggable
                                                    onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(idx)); }}
                                                    onDragOver={e => { e.preventDefault(); setDragOverIdx(getDropIdx(e)); }}
                                                    onDragEnd={() => setDragOverIdx(null)}
                                                    onDrop={e => {
                                                        e.preventDefault();
                                                        setDragOverIdx(null);
                                                        const fromIdx = Number(e.dataTransfer.getData('text/plain'));
                                                        const dropIdx = getDropIdx(e);
                                                        const next = [...selectedVehicles];
                                                        const [moved] = next.splice(fromIdx, 1);
                                                        const insertAt = dropIdx > fromIdx ? dropIdx - 1 : dropIdx;
                                                        next.splice(insertAt, 0, moved);
                                                        setVehicleSelection(next);
                                                    }}
                                                    className="selected-vehicle-chip cursor-grab active:cursor-grabbing"
                                                    // The vehicle's base — a session one if somebody set
                                                    // it, else the curated color — or nothing: an unset
                                                    // variable falls back inside the rule rather than
                                                    // being decided here.
                                                    style={{ '--chip-accent': vehicleBases[vehicleId] || vehicle.color || undefined }}
                                                    title="Drag to reorder"
                                                >
                                                    <VehicleSwatch vehicle={vehicle} />
                                                    <span>{vehicle.name}</span>
                                                    <button
                                                        onClick={() => removeVehicleSelection(vehicleId)}
                                                        className="ml-1 hover:opacity-70 rounded-full w-4 h-4 flex items-center justify-center"
                                                        style={{fontSize: '12px'}}
                                                    >
                                                        &times;
                                                    </button>
                                                </div>
                                                {/* Drop indicator after the last pill */}
                                                {idx === selectedVehicles.length - 1 && dragOverIdx === selectedVehicles.length && (
                                                    <div className="w-0.5 h-6 bg-blue-500 rounded ml-1 shrink-0" />
                                                )}
                                            </div>
                                        );
                                    })}
                                    </div>
                                    {/* Not btn-warning. Orange is the single
                                      * "active / now" signal in this design and
                                      * nothing else is allowed to use it — that
                                      * is the only reason it answers "where am
                                      * I" from across the room. Clearing a
                                      * selection is neither active nor a
                                      * warning; it is an ordinary action. */}
                                    <button
                                        onClick={clearAllSelections}
                                        className="btn btn-secondary"
                                    >
                                        Clear all
                                    </button>
                                </>
                            )}
                        </div>
                        </div>
                    </div>}
                </nav>

                <main className="page-container py-6 flex-1 flex flex-col">
                    {view === 'vehicles' && (
                        <VehiclesView
                            vehicles={vehicles}
                            selectedVehicles={selectedVehicles}
                            onToggleSelection={toggleVehicleSelection}
                            onSelectAllVisible={(ids) =>
                                setVehicleSelection([...new Set([...selectedVehicles, ...ids])])
                            }
                            onClearAllVisible={(ids) =>
                                setVehicleSelection(selectedVehicles.filter(id => !ids.includes(id)))
                            }
                            onAdd={addVehicle}
                            onUpdate={updateVehicle}
                            onDelete={deleteVehicle}
                            onViewRuns={(v) => { setActiveVehicle(v); setRunsSubtab(DEFAULT_RUNS_SUBTAB); setFocusRunId(null); navigateTo('runs'); }}
                            onOpenTest={openTest}
                            canCreate={canCreate}
                            canEdit={canEdit}
                            canDelete={canDelete}
                            canPublish={canPublish}
                            onToggleVisibility={toggleVehicleVisibility}
                            tags={tags}
                            onCreateTag={createTag}
                            onSyncVehicleTags={syncVehicleTags}
                            onUploadVehicleImage={uploadVehicleImage}
                            onReorderVehicles={reorderVehicles}
                            onDuplicateVehicle={duplicateVehicle}
                            onCreateVariant={createVariant}
                            onUpdateVehicleSpecs={updateVehicleSpecs}
                            specCustomFieldSuggestions={specCustomFieldSuggestions}
                            pendingEditVehicle={pendingEditVehicle}
                            onClearPendingEdit={() => setPendingEditVehicle(null)}
                            savedState={vehiclesViewState}
                            onSaveState={setVehiclesViewState}
                            viewMode={vehiclesMode}
                            filters={vehicleFilters}
                            onFiltersChange={setVehicleFilters}
                        />
                    )}
                    {view === 'runs' && currentActiveVehicle && (
                        <RunsView
                            vehicle={currentActiveVehicle}
                            canCreate={canCreate}
                            canEdit={canEdit}
                            canDelete={canDelete}
                            canPublish={canPublish}
                            onAddRun={(run) => addRun(currentActiveVehicle.id, run)}
                            onUpdateRun={(runId, updates) => updateRun(currentActiveVehicle.id, runId, updates)}
                            onSetDefaultRun={(runId) => setDefaultRun(currentActiveVehicle.id, runId)}
                            onDeleteRun={(runId) => deleteRun(currentActiveVehicle.id, runId)}
                            onMergeRunData={(runId, pts, joinKey) => mergeRunData(currentActiveVehicle.id, runId, pts, joinKey)}
                            onReplaceRunData={(runId, pts) => replaceRunData(currentActiveVehicle.id, runId, pts)}
                            onDuplicateRun={(runId) => duplicateRun(currentActiveVehicle.id, runId)}
                            onViewChart={() => handleChartModeChange(DEFAULT_CHART_MODE)}
                            onToggleVehicleVisibility={toggleVehicleVisibility}
                            onUpdateVehicle={updateVehicle}
                            onDuplicateVehicle={async (id) => {
                                const newVehicle = await duplicateVehicle(id);
                                if (newVehicle) { setPendingEditVehicle(newVehicle); navigateTo('vehicles'); }
                            }}
                            onCreateVariant={async (id) => {
                                const variant = await createVariant(id);
                                if (variant) { setPendingEditVehicle(variant); navigateTo('vehicles'); }
                            }}
                            onDeleteVehicle={async (id) => { await deleteVehicle(id); navigateTo('vehicles'); }}
                            tags={tags}
                            onCreateTag={createTag}
                            onSyncVehicleTags={syncVehicleTags}
                            onUploadVehicleImage={(file) => uploadVehicleImage(currentActiveVehicle.id, file)}
                            onUpdateVehicleSpecs={updateVehicleSpecs}
                            specCustomFieldSuggestions={specCustomFieldSuggestions}
                            vehicles={vehicles}
                            onViewVehicle={(v) => setActiveVehicle(v)}
                            onBack={() => navigateTo('vehicles')}
                            onClose={closeVehicle}
                            onCopyRunToVehicle={(run, targetId) => copyRunToVehicle(currentActiveVehicle.id, run, targetId)}
                            subtab={runsSubtab}
                            onSubtabChange={setRunsSubtab}
                            focusRunId={focusRunId}
                            onFocused={clearFocusRun}
                        />
                    )}
                    {/* ChargingView is the fall-through: it renders for any mode NOT
                      * listed here, so every new chart mode must be added to this
                      * exclusion list or it silently renders the charging chart
                      * instead of itself. */}
                    {activeChartCategory && selectedVehicles.length > 0 && chartMode !== 'compare' && chartMode !== 'specs' && chartMode !== 'specstable' && chartMode !== 'specscatter' && chartMode !== 'roadtrip' && chartMode !== 'epacurves' && chartMode !== 'perfcompare' && chartMode !== 'perfcurve' && (
                        <ChargingView
                            vehicles={chartVehicles}
                            selectedVehicleIds={selectedVehicles}
                            chartConfig={chartConfig}
                            setChartConfig={setChartConfig}
                            chartMode={chartMode}
                            pairings={pairings}
                            setPairings={setPairings}
                        />
                    )}
                    {activeChartCategory && selectedVehicles.length > 0 && chartMode === 'roadtrip' && (
                        <RoadTripView
                            vehicles={chartVehicles}
                            selectedVehicleIds={selectedVehicles}
                            roadTripConfig={roadTripConfig}
                            setRoadTripConfig={setRoadTripConfig}
                            pairings={pairings}
                            setPairings={setPairings}
                            palette={chartConfig.seriesPalette ?? VEHICLE_PALETTE}
                            handSet={chartConfig.handSet ?? false}
                            verboseLabels={chartConfig.verboseLabels ?? false}
                            correctionMode={chartConfig.correctionMode ?? 'none'}
                            setChartConfig={setChartConfig}
                        />
                    )}
                    {activeChartCategory && selectedVehicles.length > 0 && chartMode === 'compare' && (
                        <ChargeCompareView
                            vehicles={chartVehicles}
                            selectedVehicleIds={selectedVehicles}
                            xMinutes={compareConfig.xMinutes}
                            mMiles={compareConfig.mMiles}
                            startSoc={compareConfig.startSoc}
                            setXMinutes={v => setCompareConfig(p => ({ ...p, xMinutes: v }))}
                            setMMiles={v => setCompareConfig(p => ({ ...p, mMiles: v }))}
                            setStartSoc={v => setCompareConfig(p => ({ ...p, startSoc: v }))}
                            pairings={pairings}
                            setPairings={setPairings}
                            verboseLabels={chartConfig.verboseLabels ?? false}
                            correctionMode={chartConfig.correctionMode ?? 'none'}
                            palette={chartConfig.seriesPalette ?? VEHICLE_PALETTE}
                            handSet={chartConfig.handSet ?? false}
                            testSpread={chartConfig.testSpread ?? true}
                            setChartConfig={setChartConfig}
                        />
                    )}
                    {activeChartCategory && selectedVehicles.length > 0 && (chartMode === 'specs' || chartMode === 'specscatter') && (
                        <SpecChartKind mode={chartMode} onChange={handleChartModeChange} />
                    )}
                    {activeChartCategory && selectedVehicles.length > 0 && chartMode === 'specs' && (
                        <SpecsChartView
                            vehicles={selectedVehicles.map(id => vehicles.find(v => v.id === id)).filter(Boolean)}
                            selectedField={chartConfig.specsField}
                            onFieldChange={field => setChartConfig(p => ({ ...p, specsField: field }))}
                        />
                    )}
                    {activeChartCategory && selectedVehicles.length > 0 && chartMode === 'specscatter' && (
                        <SpecsScatterView
                            vehicles={selectedVehicles.map(id => vehicles.find(v => v.id === id)).filter(Boolean)}
                            xField={chartConfig.scatterXField}
                            yField={chartConfig.scatterYField}
                            onFieldChange={(x, y) => setChartConfig(p => ({ ...p, scatterXField: x, scatterYField: y }))}
                        />
                    )}
                    {activeChartCategory && chartMode === 'epacurves' && (
                        <EpaCurvesView
                            vehicles={chartVehicles}
                            selectedVehicleIds={selectedVehicles}
                            epaConfig={epaConfig}
                            setEpaConfig={setEpaConfig}
                            palette={chartConfig.seriesPalette ?? VEHICLE_PALETTE}
                            handSet={chartConfig.handSet ?? false}
                            verboseLabels={chartConfig.verboseLabels ?? false}
                            correctionMode={chartConfig.correctionMode ?? 'none'}
                            setChartConfig={setChartConfig}
                        />
                    )}
                    {activeChartCategory && selectedVehicles.length > 0 && chartMode === 'perfcompare' && (
                        <PerformanceCompareView
                            vehicles={vehicles}
                            selectedVehicleIds={selectedVehicles}
                        />
                    )}
                    {activeChartCategory && selectedVehicles.length > 0 && chartMode === 'perfcurve' && (
                        <PerformanceCurveView
                            vehicles={vehicles}
                            selectedVehicleIds={selectedVehicles}
                        />
                    )}
                    {/* No selection gate: the vehicle table is where a selection is
                        made, over the whole fleet (#315). */}
                    {activeChartCategory && chartMode === 'specstable' && (
                        <VehicleTable onOpenTest={openTest} filters={vehicleFilters} onFiltersChange={setVehicleFilters} />
                    )}
                    {view === 'epa' && <EpaSection subtab={epaSubtab} onExplorerState={setEpaExplorer} />}
                    {view === 'reference' && (
                        <ReferenceSection
                            subtab={referenceSubtab}
                            platformId={referencePlatformId}
                            topic={referenceTopic}
                            onBackToPlatforms={() => openReference('platforms')}
                            onBackToExplainers={() => openReference('explainers')}
                        />
                    )}

                    {/* The playground, ungated and unlinked.
                      *
                      * Reachable by anyone who types `?tab=playground`, and by
                      * nothing else — no nav entry points at it. That is safe
                      * only because the page is INERT: it renders specimens of
                      * classes and reads computed styles, and touches no
                      * vehicle, no run and no request. `playground.test.js`
                      * asserts that rather than trusting it, because the day a
                      * specimen gains a real action is the day obscurity stops
                      * being enough.
                      *
                      * Ungated because the thing it is FOR — judging spacing,
                      * contrast and focus states — happens wherever the site is
                      * actually rendering, including a phone and the deployed
                      * build. Gating it to admins would put it behind a sign-in
                      * the local preview does not have, which is exactly where
                      * it is most useful. Admins also get it as a linked tab
                      * under Admin > Playground. */}
                    {view === 'playground' && (
                        <div className="card">
                            <h2 className="page-title">Playground</h2>
                            <p className="text-note mb-4">
                                Every catalogued control, live. Unlinked — reached by URL, or via Admin &gt; Playground.
                            </p>
                            <Playground />
                        </div>
                    )}

                    {view === 'admin' && isAdmin && (
                        <AdminView
                            getUsersForAdmin={getUsersForAdmin}
                            setUserRole={setUserRole}
                            currentUserId={user?.id}
                            subtab={adminSubtab}
                            onSubtabChange={setAdminSubtab}
                        />
                    )}
                </main>

                {/* Footer, and the ~100px of clear space below it.
                    Every bottom-anchored panel here — the delete/undo bar, the
                    reorder bar, the notification banner — is fixed to the
                    viewport, so it lands on top of whatever the page ends with.
                    Individual views padded themselves only while their own bar
                    was showing; the notification banner belongs to no view and
                    covered actionable controls with nothing to be done but
                    dismiss it. Reserving the space site-wide costs one screen of
                    scroll and means nothing actionable is ever underneath. */}
                <footer className="site-footer">
                    <p>EVBench — real-world EV charging and range comparisons.</p>
                    <p>
                        © {new Date().getFullYear()} · Test data belongs to the testers credited on each run.
                    </p>
                </footer>
            </div>

            {/* ── Global notification banner ──────────────────────────────── */}
            {appNotification && (
                <div className={`fixed-action-bar z-[60] ${appNotification.type === 'error' ? 'is-danger' : 'is-good'}`}>
                    <div className="page-container py-3 flex items-center gap-4">
                        <span className="text-xl">{appNotification.type === 'error' ? '⚠️' : '✓'}</span>
                        <p className={`flex-1 text-sm font-medium ${
                            appNotification.type === 'error' ? 'text-red-900' : 'text-green-900'
                        }`}>
                            {appNotification.message}
                        </p>
                        <button
                            onClick={clearNotification}
                            className={`text-lg leading-none opacity-50 hover:opacity-100 transition ${
                                appNotification.type === 'error' ? 'text-red-900' : 'text-green-900'
                            }`}
                            aria-label="Dismiss"
                        >×</button>
                    </div>
                </div>
            )}
        </VehicleBaseContext.Provider>
        </NavigationContext.Provider>
        </ScaleSyncContext.Provider>
    );
}

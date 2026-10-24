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
import { DEFAULT_READER_MODE } from './utils/correctionSettings';
import { defaultChartConfig, defaultCompareConfig, defaultRoadTripConfig, defaultEpaConfig } from './utils/chartDefaults';
import { chartStateOf, resetStateOf, chartParamsFromSearch, defaultChartTitle, explicitChartParams } from './utils/featuredComparisons';
import { useFeaturedComparisons } from './hooks/useFeaturedComparisons';
import { useSiteEvents } from './hooks/useSiteEvents';
import { SITE_EVENTS } from './utils/siteEvents';
import { FeaturedComparisonsContext } from './context/FeaturedComparisonsContext';
import HomeView from './components/home/HomeView';
import FeaturedComparisonEditor from './components/home/FeaturedComparisonEditor';
import { parseChartUrl, buildChartParams, chartConfigFromParsed, vehicleIdsOfLink } from './utils/chartUrlState';
import SpecsChartView from './components/SpecsChartView';
import SpecsScatterView from './components/SpecsScatterView';
import EpaCurvesView from './components/EpaCurvesView';
import PerformanceCompareView from './components/PerformanceCompareView';
import PerformanceCurveView from './components/PerformanceCurveView';
import AdminView, { ADMIN_SUBTAB_IDS, DEFAULT_ADMIN_SUBTAB } from './components/AdminView';
import Playground from './components/playground/Playground';
import { explorerStateFromUrl } from './components/epa/curves/EpaCurveExplorer';
import EpaSection, { EPA_SUBTABS, DEFAULT_EPA_SUBTAB, epaSubtabFromParam } from './components/epa/EpaSection';
import { DEFAULT_CHART_MODE, ALL_CHART_MODES, TOP_CHART_CATEGORIES, categoryForMode, categoryByKey, isChartCategory, entryModeFor, labelForMode, navTabFor, chartModesUnder, navItemForMode } from './constants/chartNav';
import SpecChartKind from './components/SpecChartKind';
import { NavigationContext } from './context/NavigationContext';
import { platformHref } from './utils/platforms';
import { decodeVehicleFilters, encodeVehicleFilters, EMPTY_VEHICLE_FILTERS } from './utils/vehicleFilters';
import ReferenceSection, { REFERENCE_SUBTABS, DEFAULT_REFERENCE_SUBTAB, referenceSubtabFromParam } from './components/reference/ReferenceSection';
import { prunePairings } from './utils/pairings';
import { isEpaPartnerId } from './utils/rangeSource';
import { applyVehicleBases, withVehicleBase, NO_VEHICLE_BASES } from './utils/vehicleBase';
import { VehicleBaseContext } from './context/VehicleBaseContext';
import VehicleSwatch from './components/VehicleSwatch';
import VehicleQuickAdd from './components/VehicleQuickAdd';
import SelectionEmptyState from './components/SelectionEmptyState';
import { useStackedStripActions } from './hooks/useStackedStripActions';
import { buildVehicleLabels } from './utils/seriesLabel';

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
    { key: 'lineage', label: 'Lineage', group: 'Summary' },
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
const SELECTION_INERT_VIEWS = new Set(['home', 'runs', 'epa', 'reference', 'admin', 'playground']);

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
    // Home is where a bare address lands (#448): a first-time visitor meets the
    // featured comparison, not the full vehicle grid. Every other tab is reached
    // by its own ?tab=, which the mount parse below turns into a view; a tab name
    // it does not know stays here.
    const [view, setView] = useState('home');
    // Which Runs-tab sub-tab is showing (Charging & Range / Inherited /
    // Performance / EPA). Lifted out of RunsView so it can be persisted in the
    // URL the same way activeVehicle is.
    const [runsSubtab, setRunsSubtab] = useState(DEFAULT_RUNS_SUBTAB);
    // The test a link pointed at (?tab=runs&run=…), which Tests & Data scrolls
    // to and marks once, then hands back. Only a link sets it.
    const [focusRunId, setFocusRunId] = useState(null);
    // Whether that link also opens the test's edit form (&edit=1, from Admin →
    // Data Checks), so a finding is one click from the field that settles it.
    const [focusRunEdit, setFocusRunEdit] = useState(false);
    // Stable, because Tests & Data's landing effect depends on it: a new
    // function each render would re-scroll and restart its timer every time.
    const clearFocusRun = useCallback(() => { setFocusRunId(null); setFocusRunEdit(false); }, []);
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
    const stripRowRef = useRef(null);
    const chipScrollRef = useRef(null);
    const stripActionsRef = useRef(null);
    const [chartMode, setChartMode] = useState('charging'); // 'charging' | 'range' | 'compare' | 'epacurves' | …
    const [compareConfig, setCompareConfig] = useState(defaultCompareConfig);
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
    const [epaConfig, setEpaConfig] = useState(defaultEpaConfig);
    const [roadTripConfig, setRoadTripConfig] = useState(defaultRoadTripConfig);
    const [chartConfig, setChartConfig] = useState(defaultChartConfig);
    // The vehicles as the charts should draw them: a session base replaces the
    // vehicle's color on the copy, so every chart, sidebar accent and swatch
    // that reads `vehicle.color` follows without knowing a second layer exists.
    const vehicleBases = chartConfig.vehicleBases ?? NO_VEHICLE_BASES;
    // The selected chips' names: the curated name, widened only where two
    // selected vehicles would otherwise read the same.
    const chipNames = useMemo(
        () => buildVehicleLabels(selectedVehicles.map(id => vehicles.find(v => v.id === id))),
        [selectedVehicles, vehicles]);
    // Keyed on the chips' names, so a name that widens re-measures too.
    const stackStripActions = useStackedStripActions(stripRowRef, chipScrollRef, stripActionsRef, chipNames);
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
    // ?tab=vehicles&sub=list|lineage; Cards is the default and writes no `sub`.
    const [vehiclesMode, setVehiclesMode] = useState(() => {
        const p = new URLSearchParams(window.location.search);
        const sub = p.get('tab') === 'vehicles' ? p.get('sub') : null;
        return VEHICLES_STRIP_ITEMS.find((i) => i.key === sub)?.key ?? 'card';
    });
    // Vehicles & Specs' filters (#338): one set for Cards, List and Table, so
    // switching views never changes which vehicles show. Read from the link
    // the page opened on (vehicleFilters.js reads the table's old vt_ ones too).
    const [vehicleFilters, setVehicleFilters] = useState(() => decodeVehicleFilters(window.location.search));
    // Reference's sub-tab (#338): Explainers or Platforms.
    const [referenceSubtab, setReferenceSubtab] = useState(DEFAULT_REFERENCE_SUBTAB);
    // The platform whose page is showing under Reference › Platforms (#354), or null for the list.
    const [referencePlatformId, setReferencePlatformId] = useState(null);
    // The explainer showing under Reference › Explainers (#355), by slug, or null for the list.
    const [referenceTopic, setReferenceTopic] = useState(null);
    // Home (#448): the featured comparison named by ?fc=, or null for the newest
    // listed; and the editor request (a chart to save, or a comparison to edit).
    const [homeSlug, setHomeSlug] = useState(null);
    const [featuredEditor, setFeaturedEditor] = useState(null);

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
        const mode = entryModeFor(category, lastModeByCategory.current[categoryKey]);
        if (mode) handleChartModeChange(mode);
    };

    const { isPopout, sendState } = useChartSync({
        chartMode, chartConfig, selectedVehicles, compareConfig, roadTripConfig, epaConfig, pairings, epaExplorer, viewScale,
        setChartMode, setChartConfig, setVehicleSelection, setCompareConfig, setRoadTripConfig, setEpaConfig, setPairings, setEpaExplorer, setViewScale,
    });

    // The featured comparisons (#448), loaded once here so Home and the editor
    // share one list. The pop-out has no Home and loads nothing.
    // A chart tab or mode opened, however the reader got there (#448). One event
    // per change of tab or mode; a curator's own and the pop-out's are skipped.
    const recordEvent = useSiteEvents();
    useEffect(() => {
        if (loading || !isChartCategory(view)) return;
        recordEvent(SITE_EVENTS.CHART_VIEW, { detail: { mode: chartMode } });
    }, [loading, view, chartMode, recordEvent]);

    const featured = useFeaturedComparisons({ enabled: !isPopout });
    const canCurate = isContributor;

    /** The chart on screen, as the address now states it, into the editor. */
    const featureThisChart = () => {
        const params = chartParamsFromSearch(window.location.search);
        if (!params) return;
        setFeaturedEditor({ add: { title: defaultChartTitle(chartMode), params }, vehicleIds: selectedVehicles });
    };

    const featuredContext = {
        comparisons: featured.comparisons, loading: featured.loading, error: featured.error,
        canCurate, canDelete: isAdmin,
        openEditor: setFeaturedEditor,
        featureThisChart: isPopout || !canCurate ? null : featureThisChart,
    };

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
        setFocusRunEdit(!!ref.edit);
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
        if (mode && categoryForMode(mode).modes.some(m => m.key === mode)) {
            handleChartModeChange(mode);
            return;
        }
        navigateTo(tab);
    };

    /**
     * Put one chart of a featured comparison on screen (#448): its vehicles, and
     * its saved settings laid over a clean slate, so the previous chart's tweaks
     * do not leak in. A history entry, so Back returns to Home. From here the
     * reader's changes are theirs; Home's reset puts the comparison back.
     *
     * Replacing a selection of two or more is the caller's to warn about
     * (featuredComparisons.replacesSelection) — this does what it is told.
     */
    const openFeaturedChart = useCallback((comparison, index) => {
        const state = chartStateOf(comparison, index, vehicles);
        if (!state) return;
        // The vehicle table reads its columns, sort and prices from the address when
        // it opens, so for it the saved link goes in whole; every other chart gets
        // its settings as state and a bare address that the URL sync completes.
        // The Vehicles & Specs filters are the reader's: a table opens unfiltered.
        const isTable = state.chartMode === 'specstable';
        history.pushState(
            { view: state.view, chartMode: state.chartMode },
            '',
            isTable ? `?${explicitChartParams(comparison.charts[index].params)}` : `?tab=${state.view}&m=${state.chartMode}`,
        );
        if (isTable) setVehicleFilters(EMPTY_VEHICLE_FILTERS);
        lastModeByCategory.current[state.view] = state.chartMode;
        const parentTab = categoryForMode(state.chartMode).navParent;
        if (parentTab) lastModeUnderTab.current[parentTab] = state.chartMode;
        setVehicleSelection(state.vehicleIds);
        setChartMode(state.chartMode);
        setChartConfig(state.chartConfig);
        setCompareConfig(state.compareConfig);
        setRoadTripConfig(state.roadTripConfig);
        setEpaConfig(state.epaConfig);
        setPairings(state.pairings);
        setView(state.view);
        window.scrollTo(0, 0);
    }, [vehicles, setVehicleSelection, setVehicleFilters]);

    /**
     * Put the site back to a featured comparison: its vehicles and its
     * correction, every other setting at a fresh visitor's. Stays where it is.
     */
    const resetToComparison = useCallback((comparison) => {
        const state = resetStateOf(comparison, vehicles);
        setVehicleSelection(state.vehicleIds);
        setChartConfig(state.chartConfig);
        setCompareConfig(state.compareConfig);
        setRoadTripConfig(state.roadTripConfig);
        setEpaConfig(state.epaConfig);
        setPairings(state.pairings);
    }, [vehicles, setVehicleSelection]);

    /**
     * A platform's page, from anywhere a platform is named (#354). A history
     * entry, so Back returns to the card, table or View Specs it came from.
     */
    const openPlatform = (id) => {
        // Named, not the default: a bare ?tab=reference is Explainers (#444).
        history.pushState({ view: 'reference', subtab: 'platforms', platformId: String(id) }, '', platformHref(id));
        setReferenceSubtab('platforms');
        setReferencePlatformId(String(id));
        setView('reference');
        window.scrollTo(0, 0);
    };

    /** A Reference sub-tab's top level (the platform list, or Explainers), or one explainer. */
    const openReference = (subtab, topic = null) => {
        // Only the default is left out of the URL (Platforms is written as
        // sub=platforms), and the topic rides on whichever sub-tab holds it.
        const topicPart = subtab === 'explainers' && topic ? `&topic=${encodeURIComponent(topic)}` : '';
        const url = `?tab=reference${subtab === DEFAULT_REFERENCE_SUBTAB ? '' : `&sub=${subtab}`}${topicPart}`;
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
     * A vehicle's Tests & Data (its page), optionally at a sub-tab — from a
     * card's button, a test-count pill, or a selected-vehicle chip.
     */
    const viewVehicleRuns = (v, sub) => {
        setActiveVehicle(v);
        setRunsSubtab(RUNS_SUBTAB_IDS.includes(sub) ? sub : DEFAULT_RUNS_SUBTAB);
        setFocusRunId(null);
        navigateTo('runs');
    };

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
    const pendingRunsEdit = useRef(false);
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
            pendingRunsEdit.current = p.get('edit') === '1';
            return;
        }
        // Unlinked, but a real route: nothing here needs a role or a selection
        // resolved first, because the page reads no data at all.
        if (tab === 'playground') {
            setView('playground');
            return;
        }
        if (tab === 'home') {
            setHomeSlug(p.get('fc') || null);
            setView('home');
            return;
        }
        // Vehicles & Specs is no longer the default, so a link to it must say so.
        // Its sub-nav and filters read their own state from the address.
        if (tab === 'vehicles') {
            setView('vehicles');
            return;
        }
        if (tab === 'reference') {
            const pid = p.get('pid') || null;
            setReferenceSubtab(referenceSubtabFromParam(p.get('sub'), pid));
            setReferencePlatformId(pid);
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
        // One parse for the whole query (utils/chartUrlState.js). The main chart's
        // state waits for the data to load; the per-mode configs apply now.
        const parsed = parseChartUrl(window.location.search);
        pendingUrlState.current = parsed.chart;
        if (parsed.compare)  setCompareConfig(prev => ({ ...prev, ...parsed.compare }));
        if (parsed.pairings) setPairings(parsed.pairings);
        if (parsed.roadTrip) setRoadTripConfig(prev => ({ ...prev, ...parsed.roadTrip }));
        if (parsed.epa)      setEpaConfig(prev => ({ ...prev, ...parsed.epa }));
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
                setReferenceSubtab(referenceSubtabFromParam(e.state.subtab, e.state.platformId));
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

        // Vehicles from the plotted tests as well as v= (v= carries only those
        // with no plotted test).
        const vehicleIds = vehicleIdsOfLink(s, vehicles);
        if (vehicleIds.length > 0) setVehicleSelection(vehicleIds);
        if (s.chartMode) setChartMode(s.chartMode);

        setChartConfig(prev => chartConfigFromParsed(s, prev));
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
        const editRun = pendingRunsEdit.current;
        pendingRunsEdit.current = false;
        const v = vehicles.find(v => v.id === id);
        if (v) {
            setActiveVehicle(v);
            setView('runs');
            if (RUNS_SUBTAB_IDS.includes(sub)) setRunsSubtab(sub);
            if (runId) { setFocusRunId(runId); setFocusRunEdit(editRun); }
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
        const p = buildChartParams({
            view, chartMode, chartConfig, selectedVehicles, vehicles,
            compareConfig, roadTripConfig, epaConfig, pairings,
            vehicleFilters, currentSearch: window.location.search,
        });
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

    // ── Keep URL in sync while on Home (#448) ───────────────────────────────
    // The tab, and fc= when a particular comparison was asked for.
    useEffect(() => {
        if (isPopout || view !== 'home' || loading) return;
        const p = new URLSearchParams({ tab: 'home' });
        if (homeSlug) p.set('fc', homeSlug);
        history.replaceState({ view: 'home' }, '', '?' + p.toString());
    }, [isPopout, view, loading, homeSlug]);

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
        if (vehiclesMode !== 'card') p.set('sub', vehiclesMode);
        for (const [k, v] of encodeVehicleFilters(vehicleFilters)) p.set(k, v);
        history.replaceState({ view: 'vehicles', chartMode }, '', '?' + p.toString());
    // chartMode rides in the history state only; it does not decide the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isPopout, view, vehicleFilters, vehiclesMode]);

    // ── Keep URL in sync while on the Reference tab (#338) ──────────────────
    useEffect(() => {
        if (isPopout) return;
        if (view !== 'reference') return;
        const p = new URLSearchParams();
        p.set('tab', 'reference');
        // A platform's page is ?pid= alone (the parser reads it as Platforms);
        // the list is sub=platforms, since a bare ?tab=reference is Explainers (#444).
        if (referenceSubtab === 'platforms' && referencePlatformId != null) p.set('pid', referencePlatformId);
        else if (referenceSubtab !== DEFAULT_REFERENCE_SUBTAB) p.set('sub', referenceSubtab);
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
            // A sub-tab opens its own top level: Platforms is the list, Explainers the index.
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
        <NavigationContext.Provider value={{ openPlatform, openExplainer, openFeaturedChart, resetToComparison }}>
        <FeaturedComparisonsContext.Provider value={featuredContext}>
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
                                ...chartModesUnder(parentStrip.tab),
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
                            items={activeChartCategory?.modes ?? []}
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
                          * and Clear sit outside the scroller so the way
                          * out of a large selection never scrolls away. */}
                        <div className="selected-strip-row" ref={stripRowRef}>
                            <span className="text-micro">Selected</span>
                            {selectedVehicles.length === 0 ? (
                                <span className="text-meta">None</span>
                            ) : (
                                    <div className="selected-chip-scroll" ref={chipScrollRef}>
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
                                                    {/* The name goes to the vehicle's Tests & Data. A
                                                        button inside a draggable chip still lets the chip drag. */}
                                                    <button
                                                        type="button"
                                                        onClick={() => viewVehicleRuns(vehicle)}
                                                        className="selected-vehicle-chip-name"
                                                        title={`View ${chipNames.get(vehicle.id)?.full ?? vehicle.name} tests & data`}
                                                    >
                                                        {chipNames.get(vehicle.id)?.short ?? vehicle.name}
                                                    </button>
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
                            )}
                            {/* Clear and ＋ Add: side by side while the
                              * chips fit on one line, stacked once they wrap
                              * (useStackedStripActions). ＋ Add is LAST, so the
                              * first chip's Clear appears beside it rather
                              * than moving it. */}
                            <div
                                ref={stripActionsRef}
                                className={`selected-strip-actions${stackStripActions ? ' is-stacked' : ''}`}
                            >
                                {/* Not btn-warning. Orange is the single
                                  * "active / now" signal in this design and
                                  * nothing else is allowed to use it — that
                                  * is the only reason it answers "where am
                                  * I" from across the room. Clearing a
                                  * selection is neither active nor a
                                  * warning; it is an ordinary action. */}
                                {selectedVehicles.length > 0 && (
                                    <button
                                        onClick={clearAllSelections}
                                        className="btn btn-secondary"
                                        title="Clear the selection"
                                    >
                                        {/* ⌧ is the ISO "clear" key: all of it,
                                          * where ⌫ would read as one entry. */}
                                        <span className="btn-symbol" aria-hidden="true">⌧</span>
                                        Clear
                                    </button>
                                )}
                                <VehicleQuickAdd
                                    vehicles={chartVehicles}
                                    selectedIds={selectedVehicles}
                                    onToggle={toggleVehicleSelection}
                                />
                            </div>
                        </div>
                        </div>
                    </div>}
                </nav>

                <main className="page-container py-6 flex-1 flex flex-col">
                    {view === 'home' && <HomeView slug={homeSlug} onSlugChange={setHomeSlug} />}
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
                            onViewRuns={viewVehicleRuns}
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
                            editOnFocus={focusRunEdit}
                            onFocused={clearFocusRun}
                        />
                    )}
                    {/* Every chart but the vehicle table plots the selection.
                      * With none, it says so and points at ＋ Add rather than
                      * being unreachable; the views below draw only once
                      * there is something to plot. */}
                    {activeChartCategory && chartMode !== 'specstable' && selectedVehicles.length === 0 && (
                        <SelectionEmptyState chart={labelForMode(chartMode)} />
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
                            correctionMode={chartConfig.correctionMode ?? DEFAULT_READER_MODE}
                            correctionTarget={chartConfig.correctionTarget}
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
                            orientation={compareConfig.orientation}
                            setOrientation={o => setCompareConfig(p => ({ ...p, orientation: o }))}
                            selectedKeys={compareConfig.selected}
                            onSelectedChange={keys => setCompareConfig(p => ({ ...p, selected: keys }))}
                            pairings={pairings}
                            setPairings={setPairings}
                            verboseLabels={chartConfig.verboseLabels ?? false}
                            correctionMode={chartConfig.correctionMode ?? DEFAULT_READER_MODE}
                            correctionTarget={chartConfig.correctionTarget}
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
                    {activeChartCategory && selectedVehicles.length > 0 && chartMode === 'epacurves' && (
                        <EpaCurvesView
                            vehicles={chartVehicles}
                            selectedVehicleIds={selectedVehicles}
                            epaConfig={epaConfig}
                            setEpaConfig={setEpaConfig}
                            palette={chartConfig.seriesPalette ?? VEHICLE_PALETTE}
                            handSet={chartConfig.handSet ?? false}
                            verboseLabels={chartConfig.verboseLabels ?? false}
                            correctionMode={chartConfig.correctionMode ?? DEFAULT_READER_MODE}
                            correctionTarget={chartConfig.correctionTarget}
                            setChartConfig={setChartConfig}
                        />
                    )}
                    {activeChartCategory && selectedVehicles.length > 0 && chartMode === 'perfcompare' && (
                        <PerformanceCompareView
                            vehicles={chartVehicles}
                            selectedVehicleIds={selectedVehicles}
                        />
                    )}
                    {activeChartCategory && selectedVehicles.length > 0 && chartMode === 'perfcurve' && (
                        <PerformanceCurveView
                            vehicles={chartVehicles}
                            selectedVehicleIds={selectedVehicles}
                        />
                    )}
                    {/* No selection gate: the vehicle table is where a selection is
                        made, over the whole fleet (#315). */}
                    {activeChartCategory && chartMode === 'specstable' && (
                        <VehicleTable onOpenTest={openTest} onViewRuns={viewVehicleRuns} filters={vehicleFilters} onFiltersChange={setVehicleFilters}
                            correctionTarget={chartConfig.correctionTarget}
                            correctionMode={chartConfig.correctionMode ?? DEFAULT_READER_MODE}
                            onCorrectionTargetChange={t => setChartConfig(prev => ({ ...prev, correctionTarget: t }))}
                        />
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

                {featuredEditor && (
                    <FeaturedComparisonEditor
                        request={featuredEditor}
                        comparisons={featured.comparisons}
                        vehicles={vehicles}
                        canDelete={isAdmin}
                        onSave={(c) => (c.id == null ? featured.create(c) : featured.save(c))}
                        onDelete={featured.remove}
                        onClose={() => setFeaturedEditor(null)}
                    />
                )}

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
        </FeaturedComparisonsContext.Provider>
        </NavigationContext.Provider>
        </ScaleSyncContext.Provider>
    );
}

import { useState, useRef, useEffect, useCallback } from 'react';
import { useAppContext } from './context/AppContext';
import AuthModal from './components/AuthModal';
import ImportTableauModal from './components/ImportTableauModal';
import VehiclesView from './components/VehiclesView';
import RunsView from './components/RunsView';
import ChargingView from './components/ChargingView';
import SpecsView from './components/SpecsView';
import AdminView from './components/AdminView';

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
        headerImageUrl,
        uploadHeaderImage,
        toggleVehicleSelection,
        removeVehicleSelection,
        clearAllSelections,
        setVehicleSelection,
        addVehicle,
        updateVehicle,
        reorderVehicles,
        duplicateVehicle,
        deleteVehicle,
        duplicateRun,
        addRun,
        updateRun,
        setDefaultRun,
        updateRunColor,
        deleteRun,
        tags,
        createTag,
        syncVehicleTags,
        uploadVehicleImage,
        toggleVehicleVisibility,
        replaceRunData,
        mergeRunData,
        exportData,
        importData,
        importTableauSessions,
        getUsersForAdmin,
        setUserRole,
        signOut,
        initializeApp,
        appNotification,
        clearNotification,
        updateVehicleSpecs,
        specCustomFieldSuggestions,
    } = useAppContext();

    // Auto-dismiss notifications after 6 s
    useEffect(() => {
        if (!appNotification) return;
        const t = setTimeout(clearNotification, 6000);
        return () => clearTimeout(t);
    }, [appNotification, clearNotification]);

    const [activeVehicle, setActiveVehicle] = useState(null);
    const [view, setView] = useState('vehicles');
    const [chartMode, setChartMode] = useState('charging'); // 'charging' | 'range'
    const [chartConfig, setChartConfig] = useState({
        xAxis: 'soc',
        yAxis: 'chargeRate',
        y2Axis: null,
        selectedRuns: [],
        raceMode: false,
        raceThreshold: 10,  // % SoC at which all runs are normalised to t = 0
        xMin: null,
        xMax: null,
        yMin: 0,
        yMax: null,
        y2Min: null,
        y2Max: null,
        showLine:   true,
        showPoints: false,
    });
    const handleChartModeChange = (newMode) => {
        // Push a history entry so "back" can return to the previous chart mode.
        history.pushState(
            { view: 'chart', chartMode: newMode },
            '',
            `?tab=chart&m=${newMode}`,   // URL sync effect will replaceState with full params
        );
        setChartMode(newMode);
        setChartConfig(prev => ({ ...prev, selectedRuns: [] }));
    };

    // Navigate to a new top-level view and push a browser history entry so the
    // back button works within the app instead of exiting to the auth page.
    const navigateTo = useCallback((newView) => {
        const url = newView === 'chart'
            ? (window.location.search.includes('tab=chart') ? window.location.search : '?tab=chart')
            : `?tab=${newView}`;
        history.pushState({ view: newView, chartMode }, '', url);
        setView(newView);
    }, [chartMode]);

    const [showAuthModal, setShowAuthModal] = useState(false);
    const [showImportMenu, setShowImportMenu] = useState(false);
    const [showTableauModal, setShowTableauModal] = useState(false);
    const jsonImportRef = useRef();
    const pendingUrlState = useRef(null);
    const urlApplied = useRef(false);

    // ── Parse URL on mount ──────────────────────────────────────────────────
    useEffect(() => {
        const p = new URLSearchParams(window.location.search);
        if (p.get('tab') !== 'chart') return;
        pendingUrlState.current = {
            vehicleIds:    (p.get('v')?.split(',').filter(Boolean) || []).map(id => isNaN(Number(id)) ? id : Number(id)),
            runIds:        (p.get('r')?.split(',').filter(Boolean) || []).map(id => isNaN(Number(id)) ? id : Number(id)),
            xAxis:         p.get('x')  || null,
            yAxis:         p.get('y')  || null,
            y2Axis:        p.get('y2') || null,
            raceMode:      p.get('race') === '1',
            raceThreshold: p.get('rt')  ? Number(p.get('rt'))  : 10,
            xMin:  p.get('xn')  !== null && p.get('xn')  !== '' ? Number(p.get('xn'))  : null,
            xMax:  p.get('xx')  !== null && p.get('xx')  !== '' ? Number(p.get('xx'))  : null,
            yMin:  p.get('yn')  !== null && p.get('yn')  !== '' ? Number(p.get('yn'))  : 0,
            yMax:  p.get('yx')  !== null && p.get('yx')  !== '' ? Number(p.get('yx'))  : null,
            y2Min: p.get('y2n') !== null && p.get('y2n') !== '' ? Number(p.get('y2n')) : null,
            y2Max: p.get('y2x') !== null && p.get('y2x') !== '' ? Number(p.get('y2x')) : null,
            showLine:   p.get('line') !== '0', // default to true if not present, false if explicitly set to 0
            showPoints: p.get('pts') === '1', // default to false if not present, true if explicitly set to 1
            chartMode: p.get('m') || 'charging',
        };
    }, []);

    // ── Handle browser back/forward ─────────────────────────────────────────
    useEffect(() => {
        const onPopState = (e) => {
            // Only act on history entries we created (they carry a state object).
            // If state is null the user has navigated outside our app — let the
            // browser handle it naturally.
            if (!e.state?.view) return;
            setView(e.state.view);
            // Restore chart mode without clearing runs — auto-select re-initialises
            // them for the restored mode automatically.
            if (e.state.chartMode) setChartMode(e.state.chartMode);
        };
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, []); // setState setters are stable — no deps needed

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
            raceMode:      s.raceMode,
            raceThreshold: s.raceThreshold,
            xMin:          s.xMin,
            xMax:          s.xMax,
            yMin:          s.yMin,
            yMax:          s.yMax,
            y2Min:         s.y2Min ?? null,
            y2Max:         s.y2Max ?? null,
            showLine:   s.showLine ?? true, // default to true if not present, false if explicitly set to 0
            showPoints: s.showPoints ?? false, // default to false if not present, true if explicitly set to 1
        }));
        setView('chart');
    }, [loading]);

    // ── Keep URL in sync while on chart tab ─────────────────────────────────
    useEffect(() => {
        if (view !== 'chart') return;
        const p = new URLSearchParams();
        p.set('tab', 'chart');
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
        if (chartConfig.raceMode)                 p.set('race', '1');
        if (chartConfig.raceThreshold !== 10)     p.set('rt',   String(chartConfig.raceThreshold));
        if (chartConfig.xMin != null)             p.set('xn',   String(chartConfig.xMin));
        if (chartConfig.xMax != null)             p.set('xx',   String(chartConfig.xMax));
        if (chartConfig.yMin != null && chartConfig.yMin !== 0) p.set('yn', String(chartConfig.yMin));
        if (chartConfig.yMax != null)             p.set('yx',   String(chartConfig.yMax));
        if (chartConfig.y2Min != null)            p.set('y2n',  String(chartConfig.y2Min));
        if (chartConfig.y2Max != null)            p.set('y2x',  String(chartConfig.y2Max));
        if (chartConfig.showLine === false)       p.set('line',   '0'); // default to true if not present, false if explicitly set to 0
        if (chartConfig.showPoints)               p.set('pts',    '1'); 
        if (chartMode !== 'charging')             p.set('m', chartMode);
        history.replaceState({ view: 'chart', chartMode }, '', '?' + p.toString());
    }, [view, chartConfig, selectedVehicles, chartMode, vehicles]);

    // Keep activeVehicle in sync with vehicles state
    const currentActiveVehicle = activeVehicle
        ? vehicles.find(v => v.id === activeVehicle.id) || activeVehicle
        : null;

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="text-center">
                    <div className="text-6xl mb-4">&#9889;</div>
                    <div className="text-2xl font-semibold text-gray-700">Loading EV Data...</div>
                </div>
            </div>
        );
    }

    return (
        <>
            {showAuthModal && (
                <AuthModal
                    onClose={() => setShowAuthModal(false)}
                    onAuthSuccess={() => {
                        setShowAuthModal(false);
                        initializeApp();
                    }}
                />
            )}
            {showTableauModal && (
                <ImportTableauModal
                    vehicles={vehicles}
                    onImport={importTableauSessions}
                    onClose={() => setShowTableauModal(false)}
                />
            )}
            <div className="min-h-screen">
                {/* ── Header ── */}
                <header className="relative text-white shadow-lg overflow-hidden">
                    {/* Full-width base colour — always fills edge to edge */}
                    <div className="absolute inset-0" style={{ backgroundColor: 'var(--color-primary)' }} />
                    {/* Image + overlay are both capped to page width (max-w-7xl) so on very
                        wide monitors the image stays aligned with the content column and more
                        of it is visible rather than being stretched thin across the viewport */}
                    {headerImageUrl && (
                        <div className="absolute inset-0 flex justify-center">
                            <div className="relative w-full max-w-7xl h-full flex-shrink-0">
                                <div
                                    className="absolute inset-0"
                                    style={{ backgroundImage: `url(${headerImageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
                                />
                                <div className="absolute inset-0" style={{ backgroundColor: 'rgba(29,78,216,0.72)' }} />
                            </div>
                        </div>
                    )}
                    <div className="relative page-container py-6">
                        {/* Clickable title → home */}
                        <button
                            onClick={() => navigateTo('vehicles')}
                            className="text-left group"
                        >
                            <h1 className="text-3xl font-bold group-hover:underline decoration-white/60">EV Data Visualization</h1>
                        </button>
                        <p className="mt-1" style={{color: 'rgba(255,255,255,0.8)'}}>Compare and analyze electric vehicle performance data</p>

                        {/* Admin-only: change header image */}
                        {isAdmin && (
                            <label className="absolute top-3 right-6 cursor-pointer flex items-center gap-1 text-xs text-white/60 hover:text-white/90 transition">
                                📷 Change header image
                                <input
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={(e) => { e.target.files[0] && uploadHeaderImage(e.target.files[0]); e.target.value = ''; }}
                                />
                            </label>
                        )}
                    </div>
                </header>

                <nav className="bg-white shadow-sm border-b">
                    <div className="page-container pt-3 pb-2">
                        {/*
                          * flex-col-reverse on mobile: DOM order is tabs first, actions second,
                          * but col-reverse flips that so actions render on TOP and tabs below.
                          * sm:flex-row restores the normal side-by-side layout on wider screens.
                          */}
                        <div className={`flex flex-col-reverse gap-y-2 sm:flex-row sm:items-center ${view === 'chart' ? 'mb-1' : 'mb-3'}`}>
                            {/* Tab group */}
                            <div className="nav-tab-group">
                                <button
                                    onClick={() => navigateTo('vehicles')}
                                    className={`btn-tab ${view === 'vehicles' ? 'active' : ''}`}
                                >
                                    Vehicles
                                </button>
                                <button
                                    onClick={() => currentActiveVehicle && navigateTo('runs')}
                                    disabled={!currentActiveVehicle}
                                    className={`btn-tab ${view === 'runs' ? 'active' : ''}`}
                                >
                                    Tests &amp; Data {currentActiveVehicle ? `(${currentActiveVehicle.name})` : ''}
                                </button>
                                <button
                                    onClick={() => selectedVehicles.length > 0 && navigateTo('chart')}
                                    disabled={selectedVehicles.length === 0}
                                    className={`btn-tab ${view === 'chart' ? 'active' : ''}`}
                                >
                                    Charts
                                </button>
                                <button
                                    onClick={() => navigateTo('specs')}
                                    className={`btn-tab ${view === 'specs' ? 'active' : ''}`}
                                >
                                    Compare Specs
                                </button>
                                {isAdmin && (
                                    <button
                                        onClick={() => navigateTo('admin')}
                                        className={`btn-tab ${view === 'admin' ? 'active' : ''}`}
                                    >
                                        Admin
                                    </button>
                                )}
                            </div>
                            {/* Action group — right-aligned on desktop, full-width right-justified on mobile */}
                            <div className="nav-actions sm:ml-auto">
                                {user ? (
                                    <>
                                        <div className="flex flex-col items-end leading-tight text-sm text-gray-600">
                                            <span>{user.email}</span>
                                            {userRole && userRole !== 'user' && (
                                                <span className="owner-badge mt-0.5">{userRole.toUpperCase()}</span>
                                            )}
                                        </div>
                                        <button onClick={signOut} className="btn btn-secondary">
                                            Sign Out
                                        </button>
                                    </>
                                ) : (
                                    <button onClick={() => setShowAuthModal(true)} className="btn btn-primary">
                                        Sign In
                                    </button>
                                )}
                                <button onClick={exportData} className="btn btn-secondary">
                                    Export Data
                                </button>
                                {/* Import ▾ dropdown — blue (primary action) */}
                                <div className="relative">
                                    <button
                                        className="btn btn-primary"
                                        onClick={() => setShowImportMenu(m => !m)}
                                    >
                                        Import ▾
                                    </button>
                                    {showImportMenu && (
                                        <>
                                            <div className="fixed inset-0 z-10" onClick={() => setShowImportMenu(false)} />
                                            <div className="dropdown-menu w-44">
                                                <label
                                                    className="dropdown-item cursor-pointer"
                                                    onClick={() => setShowImportMenu(false)}
                                                >
                                                    📄 App JSON
                                                    <input
                                                        ref={jsonImportRef}
                                                        type="file"
                                                        accept=".json"
                                                        className="hidden"
                                                        onChange={(e) => { e.target.files[0] && importData(e.target.files[0]); e.target.value = ''; }}
                                                    />
                                                </label>
                                                <button
                                                    className="dropdown-item w-full text-left"
                                                    onClick={() => { setShowImportMenu(false); setShowTableauModal(true); }}
                                                >
                                                    📊 Tableau CSV
                                                </button>
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Chart mode sub-nav — only visible in chart view */}
                        {view === 'chart' && (
                            <div className="flex gap-0.5 pb-2">
                                {[
                                    { key: 'charging', label: 'Charging' },
                                    { key: 'range',    label: 'Range & Efficiency' },
                                ].map(({ key, label }) => (
                                    <button
                                        key={key}
                                        onClick={() => handleChartModeChange(key)}
                                        className={`btn-chart-mode ${chartMode === key ? 'active' : ''}`}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                        )}

                    </div>
                    <div className="border-t">
                        <div className="page-container py-2">
                        {/* Selected vehicles row */}
                        <div className="inline-row flex-wrap">
                            <span className="text-sm text-gray-600 font-medium">Selected:</span>
                            {selectedVehicles.length === 0 ? (
                                <div className="px-3 py-1 bg-gray-100 text-gray-500 rounded-full text-sm">
                                    None
                                </div>
                            ) : (
                                <>
                                    {selectedVehicles.map(vehicleId => {
                                        const vehicle = vehicles.find(v => v.id === vehicleId);
                                        if (!vehicle) return null;
                                        return (
                                            <div
                                                key={vehicleId}
                                                className="selected-vehicle-chip"
                                                style={{backgroundColor: 'var(--color-primary-light)', color: 'var(--color-primary-text)'}}
                                            >
                                                <span>{vehicle.name}</span>
                                                <button
                                                    onClick={() => removeVehicleSelection(vehicleId)}
                                                    className="ml-1 hover:opacity-70 rounded-full w-4 h-4 flex items-center justify-center"
                                                    style={{fontSize: '12px'}}
                                                >
                                                    &times;
                                                </button>
                                            </div>
                                        );
                                    })}
                                    <button
                                        onClick={clearAllSelections}
                                        className="btn btn-warning btn-sm"
                                    >
                                        Clear all
                                    </button>
                                </>
                            )}
                        </div>
                        </div>
                    </div>
                </nav>

                <main className="page-container py-6">
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
                            onViewRuns={(v) => { setActiveVehicle(v); navigateTo('runs'); }}
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
                            onUpdateVehicleSpecs={updateVehicleSpecs}
                            specCustomFieldSuggestions={specCustomFieldSuggestions}
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
                            onViewChart={() => navigateTo('chart')}
                            onToggleVehicleVisibility={toggleVehicleVisibility}
                            onUpdateVehicle={updateVehicle}
                            onDuplicateVehicle={(id) => duplicateVehicle(id)}
                            onDeleteVehicle={async (id) => { await deleteVehicle(id); navigateTo('vehicles'); }}
                            tags={tags}
                            onCreateTag={createTag}
                            onSyncVehicleTags={syncVehicleTags}
                            onUploadVehicleImage={(file) => uploadVehicleImage(currentActiveVehicle.id, file)}
                            onUpdateVehicleSpecs={updateVehicleSpecs}
                            specCustomFieldSuggestions={specCustomFieldSuggestions}
                        />
                    )}
                    {view === 'chart' && selectedVehicles.length > 0 && (
                        <ChargingView
                            vehicles={vehicles}
                            selectedVehicleIds={selectedVehicles}
                            chartConfig={chartConfig}
                            setChartConfig={setChartConfig}
                            onUpdateRunColor={updateRunColor}
                            chartMode={chartMode}
                        />
                    )}
                    {view === 'specs' && (
                        <SpecsView
                            vehicles={vehicles}
                            selectedVehicleIds={selectedVehicles}
                        />
                    )}
                    {view === 'admin' && isAdmin && (
                        <AdminView
                            getUsersForAdmin={getUsersForAdmin}
                            setUserRole={setUserRole}
                            currentUserId={user?.id}
                        />
                    )}
                </main>
            </div>

            {/* ── Global notification banner ──────────────────────────────── */}
            {appNotification && (
                <div className={`fixed bottom-0 left-0 right-0 z-[60] border-t-2 shadow-2xl ${
                    appNotification.type === 'error'
                        ? 'bg-red-50 border-red-400'
                        : 'bg-green-50 border-green-500'
                }`}>
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
        </>
    );
}

import { useState, useRef } from 'react';
import { useAppContext } from './context/AppContext';
import AuthModal from './components/AuthModal';
import ImportTableauModal from './components/ImportTableauModal';
import VehiclesView from './components/VehiclesView';
import RunsView from './components/RunsView';
import ChartView from './components/ChartView';
import SpecsView from './components/SpecsView';

export default function App() {
    const {
        vehicles,
        selectedVehicles,
        user,
        isOwner,
        loading,
        headerImageUrl,
        uploadHeaderImage,
        toggleVehicleSelection,
        removeVehicleSelection,
        clearAllSelections,
        addVehicle,
        updateVehicle,
        deleteVehicle,
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
        signOut,
        initializeApp,
    } = useAppContext();

    const [activeVehicle, setActiveVehicle] = useState(null);
    const [view, setView] = useState('vehicles');
    const [chartConfig, setChartConfig] = useState({
        xAxis: 'soc',
        yAxis: 'chargeRate',
        selectedRuns: [],
        raceMode: false,
        raceThreshold: 10,  // % SoC at which all runs are normalised to t = 0
    });
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [showImportMenu, setShowImportMenu] = useState(false);
    const [showTableauModal, setShowTableauModal] = useState(false);
    const jsonImportRef = useRef();

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
                    <div className="relative max-w-7xl mx-auto px-6 py-6">
                        {/* Clickable title → home */}
                        <button
                            onClick={() => setView('vehicles')}
                            className="text-left group"
                        >
                            <h1 className="text-3xl font-bold group-hover:underline decoration-white/60">EV Data Visualization</h1>
                        </button>
                        <p className="mt-1" style={{color: 'rgba(255,255,255,0.8)'}}>Compare and analyze electric vehicle performance data</p>

                        {/* Owner-only: change header image */}
                        {isOwner && (
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
                    <div className="max-w-7xl mx-auto px-6 py-3">
                        {/*
                          * flex-col-reverse on mobile: DOM order is tabs first, actions second,
                          * but col-reverse flips that so actions render on TOP and tabs below.
                          * sm:flex-row restores the normal side-by-side layout on wider screens.
                          */}
                        <div className="flex flex-col-reverse gap-y-2 sm:flex-row sm:items-center mb-3">
                            {/* Tab group */}
                            <div className="flex gap-1 items-center flex-wrap">
                                <button
                                    onClick={() => setView('vehicles')}
                                    className={`btn-tab ${view === 'vehicles' ? 'active' : ''}`}
                                >
                                    Vehicles
                                </button>
                                <button
                                    onClick={() => currentActiveVehicle && setView('runs')}
                                    disabled={!currentActiveVehicle}
                                    className={`btn-tab ${view === 'runs' ? 'active' : ''}`}
                                >
                                    Test Runs {currentActiveVehicle ? `(${currentActiveVehicle.name})` : ''}
                                </button>
                                <button
                                    onClick={() => selectedVehicles.length > 0 && setView('chart')}
                                    disabled={selectedVehicles.length === 0}
                                    className={`btn-tab ${view === 'chart' ? 'active' : ''}`}
                                >
                                    Charts
                                </button>
                                <button
                                    onClick={() => setView('specs')}
                                    className={`btn-tab ${view === 'specs' ? 'active' : ''}`}
                                >
                                    Compare Specs
                                </button>
                            </div>
                            {/* Action group — right-aligned on desktop, full-width right-justified on mobile */}
                            <div className="flex gap-2 items-center justify-end sm:ml-auto">
                                {user ? (
                                    <>
                                        <span className="text-sm text-gray-600">
                                            {user.email}
                                            {isOwner && <span className="ml-2 px-2 py-1 bg-yellow-100 text-yellow-800 rounded text-xs font-bold">OWNER</span>}
                                        </span>
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
                                            <div className="absolute right-0 mt-1 w-44 bg-white border rounded-lg shadow-lg z-20 overflow-hidden">
                                                <label
                                                    className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-gray-50 cursor-pointer"
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
                                                    className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-gray-50 w-full text-left"
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

                        {/* Selected vehicles row */}
                        <div className="flex gap-2 items-center flex-wrap pt-2 border-t">
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
                                                className="flex items-center gap-1 px-3 py-1 rounded-full text-sm"
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
                                        className="text-xs text-gray-400 hover:text-gray-600 underline ml-1"
                                    >
                                        Clear all
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </nav>

                <main className="max-w-7xl mx-auto p-6">
                    {view === 'vehicles' && (
                        <VehiclesView
                            vehicles={vehicles}
                            selectedVehicles={selectedVehicles}
                            onToggleSelection={toggleVehicleSelection}
                            onAdd={addVehicle}
                            onUpdate={updateVehicle}
                            onDelete={deleteVehicle}
                            onViewRuns={(v) => { setActiveVehicle(v); setView('runs'); }}
                            isOwner={isOwner}
                            onToggleVisibility={toggleVehicleVisibility}
                            tags={tags}
                            onCreateTag={createTag}
                            onSyncVehicleTags={syncVehicleTags}
                            onUploadVehicleImage={uploadVehicleImage}
                        />
                    )}
                    {view === 'runs' && currentActiveVehicle && (
                        <RunsView
                            vehicle={currentActiveVehicle}
                            isOwner={isOwner}
                            onAddRun={(run) => addRun(currentActiveVehicle.id, run)}
                            onUpdateRun={(runId, updates) => updateRun(currentActiveVehicle.id, runId, updates)}
                            onSetDefaultRun={(runId) => setDefaultRun(currentActiveVehicle.id, runId)}
                            onDeleteRun={(runId) => deleteRun(currentActiveVehicle.id, runId)}
                            onMergeRunData={(runId, pts, joinKey) => mergeRunData(currentActiveVehicle.id, runId, pts, joinKey)}
                            onReplaceRunData={(runId, pts) => replaceRunData(currentActiveVehicle.id, runId, pts)}
                            onViewChart={() => setView('chart')}
                        />
                    )}
                    {view === 'chart' && selectedVehicles.length > 0 && (
                        <ChartView
                            vehicles={vehicles}
                            selectedVehicleIds={selectedVehicles}
                            chartConfig={chartConfig}
                            setChartConfig={setChartConfig}
                            onUpdateRunColor={updateRunColor}
                        />
                    )}
                    {view === 'specs' && (
                        <SpecsView
                            vehicles={vehicles}
                            selectedVehicleIds={selectedVehicles}
                        />
                    )}
                </main>
            </div>
        </>
    );
}

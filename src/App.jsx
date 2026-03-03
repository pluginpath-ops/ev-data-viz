import { useState } from 'react';
import { useAppContext } from './context/AppContext';
import AuthModal from './components/AuthModal';
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
        toggleVehicleSelection,
        removeVehicleSelection,
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
        exportData,
        importData,
        signOut,
        initializeApp,
    } = useAppContext();

    const [activeVehicle, setActiveVehicle] = useState(null);
    const [view, setView] = useState('vehicles');
    const [chartConfig, setChartConfig] = useState({
        xAxis: 'soc',
        yAxis: 'chargeRate',
        selectedRuns: []
    });
    const [showAuthModal, setShowAuthModal] = useState(false);

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
            <div className="min-h-screen">
                <header className="bg-blue-600 text-white p-6 shadow-lg" style={{backgroundColor: 'var(--color-primary)'}}>
                    <div className="max-w-7xl mx-auto">
                        <h1 className="text-3xl font-bold">EV Data Visualization</h1>
                        <p className="text-blue-100 mt-1" style={{color: 'rgba(255, 255, 255, 0.8)'}}>Compare and analyze electric vehicle performance data</p>
                    </div>
                </header>

                <nav className="bg-white shadow-sm border-b">
                    <div className="max-w-7xl mx-auto px-6 py-3">
                        <div className="flex gap-4 items-center mb-3">
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
                            <div className="ml-auto flex gap-2 items-center">
                                {user ? (
                                    <>
                                        <span className="text-sm text-gray-600">
                                            {user.email}
                                            {isOwner && <span className="ml-2 px-2 py-1 bg-yellow-100 text-yellow-800 rounded text-xs font-bold">OWNER</span>}
                                        </span>
                                        <button
                                            onClick={signOut}
                                            className="btn btn-secondary text-sm"
                                        >
                                            Sign Out
                                        </button>
                                    </>
                                ) : (
                                    <button
                                        onClick={() => setShowAuthModal(true)}
                                        className="btn btn-primary text-sm"
                                    >
                                        Sign In
                                    </button>
                                )}
                                <button
                                    onClick={exportData}
                                    className="btn btn-edit"
                                >
                                    Export Data
                                </button>
                                <label className="btn btn-secondary cursor-pointer">
                                    Import Data
                                    <input
                                        type="file"
                                        accept=".json"
                                        className="hidden"
                                        onChange={(e) => e.target.files[0] && importData(e.target.files[0])}
                                    />
                                </label>
                            </div>
                        </div>

                        <div className="flex gap-2 items-center flex-wrap pt-2 border-t">
                            <span className="text-sm text-gray-600 font-medium">Selected:</span>
                            {selectedVehicles.length === 0 ? (
                                <div className="px-3 py-1 bg-gray-100 text-gray-500 rounded-full text-sm">
                                    None
                                </div>
                            ) : (
                                selectedVehicles.map(vehicleId => {
                                    const vehicle = vehicles.find(v => v.id === vehicleId);
                                    if (!vehicle) return null;
                                    return (
                                        <div
                                            key={vehicleId}
                                            className="flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm"
                                            style={{backgroundColor: 'var(--color-primary-light)', color: 'var(--color-primary-text)'}}
                                        >
                                            <span>{vehicle.name}</span>
                                            <button
                                                onClick={() => removeVehicleSelection(vehicleId)}
                                                className="ml-1 hover:bg-blue-200 rounded-full w-4 h-4 flex items-center justify-center"
                                                style={{fontSize: '12px'}}
                                            >
                                                &times;
                                            </button>
                                        </div>
                                    );
                                })
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
                            onAddRun={(run) => addRun(currentActiveVehicle.id, run)}
                            onUpdateRun={(runId, updates) => updateRun(currentActiveVehicle.id, runId, updates)}
                            onSetDefaultRun={(runId) => setDefaultRun(currentActiveVehicle.id, runId)}
                            onDeleteRun={(runId) => deleteRun(currentActiveVehicle.id, runId)}
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

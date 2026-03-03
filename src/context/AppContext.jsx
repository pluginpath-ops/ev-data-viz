import { createContext, useContext, useState, useEffect } from 'react';
import { dataService } from '../services/DataService';

const AppContext = createContext(null);

export function AppProvider({ children }) {
    const [vehicles, setVehicles] = useState([]);
    const [selectedVehicles, setSelectedVehicles] = useState([]);
    const [user, setUser] = useState(null);
    const [isOwner, setIsOwner] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        initializeApp();
    }, []);

    async function initializeApp() {
        setLoading(true);
        await dataService.initialize();
        setUser(dataService.user);
        setIsOwner(dataService.isOwner);

        const vehiclesData = await dataService.getVehicles();
        const selectedIds = await dataService.getSelectedVehicles();

        setVehicles(vehiclesData);
        setSelectedVehicles(selectedIds);
        setLoading(false);
    }

    const toggleVehicleSelection = async (vehicleId) => {
        const newSelection = selectedVehicles.includes(vehicleId)
            ? selectedVehicles.filter(id => id !== vehicleId)
            : [...selectedVehicles, vehicleId];

        setSelectedVehicles(newSelection);
        await dataService.setSelectedVehicles(newSelection);
    };

    const removeVehicleSelection = async (vehicleId) => {
        const newSelection = selectedVehicles.filter(id => id !== vehicleId);
        setSelectedVehicles(newSelection);
        await dataService.setSelectedVehicles(newSelection);
    };

    const addVehicle = async (vehicle) => {
        try {
            const newVehicle = await dataService.addVehicle(vehicle);
            setVehicles(prev => [...prev, newVehicle]);
        } catch (error) {
            alert('Error adding vehicle: ' + error.message);
        }
    };

    const updateVehicle = async (vehicleId, updates) => {
        try {
            await dataService.updateVehicle(vehicleId, updates);
            setVehicles(prev => prev.map(v => v.id === vehicleId ? { ...v, ...updates } : v));
        } catch (error) {
            alert('Error updating vehicle: ' + error.message);
        }
    };

    const deleteVehicle = async (vehicleId) => {
        try {
            await dataService.deleteVehicle(vehicleId);
            setVehicles(prev => prev.filter(v => v.id !== vehicleId));
            setSelectedVehicles(prev => prev.filter(id => id !== vehicleId));
        } catch (error) {
            alert('Error deleting vehicle: ' + error.message);
        }
    };

    const addRun = async (vehicleId, run) => {
        try {
            const newRun = await dataService.addRun(vehicleId, run);
            setVehicles(prev => prev.map(v =>
                v.id === vehicleId
                    ? { ...v, runs: [...(v.runs || []), newRun] }
                    : v
            ));
            return vehicleId;
        } catch (error) {
            alert('Error adding run: ' + error.message);
        }
    };

    const updateRun = async (vehicleId, runId, updates) => {
        try {
            await dataService.updateRun(vehicleId, runId, updates);
            setVehicles(prev => prev.map(v =>
                v.id === vehicleId
                    ? { ...v, runs: v.runs.map(r => r.id === runId ? { ...r, ...updates } : r) }
                    : v
            ));
        } catch (error) {
            alert('Error updating run: ' + error.message);
        }
    };

    const setDefaultRun = async (vehicleId, runId) => {
        try {
            await dataService.setDefaultRun(vehicleId, runId);
            setVehicles(prev => prev.map(v =>
                v.id === vehicleId
                    ? {
                        ...v,
                        runs: v.runs.map(r => ({
                            ...r,
                            isDefault: r.id === runId
                        }))
                    }
                    : v
            ));
        } catch (error) {
            alert('Error setting default run: ' + error.message);
        }
    };

    const updateRunColor = async (vehicleId, runId, color) => {
        try {
            await dataService.updateRunColor(vehicleId, runId, color);
            setVehicles(prev => prev.map(v =>
                v.id === vehicleId
                    ? { ...v, runs: v.runs.map(r => r.id === runId ? { ...r, color } : r) }
                    : v
            ));
        } catch (error) {
            console.error('Error updating color:', error);
        }
    };

    const deleteRun = async (vehicleId, runId) => {
        try {
            await dataService.deleteRun(vehicleId, runId);
            setVehicles(prev => prev.map(v =>
                v.id === vehicleId
                    ? { ...v, runs: v.runs.filter(r => r.id !== runId) }
                    : v
            ));
        } catch (error) {
            alert('Error deleting run: ' + error.message);
        }
    };

    const exportData = () => {
        const dataStr = JSON.stringify({ vehicles }, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'ev-data-export.json';
        a.click();
    };

    const importData = (file) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = JSON.parse(e.target.result);
                const vehiclesToImport = data.vehicles || [];
                if (dataService.useSupabase && dataService.user) {
                    // Insert each vehicle and its runs into Supabase
                    for (const vehicle of vehiclesToImport) {
                        const newVehicle = await dataService.addVehicle(vehicle);
                        for (const run of vehicle.runs || []) {
                            await dataService.addRun(newVehicle.id, run);
                        }
                    }
                    await initializeApp();
                    alert(`Imported ${vehiclesToImport.length} vehicle(s) into Supabase successfully!`);
                } else {
                    setVehicles(vehiclesToImport);
                    alert('Data imported successfully!');
                }
            } catch (error) {
                alert('Error importing data: ' + error.message);
            }
        };
        reader.readAsText(file);
    };

    const toggleVehicleVisibility = async (vehicleId, newVisibility) => {
        try {
            await dataService.toggleVehicleVisibility(vehicleId, newVisibility);
            // Only update UI after confirmed DB write
            setVehicles(prev => prev.map(v => v.id === vehicleId ? { ...v, visibility: newVisibility } : v));
        } catch (error) {
            alert('Error updating visibility: ' + error.message);
            // Re-sync from DB so the UI doesn't show stale state
            await initializeApp();
        }
    };

    const signOut = async () => {
        await dataService.signOut();
        window.location.reload();
    };

    const value = {
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
        toggleVehicleVisibility,
        exportData,
        importData,
        signOut,
        initializeApp,
    };

    return (
        <AppContext.Provider value={value}>
            {children}
        </AppContext.Provider>
    );
}

export function useAppContext() {
    const context = useContext(AppContext);
    if (!context) {
        throw new Error('useAppContext must be used within an AppProvider');
    }
    return context;
}

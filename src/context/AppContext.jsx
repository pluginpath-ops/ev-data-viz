import { createContext, useContext, useState, useEffect } from 'react';
import { dataService } from '../services/DataService';

const AppContext = createContext(null);

export function AppProvider({ children }) {
    const [vehicles, setVehicles] = useState([]);
    const [selectedVehicles, setSelectedVehicles] = useState([]);
    const [tags, setTags] = useState([]);
    const [user, setUser] = useState(null);
    const [isOwner, setIsOwner] = useState(false);
    const [loading, setLoading] = useState(true);
    const [headerImageUrl, setHeaderImageUrl] = useState('');

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
        const tagsData = dataService.useSupabase ? await dataService.getTags() : [];
        const siteSettings = await dataService.getSiteSettings();

        setVehicles(vehiclesData);
        setSelectedVehicles(selectedIds);
        setTags(tagsData);
        setHeaderImageUrl(siteSettings.header_image_url || '');
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

    const clearAllSelections = async () => {
        setSelectedVehicles([]);
        await dataService.setSelectedVehicles([]);
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

    const mergeRunData = async (vehicleId, runId, newDataPoints, joinKey) => {
        try {
            const result = await dataService.mergeRunData(runId, newDataPoints, joinKey);
            // No need to call initializeApp() — run cards don't display data-point
            // values loaded from DB, and ChartView fetches fresh via getRunData().
            // If the service returned updated populated_fields, sync them into state.
            if (result?.populatedFields) {
                setVehicles(prev => prev.map(v =>
                    v.id === vehicleId
                        ? { ...v, runs: v.runs.map(r => r.id === runId ? { ...r, populated_fields: result.populatedFields } : r) }
                        : v
                ));
            }
            return result;
        } catch (error) {
            alert('Error updating run data: ' + error.message);
            throw error; // re-throw so the caller knows it failed
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
                    // Build import plan:
                    // - Vehicle name match → merge into existing (no duplicate vehicle created)
                    // - Run name+date match → suspected duplicate, ask user
                    const plans = [];
                    const suspectedDupLines = [];

                    for (const vehicle of vehiclesToImport) {
                        const existing = vehicles.find(v =>
                            v.name?.toLowerCase() === vehicle.name?.toLowerCase()
                        );
                        const runsToAdd = [];
                        const suspectedDups = [];

                        for (const run of vehicle.runs || []) {
                            const isDup = (existing?.runs || []).some(r =>
                                r.name?.toLowerCase() === run.name?.toLowerCase() &&
                                r.date === run.date
                            );
                            if (isDup) {
                                suspectedDups.push(run);
                                suspectedDupLines.push(`• "${vehicle.name}" → Run "${run.name}" (${run.date || 'no date'})`);
                            } else {
                                runsToAdd.push(run);
                            }
                        }

                        plans.push({ vehicle, existingId: existing?.id || null, isNew: !existing, runsToAdd, suspectedDups });
                    }

                    // Ask about suspected duplicates (name + date match)
                    let addDups = false;
                    if (suspectedDupLines.length > 0) {
                        const msg = `Found ${suspectedDupLines.length} suspected duplicate run(s) (same name & date):\n\n${suspectedDupLines.join('\n')}\n\nAdd suspected duplicates anyway?`;
                        addDups = window.confirm(msg); // OK = add anyway, Cancel = skip
                    }

                    // Execute import
                    let vehiclesImported = 0;
                    let runsImported = 0;

                    for (const plan of plans) {
                        let vehicleId = plan.existingId;
                        if (plan.isNew) {
                            const newVehicle = await dataService.addVehicle(plan.vehicle);
                            vehicleId = newVehicle.id;
                            vehiclesImported++;
                        }
                        const allRuns = addDups
                            ? [...plan.runsToAdd, ...plan.suspectedDups]
                            : plan.runsToAdd;
                        for (const run of allRuns) {
                            await dataService.addRun(vehicleId, run);
                            runsImported++;
                        }
                    }

                    await initializeApp();
                    const dupNote = suspectedDupLines.length > 0
                        ? ` ${suspectedDupLines.length} suspected duplicate(s) ${addDups ? 'added' : 'skipped'}.`
                        : '';
                    alert(`Import complete: ${vehiclesImported} new vehicle(s), ${runsImported} run(s) added.${dupNote}`);
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

    const createTag = async (name) => {
        try {
            const tag = await dataService.createTag(name);
            setTags(prev => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)));
            return tag;
        } catch (error) {
            const message = error.message?.includes('row-level security')
                ? 'Only vehicle owners can create tags.'
                : 'Error creating tag: ' + error.message;
            alert(message);
        }
    };

    const syncVehicleTags = async (vehicleId, tagIds) => {
        try {
            await dataService.syncVehicleTags(vehicleId, tagIds);
            const vehicleTags = tags.filter(t => tagIds.includes(t.id));
            setVehicles(prev => prev.map(v => v.id === vehicleId ? { ...v, tags: vehicleTags } : v));
        } catch (error) {
            alert('Error updating tags: ' + error.message);
        }
    };

    const uploadVehicleImage = async (vehicleId, file) => {
        try {
            const imageUrl = await dataService.uploadVehicleImage(vehicleId, file);
            setVehicles(prev => prev.map(v => v.id === vehicleId ? { ...v, image_url: imageUrl } : v));
            return imageUrl;
        } catch (error) {
            alert('Error uploading image: ' + error.message);
        }
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

    const uploadHeaderImage = async (file) => {
        try {
            const url = await dataService.uploadHeaderImage(file);
            setHeaderImageUrl(url);
            return url;
        } catch (error) {
            alert('Error uploading header image: ' + error.message);
        }
    };

    const importTableauSessions = async (sessions, vehicleMap) => {
        try {
            const result = await dataService.importTableauSessions(sessions, vehicleMap);
            await initializeApp();
            return result;
        } catch (error) {
            throw error;
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
        mergeRunData,
        exportData,
        importData,
        importTableauSessions,
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

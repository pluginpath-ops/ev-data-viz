import { createContext, useContext, useState, useEffect } from 'react';
import { dataService } from '../services/DataService';

const AppContext = createContext(null);

export function AppProvider({ children }) {
    const [vehicles, setVehicles] = useState([]);
    const [selectedVehicles, setSelectedVehicles] = useState([]);
    const [tags, setTags] = useState([]);
    const [user, setUser] = useState(null);
    const [userRole, setUserRole] = useState(null); // 'admin'|'contributor'|'user'|null
    const [loading, setLoading] = useState(true);
    const [headerImageUrl, setHeaderImageUrl] = useState('');
    const [appNotification, setAppNotification] = useState(null); // { message, type: 'error'|'success' }
    const [specCustomFieldSuggestions, setSpecCustomFieldSuggestions] = useState({}); // { [category]: Set<normalizedKey> }

    const showError   = (message) => setAppNotification({ message, type: 'error' });
    const showSuccess = (message) => setAppNotification({ message, type: 'success' });
    const clearNotification = () => setAppNotification(null);

    useEffect(() => {
        initializeApp();
    }, []);

    async function initializeApp() {
        setLoading(true);
        await dataService.initialize();
        setUser(dataService.user);
        setUserRole(dataService.role);

        const vehiclesData = await dataService.getVehicles();
        const selectedIds = await dataService.getSelectedVehicles();
        const tagsData = dataService.useSupabase ? await dataService.getTags() : [];
        const siteSettings = await dataService.getSiteSettings();

        // Derive custom field name suggestions from all vehicles' specs._custom objects
        const suggestions = {};
        for (const vehicle of vehiclesData) {
            if (!vehicle.specs) continue;
            for (const [cat, catData] of Object.entries(vehicle.specs)) {
                if (!catData?._custom) continue;
                if (!suggestions[cat]) suggestions[cat] = new Set();
                for (const key of Object.keys(catData._custom)) {
                    suggestions[cat].add(key);
                }
            }
        }
        setSpecCustomFieldSuggestions(suggestions);

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

    // Replace the entire selection at once (used by URL restore)
    const setVehicleSelection = async (vehicleIds) => {
        setSelectedVehicles(vehicleIds);
        await dataService.setSelectedVehicles(vehicleIds);
    };

    const addVehicle = async (vehicle) => {
        try {
            const newVehicle = await dataService.addVehicle(vehicle);
            setVehicles(prev => [...prev, newVehicle]);
        } catch (error) {
            showError('Error adding vehicle: ' + error.message);
        }
    };

    const updateVehicle = async (vehicleId, updates) => {
        try {
            await dataService.updateVehicle(vehicleId, updates);
            setVehicles(prev => prev.map(v => v.id === vehicleId ? { ...v, ...updates } : v));
        } catch (error) {
            showError('Error updating vehicle: ' + error.message);
        }
    };

    const reorderVehicles = async (sortUpdates) => {
        try {
            await dataService.updateVehicleSortOrders(sortUpdates);
            setVehicles(prev => prev.map(v => {
                const u = sortUpdates.find(u => u.id === v.id);
                return u ? { ...v, sort_order: u.sort_order } : v;
            }));
        } catch (error) {
            showError('Error reordering vehicles: ' + error.message);
        }
    };

    const duplicateVehicle = async (vehicleId) => {
        try {
            const newVehicle = await dataService.duplicateVehicle(vehicleId, vehicles);
            // Refresh vehicles list without setLoading(true) — initializeApp() would unmount VehiclesView
            // and wipe the edit modal's local state before it can open.
            dataService.getVehicles().then(setVehicles).catch(() => {});
            return newVehicle;
        } catch (error) {
            showError('Error duplicating vehicle: ' + error.message);
        }
    };

    const deleteVehicle = async (vehicleId) => {
        try {
            await dataService.deleteVehicle(vehicleId);
            setVehicles(prev => prev.filter(v => v.id !== vehicleId));
            setSelectedVehicles(prev => prev.filter(id => id !== vehicleId));
        } catch (error) {
            showError('Error deleting vehicle: ' + error.message);
        }
    };

    // ── Trim CRUD ─────────────────────────────────────────────────────────────

    const addTrim = async (vehicleId, trimData) => {
        try {
            const newTrim = await dataService.addTrim(vehicleId, trimData);
            setVehicles(prev => prev.map(v =>
                v.id === vehicleId
                    ? { ...v, trims: [...(v.trims || []), newTrim] }
                    : v
            ));
        } catch (error) {
            showError('Error adding trim: ' + error.message);
        }
    };

    const updateTrim = async (vehicleId, trimId, updates) => {
        try {
            await dataService.updateTrim(trimId, updates);
            setVehicles(prev => prev.map(v =>
                v.id === vehicleId
                    ? { ...v, trims: (v.trims || []).map(t => t.id === trimId ? { ...t, ...updates } : t) }
                    : v
            ));
        } catch (error) {
            showError('Error updating trim: ' + error.message);
        }
    };

    const deleteTrim = async (vehicleId, trimId) => {
        try {
            await dataService.deleteTrim(trimId);
            setVehicles(prev => prev.map(v =>
                v.id === vehicleId
                    ? { ...v, trims: (v.trims || []).filter(t => t.id !== trimId) }
                    : v
            ));
        } catch (error) {
            showError('Error deleting trim: ' + error.message);
        }
    };

    // ── Copy run to a different vehicle ───────────────────────────────────────

    const copyRunToVehicle = async (sourceVehicleId, run, targetVehicleId) => {
        try {
            const newRun = await dataService.copyRunToVehicle(run, targetVehicleId);
            setVehicles(prev => prev.map(v =>
                v.id === targetVehicleId
                    ? { ...v, runs: [...(v.runs || []), newRun] }
                    : v
            ));
            showSuccess(`Test copied to ${vehicles.find(v => v.id === targetVehicleId)?.name || 'vehicle'}`);
        } catch (error) {
            showError('Error copying test: ' + error.message);
        }
    };

    const duplicateRun = async (vehicleId, runId) => {
        try {
            const vehicle = vehicles.find(v => v.id === vehicleId);
            const run = vehicle?.runs.find(r => r.id === runId);
            if (!run) throw new Error('Run not found');
            const newRun = await dataService.duplicateRun(vehicleId, run);
            setVehicles(prev => prev.map(v =>
                v.id === vehicleId
                    ? { ...v, runs: [...(v.runs || []), newRun] }
                    : v
            ));
        } catch (error) {
            showError('Error duplicating run: ' + error.message);
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
            showError('Error adding run: ' + error.message);
        }
    };

    const updateRun = async (vehicleId, runId, updates) => {
        try {
            await dataService.updateRun(vehicleId, runId, updates);
            // Convert the camelCase editFormData keys back to the snake_case keys that
            // the rest of the UI expects (matching what Supabase returns on next load).
            const toNum = (v) => (v === '' || v == null) ? null : Number(v);
            const normalized = {};
            for (const [k, v] of Object.entries(updates)) {
                switch (k) {
                    case 'hasCharging':     normalized.has_charging       = v;         break;
                    case 'hasRange':        normalized.has_range          = v;         break;
                    case 'softwareVersion': normalized.software_version   = v;         break;
                    case 'startSoc':        normalized.start_soc          = toNum(v);  break;
                    case 'endSoc':          normalized.end_soc            = toNum(v);  break;
                    case 'speedMph':        normalized.speed_mph          = toNum(v);  break;
                    case 'distanceMiles':   normalized.distance_miles     = toNum(v);  break;
                    case 'energyKwh':       normalized.energy_kwh         = toNum(v);  break;
                    case 'temperatureF':    normalized.temperature_f      = toNum(v);  break;
                    case 'elevationGainFt': normalized.elevation_gain_ft  = toNum(v);  break;
                    case 'chargingUrl':     normalized.charging_url       = v;         break;
                    default:                normalized[k] = v;                         break;
                }
            }
            setVehicles(prev => prev.map(v =>
                v.id === vehicleId
                    ? { ...v, runs: v.runs.map(r => r.id === runId ? { ...r, ...normalized } : r) }
                    : v
            ));
        } catch (error) {
            showError('Error updating run: ' + error.message);
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
            showError('Error setting default run: ' + error.message);
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
            showError('Error updating run color: ' + error.message);
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
            showError('Error deleting run: ' + error.message);
        }
    };

    const replaceRunData = async (vehicleId, runId, points) => {
        try {
            const result = await dataService.replaceRunData(runId, points);
            // Sync updated field tags and point count back into state
            setVehicles(prev => prev.map(v =>
                v.id === vehicleId
                    ? { ...v, runs: v.runs.map(r => r.id === runId
                        ? { ...r, populated_fields: result.populatedFields, dataPointCount: result.rowCount }
                        : r) }
                    : v
            ));
            return result;
        } catch (error) {
            showError('Error saving data: ' + error.message);
            throw error;
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
            showError('Error updating run data: ' + error.message);
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
                    showSuccess(`Import complete: ${vehiclesImported} new vehicle(s), ${runsImported} run(s) added.${dupNote}`);
                } else {
                    setVehicles(vehiclesToImport);
                    showSuccess('Data imported successfully!');
                }
            } catch (error) {
                showError('Error importing data: ' + error.message);
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
            showError(message);
        }
    };

    const syncVehicleTags = async (vehicleId, tagIds) => {
        try {
            await dataService.syncVehicleTags(vehicleId, tagIds);
            const vehicleTags = tags.filter(t => tagIds.includes(t.id));
            setVehicles(prev => prev.map(v => v.id === vehicleId ? { ...v, tags: vehicleTags } : v));
        } catch (error) {
            showError('Error updating tags: ' + error.message);
        }
    };

    const updateVehicleSpecs = async (vehicleId, specs) => {
        try {
            await dataService.updateVehicleSpecs(vehicleId, specs);
            setVehicles(prev => prev.map(v => v.id === vehicleId ? { ...v, specs } : v));
            // Update custom field suggestions with any new keys from the saved specs
            setSpecCustomFieldSuggestions(prev => {
                const next = { ...prev };
                for (const [cat, catData] of Object.entries(specs)) {
                    if (!catData?._custom) continue;
                    const existing = next[cat] ? new Set(next[cat]) : new Set();
                    for (const key of Object.keys(catData._custom)) existing.add(key);
                    next[cat] = existing;
                }
                return next;
            });
        } catch (error) {
            showError('Error updating specs: ' + error.message);
        }
    };

    const uploadVehicleImage = async (vehicleId, file) => {
        try {
            const imageUrl = await dataService.uploadVehicleImage(vehicleId, file);
            setVehicles(prev => prev.map(v => v.id === vehicleId ? { ...v, image_url: imageUrl } : v));
            return imageUrl;
        } catch (error) {
            showError('Error uploading image: ' + error.message);
        }
    };

    const toggleVehicleVisibility = async (vehicleId, newVisibility) => {
        try {
            await dataService.toggleVehicleVisibility(vehicleId, newVisibility);
            // Only update UI after confirmed DB write
            setVehicles(prev => prev.map(v => v.id === vehicleId ? { ...v, visibility: newVisibility } : v));
        } catch (error) {
            showError('Error updating visibility: ' + error.message);
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
            showError('Error uploading header image: ' + error.message);
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

    // ── RBAC helpers ──────────────────────────────────────────────────────────
    const isAdmin       = userRole === 'admin';
    const isContributor = userRole === 'admin' || userRole === 'contributor';
    const canCreate     = !!user; // any authenticated user can add vehicles/runs

    // Can this user edit a vehicle or run record?
    // resource: { user_id } for vehicles; for runs pass the parent vehicle
    const canEdit = (resource) => {
        if (!user) return false;
        if (isContributor) return true;        // admin + contributor can edit anything
        return resource?.user_id === user.id;  // user can only edit their own
    };

    // Can this user delete a record?
    const canDelete = (resource) => {
        if (!user) return false;
        if (isAdmin) return true;              // only admin can delete others' items
        return resource?.user_id === user.id;
    };

    // Can this user toggle public/private visibility?
    const canPublish = () => isContributor;

    // ── Admin actions ─────────────────────────────────────────────────────────
    const getUsersForAdmin = async () => {
        // Let the error propagate to AdminView so it can show it inline.
        // showError would only flash the global banner and return [], hiding the cause.
        return await dataService.getUsersForAdmin();
    };

    const setUserRoleAction = async (targetUserId, newRole) => {
        try {
            await dataService.setUserRole(targetUserId, newRole);
        } catch (error) {
            showError('Error updating role: ' + error.message);
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
        userRole,
        isAdmin,
        isContributor,
        canCreate,
        canEdit,
        canDelete,
        canPublish,
        loading,
        headerImageUrl,
        appNotification,
        clearNotification,
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
        addTrim,
        updateTrim,
        deleteTrim,
        copyRunToVehicle,
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
        updateVehicleSpecs,
        specCustomFieldSuggestions,
        getUsersForAdmin,
        setUserRole: setUserRoleAction,
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

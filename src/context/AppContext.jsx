import { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { dataService } from '../services/DataService';
import { applyDefaultRun, clearDefaultRuns } from '../utils/runUtils';
import { toSessionRow } from '../utils/testSessions';

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
    const [specVouches, setSpecVouches] = useState({});   // { [vehicleId]: { count, myVouch } }
    const [runVotes, setRunVotes] = useState({});          // { [runId]: { vouch, flag, myVote } }
    const [units, setUnits] = useState(() => localStorage.getItem('evbench_units') || 'imperial');
    const [manufacturers, setManufacturers] = useState([]);
    const [testSessions, setTestSessions] = useState([]);
    const [chartHelp, setChartHelp] = useState({});        // { [chart_key]: row } — "About this chart" copy
    const [performanceCounts, setPerformanceCounts] = useState({}); // { [vehicleId]: {accel, braking} } — card badges

    const toggleUnits = () => setUnits(u => {
        const next = u === 'imperial' ? 'metric' : 'imperial';
        localStorage.setItem('evbench_units', next);
        return next;
    });

    const showError   = (message) => setAppNotification({ message, type: 'error' });
    const showSuccess = (message) => setAppNotification({ message, type: 'success' });
    const clearNotification = () => setAppNotification(null);

    // ── Access logging helpers ────────────────────────────────────────────────
    const isRlsViolation = (err) =>
        err?.message?.includes('row-level security') ||
        err?.code === 'PGRST301' ||
        err?.code === '42501';

    const logIfUnauthorized = (operation, resourceType, resourceId, err) => {
        if (isRlsViolation(err)) {
            dataService.logAccessAttempt({
                operation,
                resourceType,
                resourceId: String(resourceId ?? ''),
                errorCode:    err.code,
                errorMessage: err.message,
            });
        }
    };

    useEffect(() => {
        initializeApp();
    }, []);

    // Refresh only the vehicles list (no loading spinner, no full re-init).
    // Used after spec-link add/delete so inherited runs rebuild without a page flash.
    async function softRefreshVehicles() {
        const vehiclesData = await dataService.getVehicles();
        setVehicles(vehiclesData);
    }

    async function initializeApp() {
        setLoading(true);
        await dataService.initialize();
        setUser(dataService.user);
        setUserRole(dataService.role);

        // These queries are independent of one another. Awaiting them in sequence
        // cost ~900ms of round-trip latency on a warm load — six of the seven
        // return under 4KB, so the time was almost entirely waiting, not transfer.
        // Keep them in one Promise.all; adding a new startup query below this line
        // rather than inside it silently reintroduces the waterfall.
        const [
            vehiclesData,
            selectedIds,
            tagsData,
            siteSettings,
            manufacturersData,
            chartHelpData,
            sessionsData,
            perfCounts,
        ] = await Promise.all([
            dataService.getVehicles(),
            dataService.getSelectedVehicles(),
            dataService.useSupabase ? dataService.getTags() : [],
            dataService.getSiteSettings(),
            dataService.useSupabase ? dataService.getManufacturers() : [],
            dataService.useSupabase ? dataService.getChartHelp() : {},
            dataService.useSupabase ? dataService.getTestSessions() : [],
            // One extra query, kept out of getVehicles so a missing performance table
            // can never take the vehicles list down with it.
            dataService.useSupabase ? dataService.getPerformanceRunCounts() : {},
        ]);

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
        setManufacturers(manufacturersData);
        setTestSessions(sessionsData);
        setChartHelp(chartHelpData);
        setPerformanceCounts(perfCounts);
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
            // API response has manufacturer_id but not the joined manufacturer object —
            // attach it from the already-loaded list so the card renders correctly.
            if (newVehicle.manufacturer_id && !newVehicle.manufacturer) {
                const mfg = manufacturers.find(m => m.id === newVehicle.manufacturer_id);
                if (mfg) newVehicle.manufacturer = mfg;
            }
            setVehicles(prev => [...prev, newVehicle]);
        } catch (error) {
            logIfUnauthorized('add_vehicle', 'vehicle', null, error);
            showError('Error adding vehicle: ' + error.message);
        }
    };

    const updateVehicle = async (vehicleId, updates) => {
        try {
            await dataService.updateVehicle(vehicleId, updates);
            setVehicles(prev => prev.map(v => {
                if (v.id !== vehicleId) return v;
                const updated = { ...v, ...updates };
                // Re-attach manufacturer object when manufacturer_id changes so the
                // card and filters reflect the new brand without a full page refresh.
                if ('manufacturer_id' in updates) {
                    updated.manufacturer = manufacturers.find(m => m.id === updates.manufacturer_id) ?? null;
                }
                return updated;
            }));
        } catch (error) {
            logIfUnauthorized('update_vehicle', 'vehicle', vehicleId, error);
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
            logIfUnauthorized('reorder_vehicles', 'vehicle', null, error);
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
            logIfUnauthorized('delete_vehicle', 'vehicle', vehicleId, error);
            showError('Error deleting vehicle: ' + error.message);
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
            logIfUnauthorized('copy_run', 'run', null, error);
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
            logIfUnauthorized('duplicate_run', 'run', runId, error);
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
            logIfUnauthorized('add_run', 'run', null, error);
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
                    case 'kind':            normalized.kind               = v;         break;
                    case 'softwareVersion': normalized.software_version   = v;         break;
                    case 'startSoc':        normalized.start_soc          = toNum(v);  break;
                    case 'endSoc':          normalized.end_soc            = toNum(v);  break;
                    case 'speedMph':        normalized.speed_mph          = toNum(v);  break;
                    case 'distanceMiles':   normalized.distance_miles     = toNum(v);  break;
                    case 'energyKwh':       normalized.energy_kwh         = toNum(v);  break;
                    case 'chargeEnergyKwh': normalized.charge_energy_kwh  = toNum(v);  break;
                    case 'temperatureF':    normalized.temperature_f      = toNum(v);  break;
                    case 'speedBasis':     normalized.speed_basis       = v || null; break;
                    case 'altitudeFt':      normalized.altitude_ft       = toNum(v);  break;
                    case 'elevationGainFt': normalized.elevation_gain_ft  = toNum(v);  break;
                    case 'sourceUrl':       normalized.source_url         = v;         break;
                    default:                normalized[k] = v;                         break;
                }
            }
            setVehicles(prev => prev.map(v =>
                v.id === vehicleId
                    ? { ...v, runs: v.runs.map(r => r.id === runId ? { ...r, ...normalized } : r) }
                    : v
            ));
        } catch (error) {
            logIfUnauthorized('update_run', 'run', runId, error);
            showError('Error updating run: ' + error.message);
        }
    };

    // runId is the run whose default is being cleared. Without it this cleared
    // every run of the vehicle, so clearing the default range test also cleared
    // the default charging run — the two are independent since migration 046.
    // ── Test sessions ─────────────────────────────────────────────────────────
    //
    // Assignment runs from the RUN's side: a run picks its session, exactly like
    // it picks a manufacturer. The multi-vehicle case — four cars round one loop
    // — then needs no multi-vehicle UI at all: it emerges when several runs
    // choose the same session.

    const createTestSession = async (fields) => {
        try {
            const row = await dataService.createTestSession(fields);
            setTestSessions(prev => [row, ...prev]);
            return row;
        } catch (error) {
            logIfUnauthorized('create_test_session', 'test_session', null, error);
            showError('Error creating session: ' + error.message);
            return null;
        }
    };

    const updateTestSession = async (id, changes) => {
        try {
            await dataService.updateTestSession(id, changes);
            setTestSessions(prev => prev.map(s => s.id === id ? { ...s, ...toSessionRow(changes) } : s));
        } catch (error) {
            logIfUnauthorized('update_test_session', 'test_session', id, error);
            showError('Error updating session: ' + error.message);
        }
    };

    const deleteTestSession = async (id) => {
        try {
            await dataService.deleteTestSession(id);
            setTestSessions(prev => prev.filter(s => s.id !== id));
            // runs.session_id is ON DELETE SET NULL; mirror that locally.
            setVehicles(prev => prev.map(v => ({
                ...v,
                runs: (v.runs || []).map(r => r.session_id === id ? { ...r, session_id: null } : r),
            })));
        } catch (error) {
            logIfUnauthorized('delete_test_session', 'test_session', id, error);
            showError('Error deleting session: ' + error.message);
        }
    };

    const setRunsSession = async (runIds, sessionId) => {
        const ids = (Array.isArray(runIds) ? runIds : [runIds]).filter(Boolean);
        try {
            await dataService.setRunsSession(ids, sessionId);
            const idSet = new Set(ids.map(String));
            setVehicles(prev => prev.map(v => ({
                ...v,
                runs: (v.runs || []).map(r =>
                    idSet.has(String(r.id)) ? { ...r, session_id: sessionId ?? null } : r),
            })));
        } catch (error) {
            logIfUnauthorized('set_run_session', 'run', ids[0] ?? null, error);
            showError('Error assigning session: ' + error.message);
        }
    };

    const clearDefaultRun = async (vehicleId, runId = null) => {
        try {
            await dataService.clearDefaultRun(vehicleId, runId);
            setVehicles(prev => prev.map(v =>
                v.id === vehicleId
                    ? { ...v, runs: clearDefaultRuns(v.runs, runId) }
                    : v
            ));
        } catch (error) {
            logIfUnauthorized('clear_default_run', 'run', null, error);
            showError('Error clearing default run: ' + error.message);
        }
    };

    const setDefaultRun = async (vehicleId, runId) => {
        try {
            await dataService.setDefaultRun(vehicleId, runId);
            // Only the runs of the SAME KIND lose their default. The service has
            // scoped this per kind since #177; the local copy had not, so setting
            // a default range test cleared the default charging run on screen and
            // the two disagreed until a reload.
            setVehicles(prev => prev.map(v =>
                v.id === vehicleId ? { ...v, runs: applyDefaultRun(v.runs, runId) } : v));
        } catch (error) {
            logIfUnauthorized('set_default_run', 'run', runId, error);
            showError('Error setting default run: ' + error.message);
        }
    };

    /**
     * Set the curator's default charging test for a range test, or clear it with
     * null. This is the durable pairing — a chart-session pairing lives only in
     * the URL, so this is what a visitor arriving without one sees.
     */
    const setPairedChargingRun = async (vehicleId, rangeRunId, chargingRunId) => {
        try {
            await dataService.setPairedChargingRun(rangeRunId, chargingRunId);
            setVehicles(prev => prev.map(v =>
                v.id !== vehicleId ? v : {
                    ...v,
                    runs: v.runs.map(r => r.id === rangeRunId
                        ? { ...r, paired_charging_run_id: chargingRunId ? Number(chargingRunId) : null }
                        : r),
                }
            ));
        } catch (error) {
            logIfUnauthorized('set_paired_charging_run', 'run', rangeRunId, error);
            showError('Error saving pairing: ' + error.message);
        }
    };

    const updateRunColor = async (vehicleId, runId, color) => {
        try {
            if (typeof runId === 'string' && runId.startsWith('inherited_')) {
                // Update local state immediately for responsiveness
                setVehicles(prev => prev.map(v =>
                    v.id === vehicleId
                        ? { ...v, runs: v.runs.map(r => r.id === runId ? { ...r, color } : r) }
                        : v
                ));
                // Persist on the spec_link so it survives page reload
                const run = vehicles.find(v => v.id === vehicleId)?.runs?.find(r => r.id === runId);
                if (run?._specLinkId) {
                    await dataService.updateSpecLink(run._specLinkId, { color });
                }
                return;
            }
            await dataService.updateRunColor(vehicleId, runId, color);
            setVehicles(prev => prev.map(v =>
                v.id === vehicleId
                    ? { ...v, runs: v.runs.map(r => r.id === runId ? { ...r, color } : r) }
                    : v
            ));
        } catch (error) {
            logIfUnauthorized('update_run_color', 'run', runId, error);
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
            logIfUnauthorized('delete_run', 'run', runId, error);
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
            logIfUnauthorized('save_run_data', 'run', runId, error);
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
            logIfUnauthorized('merge_run_data', 'run', runId, error);
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
            logIfUnauthorized('create_tag', 'tag', null, error);
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
            logIfUnauthorized('sync_tags', 'vehicle', vehicleId, error);
            showError('Error updating tags: ' + error.message);
        }
    };

    const updateVehicleSpecs = async (vehicleId, specs, specSourceVehicleId = undefined) => {
        try {
            await dataService.updateVehicleSpecs(vehicleId, specs, specSourceVehicleId);
            setVehicles(prev => prev.map(v => {
                if (v.id !== vehicleId) return v;
                const update = { ...v, specs };
                if (specSourceVehicleId !== undefined) {
                    update.spec_source_vehicle_id = specSourceVehicleId ? Number(specSourceVehicleId) : null;
                }
                return update;
            }));
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
            logIfUnauthorized('update_specs', 'vehicle', vehicleId, error);
            showError('Error updating specs: ' + error.message);
        }
    };

    /**
     * Execute a bulk vehicle import plan (see utils/vehicleImportPlan.js).
     *
     * Runs in dependency order: new manufacturers and tags first, then every
     * vehicle create/update, then specs + tags + inheritance links — so a row
     * may inherit from a vehicle created earlier in the same file.
     *
     * Per-row failures are collected rather than aborting the run; the caller
     * shows them in the import modal.
     */
    const importVehicles = async (plan) => {
        const failures = [];
        let created = 0, updated = 0;

        // 1. Reference data the rows depend on.
        const mfgByName = new Map(manufacturers.map(m => [m.name.toLowerCase(), m]));
        for (const name of plan.summary.newManufacturers) {
            try {
                const mfg = await dataService.addManufacturer(name);
                mfgByName.set(name.toLowerCase(), mfg);
            } catch (error) {
                failures.push({ label: name, message: `Manufacturer: ${error.message}` });
            }
        }

        const tagByName = new Map(tags.map(t => [t.name.toLowerCase(), t]));
        for (const name of plan.summary.newTags) {
            try {
                const tag = await dataService.createTag(name);
                tagByName.set(name.toLowerCase(), tag);
            } catch (error) {
                failures.push({ label: name, message: `Tag: ${error.message}` });
            }
        }

        // 2. Create / update the vehicle rows. rowVehicleIds lets pass 3 resolve
        //    inherits_from references that point at rows in this same file.
        const actionable = plan.rows
            .map((row, planIndex) => ({ row, planIndex }))
            .filter(({ row }) => row.action === 'create' || row.action === 'update');
        const rowVehicleIds = new Map(); // plan-row array index → vehicle id
        const done = [];

        for (const { row, planIndex } of actionable) {
            const mfgId = row.manufacturerName
                ? mfgByName.get(row.manufacturerName.toLowerCase())?.id ?? null
                : null;
            try {
                if (row.action === 'create') {
                    const newVehicle = await dataService.addVehicle({
                        ...row.coreWrites,
                        ...(mfgId ? { manufacturer_id: mfgId } : {}),
                    });
                    rowVehicleIds.set(planIndex, newVehicle.id);
                    created++;
                } else {
                    const updates = { ...row.coreWrites };
                    if (mfgId) updates.manufacturer_id = mfgId;
                    if (Object.keys(updates).length > 0) {
                        // updateVehicle writes every core column, so send the
                        // vehicle's current values for anything not being filled.
                        const current = vehicles.find(v => v.id === row.vehicleId) || {};
                        await dataService.updateVehicle(row.vehicleId, {
                            name: current.name, make: current.make, model: current.model,
                            trim: current.trim, year: current.year, battery: current.battery,
                            range: current.range, power: current.power,
                            ...updates,
                        });
                    }
                    rowVehicleIds.set(planIndex, row.vehicleId);
                    updated++;
                }
                done.push({ row, planIndex });
            } catch (error) {
                logIfUnauthorized('import_vehicle', 'vehicle', row.vehicleId, error);
                failures.push({ label: row.label, message: error.message });
            }
        }

        // 3. Specs, tags and inheritance — all vehicle ids are known by now.
        for (const { row, planIndex } of done) {
            const vehicleId = rowVehicleIds.get(planIndex);
            try {
                if (row.tagNames.length > 0) {
                    const existingIds = (vehicles.find(v => v.id === vehicleId)?.tags || []).map(t => t.id);
                    const newIds = row.tagNames
                        .map(name => tagByName.get(name.toLowerCase())?.id)
                        .filter(id => id != null);
                    await dataService.syncVehicleTags(vehicleId, [...new Set([...existingIds, ...newIds])]);
                }

                const parentId = row.inherit
                    ? (row.inherit.vehicleId ?? rowVehicleIds.get(row.inherit.rowIndex) ?? null)
                    : undefined;
                if (row.needsSpecWrite) {
                    await dataService.updateVehicleSpecs(vehicleId, row.mergedSpecs, parentId);
                }
            } catch (error) {
                logIfUnauthorized('import_vehicle_specs', 'vehicle', vehicleId, error);
                failures.push({ label: row.label, message: error.message });
            }
        }

        // Refresh without initializeApp()'s loading flag — that would unmount the
        // import modal before it can show the result.
        const [vehiclesData, tagsData, mfgData] = await Promise.all([
            dataService.getVehicles(),
            dataService.useSupabase ? dataService.getTags() : Promise.resolve(tags),
            dataService.useSupabase ? dataService.getManufacturers() : Promise.resolve(manufacturers),
        ]);
        setVehicles(vehiclesData);
        setTags(tagsData);
        setManufacturers(mfgData);

        return { created, updated, failures };
    };

    const uploadVehicleImage = async (vehicleId, renditions) => {
        try {
            const urls = await dataService.uploadVehicleImage(vehicleId, renditions);
            setVehicles(prev => prev.map(v => v.id === vehicleId ? { ...v, ...urls } : v));
            return urls;
        } catch (error) {
            showError('Error uploading image: ' + error.message);
        }
    };

    const backfillVehicleThumbnails = async (onProgress) => {
        const result = await dataService.backfillVehicleThumbnails(onProgress);
        // Re-read rather than patching locally: the backfill writes rows this
        // context did not touch, and a partial run must not leave the grid
        // claiming thumbnails that were not written.
        if (result.updated > 0) await softRefreshVehicles();
        return result;
    };

    const toggleVehicleVisibility = async (vehicleId, newVisibility) => {
        try {
            await dataService.toggleVehicleVisibility(vehicleId, newVisibility);
            // Only update UI after confirmed DB write
            setVehicles(prev => prev.map(v => v.id === vehicleId ? { ...v, visibility: newVisibility } : v));
        } catch (error) {
            logIfUnauthorized('update_visibility', 'vehicle', vehicleId, error);
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
        // Deliberately not caught here: the import modal shows the failure, and
        // swallowing it would leave the user staring at a dialog that never
        // finished. The try/catch that only rethrew said nothing.
        const result = await dataService.importTableauSessions(sessions, vehicleMap);
        await initializeApp();
        return result;
    };

    // ── Chart help ("About this chart" copy) ──────────────────────────────────

    const updateChartHelp = async (chartKey, fields) => {
        try {
            const row = await dataService.updateChartHelp(chartKey, fields);
            setChartHelp(prev => ({ ...prev, [chartKey]: row }));
            return row;
        } catch (error) {
            logIfUnauthorized('update_chart_help', 'chart_help', chartKey, error);
            showError('Error saving chart help: ' + error.message);
            throw error;
        }
    };

    // ── Manufacturer CRUD ─────────────────────────────────────────────────────

    const addManufacturer = async (name, country = null) => {
        try {
            const mfg = await dataService.addManufacturer(name, country);
            setManufacturers(prev => [...prev, mfg].sort((a, b) => a.name.localeCompare(b.name)));
            return mfg;
        } catch (error) {
            logIfUnauthorized('add_manufacturer', 'manufacturer', null, error);
            showError('Error adding manufacturer: ' + error.message);
        }
    };

    const updateManufacturer = async (id, updates) => {
        try {
            await dataService.updateManufacturer(id, updates);
            setManufacturers(prev =>
                prev.map(m => m.id === id ? { ...m, ...updates } : m)
                    .sort((a, b) => a.name.localeCompare(b.name))
            );
            // If name changed, keep vehicles' make field in sync
            if (updates.name) {
                setVehicles(prev => prev.map(v =>
                    v.manufacturer?.id === id ? { ...v, manufacturer: { ...v.manufacturer, ...updates }, make: updates.name } : v
                ));
            }
        } catch (error) {
            logIfUnauthorized('update_manufacturer', 'manufacturer', id, error);
            showError('Error updating manufacturer: ' + error.message);
        }
    };

    const deleteManufacturer = async (id) => {
        try {
            await dataService.deleteManufacturer(id);
            setManufacturers(prev => prev.filter(m => m.id !== id));
        } catch (error) {
            logIfUnauthorized('delete_manufacturer', 'manufacturer', id, error);
            showError('Error deleting manufacturer: ' + error.message);
        }
    };

    // ── Spec link CRUD ────────────────────────────────────────────────────────

    // Spec links require a full reload because buildInheritedRuns() is a two-pass
    // operation inside DataService — optimistic state cannot replicate it cheaply.
    const addSpecLink = async ({ targetVehicleId, sourceRunId, scalingFactor, notes }) => {
        try {
            await dataService.addSpecLink({ targetVehicleId, sourceRunId, scalingFactor, notes });
            await softRefreshVehicles();
        } catch (error) {
            logIfUnauthorized('add_spec_link', 'spec_link', null, error);
            showError('Error adding spec link: ' + error.message);
            throw error;
        }
    };

    const updateSpecLink = async (linkId, changes, targetVehicleId = null) => {
        try {
            await dataService.updateSpecLink(linkId, changes, targetVehicleId);
            await softRefreshVehicles();
        } catch (error) {
            logIfUnauthorized('update_spec_link', 'spec_link', linkId, error);
            showError('Error updating spec link: ' + error.message);
            throw error;
        }
    };

    const deleteSpecLink = async (linkId) => {
        try {
            await dataService.deleteSpecLink(linkId);
            await softRefreshVehicles();
        } catch (error) {
            logIfUnauthorized('delete_spec_link', 'spec_link', linkId, error);
            showError('Error removing spec link: ' + error.message);
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

    // ── Voting actions ────────────────────────────────────────────────────────

    /** Load vouch count for a vehicle's specs (called when specs modal opens). */
    const loadSpecVouches = async (vehicleId) => {
        try {
            const data = await dataService.getVehicleSpecVouches(vehicleId);
            setSpecVouches(prev => ({ ...prev, [vehicleId]: data }));
        } catch (error) {
            showError('Error loading votes: ' + error.message);
        }
    };

    /** Toggle vouch on a vehicle's specs. Optimistic update. */
    const toggleSpecVouch = async (vehicleId) => {
        const current = specVouches[vehicleId] ?? { count: 0, myVouch: false };
        const optimistic = {
            count: current.myVouch ? current.count - 1 : current.count + 1,
            myVouch: !current.myVouch,
        };
        setSpecVouches(prev => ({ ...prev, [vehicleId]: optimistic }));
        try {
            const updated = await dataService.toggleSpecVouch(vehicleId);
            setSpecVouches(prev => ({ ...prev, [vehicleId]: updated }));
        } catch (error) {
            setSpecVouches(prev => ({ ...prev, [vehicleId]: current }));
            showError('Error saving vote: ' + error.message);
        }
    };

    /** Load run votes for an array of run IDs (called when a vehicle's runs are expanded). */
    const loadRunVotes = async (runIds) => {
        if (!runIds.length) return;
        try {
            const data = await dataService.getRunVotes(runIds);
            setRunVotes(prev => ({ ...prev, ...data }));
        } catch (error) {
            showError('Error loading run votes: ' + error.message);
        }
    };

    /** Toggle vouch/flag on a run. Optimistic update. */
    const toggleRunVote = async (runId, voteType) => {
        const current = runVotes[runId] ?? { vouch: 0, flag: 0, myVote: null };
        const removing = current.myVote === voteType;
        const optimistic = {
            vouch: current.vouch + (voteType === 'vouch' ? (removing ? -1 : (current.myVote === 'flag' ? 0 : 1)) : (current.myVote === 'vouch' ? -1 : 0)),
            flag:  current.flag  + (voteType === 'flag'  ? (removing ? -1 : (current.myVote === 'vouch' ? 0 : 1)) : (current.myVote === 'flag'  ? -1 : 0)),
            myVote: removing ? null : voteType,
        };
        setRunVotes(prev => ({ ...prev, [runId]: optimistic }));
        try {
            const updated = await dataService.toggleRunVote(runId, voteType);
            setRunVotes(prev => ({ ...prev, [runId]: updated }));
        } catch (error) {
            setRunVotes(prev => ({ ...prev, [runId]: current }));
            showError('Error saving vote: ' + error.message);
        }
    };

    /** Flag a spec field as inaccurate. Updates vehicles state optimistically. */
    const flagSpecField = async (vehicleId, fieldKey) => {
        setVehicles(prev => prev.map(v =>
            v.id === vehicleId
                ? { ...v, flagged_specs: v.flagged_specs?.includes(fieldKey) ? v.flagged_specs : [...(v.flagged_specs || []), fieldKey] }
                : v
        ));
        try {
            await dataService.flagSpecField(vehicleId, fieldKey);
        } catch (error) {
            setVehicles(prev => prev.map(v =>
                v.id === vehicleId
                    ? { ...v, flagged_specs: (v.flagged_specs || []).filter(k => k !== fieldKey) }
                    : v
            ));
            showError('Error flagging field: ' + error.message);
        }
    };

    /** Unflag a spec field. Admin only — enforced here. */
    const unflagSpecField = async (vehicleId, fieldKey) => {
        if (!isAdmin) return;
        setVehicles(prev => prev.map(v =>
            v.id === vehicleId
                ? { ...v, flagged_specs: (v.flagged_specs || []).filter(k => k !== fieldKey) }
                : v
        ));
        try {
            await dataService.unflagSpecField(vehicleId, fieldKey);
        } catch (error) {
            setVehicles(prev => prev.map(v =>
                v.id === vehicleId
                    ? { ...v, flagged_specs: [...(v.flagged_specs || []), fieldKey] }
                    : v
            ));
            showError('Error removing flag: ' + error.message);
        }
    };

    // ── EPA test group linking ────────────────────────────────────────────────

    /** Pass-through: server-side search used by the linking combobox. */
    const searchEpaTestGroups = (query, year) => dataService.searchEpaTestGroups(query, year);

    const linkEpaTestGroup = async (vehicleId, groupId, confidence, notes) => {
        try {
            await dataService.linkEpaTestGroup(vehicleId, groupId, confidence, notes);
            // Re-fetch vehicles so epa_mappings reflects the new link immediately.
            const updated = await dataService.getVehicles();
            setVehicles(updated);
            showSuccess('EPA test group linked.');
        } catch (error) {
            showError('Error linking EPA test group: ' + error.message);
        }
    };

    /**
     * Create an EPA test group from scratch (hand-entered, e.g. from a lab PDF)
     * and link it to the vehicle, then refresh so the curator form can fill in
     * coefficients, tests and phases.
     */
    const createAndLinkEpaTestGroup = async (vehicleId, fields) => {
        try {
            await dataService.createEpaTestGroup(fields);
            await dataService.linkEpaTestGroup(vehicleId, fields.test_group_id, 'likely', null);
            const updated = await dataService.getVehicles();
            setVehicles(updated);
            showSuccess('EPA test group created and linked.');
        } catch (error) {
            showError('Error creating EPA test group: ' + error.message);
            throw error;
        }
    };

    /** Which of these test_group_ids already exist (for overwrite confirmation). */
    const getExistingEpaTestGroupIds = (ids) => dataService.getExistingEpaTestGroupIds(ids);

    /**
     * Import parsed CSI-PDF groups (clean-replace each), optionally linking one
     * to a vehicle, then refresh. Used by the PDF import modal from both Admin
     * and the per-vehicle curator section.
     */
    /**
     * Bulk-import a parsed EPA Fuel Economy Guide (#206).
     *
     * Staged rows only — nothing is written to epa_test_groups here. Promotion
     * onto a group is a separate, curator-driven step, because no key joins the
     * two automatically.
     */
    const importFeGuide = async (rows, sourceFile = null) => {
        try {
            const res = await dataService.importFeGuideRows(rows, sourceFile);
            const parts = [];
            if (res.imported) parts.push(`${res.imported} new`);
            if (res.updated)  parts.push(`${res.updated} updated`);
            if (res.failed)   parts.push(`${res.failed} failed`);
            showSuccess(`Fuel Economy Guide: ${parts.join(', ') || 'nothing to import'}.`);
            return res;
        } catch (error) {
            showError('Guide import failed: ' + error.message);
            throw error;
        }
    };

    const getFeGuideSummary = () => dataService.getFeGuideSummary();

    const importEpaCsiGroups = async (groups, { linkVehicleId, linkTestGroupIds = [] } = {}) => {
        try {
            for (const g of groups) await dataService.importEpaGroupFull(g);
            if (linkVehicleId) {
                for (const tgid of linkTestGroupIds) {
                    try { await dataService.linkEpaTestGroup(linkVehicleId, tgid, 'verified', null); }
                    catch { /* already linked — ignore UNIQUE conflict */ }
                }
            }
            const updated = await dataService.getVehicles();
            setVehicles(updated);
            showSuccess(`Imported ${groups.length} EPA config(s) from PDF.`);
            return { count: groups.length };
        } catch (error) {
            showError('PDF import failed: ' + error.message);
            throw error;
        }
    };

    const updateEpaMapping = async (mappingId, updates) => {
        try {
            await dataService.updateEpaMapping(mappingId, updates);
            const updated = await dataService.getVehicles();
            setVehicles(updated);
        } catch (error) {
            showError('Error updating EPA mapping: ' + error.message);
        }
    };

    const unlinkEpaTestGroup = async (mappingId) => {
        try {
            await dataService.unlinkEpaTestGroup(mappingId);
            const updated = await dataService.getVehicles();
            setVehicles(updated);
            showSuccess('EPA test group unlinked.');
        } catch (error) {
            showError('Error unlinking EPA test group: ' + error.message);
        }
    };

    /** Pass-through: fetch all test groups with linked vehicles for admin panel. */
    const getEpaTestGroupsAdmin = () => dataService.getEpaTestGroupsAdmin();

    /**
     * Update editable fields on an EPA test group.
     * Accepts any subset of: { label_method, display_name }.
     * Soft-refreshes vehicles so chart labels and vehicle cards reflect the change.
     */
    const updateEpaTestGroup = async (testGroupId, updates) => {
        await dataService.updateEpaTestGroup(testGroupId, updates);
        softRefreshVehicles();
    };

    /** Convenience alias: update only label_method. */
    const updateEpaLabelMethod = async (testGroupId, method) => {
        await dataService.updateEpaLabelMethod(testGroupId, method);
    };

    // ── EPA curator hierarchy (coefficient sets, tests, phases, audit) ──────────
    // Used by the curator form in Tests & Data. Save helpers return the saved row
    // so the form can update local state; the form re-fetches the full hierarchy
    // via getEpaTestGroupFull as needed.

    /** Pass-through: fetch a group with its coefficient sets, tests and phases. */
    const getEpaTestGroupFull = (testGroupId) => dataService.getEpaTestGroupFull(testGroupId);

    const saveEpaCoefficientSet = async (row) => {
        try {
            const saved = await dataService.saveEpaCoefficientSet(row);
            softRefreshVehicles(); // primary coeffs feed the curve
            return saved;
        } catch (error) {
            showError('Error saving coefficient set: ' + error.message);
            throw error;
        }
    };

    const deleteEpaCoefficientSet = async (id) => {
        try {
            await dataService.deleteEpaCoefficientSet(id);
            softRefreshVehicles();
        } catch (error) {
            showError('Error deleting coefficient set: ' + error.message);
            throw error;
        }
    };

    const saveEpaTest = async (row) => {
        try {
            const saved = await dataService.saveEpaTest(row);
            softRefreshVehicles(); // tests feed η / charger-eff derivations
            return saved;
        } catch (error) {
            showError('Error saving test: ' + error.message);
            throw error;
        }
    };

    const deleteEpaTest = async (id) => {
        try {
            await dataService.deleteEpaTest(id);
            softRefreshVehicles();
        } catch (error) {
            showError('Error deleting test: ' + error.message);
            throw error;
        }
    };

    const saveEpaPhase = async (row) => {
        try {
            const saved = await dataService.saveEpaPhase(row);
            softRefreshVehicles(); // HWY-phase consumption drives η
            return saved;
        } catch (error) {
            showError('Error saving phase: ' + error.message);
            throw error;
        }
    };

    const deleteEpaPhase = async (id) => {
        try {
            await dataService.deleteEpaPhase(id);
            softRefreshVehicles();
        } catch (error) {
            showError('Error deleting phase: ' + error.message);
            throw error;
        }
    };

    /** Append an audit-trail entry. Best-effort: failures must never block or
     *  surface from the edit that triggered them (fire-and-forget). */
    const logEpaFieldEdit = (entry) =>
        Promise.resolve(dataService.logEpaFieldEdit(entry)).catch(() => {});

    /** Pass-through: read the audit trail for a row. */
    const getEpaFieldAudit = (tableName, rowId) => dataService.getEpaFieldAudit(tableName, rowId);

    /** Pass-through: read the audit trail for a whole group (+ its child rows). */
    const getEpaAuditForGroup = (testGroupId, childRowIds) =>
        dataService.getEpaAuditForGroup(testGroupId, childRowIds);

    // ── Performance testing (acceleration / braking) ────────────────────────

    /** Sessions (with runs and splits) for one vehicle. Read-only, no refresh. */
    const getPerformanceSessions = (vehicleId) => dataService.getPerformanceSessions(vehicleId);

    /** Reported summaries with their speed-window intervals, for one vehicle. */
    const getPerformanceSummaries = (vehicleId) => dataService.getPerformanceSummaries(vehicleId);

    /**
     * Import a parsed performance CSV as one session with its runs and splits.
     * `parsed` is the output of parsePerformanceCSV().
     */
    const importPerformanceSession = async (vehicleId, parsed, meta) => {
        try {
            const session = await dataService.importPerformanceSession(vehicleId, parsed, meta);
            showSuccess(`Imported ${parsed.runs.length} run${parsed.runs.length === 1 ? '' : 's'}.`);
            return session;
        } catch (error) {
            showError('Import failed: ' + error.message);
            throw error;
        }
    };

    /** Which existing runs, if any, a parsed export already describes. */
    const findMatchingPerformanceRuns = (vehicleId, parsedRuns) =>
        dataService.findMatchingPerformanceRuns(vehicleId, parsedRuns);

    /** Layer a second export's splits onto runs that already exist. */
    const mergePerformanceSplits = async (match, parsedRuns) => {
        try {
            const res = await dataService.mergePerformanceSplits(match, parsedRuns);
            if (res.pointsAdded > 0) {
                showSuccess(`Added ${res.pointsAdded} splits across ${res.runsUpdated} existing runs.`);
            } else {
                // A no-op is NOT a success. Say which step produced nothing, so
                // "it said it worked but nothing appeared" can't happen again.
                const why =
                    res.runsMatched === 0   ? 'none of the runs in this file matched by timestamp'
                  : res.splitsSeen === 0    ? 'no splits were found in the file — the format may not be recognised'
                  : res.alreadyPresent > 0  ? 'every split in this file is already on these runs'
                  : 'the file produced no new splits';
                showError(`Nothing was added: ${why}.`);
            }
            return res;
        } catch (error) {
            showError('Merge failed: ' + error.message);
            throw error;
        }
    };

    /** Edit a session's own fields — its attribution, chiefly. */
    const savePerformanceSession = async (row) => {
        try {
            return await dataService.savePerformanceSession(row);
        } catch (error) {
            showError('Save failed: ' + error.message);
            throw error;
        }
    };

    const deletePerformanceSession = async (id) => {
        try {
            await dataService.deletePerformanceSession(id);
            showSuccess('Testing session deleted.');
        } catch (error) {
            showError('Delete failed: ' + error.message);
            throw error;
        }
    };

    /**
     * Save a reported result. Refreshes vehicles because summaries ride along on
     * the vehicle record and feed the comparison charts.
     */
    // These do NOT refresh the vehicles list. Summaries aren't embedded in
    // getVehicles (see the note there), so refetching every vehicle on each
    // field blur would cost a full reload and change nothing on screen — the
    // performance section owns and reloads its own data.
    const savePerformanceSummary = async (row) => {
        try {
            return await dataService.savePerformanceSummary(row);
        } catch (error) {
            showError('Save failed: ' + error.message);
            throw error;
        }
    };

    /** Create a published result and its speed windows from a parsed paste. */
    const importPublishedResult = async (parsed) => {
        try {
            const saved = await dataService.importPublishedResult(parsed);
            const n = parsed.intervals?.length ?? 0;
            showSuccess(`Result imported${n ? ` with ${n} speed window${n === 1 ? '' : 's'}` : ''}.`);
            return saved;
        } catch (error) {
            showError('Import failed: ' + error.message);
            throw error;
        }
    };

    const deletePerformanceSummary = async (id) => {
        try {
            await dataService.deletePerformanceSummary(id);
            showSuccess('Result deleted.');
        } catch (error) {
            showError('Delete failed: ' + error.message);
            throw error;
        }
    };

    const savePerformanceInterval = async (row) => {
        try {
            return await dataService.savePerformanceInterval(row);
        } catch (error) {
            showError('Save failed: ' + error.message);
            throw error;
        }
    };

    const deletePerformanceInterval = async (id) => {
        try {
            await dataService.deletePerformanceInterval(id);
        } catch (error) {
            showError('Delete failed: ' + error.message);
            throw error;
        }
    };

    /** Delete an EPA test group and its vehicle mappings, then refresh vehicles. */
    const deleteEpaTestGroup = async (testGroupId) => {
        try {
            await dataService.deleteEpaTestGroup(testGroupId);
            const updated = await dataService.getVehicles();
            setVehicles(updated);
            showSuccess('EPA test group deleted.');
        } catch (error) {
            showError('Delete failed: ' + error.message);
            throw error;
        }
    };

    /**
     * Bulk-import EPA test groups from the parsed testcar sheet, then create
     * vehicle mappings for any test groups the user linked to a vehicle.
     *
     * @param {Array<Object>} testGroups  Rows for epa_test_groups upsert
     * @param {Array<{vehicleId, testGroupId}>} mappings  Vehicle → test group links to create
     */
    const importEpaTestGroups = async (testGroups, mappings) => {
        try {
            await dataService.bulkUpsertEpaTestGroups(testGroups);
            // Create mappings sequentially; skip if already linked (upsert would conflict)
            for (const { vehicleId, testGroupId } of mappings) {
                try {
                    await dataService.linkEpaTestGroup(vehicleId, testGroupId, 'likely', null);
                } catch {
                    // Ignore duplicate-link errors (UNIQUE constraint) — mapping already exists
                }
            }
            const updated = await dataService.getVehicles();
            setVehicles(updated);
            showSuccess(`Imported ${testGroups.length} EPA test group(s), linked ${mappings.length}.`);
            return { testGroupsCount: testGroups.length, mappingsCount: mappings.length };
        } catch (error) {
            showError('EPA import failed: ' + error.message);
            throw error;
        }
    };

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

    // Admins/contributors can hide a run's test data (disputed, incomplete) without
    // deleting it. Everyone else — including anonymous viewers — never sees it, in
    // Tests & Data or in any chart/compare tab, since all of those read from `vehicles`.
    const visibleVehicles = useMemo(() => {
        if (isContributor) return vehicles;
        return vehicles.map(v => ({ ...v, runs: (v.runs || []).filter(r => !r.isHidden) }));
    }, [vehicles, isContributor]);

    const value = {
        vehicles: visibleVehicles,
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
        importVehicles,
        updateVehicle,
        reorderVehicles,
        duplicateVehicle,
        deleteVehicle,
        copyRunToVehicle,
        duplicateRun,
        addRun,
        updateRun,
        setDefaultRun,
        updateRunColor,
        setPairedChargingRun,
        deleteRun,
        tags,
        createTag,
        syncVehicleTags,
        uploadVehicleImage,
        backfillVehicleThumbnails,
        toggleVehicleVisibility,
        replaceRunData,
        mergeRunData,
        exportData,
        importData,
        importTableauSessions,
        updateVehicleSpecs,
        specCustomFieldSuggestions,
        specVouches,
        runVotes,
        loadSpecVouches,
        toggleSpecVouch,
        loadRunVotes,
        toggleRunVote,
        flagSpecField,
        unflagSpecField,
        getUsersForAdmin,
        setUserRole: setUserRoleAction,
        signOut,
        initializeApp,
        units,
        toggleUnits,
        manufacturers,
        chartHelp,
        updateChartHelp,
        addManufacturer,
        updateManufacturer,
        deleteManufacturer,
        addSpecLink,
        updateSpecLink,
        deleteSpecLink,
        clearDefaultRun,
        testSessions,
        createTestSession,
        updateTestSession,
        deleteTestSession,
        setRunsSession,
        searchEpaTestGroups,
        linkEpaTestGroup,
        createAndLinkEpaTestGroup,
        importEpaCsiGroups,
        importFeGuide,
        getFeGuideSummary,
        getExistingEpaTestGroupIds,
        updateEpaMapping,
        unlinkEpaTestGroup,
        importEpaTestGroups,
        getEpaTestGroupsAdmin,
        deleteEpaTestGroup,
        updateEpaLabelMethod,
        updateEpaTestGroup,
        // Performance testing (acceleration / braking)
        performanceCounts,
        getPerformanceSessions,
        getPerformanceSummaries,
        importPerformanceSession,
        findMatchingPerformanceRuns,
        mergePerformanceSplits,
        savePerformanceSession,
        deletePerformanceSession,
        savePerformanceSummary,
        importPublishedResult,
        deletePerformanceSummary,
        savePerformanceInterval,
        deletePerformanceInterval,
        // EPA curator hierarchy
        getEpaTestGroupFull,
        saveEpaCoefficientSet,
        deleteEpaCoefficientSet,
        saveEpaTest,
        deleteEpaTest,
        saveEpaPhase,
        deleteEpaPhase,
        logEpaFieldEdit,
        getEpaFieldAudit,
        getEpaAuditForGroup,
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

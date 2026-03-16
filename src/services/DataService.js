import { getSupabase } from './supabase';

/**
 * Round a numeric field to a given number of decimal places.
 * Returns null if the value is null/undefined/NaN.
 */
function roundField(value, decimals) {
  if (value == null) return null;
  const n = Number(value);
  if (isNaN(n)) return null;
  return Math.round(n * 10 ** decimals) / 10 ** decimals;
}

/** Normalise a raw data-point object into a clean DB row shape. */
function normalisePoint(point, runId, frame) {
  return {
    run_id:      runId,
    frame,
    timestamp:   point.timestamp ?? null,
    soc:         roundField(point.soc,         1),  // 0–100 %,   1 dp  e.g. 42.5
    charge_rate: roundField(point.chargeRate,  2),  // kW,        2 dp  e.g. 150.00
    time_value:  roundField(point.time,        1),  // min/s,     1 dp
    range_value: roundField(point.range,       1),  // mi/km,     1 dp
    temperature: roundField(point.temperature, 1),  // °C/°F,     1 dp
  };
}

class DataService {
  constructor() {
    this.user = null;
    this.role = null; // 'admin' | 'contributor' | 'user' | null (unauthenticated)
    this.useSupabase = false;
  }

  get isAdmin()       { return this.role === 'admin'; }
  get isContributor() { return this.role === 'admin' || this.role === 'contributor'; }

  async initialize() {
    const supabase = getSupabase();
    if (!supabase) {
      this.useSupabase = false;
      return;
    }
    // Always use Supabase for reads when credentials are configured,
    // so unauthenticated visitors can see public vehicles.
    this.useSupabase = true;
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      this.user = user;
      const { data: profile } = await getSupabase().from('profiles').select('role').eq('id', user.id).single();
      this.role = profile?.role || 'user';
    }
  }

  async getVehicles() {
    if (!this.useSupabase) {
      const saved = localStorage.getItem('evData');
      return saved ? (JSON.parse(saved).vehicles || []) : [];
    }
    const { data } = await getSupabase()
      .from('vehicles')
      .select(`*, runs(*, data_points(count)), vehicle_tags(tags(id, name))`)
      .order('created_at', { ascending: false });
    return (data || []).map(v => ({
      ...v,
      tags: (v.vehicle_tags || []).map(vt => vt.tags).filter(Boolean),
      runs: (v.runs || []).map(r => ({
        ...r,
        // data_points(count) returns [{ count: N }]; normalise to a plain number
        dataPointCount: Array.isArray(r.data_points) ? (r.data_points[0]?.count ?? 0) : 0,
      })),
    }));
  }

  async getTags() {
    if (!this.useSupabase) return [];
    const { data, error } = await getSupabase().from('tags').select('*').order('name');
    if (error) throw error;
    return data || [];
  }

  async createTag(name) {
    const { data, error } = await getSupabase().from('tags').insert({ name }).select().single();
    if (error) throw error;
    return data;
  }

  async syncVehicleTags(vehicleId, tagIds) {
    await getSupabase().from('vehicle_tags').delete().eq('vehicle_id', vehicleId);
    if (tagIds.length > 0) {
      const { error } = await getSupabase()
        .from('vehicle_tags')
        .insert(tagIds.map(tagId => ({ vehicle_id: vehicleId, tag_id: tagId })));
      if (error) throw error;
    }
  }

  async uploadVehicleImage(vehicleId, blob) {
    // Always store as JPEG — the blob is produced by the crop/resize canvas step
    const path = `${vehicleId}.jpg`;
    const { error: uploadError } = await getSupabase().storage
      .from('vehicle-images')
      .upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
    if (uploadError) throw uploadError;
    const { data } = getSupabase().storage.from('vehicle-images').getPublicUrl(path);
    const { error: updateError } = await getSupabase()
      .from('vehicles').update({ image_url: data.publicUrl }).eq('id', vehicleId);
    if (updateError) throw updateError;
    return data.publicUrl;
  }

  async addVehicle(vehicle) {
    if (!this.useSupabase || !this.user) {
      const saved = localStorage.getItem('evData');
      const data = saved ? JSON.parse(saved) : { vehicles: [], selectedVehicles: [] };
      const newVehicle = { ...vehicle, id: Date.now(), runs: [] };
      data.vehicles.push(newVehicle);
      localStorage.setItem('evData', JSON.stringify(data));
      return newVehicle;
    }
    const { data, error } = await getSupabase().from('vehicles').insert({
      user_id: this.user.id, name: vehicle.name, make: vehicle.make, model: vehicle.model, year: vehicle.year,
      battery: vehicle.battery ? parseFloat(vehicle.battery) : null,
      range: vehicle.range ? parseFloat(vehicle.range) : null,
      power: vehicle.power ? parseFloat(vehicle.power) : null,
      visibility: 'private'
    }).select().single();
    if (error) throw error;
    return { ...data, runs: [] };
  }

  async updateVehicle(vehicleId, updates) {
    if (!this.useSupabase || !this.user) {
      const saved = localStorage.getItem('evData');
      const data = saved ? JSON.parse(saved) : { vehicles: [], selectedVehicles: [] };
      data.vehicles = data.vehicles.map(v => v.id === vehicleId ? { ...v, ...updates } : v);
      localStorage.setItem('evData', JSON.stringify(data));
      return;
    }
    const { error } = await getSupabase().from('vehicles').update({
      name: updates.name, make: updates.make, model: updates.model, year: updates.year,
      battery: updates.battery ? parseFloat(updates.battery) : null,
      range: updates.range ? parseFloat(updates.range) : null,
      power: updates.power ? parseFloat(updates.power) : null
    }).eq('id', vehicleId);
    if (error) throw error;
  }

  async updateVehicleSpecs(vehicleId, specs) {
    if (!this.useSupabase || !this.user) return;
    const { error } = await getSupabase()
      .from('vehicles')
      .update({ specs })
      .eq('id', vehicleId);
    if (error) throw error;
  }

  async updateVehicleSortOrders(sortUpdates) {
    // sortUpdates: [{ id, sort_order }, ...]
    if (!this.useSupabase || !this.user) return; // no-op in localStorage mode
    for (const { id, sort_order } of sortUpdates) {
      const { error } = await getSupabase()
        .from('vehicles')
        .update({ sort_order })
        .eq('id', id);
      if (error) throw error;
    }
  }

  async duplicateVehicle(vehicleId, vehicles) {
    const src = vehicles.find(v => v.id === vehicleId);
    if (!src) throw new Error('Vehicle not found');
    const newVehicle = await this.addVehicle({ ...src, name: src.name + ' (copy)' });
    for (const run of (src.runs || [])) {
      const points = await this.getRunData(run.id);
      await this.addRun(newVehicle.id, {
        ...run,
        name: run.name,
        isDefault: false,
        data: points,
        calculated_fields: run.calculated_fields || [],
      });
    }
    return newVehicle.id;
  }

  async duplicateRun(vehicleId, run) {
    const points = await this.getRunData(run.id);
    return await this.addRun(vehicleId, {
      ...run,
      name: run.name + ' (copy)',
      isDefault: false,
      data: points,
      calculated_fields: run.calculated_fields || [],
    });
  }

  async deleteVehicle(vehicleId) {
    if (!this.useSupabase || !this.user) {
      const saved = localStorage.getItem('evData');
      const data = saved ? JSON.parse(saved) : { vehicles: [], selectedVehicles: [] };
      data.vehicles = data.vehicles.filter(v => v.id !== vehicleId);
      data.selectedVehicles = data.selectedVehicles.filter(id => id !== vehicleId);
      localStorage.setItem('evData', JSON.stringify(data));
      return;
    }
    const { error } = await getSupabase().from('vehicles').delete().eq('id', vehicleId);
    if (error) throw error;
  }

  async addRun(vehicleId, run) {
    if (!this.useSupabase || !this.user) {
      const saved = localStorage.getItem('evData');
      const data = saved ? JSON.parse(saved) : { vehicles: [], selectedVehicles: [] };
      const vehicle = data.vehicles.find(v => v.id === vehicleId);
      const runCount = vehicle?.runs?.length || 0;
      const colorPalette = ['#3b82f6', '#ef4444', '#22c55e', '#a855f7', '#fb923c', '#0ea5e9', '#ec4899', '#84cc16'];
      const newRun = { ...run, id: Date.now(), color: colorPalette[runCount % colorPalette.length] };
      data.vehicles = data.vehicles.map(v => v.id === vehicleId ? { ...v, runs: [...(v.runs || []), newRun] } : v);
      localStorage.setItem('evData', JSON.stringify(data));
      return newRun;
    }
    const { data: newRun, error } = await getSupabase().from('runs').insert({
      vehicle_id: vehicleId, name: run.name, date: run.date,
      software_version: run.softwareVersion, conditions: run.conditions,
      color: run.color || '#3b82f6', is_default: run.isDefault || false,
      synthetic: run.synthetic || false,
      has_charging: run.hasCharging ?? true,
      has_range:    run.hasRange    ?? false,
      source: run.source || null,
      start_soc: run.startSoc != null && run.startSoc !== '' ? Number(run.startSoc) : null,
      end_soc: run.endSoc != null && run.endSoc !== '' ? Number(run.endSoc) : null,
      speed_mph: run.speedMph != null && run.speedMph !== '' ? Number(run.speedMph) : null,
      distance_miles: run.distanceMiles != null && run.distanceMiles !== '' ? Number(run.distanceMiles) : null,
      energy_kwh: run.energyKwh != null && run.energyKwh !== '' ? Number(run.energyKwh) : null,
      temperature_f: run.temperatureF != null && run.temperatureF !== '' ? Number(run.temperatureF) : null,
      elevation_gain_ft: run.elevationGainFt != null && run.elevationGainFt !== '' ? Number(run.elevationGainFt) : null,
      url: run.url || null,
      charging_url: run.chargingUrl || null,
    }).select().single();
    if (error) throw error;
    if (run.data?.length > 0) {
      // Determine which fields have at least one non-null value
      const populatedFields = [];
      if (run.data.some(p => p.soc         != null)) populatedFields.push('soc');
      if (run.data.some(p => p.chargeRate  != null)) populatedFields.push('chargeRate');
      if (run.data.some(p => p.time        != null)) populatedFields.push('time');
      if (run.data.some(p => p.range       != null)) populatedFields.push('range');
      if (run.data.some(p => p.temperature != null)) populatedFields.push('temperature');

      const batchSize = 1000;
      for (let i = 0; i < run.data.length; i += batchSize) {
        const batch = run.data.slice(i, i + batchSize).map((point, j) =>
          normalisePoint(point, newRun.id, point.frame ?? (i + j))
        );
        const { error: batchError } = await getSupabase().from('data_points').insert(batch);
        if (batchError) throw batchError;
      }

      const fieldsUpdate = {};
      if (populatedFields.length > 0)           fieldsUpdate.populated_fields  = populatedFields;
      if (run.calculated_fields?.length > 0)    fieldsUpdate.calculated_fields = run.calculated_fields;
      if (Object.keys(fieldsUpdate).length > 0) {
        await getSupabase().from('runs').update(fieldsUpdate).eq('id', newRun.id);
        Object.assign(newRun, fieldsUpdate);
      }
    }
    return { ...newRun, data: run.data };
  }

  async updateRun(vehicleId, runId, updates) {
    if (!this.useSupabase || !this.user) {
      const saved = localStorage.getItem('evData');
      const data = saved ? JSON.parse(saved) : { vehicles: [], selectedVehicles: [] };
      data.vehicles = data.vehicles.map(v =>
        v.id === vehicleId ? { ...v, runs: v.runs.map(r => r.id === runId ? { ...r, ...updates } : r) } : v
      );
      localStorage.setItem('evData', JSON.stringify(data));
      return;
    }
    const { error } = await getSupabase().from('runs').update({
      name: updates.name, date: updates.date,
      software_version: updates.softwareVersion, conditions: updates.conditions, color: updates.color,
      ...(updates.calculated_fields !== undefined ? { calculated_fields: updates.calculated_fields } : {}),
      ...(updates.hasCharging !== undefined ? { has_charging: updates.hasCharging } : {}),
      ...(updates.hasRange    !== undefined ? { has_range:    updates.hasRange    } : {}),
      ...(updates.source !== undefined ? { source: updates.source || null } : {}),
      ...(updates.startSoc !== undefined ? { start_soc: updates.startSoc !== '' ? Number(updates.startSoc) : null } : {}),
      ...(updates.endSoc !== undefined ? { end_soc: updates.endSoc !== '' ? Number(updates.endSoc) : null } : {}),
      ...(updates.speedMph !== undefined ? { speed_mph: updates.speedMph !== '' ? Number(updates.speedMph) : null } : {}),
      ...(updates.distanceMiles !== undefined ? { distance_miles: updates.distanceMiles !== '' ? Number(updates.distanceMiles) : null } : {}),
      ...(updates.energyKwh !== undefined ? { energy_kwh: updates.energyKwh !== '' ? Number(updates.energyKwh) : null } : {}),
      ...(updates.temperatureF !== undefined ? { temperature_f: updates.temperatureF !== '' ? Number(updates.temperatureF) : null } : {}),
      ...(updates.elevationGainFt !== undefined ? { elevation_gain_ft: updates.elevationGainFt !== '' ? Number(updates.elevationGainFt) : null } : {}),
      ...(updates.url !== undefined ? { url: updates.url || null } : {}),
      ...(updates.chargingUrl !== undefined ? { charging_url: updates.chargingUrl || null } : {}),
    }).eq('id', runId);
    if (error) throw error;
  }

  async setDefaultRun(vehicleId, runId) {
    if (!this.useSupabase || !this.user) {
      const saved = localStorage.getItem('evData');
      const data = saved ? JSON.parse(saved) : { vehicles: [], selectedVehicles: [] };
      data.vehicles = data.vehicles.map(v =>
        v.id === vehicleId ? { ...v, runs: v.runs.map(r => ({ ...r, isDefault: r.id === runId }))} : v
      );
      localStorage.setItem('evData', JSON.stringify(data));
      return;
    }
    const { error } = await getSupabase().from('runs').update({ is_default: true }).eq('id', runId);
    if (error) throw error;
  }

  async updateRunColor(vehicleId, runId, color) {
    if (!this.useSupabase || !this.user) {
      const saved = localStorage.getItem('evData');
      const data = saved ? JSON.parse(saved) : { vehicles: [], selectedVehicles: [] };
      data.vehicles = data.vehicles.map(v =>
        v.id === vehicleId ? { ...v, runs: v.runs.map(r => r.id === runId ? { ...r, color } : r) } : v
      );
      localStorage.setItem('evData', JSON.stringify(data));
      return;
    }
    const { error } = await getSupabase().from('runs').update({ color }).eq('id', runId);
    if (error) throw error;
  }

  async deleteRun(vehicleId, runId) {
    if (!this.useSupabase || !this.user) {
      const saved = localStorage.getItem('evData');
      const data = saved ? JSON.parse(saved) : { vehicles: [], selectedVehicles: [] };
      data.vehicles = data.vehicles.map(v =>
        v.id === vehicleId ? { ...v, runs: v.runs.filter(r => r.id !== runId) } : v
      );
      localStorage.setItem('evData', JSON.stringify(data));
      return;
    }
    const { error } = await getSupabase().from('runs').delete().eq('id', runId);
    if (error) throw error;
  }

  async getSelectedVehicles() {
    if (!this.useSupabase) {
      const saved = localStorage.getItem('evData');
      return saved ? (JSON.parse(saved).selectedVehicles || []) : [];
    }
    const saved = localStorage.getItem('selectedVehicles');
    return saved ? JSON.parse(saved) : [];
  }

  async setSelectedVehicles(vehicleIds) {
    if (!this.useSupabase) {
      const saved = localStorage.getItem('evData');
      const data = saved ? JSON.parse(saved) : { vehicles: [], selectedVehicles: [] };
      data.selectedVehicles = vehicleIds;
      localStorage.setItem('evData', JSON.stringify(data));
      return;
    }
    localStorage.setItem('selectedVehicles', JSON.stringify(vehicleIds));
  }

  async getRunData(runId) {
    const { data, error } = await getSupabase()
      .from('data_points')
      .select('*')
      .eq('run_id', runId)
      .order('frame', { ascending: true });
    if (error) throw error;
    return (data || []).map(p => ({
      frame: p.frame,
      timestamp: p.timestamp,
      soc: p.soc,
      chargeRate: p.charge_rate,
      time: p.time_value,
      range: p.range_value,
      temperature: p.temperature,
    }));
  }

  async toggleVehicleVisibility(vehicleId, newVisibility) {
    const { data, error } = await getSupabase()
      .from('vehicles')
      .update({ visibility: newVisibility })
      .eq('id', vehicleId)
      .select('id');
    if (error) throw error;
    if (!data || data.length === 0) {
      throw new Error('Update blocked — vehicle may have no owner assigned. Run the SQL fix in Supabase.');
    }
  }

  // ── Site settings ────────────────────────────────────────────────────────

  async getSiteSettings() {
    if (!this.useSupabase) return {};
    const { data } = await getSupabase().from('site_settings').select('*');
    const settings = {};
    for (const row of data || []) settings[row.key] = row.value;
    return settings;
  }

  async uploadHeaderImage(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    const path = `header_image.${ext}`;
    const { error: uploadError } = await getSupabase().storage
      .from('site-assets')
      .upload(path, file, { upsert: true });
    if (uploadError) throw new Error(`[Storage] ${uploadError.message}`);
    // Bust the CDN cache by appending a timestamp query param
    const { data } = getSupabase().storage.from('site-assets').getPublicUrl(path);
    const url = `${data.publicUrl}?t=${Date.now()}`;
    // Use an RPC (SECURITY DEFINER function) to write the setting.
    // Direct upsert on site_settings triggers a double RLS check
    // (INSERT + ON CONFLICT DO UPDATE) that fails even for owners.
    const { error: settingError } = await getSupabase()
      .rpc('update_site_setting', { setting_key: 'header_image_url', setting_value: url });
    if (settingError) throw new Error(`[DB] ${settingError.message}`);
    return url;
  }

  /**
   * Import pre-parsed Tableau CSV sessions into Supabase.
   * @param {Array} sessions - output of parseTableauCSV()
   * @param {Object} vehicleMap - { rawVehicle: vehicleId|null }
   *   null → create a new vehicle from session.year + session.vehicleName
   */
  async importTableauSessions(sessions, vehicleMap) {
    if (!this.useSupabase || !this.user) throw new Error('Must be logged in to import.');
    console.log('[DataService] importTableauSessions — starting, sessions:', sessions.length);
    const colorPalette = ['#3b82f6', '#ef4444', '#22c55e', '#a855f7', '#fb923c', '#0ea5e9', '#ec4899', '#84cc16'];
    const results = { vehiclesCreated: 0, runsImported: 0, runsSkipped: 0, pointsImported: 0 };
    // Cache of existing run names per vehicle (lowercased) to skip duplicates on retry
    const existingRunNames = {}; // vehicleId → Set<string>
    const getExistingRunNames = async (vid) => {
      if (!existingRunNames[vid]) {
        const { data } = await getSupabase().from('runs').select('name').eq('vehicle_id', vid);
        existingRunNames[vid] = new Set((data || []).map(r => (r.name || '').toLowerCase()));
      }
      return existingRunNames[vid];
    };

    // Build a name→id lookup of all existing vehicles so "create new" is idempotent:
    // if a vehicle with the same name already exists we reuse it instead of duplicating.
    const { data: existingVehicles } = await getSupabase()
      .from('vehicles')
      .select('id, name, year');
    const existingByName = {};
    for (const v of existingVehicles || []) {
      if (v.name) existingByName[v.name.toLowerCase()] = v.id;
    }

    // Cache vehicles created during this batch so multiple sessions for the same
    // raw vehicle string all get the same id.
    const createdIds = {};

    for (const session of sessions) {
      let vehicleId = vehicleMap[session.rawVehicle];

      if (!vehicleId) {
        // Reuse a vehicle created earlier in this batch
        if (createdIds[session.rawVehicle]) {
          vehicleId = createdIds[session.rawVehicle];
        } else {
          // Reuse an existing vehicle with the same name (makes retries safe)
          const nameKey = session.vehicleName.toLowerCase();
          if (existingByName[nameKey]) {
            vehicleId = existingByName[nameKey];
          } else {
            const v = await this.addVehicle({ name: session.vehicleName, year: session.year });
            vehicleId = v.id;
            existingByName[nameKey] = vehicleId; // prevent duplicates later in batch
            results.vehiclesCreated++;
          }
          createdIds[session.rawVehicle] = vehicleId;
        }
      }

      const runData = session.dataPoints.map((p, i) => ({
        frame: i,
        soc: p.soc,
        chargeRate: p.charge_rate,
        timestamp: null,
        time: null,
        range: null,
        temperature: null,
      }));

      // Skip if a run with this exact name already exists for the vehicle
      const runNamesForVehicle = await getExistingRunNames(vehicleId);
      if (runNamesForVehicle.has(session.runName.toLowerCase())) {
        results.runsSkipped++;
        continue;
      }

      const colorIndex = results.runsImported % colorPalette.length;
      await this.addRun(vehicleId, {
        name: session.runName,
        date: session.date,
        synthetic: session.synthetic,
        color: colorPalette[colorIndex],
        data: runData,
      });
      // Add to cache so a second session with the same name in this batch is also skipped
      runNamesForVehicle.add(session.runName.toLowerCase());
      results.runsImported++;
      results.pointsImported += session.dataPoints.length;
    }
    return results;
  }

  /**
   * Merge new data points into an existing run via a server-side RPC.
   *
   * The PostgreSQL function merge_run_data_points does a set-based UPDATE
   * (patching only non-null fields with COALESCE) for rows whose join-key
   * matches, then INSERTs any unmatched rows.  One round-trip, no extra RLS
   * policy needed (SECURITY DEFINER handles auth internally).
   *
   * @param {string} runId
   * @param {Array}  newDataPoints — [{ soc, chargeRate, time, range, temperature }]
   * @param {'soc'|'time'} joinKey — shared column used to align rows
   */
  async mergeRunData(runId, newDataPoints, joinKey = 'soc') {
    if (!this.useSupabase || !this.user) {
      throw new Error('Must be logged in to update run data.');
    }

    // Round values to consistent precision before sending to the RPC
    const rows = newDataPoints.map(p => ({
      soc:         roundField(p.soc,         1),
      charge_rate: roundField(p.chargeRate,  2),
      time_value:  roundField(p.time,        1),
      range_value: roundField(p.range,       1),
      temperature: roundField(p.temperature, 1),
    }));

    const { data, error } = await getSupabase()
      .rpc('merge_run_data_points', {
        p_run_id:   runId,
        p_join_key: joinKey,
        p_rows:     rows,
      });
    if (error) throw error;

    // After a successful merge, union any newly-populated fields into populated_fields
    const newFields = [];
    if (rows.some(r => r.soc         != null)) newFields.push('soc');
    if (rows.some(r => r.charge_rate != null)) newFields.push('chargeRate');
    if (rows.some(r => r.time_value  != null)) newFields.push('time');
    if (rows.some(r => r.range_value != null)) newFields.push('range');
    if (rows.some(r => r.temperature != null)) newFields.push('temperature');

    const result = data; // { updated: N, inserted: M }
    if (newFields.length > 0) {
      const { data: runRow } = await getSupabase()
        .from('runs').select('populated_fields').eq('id', runId).single();
      const current = runRow?.populated_fields || [];
      const merged = [...new Set([...current, ...newFields])];
      await getSupabase().from('runs').update({ populated_fields: merged }).eq('id', runId);
      result.populatedFields = merged;
    }

    return result; // { updated: N, inserted: M, populatedFields?: [...] }
  }

  /**
   * Replace all data points for a run with a new set of rows.
   * Uses a SECURITY DEFINER RPC (delete + re-insert) so RLS is not an obstacle.
   * Updates populated_fields on the runs table after the write.
   *
   * @param {string|number} runId
   * @param {Array} points — [{ soc, chargeRate, time, range, temperature }]
   */
  async replaceRunData(runId, points) {
    if (!this.useSupabase || !this.user) {
      throw new Error('Must be logged in to update run data.');
    }
    const rows = points.map((p, i) => ({
      frame:       p.frame ?? i,
      soc:         roundField(p.soc,         1),
      charge_rate: roundField(p.chargeRate,  2),
      time_value:  roundField(p.time,        1),
      range_value: roundField(p.range,       1),
      temperature: roundField(p.temperature, 1),
    }));
    const { error } = await getSupabase()
      .rpc('replace_run_data_points', { p_run_id: runId, p_rows: rows });
    if (error) throw error;

    // Recompute populated_fields from the new data
    const populatedFields = [];
    if (points.some(p => p.soc         != null)) populatedFields.push('soc');
    if (points.some(p => p.chargeRate  != null)) populatedFields.push('chargeRate');
    if (points.some(p => p.time        != null)) populatedFields.push('time');
    if (points.some(p => p.range       != null)) populatedFields.push('range');
    if (points.some(p => p.temperature != null)) populatedFields.push('temperature');
    await getSupabase().from('runs').update({ populated_fields: populatedFields }).eq('id', runId);

    return { rowCount: points.length, populatedFields };
  }

  async signOut() {
    const supabase = getSupabase();
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    this.user = null;
    this.role = null;
    this.useSupabase = false;
  }

  // ── Admin RPCs ────────────────────────────────────────────────────────────

  async getUsersForAdmin() {
    const { data, error } = await getSupabase().rpc('get_admin_users');
    if (error) throw error;
    return data || [];
  }

  async setUserRole(targetUserId, newRole) {
    const { error } = await getSupabase().rpc('set_user_role', {
      target_user_id: targetUserId,
      new_role: newRole,
    });
    if (error) throw error;
  }
}

export const dataService = new DataService();

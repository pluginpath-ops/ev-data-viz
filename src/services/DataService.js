import { getSupabase } from './supabase';

class DataService {
  constructor() {
    this.user = null;
    this.isOwner = false;
    this.useSupabase = false;
  }

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
      const { data: profile } = await getSupabase().from('profiles').select('is_owner').eq('id', user.id).single();
      this.isOwner = profile?.is_owner || false;
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

  async uploadVehicleImage(vehicleId, file) {
    const ext = file.name.split('.').pop().toLowerCase();
    const path = `${vehicleId}.${ext}`;
    const { error: uploadError } = await getSupabase().storage
      .from('vehicle-images')
      .upload(path, file, { upsert: true });
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
      visibility: this.isOwner ? 'public' : 'private'
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
      synthetic: run.synthetic || false
    }).select().single();
    if (error) throw error;
    if (run.data?.length > 0) {
      const batchSize = 1000;
      for (let i = 0; i < run.data.length; i += batchSize) {
        const batch = run.data.slice(i, i + batchSize).map(point => ({
          run_id: newRun.id, frame: point.frame, timestamp: point.timestamp,
          soc: point.soc, charge_rate: point.chargeRate,
          time_value: point.time, range_value: point.range, temperature: point.temperature
        }));
        const { error: batchError } = await getSupabase().from('data_points').insert(batch);
        if (batchError) throw batchError;
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
      software_version: updates.softwareVersion, conditions: updates.conditions, color: updates.color
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
   * Append new data points to an existing run.
   *
   * Each CSV upload contributes independent rows — no row-matching needed.
   * For XY plots, each axis is drawn from whatever field is populated on a
   * given row, so SoC+kW rows and SoC+Time rows live happily alongside each
   * other; the chart simply skips rows where the chosen axis field is null.
   *
   * @param {string|number} runId
   * @param {Array} newDataPoints — array of { soc, chargeRate, time, range, temperature }
   */
  async mergeRunData(runId, newDataPoints) {
    if (!this.useSupabase || !this.user) {
      throw new Error('Must be logged in to update run data.');
    }

    // Get current row count so we can assign sequential frame numbers
    const { count, error: countError } = await getSupabase()
      .from('data_points')
      .select('*', { count: 'exact', head: true })
      .eq('run_id', runId);
    if (countError) throw countError;

    const startFrame = count || 0;

    const toInsert = newDataPoints.map((point, i) => ({
      run_id:      runId,
      frame:       startFrame + i,
      soc:         point.soc         != null ? Number(point.soc)         : null,
      charge_rate: point.chargeRate  != null ? Number(point.chargeRate)  : null,
      time_value:  point.time        != null ? Number(point.time)        : null,
      range_value: point.range       != null ? Number(point.range)       : null,
      temperature: point.temperature != null ? Number(point.temperature) : null,
      timestamp:   point.timestamp   ?? null,
    }));

    const batchSize = 1000;
    for (let i = 0; i < toInsert.length; i += batchSize) {
      const { error } = await getSupabase()
        .from('data_points')
        .insert(toInsert.slice(i, i + batchSize));
      if (error) throw error;
    }

    return { inserted: toInsert.length };
  }

  async signOut() {
    const supabase = getSupabase();
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    this.user = null;
    this.isOwner = false;
    this.useSupabase = false;
  }
}

export const dataService = new DataService();

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
      .select(`*, runs(*), vehicle_tags(tags(id, name))`)
      .order('created_at', { ascending: false });
    return (data || []).map(v => ({
      ...v,
      tags: (v.vehicle_tags || []).map(vt => vt.tags).filter(Boolean),
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
        await getSupabase().from('data_points').insert(batch);
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

  /**
   * Import pre-parsed Tableau CSV sessions into Supabase.
   * @param {Array} sessions - output of parseTableauCSV()
   * @param {Object} vehicleMap - { rawVehicle: vehicleId|null }
   *   null → create a new vehicle from session.year + session.vehicleName
   */
  async importTableauSessions(sessions, vehicleMap) {
    if (!this.useSupabase || !this.user) throw new Error('Must be logged in to import.');
    const colorPalette = ['#3b82f6', '#ef4444', '#22c55e', '#a855f7', '#fb923c', '#0ea5e9', '#ec4899', '#84cc16'];
    const results = { vehiclesCreated: 0, runsImported: 0, pointsImported: 0 };
    // Cache newly created vehicles so duplicate rawVehicle rows reuse the same id
    const createdIds = {};

    for (const session of sessions) {
      let vehicleId = vehicleMap[session.rawVehicle];

      if (!vehicleId) {
        // Reuse if we already created this vehicle earlier in this import batch
        if (createdIds[session.rawVehicle]) {
          vehicleId = createdIds[session.rawVehicle];
        } else {
          const v = await this.addVehicle({ name: session.vehicleName, year: session.year });
          vehicleId = v.id;
          createdIds[session.rawVehicle] = vehicleId;
          results.vehiclesCreated++;
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

      const colorIndex = results.runsImported % colorPalette.length;
      await this.addRun(vehicleId, {
        name: session.runName,
        date: session.date,
        synthetic: session.synthetic,
        color: colorPalette[colorIndex],
        data: runData,
      });
      results.runsImported++;
      results.pointsImported += session.dataPoints.length;
    }
    return results;
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

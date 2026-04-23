import { getSupabase } from './supabase';
import { vehicleLabel } from '../utils/specHelpers';

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

// Fields stored in vehicle_performance table instead of specs JSONB.
// Add a key here when a new column is promoted to the table.
const PROMOTED_PERF_FIELDS = ['zero_to_60_mph_sec', 'quarter_mile_sec', 'quarter_mile_mph', 'weight_lbs'];

function splitPerformance(performance = {}) {
  const promoted = {}, remaining = {};
  for (const [k, v] of Object.entries(performance)) {
    if (v !== '' && v != null) {
      (PROMOTED_PERF_FIELDS.includes(k) ? promoted : remaining)[k] = v;
    }
  }
  return { promoted, remaining: Object.keys(remaining).length ? remaining : null };
}

// ── Spec-link helpers (module-level so they're available before class) ────────

/**
 * Given a processed vehicle, a Map of runId→run, and a Map of runId→{vehicleId,vehicleName},
 * returns synthetic run objects for all runs inherited via spec_links.
 * Each inherited run gets a synthetic string id to prevent runDataCache collisions.
 */
function buildInheritedRuns(vehicle, runById, runToVehicle) {
  const inherited = [];
  for (const link of (vehicle.spec_links || [])) {
    const run = runById.get(Number(link.source_run_id));
    if (!run) continue;
    const vInfo = runToVehicle.get(Number(link.source_run_id));
    const sf = link.scaling_factor != null ? Number(link.scaling_factor) : 1;
    inherited.push({
      ...run,
      // Synthetic id prevents runDataCache collision when both source and
      // target vehicles are selected simultaneously in charts.
      id:                `inherited_${link.id}_${run.id}`,
      _inherited:         true,
      _realRunId:         run.id,
      _scalingFactor:     sf,
      _specLinkId:        link.id,
      _sourceVehicleId:   vInfo?.vehicleId,
      _sourceVehicleName: vInfo?.vehicleName,
      // Link color overrides the source run's color; fall back to gray.
      color:          link.color ?? run.color ?? '#9ca3af',
      // is_default on the link row gives per-run default precision.
      isDefault:      !!link.is_default,
      // Scale the run-level range metric immediately so bar charts are correct
      // without needing to fetch data points.
      distance_miles: run.distance_miles != null ? run.distance_miles * sf : null,
    });
  }
  return inherited;
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
      .select(`*, runs(*, data_points(count)), vehicle_tags(tags(id, name)), vehicle_performance(*), manufacturers(id,name,country), spec_links!spec_links_target_vehicle_id_fkey(id, source_run_id, scaling_factor, notes, is_default, color)`)
      .order('created_at', { ascending: false });

    // Pass 1: process each vehicle's own data
    const processed = (data || []).map(v => {
      // Merge promoted performance fields into specs.performance transparently
      const perf = v.vehicle_performance;
      if (perf) {
        const { vehicle_id, updated_at, ...perfFields } = perf;
        v.specs = {
          ...(v.specs || {}),
          performance: { ...(v.specs?.performance || {}), ...perfFields },
        };
      }
      delete v.vehicle_performance;

      // Flatten manufacturer object
      const manufacturer = v.manufacturers ?? null;
      delete v.manufacturers;

      return {
        ...v,
        manufacturer,                    // { id, name, country } or null
        spec_links: v.spec_links || [],  // raw link rows (kept for admin UI)
        tags:  (v.vehicle_tags || []).map(vt => vt.tags).filter(Boolean),
        runs:  (v.runs || []).map(r => ({
          ...r,
          // Normalise DB snake_case to the camelCase used throughout the app.
          isDefault: !!r.is_default,
          // data_points(count) returns [{ count: N }]; normalise to a plain number
          dataPointCount: Array.isArray(r.data_points) ? (r.data_points[0]?.count ?? 0) : 0,
        })),
      };
    });

    // Pass 2: build flat run lookup maps, then attach inherited runs.
    // buildInheritedRuns needs to locate source runs across all vehicles.
    const runById      = new Map(); // runId → run object
    const runToVehicle = new Map(); // runId → { vehicleId, vehicleName }
    for (const v of processed) {
      for (const r of v.runs) {
        runById.set(Number(r.id), r);
        runToVehicle.set(Number(r.id), { vehicleId: v.id, vehicleName: vehicleLabel(v) });
      }
    }

    return processed.map(v => ({
      ...v,
      runs: [...v.runs, ...buildInheritedRuns(v, runById, runToVehicle)],
    }));
  }

  // ── Manufacturers ─────────────────────────────────────────────────────────

  async getManufacturers() {
    if (!this.useSupabase) return [];
    const { data, error } = await getSupabase().from('manufacturers').select('*').order('name');
    if (error) throw error;
    return data || [];
  }

  async addManufacturer(name, country = null) {
    const { data, error } = await getSupabase()
      .from('manufacturers')
      .insert({ name, country: country || null })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async updateManufacturer(id, { name, country }) {
    const { error } = await getSupabase()
      .from('manufacturers')
      .update({ name, country: country || null })
      .eq('id', id);
    if (error) throw error;
  }

  async deleteManufacturer(id) {
    const { error } = await getSupabase().from('manufacturers').delete().eq('id', id);
    if (error) throw error;
  }

  // ── Spec links ────────────────────────────────────────────────────────────

  async addSpecLink({ targetVehicleId, sourceRunId, scalingFactor, notes }) {
    const { data, error } = await getSupabase()
      .from('spec_links')
      .insert({
        target_vehicle_id: targetVehicleId,
        source_run_id:     sourceRunId,
        scaling_factor:    scalingFactor != null && scalingFactor !== '' ? Number(scalingFactor) : null,
        notes:             notes || null,
        created_by:        this.user?.id ?? null,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async updateSpecLink(id, changes, targetVehicleId = null) {
    // When promoting an inherited run to default, first clear all existing
    // defaults for this vehicle so exactly one is ever marked at a time.
    if (changes.useAsDefault && targetVehicleId) {
      await getSupabase().from('runs').update({ is_default: false }).eq('vehicle_id', targetVehicleId);
      await getSupabase().from('spec_links').update({ is_default: false }).eq('target_vehicle_id', targetVehicleId);
    }
    const payload = {};
    if ('scalingFactor' in changes) {
      payload.scaling_factor = changes.scalingFactor != null && changes.scalingFactor !== ''
        ? Number(changes.scalingFactor) : null;
    }
    if ('useAsDefault' in changes) {
      payload.is_default = !!changes.useAsDefault;
    }
    if ('color' in changes) {
      payload.color = changes.color || null;
    }
    const { error } = await getSupabase()
      .from('spec_links')
      .update(payload)
      .eq('id', id);
    if (error) throw error;
  }

  /**
   * Fetches data points for a range-test run and returns a linear interpolation
   * function (soc → range in display miles/km).  Returns null when there are
   * fewer than two usable SoC+range point pairs.
   */
  async buildRangePerSocLookup(rangeTestRunId) {
    const data = await this.getRunData(rangeTestRunId);
    const pts = data
      .filter(p => p.soc != null && p.range != null)
      .sort((a, b) => a.soc - b.soc);
    if (pts.length < 2) return null;
    return (soc) => {
      if (soc <= pts[0].soc)              return pts[0].range;
      if (soc >= pts[pts.length - 1].soc) return pts[pts.length - 1].range;
      const hi = pts.findIndex(p => p.soc >= soc);
      const lo = hi - 1;
      const t = (soc - pts[lo].soc) / (pts[hi].soc - pts[lo].soc);
      return Math.round((pts[lo].range + t * (pts[hi].range - pts[lo].range)) * 10) / 10;
    };
  }

  async deleteSpecLink(id) {
    const { error } = await getSupabase().from('spec_links').delete().eq('id', id);
    if (error) throw error;
  }

  // ── Tags ──────────────────────────────────────────────────────────────────

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
      manufacturer_id: vehicle.manufacturer_id ? Number(vehicle.manufacturer_id) : null,
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
      power: updates.power ? parseFloat(updates.power) : null,
      ...(updates.manufacturer_id !== undefined
        ? { manufacturer_id: updates.manufacturer_id ? Number(updates.manufacturer_id) : null }
        : {}),
    }).eq('id', vehicleId);
    if (error) throw error;
  }

  async updateVehicleSpecs(vehicleId, specs, specSourceVehicleId = undefined) {
    if (!this.useSupabase || !this.user) return;
    const { performance, ...otherSpecs } = specs;
    const { promoted, remaining } = splitPerformance(performance);

    // Upsert promoted fields to dedicated vehicle_performance table
    if (Object.keys(promoted).length > 0) {
      const { error: perfError } = await getSupabase()
        .from('vehicle_performance')
        .upsert({ vehicle_id: vehicleId, ...promoted }, { onConflict: 'vehicle_id' });
      if (perfError) throw perfError;
    }

    // Save remaining performance fields + all other spec categories to JSONB.
    // Optionally persist the inheritance source alongside the overrides.
    const finalSpecs = remaining ? { ...otherSpecs, performance: remaining } : otherSpecs;
    const update = { specs: finalSpecs };
    if (specSourceVehicleId !== undefined) {
      update.spec_source_vehicle_id = specSourceVehicleId ? Number(specSourceVehicleId) : null;
    }
    const { error } = await getSupabase()
      .from('vehicles')
      .update(update)
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
    return newVehicle;
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

  // ── Copy run to a different vehicle ───────────────────────────────────────

  async copyRunToVehicle(run, targetVehicleId) {
    const points = await this.getRunData(run.id);
    return await this.addRun(targetVehicleId, {
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
    // Accept both camelCase (from form/context) and snake_case (from raw DB rows,
    // e.g. when duplicating a run that came directly out of getVehicles()).
    const coalesce = (camel, snake) => camel !== undefined ? camel : snake;
    const numField = (camel, snake) => {
      const v = coalesce(camel, snake);
      return v != null && v !== '' ? Number(v) : null;
    };
    const { data: newRun, error } = await getSupabase().from('runs').insert({
      vehicle_id: vehicleId, name: run.name, date: run.date,
      software_version: coalesce(run.softwareVersion,   run.software_version)  || null,
      conditions: run.conditions || null,
      color: run.color || '#3b82f6',
      is_default: coalesce(run.isDefault,  run.is_default)  || false,
      synthetic:  coalesce(run.synthetic,  run.synthetic)   || false,
      has_charging: coalesce(run.hasCharging, run.has_charging) ?? true,
      has_range:    coalesce(run.hasRange,    run.has_range)    ?? false,
      source: run.source || null,
      start_soc:         numField(run.startSoc,        run.start_soc),
      end_soc:           numField(run.endSoc,          run.end_soc),
      speed_mph:         numField(run.speedMph,        run.speed_mph),
      distance_miles:    numField(run.distanceMiles,   run.distance_miles),
      energy_kwh:        numField(run.energyKwh,       run.energy_kwh),
      temperature_f:     numField(run.temperatureF,    run.temperature_f),
      elevation_gain_ft: numField(run.elevationGainFt, run.elevation_gain_ft),
      url: run.url || null,
      charging_url: coalesce(run.chargingUrl, run.charging_url) || null,
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

  async clearDefaultRun(vehicleId) {
    if (!this.useSupabase || !this.user) return;
    await getSupabase().from('runs').update({ is_default: false }).eq('vehicle_id', vehicleId);
    await getSupabase().from('spec_links').update({ is_default: false }).eq('target_vehicle_id', vehicleId);
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
    // Clear all defaults for this vehicle first (runs + inherited links) so
    // exactly one run is ever marked as default at a time.
    await getSupabase().from('runs').update({ is_default: false }).eq('vehicle_id', vehicleId);
    await getSupabase().from('spec_links').update({ is_default: false }).eq('target_vehicle_id', vehicleId);
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

  async getRunData(runId, scalingFactor = 1) {
    // Inherited runs carry synthetic string ids like "inherited_<linkId>_<realRunId>".
    // Strip the prefix to get the real DB run id.
    const actualId = typeof runId === 'string' && runId.startsWith('inherited_')
      ? parseInt(runId.split('_').pop(), 10)
      : runId;
    const { data, error } = await getSupabase()
      .from('data_points')
      .select('*')
      .eq('run_id', actualId)
      .order('frame', { ascending: true });
    if (error) throw error;
    return (data || []).map(p => ({
      frame:       p.frame,
      timestamp:   p.timestamp,
      soc:         p.soc,
      chargeRate:  p.charge_rate,
      time:        p.time_value,
      // Scale range_value for inherited runs so charts reflect the target vehicle
      range:       p.range_value != null && scalingFactor !== 1
        ? p.range_value * scalingFactor
        : p.range_value,
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

  // ── Voting ─────────────────────────────────────────────────────────────────

  /**
   * Returns (or creates) the persistent browser token stored in localStorage.
   * Used as a client-side identity for vote deduplication.
   */
  getBrowserToken() {
    let t = localStorage.getItem('evbench_browser_token');
    if (!t) {
      t = crypto.randomUUID();
      localStorage.setItem('evbench_browser_token', t);
    }
    return t;
  }

  /**
   * Fetch vouch count and whether the current browser has vouched
   * for a vehicle's specs.
   * Returns { count: number, myVouch: boolean }
   */
  async getVehicleSpecVouches(vehicleId) {
    if (!this.useSupabase) return { count: 0, myVouch: false };
    const token = this.getBrowserToken();
    const sb = getSupabase();

    const [{ count }, { data: mine }] = await Promise.all([
      sb.from('votes')
        .select('*', { count: 'exact', head: true })
        .eq('target_type', 'vehicle_specs')
        .eq('target_id', vehicleId)
        .eq('vote_type', 'vouch'),
      sb.from('votes')
        .select('id')
        .eq('target_type', 'vehicle_specs')
        .eq('target_id', vehicleId)
        .eq('vote_type', 'vouch')
        .eq('browser_token', token)
        .maybeSingle(),
    ]);
    return { count: count ?? 0, myVouch: !!mine };
  }

  /**
   * Toggle a vouch on a vehicle's specs.
   * If the current browser has already vouched → removes the vouch.
   * Otherwise → inserts a vouch.
   * Returns updated { count, myVouch }.
   */
  async toggleSpecVouch(vehicleId) {
    if (!this.useSupabase) return { count: 0, myVouch: false };
    const token = this.getBrowserToken();
    const sb = getSupabase();

    const { data: existing } = await sb.from('votes')
      .select('id')
      .eq('target_type', 'vehicle_specs')
      .eq('target_id', vehicleId)
      .eq('vote_type', 'vouch')
      .eq('browser_token', token)
      .maybeSingle();

    if (existing) {
      await sb.from('votes').delete().eq('id', existing.id);
    } else {
      await sb.from('votes').insert({
        target_type: 'vehicle_specs',
        target_id: vehicleId,
        vote_type: 'vouch',
        browser_token: token,
      });
    }
    return this.getVehicleSpecVouches(vehicleId);
  }

  /**
   * Fetch vouch/flag counts and the current browser's vote for each run in runIds.
   * Returns { [runId]: { vouch: number, flag: number, myVote: 'vouch'|'flag'|null } }
   */
  async getRunVotes(runIds) {
    if (!this.useSupabase || !runIds.length) return {};
    const token = this.getBrowserToken();
    const sb = getSupabase();

    const [{ data: all }, { data: mine }] = await Promise.all([
      sb.from('votes')
        .select('target_id, vote_type')
        .eq('target_type', 'run')
        .in('target_id', runIds),
      sb.from('votes')
        .select('target_id, vote_type')
        .eq('target_type', 'run')
        .in('target_id', runIds)
        .eq('browser_token', token),
    ]);

    const result = {};
    for (const id of runIds) {
      result[id] = { vouch: 0, flag: 0, myVote: null };
    }
    for (const row of (all || [])) {
      if (result[row.target_id]) result[row.target_id][row.vote_type]++;
    }
    for (const row of (mine || [])) {
      if (result[row.target_id]) result[row.target_id].myVote = row.vote_type;
    }
    return result;
  }

  /**
   * Toggle a vouch or flag on a run.
   * If the browser's current vote matches voteType → removes it (toggle off).
   * If the browser has a different vote → replaces it.
   * Returns updated { vouch, flag, myVote } for that run.
   */
  async toggleRunVote(runId, voteType) {
    if (!this.useSupabase) return { vouch: 0, flag: 0, myVote: null };
    const token = this.getBrowserToken();
    const sb = getSupabase();

    const { data: existing } = await sb.from('votes')
      .select('id, vote_type')
      .eq('target_type', 'run')
      .eq('target_id', runId)
      .eq('browser_token', token)
      .maybeSingle();

    if (existing?.vote_type === voteType) {
      // Same vote — toggle off
      await sb.from('votes').delete().eq('id', existing.id);
    } else {
      if (existing) await sb.from('votes').delete().eq('id', existing.id);
      await sb.from('votes').insert({
        target_type: 'run',
        target_id: runId,
        vote_type: voteType,
        browser_token: token,
      });
    }
    const updated = await this.getRunVotes([runId]);
    return updated[runId] ?? { vouch: 0, flag: 0, myVote: null };
  }

  /**
   * Flag a specific spec field on a vehicle as potentially inaccurate.
   * Idempotent — no-op if already flagged.
   * fieldKey format: 'category.fieldKey' e.g. 'powertrain.horsepower_hp'
   */
  async flagSpecField(vehicleId, fieldKey) {
    if (!this.useSupabase) return;
    const { error } = await getSupabase().rpc('flag_spec_field', {
      p_vehicle_id: vehicleId,
      p_field_key: fieldKey,
    });
    if (error) throw error;
  }

  /**
   * Remove a flag from a specific spec field. Admin only (enforced in AppContext).
   */
  async unflagSpecField(vehicleId, fieldKey) {
    if (!this.useSupabase) return;
    const { error } = await getSupabase().rpc('unflag_spec_field', {
      p_vehicle_id: vehicleId,
      p_field_key: fieldKey,
    });
    if (error) throw error;
  }
}

export const dataService = new DataService();

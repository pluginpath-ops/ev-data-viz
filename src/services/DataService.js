import { getSupabase } from './supabase';
import { RETIRED_RUN_COLOR } from '../utils/colorUtils';
import { fetchSiteSettings, updateCachedSetting, MODEL_CONSTANTS_KEY } from './siteSettings';
import { vehicleLabel } from '../utils/specHelpers';
import { passDown } from '../utils/vehicleDeletion';
import { roundTo, } from '../utils/unitConversions';
import { toSessionRow } from '../utils/testSessions';
import { rankFeCandidates } from '../utils/feGuideMatch';
import { promotionUpdates, demotionUpdates, acceptGuideUpdates, isCuratorOwned } from '../utils/feGuidePromotion';
import { selectTestForGuide } from '../utils/epaTestSelection';
import { planTestVehicleImport, uniqueCoveredModels } from '../utils/epaImportMerge';
import { planCertificationImport, guideLinkTarget, testGroupYear, isTestGroup } from '../utils/epaCertifications';
import { detectPopulatedFields, buildInheritedRunId, isInheritedRunId, isCompositeRun, parseInheritedRunId, runKindFrom, applyDefaultRun, clearDefaultRuns, scaleInheritedMagnitudes } from '../utils/runUtils';
import { summarizeChargeSession, isCurrentSummary } from '../utils/chargeWindows';
import { planCompositeRebuild, compositeEligible, mayHaveComposite } from '../utils/compositeCurve';
import { toPreconditioned } from '../utils/runPreconditioning';
import { toChargerClass } from '../utils/runChargerClass';
import { THUMB_MAX, THUMB_QUALITY, thumbPathFor, renderToJpegBlob, loadBitmapFromUrl } from '../utils/imageRenditions';

const roundField = roundTo;

/**
 * How many rows PostgREST will return for one request.
 *
 * Supabase caps a response at `db-max-rows` (1000 by default) and says nothing
 * about it — no error, no flag, just a short array. A read that outgrows the
 * cap therefore returns a confidently wrong answer. That is how the Fuel
 * Economy Guide import summary came to show 2024-2027 and silently omit 2022
 * and 2023: the four visible years summed to precisely 1000 rows.
 *
 * Where the answer is an aggregate, the fix is to aggregate in Postgres — see
 * migration 054 — because that returns one row per test vehicle and never approaches
 * the cap. Paging is for the reads that genuinely want every row.
 */
const PAGE_SIZE = 1000;

/**
 * Read every row a query matches, a page at a time.
 *
 * `builder` must be a function returning a FRESH PostgREST query, not a query
 * object — a builder is single-use, and calling `.range()` on one twice mutates
 * the same request rather than producing two.
 *
 * The caller's ordering must be unique for paging to be sound: with a
 * non-unique sort key, rows tie and Postgres may order them differently between
 * requests, which drops some and repeats others across the page boundary.
 * Order by `id`, or add it as a tiebreaker.
 */
export async function fetchAllRows(builder) {
  const out = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await builder().range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    out.push(...(data || []));
    // A short page means the end. A full one is ambiguous, so it costs one more
    // request that comes back empty.
    if (!data || data.length < PAGE_SIZE) return out;
  }
}

/**
 * How long a stored image object may be cached. Safe at a year only because
 * every stored URL carries a ?v= stamp written at upload time — see
 * #putVehicleImageObject. Objects predating that carry Supabase Storage's
 * default of no-cache and revalidate on every page load.
 */
const IMAGE_CACHE_SECONDS = 31536000;

/**
 * Whether an error means the table or function simply is not there yet.
 *
 * Migrations are applied by hand in the Supabase SQL editor, so a deploy can
 * lead its schema by hours or days. Features reading a brand-new relation
 * degrade to their un-migrated behaviour instead of erroring — an un-merged
 * brand list is a worse page, not a broken one.
 *
 * Deliberately narrow: only "undefined table" (42P01), "undefined function"
 * (42883) and PostgREST's own "no such function" (PGRST202). Anything else —
 * permission, syntax, a genuine failure — still throws.
 */
/** Whether an error means a COLUMN is absent — a migration not yet applied. */
function isMissingColumn(error) {
  return error?.code === '42703';
}

function isMissingRelation(error) {
  const code = error?.code;
  return code === '42P01' || code === '42883' || code === 'PGRST202';
}

/**
 * An embed PostgREST could not resolve: no relationship to that name
 * (PGRST200), or a table or column the database does not have. getVehicles
 * uses it to survive the window between a deploy and migration 081.
 */
function isMissingEpaEmbed(error) {
  return error?.code === 'PGRST200' || isMissingRelation(error) || isMissingColumn(error);
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

/**
 * A data_points row as the app holds it — the one mapping getRunData and the
 * batched getPointsForRuns share.
 */
function shapePoint(p, efficiencyFactor = 1, capacityFactor = 1) {
  return {
    frame:       p.frame,
    timestamp:   p.timestamp,
    soc:         p.soc,
    // Same rule as buildInheritedRuns, by what the field IS rather than what
    // kind of run it sits on — a charging test carries a range readout too,
    // and it is still a distance:
    //
    //   charge_rate (power)  → × cap        a bigger pack pulls more kW
    //   range_value (distance) → × cap × eff  remaining range is range
    //
    // Time is untouched in both cases: these scale magnitude, not the axis
    // the magnitude is plotted against.
    //
    // Each rounds back to its own column's precision (charge_rate is
    // numeric(8,2), range_value numeric(8,1)) so a scaled point claims no
    // more precision than the measurement behind it.
    chargeRate:  p.charge_rate != null && capacityFactor !== 1
      ? roundField(p.charge_rate * capacityFactor, 2)
      : p.charge_rate,
    time:        p.time_value,
    range:       p.range_value != null && (efficiencyFactor !== 1 || capacityFactor !== 1)
      ? roundField(p.range_value * capacityFactor * efficiencyFactor, 1)
      : p.range_value,
    temperature: p.temperature,
    // A composite curve's points carry how many tests stand behind them and
    // their test spread (migration 077); a test's points carry none.
    ...(p.extra_data?.n != null ? {
      n:        p.extra_data.n,
      spreadHi: p.extra_data.spreadHi ?? null,
      spreadLo: p.extra_data.spreadLo ?? null,
    } : {}),
  };
}

/**
 * A runs row as the app holds it. The one door every run comes through —
 * getVehicles, and a vehicle's runs re-read after its composites are rebuilt —
 * so the two can never shape a run differently.
 */
function shapeRun(r) {
  return {
    ...r,
    // Color belongs to the vehicle now (#308). The stored value is left
    // in the database and replaced HERE, at the one door every run comes
    // through, so a read we missed anywhere downstream paints magenta
    // rather than silently keeping the old per-run color alive.
    color: RETIRED_RUN_COLOR,
    // Normalise DB snake_case to the camelCase used throughout the app.
    isDefault: !!r.is_default,
    // Unlisted (#394: is_hidden narrowed to this in migration 079) and
    // excluded from the statistics — two questions, see utils/runListing.js.
    isHidden:  !!r.is_hidden,
    // Before migration 079 the column does not exist, and a hidden test meant
    // an untrusted one — so read it as excluded, as the backfill would. Either
    // order of deploy and migration then leaves the statistics unchanged.
    isExcluded: r.is_excluded === undefined ? !!r.is_hidden : !!r.is_excluded,
    // A curator's "I have looked; count it" (migration 080, runListing).
    qualityOverride: !!r.quality_override,
    // data_points(count) returns [{ count: N }]; normalise to a plain number
    dataPointCount: Array.isArray(r.data_points) ? (r.data_points[0]?.count ?? 0) : 0,
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
    // Two independent knobs (migration 055). Null reads as 1 for both, so a
    // link predating the split keeps exactly its old meaning.
    const eff = link.efficiency_factor != null ? Number(link.efficiency_factor) : 1;
    const cap = link.capacity_factor   != null ? Number(link.capacity_factor)   : 1;
    inherited.push({
      ...run,
      // Synthetic id prevents runDataCache collision when both source and
      // target vehicles are selected simultaneously in charts.
      id:                buildInheritedRunId(link.id, run.id),
      _inherited:         true,
      _realRunId:         run.id,
      _efficiencyFactor:  eff,
      _capacityFactor:    cap,
      _specLinkId:        link.id,
      _sourceVehicleId:   vInfo?.vehicleId,
      _sourceVehicleName: vInfo?.vehicleName,
      // The link's own color still overrides, and is a separate stored value
      // from the retired run color. Without one the inherited run falls through
      // to the TARGET vehicle's curated color, which is the vehicle it is
      // being read as — see #308.
      color:          link.color ?? RETIRED_RUN_COLOR,
      // is_default on the link row gives per-run default precision.
      isDefault:      !!link.is_default,
      // Which factor reaches which field is the arithmetic that makes the two
      // knobs independent, so it lives in one tested place rather than here.
      ...scaleInheritedMagnitudes(run, cap, eff),
    });
  }
  return inherited;
}

/**
 * Everything the EPA views read from a certification record: the curve, its
 * η, the methodology card. One list, shared by getVehicles and
 * getModeledEfficiencyPreview, so an explainer's preview can never be built
 * from less of the record than the chart it links to.
 */
const EPA_TEST_VEHICLE_FIELDS = 'test_vehicle_id, test_group, model_year, make, epa_carline_name, drive, transmission, fuel_type, vehicle_config_number, evap_family, useable_kwh, total_voltage, battery_specific_energy, accessory_load_w_override, charger_efficiency_override, label_combined_mpge, label_hwy_mpge, label_range_published, label_city_mpge, label_city_range_mi, label_hwy_range_mi, unadj_city_mpge, unadj_hwy_mpge, adj_city_mpge, adj_hwy_mpge, label_adjustment_factor, label_calc_approach, nominal_pack_kwh, fe_guide_row_id, overrides, cd_range_combined_calc, cd_range_hwy_calc, preferred_test_number, derived_5cycle_coefficient, display_name, epa_coefficient_sets(id, category, is_primary, target_a, target_b, target_c, set_a, set_b, set_c, equiv_test_weight_lbs), epa_tests(id, test_number, test_date, procedure_code, total_dc_energy_kwh, ac_recharge_kwh, cd_range_combined_calc, cd_range_hwy_calc, epa_test_phases(id, phase_index, phase_type, dc_energy_kwh, distance_mi)), epa_fe_guide!epa_test_vehicles_fe_guide_row_id_fkey(adjustment_signature)';

class DataService {
  constructor() {
    this.user = null;
    this.role = null; // 'admin' | 'contributor' | 'user' | null (unauthenticated)
    this.useSupabase = false;
    // Whether migration 072's platform columns exist; set by getPlatforms().
    this.platformsAvailable = false;
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
    // NOTE: performance_summaries / performance_intervals are deliberately NOT
    // embedded here. This query backs the entire app, and a nested select against
    // a table that doesn't exist yet fails the WHOLE query — which previously
    // surfaced as "No vehicles yet" on any environment where the newest migration
    // hadn't been applied. Performance data is fetched separately, where a missing
    // table degrades to "no performance data" instead of "no vehicles".
    //
    // spec_links is embedded as `(*)` for the same reason, one level down: a
    // NAMED column that does not exist yet fails just as hard as a missing
    // table. Listing efficiency_factor / capacity_factor explicitly (migration
    // 055) blanked the entire site against an un-migrated database. A wildcard
    // brings the new columns back as undefined instead, which reads as a null
    // factor, which reads as 1 — so inheritance is merely unscaled until the
    // migration lands, and every other vehicle still renders.
    //
    // epa_vehicle_mappings is a wildcard for the same reason: `is_primary`
    // arrives with migration 067, and naming it would blank the site until then.
    const base = '*, runs(*, data_points(count)), vehicle_tags(tags(id, name)), vehicle_performance(*), manufacturers(id,name,country), spec_links!spec_links_target_vehicle_id_fkey(*)';
    const query = (select) => getSupabase()
      .from('vehicles')
      .select(select)
      .order('created_at', { ascending: false });
    let { data, error } = await query(`${base}, epa_vehicle_mappings(*, epa_test_vehicles(${EPA_TEST_VEHICLE_FIELDS}))`);

    // Migration 081 renames the EPA tables, and it is applied by hand after
    // the deploy. Until it is, the EPA embed names a table that does not exist
    // yet — and because this one query backs the whole app, that would blank
    // the site, not just its EPA figures. So an EPA embed the database cannot
    // resolve is dropped and the vehicles load without it. Remove once 081 is
    // applied (#374 step 2, layer 4).
    if (error && isMissingEpaEmbed(error)) {
      console.warn('getVehicles: EPA tables not readable under their current names; loading without EPA data.', error.message);
      ({ data, error } = await query(base));
    }

    // Never swallow this. Destructuring only `data` made a failed query look
    // identical to an empty account, which turned a missing migration into a
    // silent "No vehicles yet" that took a live debugging session to trace.
    if (error) {
      console.error('getVehicles failed:', error.message, error);
      throw error;
    }

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
        epa_mappings: (v.epa_vehicle_mappings || []).map(m => ({
          id:        m.id,
          confidence: m.confidence,
          notes:     m.notes,
          // Undefined before migration 067, which reads as not primary;
          // primaryEpaMapping still treats a sole link as the vehicle's.
          isPrimary: m.is_primary === true,
          epaTestVehicle:  m.epa_test_vehicles,
        })),
        tags:  (v.vehicle_tags || []).map(vt => vt.tags).filter(Boolean),
        runs:  (v.runs || []).map(shapeRun),
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

  // ── Test sessions ──────────────────────────────────────────────────────────
  //
  // A session is one testing outing: same day, same road, same weather, same
  // crew. It deliberately has NO vehicle_id (migration 044) because the outings
  // worth recording are often side-by-side — four cars round one loop — and the
  // shared conditions are the point.
  //
  // Fetched globally rather than per vehicle for the same reason: a session a
  // vehicle belongs to may have been created while curating a different one.

  async getTestSessions() {
    if (!this.useSupabase) return [];
    const { data, error } = await getSupabase()
      .from('test_sessions').select('*').order('tested_at', { ascending: false, nullsFirst: false });
    if (error) throw error;
    return data || [];
  }

  async createTestSession(fields) {
    const { data, error } = await getSupabase()
      .from('test_sessions')
      .insert(toSessionRow(fields))
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async updateTestSession(id, changes) {
    const { error } = await getSupabase()
      .from('test_sessions').update(toSessionRow(changes)).eq('id', id);
    if (error) throw error;
  }

  async deleteTestSession(id) {
    // runs.session_id is ON DELETE SET NULL, so the runs survive unattached.
    const { error } = await getSupabase().from('test_sessions').delete().eq('id', id);
    if (error) throw error;
  }

  /**
   * Attach runs to a session, or detach them with a null sessionId.
   *
   * Takes a LIST because a session is usually assigned to several runs at once —
   * eight in a two-car speed sweep — and one round trip per run is the shape
   * that makes bulk assignment feel like a chore.
   */
  async setRunsSession(runIds, sessionId) {
    if (!this.useSupabase || !runIds?.length) return;
    const real = runIds.filter(id => !isInheritedRunId(id)).map(Number);
    if (!real.length) return;
    const { error } = await getSupabase()
      .from('runs').update({ session_id: sessionId ?? null }).in('id', real);
    if (error) throw error;
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

  // ── Brand registry (#149, #243) ───────────────────────────────────────────
  //
  // `manufacturers` is the one registry; `brand_aliases` maps every other
  // spelling into it — EPA division strings, legacy make text, typos. See
  // migration 057.

  /**
   * Every alias, for resolving a raw name to a brand.
   *
   * Small by construction (one row per spelling, tens not thousands), so it is
   * fetched whole once and resolved in memory rather than joined per row.
   *
   * Returns [] rather than throwing when the table is absent: migration 057 may
   * not be applied yet, and the FE Guide browser must still render — un-merged
   * brands are a worse page, not a broken one.
   */
  async getBrandAliases() {
    if (!this.useSupabase) return [];
    const { data, error } = await getSupabase()
      .from('brand_aliases')
      .select('id, manufacturer_id, alias, alias_key, source, manufacturers(id, name, parent_name)')
      .order('alias');
    if (error) {
      if (isMissingRelation(error)) return [];
      throw error;
    }
    return data || [];
  }

  async addBrandAlias(manufacturerId, alias, source = 'manual') {
    const { data, error } = await getSupabase()
      .from('brand_aliases')
      .insert({ manufacturer_id: manufacturerId, alias, source })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async deleteBrandAlias(id) {
    const { error } = await getSupabase().from('brand_aliases').delete().eq('id', id);
    if (error) throw error;
  }

  /**
   * Every distinct EPA division with its configuration count and resolved brand.
   *
   * Server-side for the reason migration 054 exists: 1,175 guide rows against a
   * silent 1,000-row cap means counting divisions in the browser under-reports
   * them, and a division that never appears is a decision nobody knows they
   * have to make.
   */
  async getBrandDivisionSummary() {
    if (!this.useSupabase) return [];
    const { data, error } = await getSupabase().rpc('brand_division_summary');
    if (error) {
      if (isMissingRelation(error)) return [];
      throw error;
    }
    return (data || []).map(r => ({
      division:       r.division,
      rowCount:       Number(r.row_count),
      manufacturerId: r.manufacturer_id,
      brandName:      r.brand_name,
      parentName:     r.parent_name,
    }));
  }

  /**
   * Vehicle / alias / guide-row counts per brand — drives "safe to delete?".
   *
   * Returns **null**, not {}, when the function is absent. The difference
   * matters: a caller cannot tell "this brand has no vehicles" from "we could
   * not find out", and treating the second as the first would enable Delete on
   * every brand while the migration is unapplied — which nulls the FK on real
   * vehicles and strands `vehicles.make` at a name the registry no longer
   * holds. Unknown must read as unknown.
   */
  async getBrandUsageSummary() {
    if (!this.useSupabase) return null;
    const { data, error } = await getSupabase().rpc('brand_usage_summary');
    if (error) {
      if (isMissingRelation(error)) return null;
      throw error;
    }
    const byId = {};
    for (const r of data || []) {
      byId[r.manufacturer_id] = {
        vehicles:  Number(r.vehicle_count),
        aliases:   Number(r.alias_count),
        guideRows: Number(r.guide_row_count),
      };
    }
    return byId;
  }

  /**
   * Fold one brand into another.
   *
   * A single RPC rather than a sequence of writes from here, because the steps
   * are not independent: repointing the FK without rewriting `vehicles.make`
   * leaves every card showing the spelling the merge was meant to remove, and a
   * half-applied merge is worse than none. See migration 057.
   */
  async mergeManufacturers(fromId, intoId) {
    const { error } = await getSupabase().rpc('merge_manufacturers', {
      p_from: Number(fromId), p_into: Number(intoId),
    });
    if (error) throw error;
  }

  // ── Tags ──────────────────────────────────────────────────────────────────
  // (list/create/sync live with the vehicle methods above)

  async updateTag(id, name) {
    const { error } = await getSupabase().from('tags').update({ name }).eq('id', id);
    if (error) throw error;
  }

  /**
   * Delete a tag and its vehicle links.
   *
   * The join rows are removed explicitly rather than relying on a cascade:
   * `tags` and `vehicle_tags` predate this repo's migrations directory, so the
   * FK's delete behaviour is not stated anywhere we control, and a missing
   * cascade would fail the delete instead of orphaning it.
   */
  async deleteTag(id) {
    const supabase = getSupabase();
    const { error: linkError } = await supabase.from('vehicle_tags').delete().eq('tag_id', id);
    if (linkError) throw linkError;
    const { error } = await supabase.from('tags').delete().eq('id', id);
    if (error) throw error;
  }

  /** Move every vehicle on one tag to another, then drop the empty one. */
  async mergeTags(fromId, intoId) {
    const supabase = getSupabase();
    const { data: fromLinks, error: readError } = await supabase
      .from('vehicle_tags').select('vehicle_id').eq('tag_id', fromId);
    if (readError) throw readError;

    const { data: intoLinks, error: intoError } = await supabase
      .from('vehicle_tags').select('vehicle_id').eq('tag_id', intoId);
    if (intoError) throw intoError;

    // Skip vehicles that already carry the target tag: (vehicle_id, tag_id) is
    // the primary key, so re-inserting one fails the whole batch.
    const already = new Set((intoLinks || []).map(l => l.vehicle_id));
    const toAdd = (fromLinks || [])
      .map(l => l.vehicle_id)
      .filter(id => !already.has(id));

    if (toAdd.length > 0) {
      const { error } = await supabase
        .from('vehicle_tags')
        .insert(toAdd.map(vehicle_id => ({ vehicle_id, tag_id: intoId })));
      if (error) throw error;
    }
    await this.deleteTag(fromId);
  }

  // ── Chart help ("About this chart" copy) ──────────────────────────────────

  /**
   * Fetch all chart-help rows as a map keyed by chart_key. {} in local mode.
   * Resilient: if the table is missing (migration 031 not yet applied) or read
   * fails, returns {} so callers fall back to the bundled default copy rather
   * than blocking app load.
   */
  async getChartHelp() {
    if (!this.useSupabase) return {};
    try {
      const { data, error } = await getSupabase().from('chart_help').select('*');
      if (error) throw error;
      const map = {};
      for (const row of data || []) map[row.chart_key] = row;
      return map;
    } catch (err) {
      console.warn('chart_help unavailable — using bundled defaults:', err.message);
      return {};
    }
  }

  /**
   * Upsert the editable copy for one chart. `fields` is a subset of
   * { title, data_source, how_to_read, key_terms, math_approach }.
   * Returns the saved row.
   */
  async updateChartHelp(chartKey, fields) {
    const { data, error } = await getSupabase()
      .from('chart_help')
      .upsert(
        { chart_key: chartKey, ...fields, updated_at: new Date().toISOString(), updated_by: this.user?.id ?? null },
        { onConflict: 'chart_key' }
      )
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  // ── Spec links ────────────────────────────────────────────────────────────

  async addSpecLink({ targetVehicleId, sourceRunId, efficiencyFactor, capacityFactor, notes }) {
    const num = (v) => (v != null && v !== '' ? Number(v) : null);
    const { data, error } = await getSupabase()
      .from('spec_links')
      .insert({
        target_vehicle_id: targetVehicleId,
        source_run_id:     sourceRunId,
        efficiency_factor: num(efficiencyFactor),
        capacity_factor:   num(capacityFactor),
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
      // Inherited runs are charging curves, so promoting one must not clear the
      // vehicle's default RANGE test — see setDefaultRun.
      await getSupabase().from('runs')
        .update({ is_default: false }).eq('vehicle_id', targetVehicleId).eq('kind', 'charging');
      await getSupabase().from('spec_links').update({ is_default: false }).eq('target_vehicle_id', targetVehicleId);
    }
    const payload = {};
    if ('efficiencyFactor' in changes) {
      payload.efficiency_factor = changes.efficiencyFactor != null && changes.efficiencyFactor !== ''
        ? Number(changes.efficiencyFactor) : null;
    }
    if ('capacityFactor' in changes) {
      payload.capacity_factor = changes.capacityFactor != null && changes.capacityFactor !== ''
        ? Number(changes.capacityFactor) : null;
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

  /**
   * Store both renditions of a vehicle image and point the row at them.
   *
   * @param {number} vehicleId
   * @param {{ full: Blob, thumb: Blob }} renditions from utils/imageRenditions
   * The focal point goes back to null in the same patch. It frames ONE picture
   * -- "show the slice 30% down" is an answer about this photo and no other --
   * so carrying it onto a replacement would frame the new image by where the
   * old car's roof happened to be. Centered is the right starting point for a
   * photo nobody has looked at yet (#340).
   *
   * @returns {Promise<{ image_url: string, image_thumb_url: string, image_focal_y: null }>}
   */
  async uploadVehicleImage(vehicleId, renditions) {
    // Always store as JPEG — both blobs are produced by the crop/resize canvas step
    const fullPath = `${vehicleId}.jpg`;
    const thumbPath = thumbPathFor(fullPath);

    const [fullResult, thumbResult] = await Promise.all([
      this.#putVehicleImageObject(fullPath, renditions.full),
      this.#putVehicleImageObject(thumbPath, renditions.thumb),
    ]);

    const patch = { image_url: fullResult, image_thumb_url: thumbResult, image_focal_y: null };
    const { error: updateError } = await getSupabase()
      .from('vehicles').update(patch).eq('id', vehicleId);
    if (updateError) throw updateError;
    return patch;
  }

  /**
   * Upload one image object and return its public URL with a version query.
   *
   * The storage path is derived from the vehicle id, so replacing an image
   * reuses the same key. That is what makes the long cacheControl safe to set:
   * the ?v= stamp changes on every write, so a replaced image is a new URL to
   * every cache while the object itself can be held for a year. Without the
   * stamp a long max-age would pin the old picture in browsers indefinitely.
   */
  async #putVehicleImageObject(path, blob) {
    const { error } = await getSupabase().storage
      .from('vehicle-images')
      .upload(path, blob, {
        upsert: true,
        contentType: 'image/jpeg',
        cacheControl: String(IMAGE_CACHE_SECONDS),
      });
    if (error) throw error;
    const { data } = getSupabase().storage.from('vehicle-images').getPublicUrl(path);
    return `${data.publicUrl}?v=${Date.now()}`;
  }

  /**
   * Generate the missing card-sized rendition for vehicles that only have a
   * full-resolution image — the one-time catch-up for everything uploaded
   * before migration 051.
   *
   * Deliberately leaves image_url alone: the original is the copy we cannot
   * regenerate, and re-encoding it here would degrade it for no gain.
   *
   * @param {(done:number, total:number, label:string) => void} [onProgress]
   * @returns {Promise<{ updated:number, failures:Array<{id:number,name:string,error:string}> }>}
   */
  async backfillVehicleThumbnails(onProgress) {
    const { data, error } = await getSupabase()
      .from('vehicles')
      .select('id, name, image_url, image_thumb_url')
      .not('image_url', 'is', null)
      .is('image_thumb_url', null)
      .order('id');
    if (error) throw error;

    const pending = data || [];
    const failures = [];
    let updated = 0;

    // Sequential on purpose. This runs a handful of times in the life of the
    // project against ~25 rows; decoding several 1600x900 images at once is a
    // real memory spike in a browser tab, and a slow correct pass beats a fast
    // one that dies halfway with no record of where it stopped.
    for (const [index, vehicle] of pending.entries()) {
      onProgress?.(index, pending.length, vehicle.name || `#${vehicle.id}`);
      let bitmap;
      try {
        bitmap = await loadBitmapFromUrl(vehicle.image_url);
        const thumb = await renderToJpegBlob(bitmap, THUMB_MAX, THUMB_QUALITY);
        const thumbUrl = await this.#putVehicleImageObject(
          thumbPathFor(`${vehicle.id}.jpg`), thumb,
        );
        const { error: updateError } = await getSupabase()
          .from('vehicles').update({ image_thumb_url: thumbUrl }).eq('id', vehicle.id);
        if (updateError) throw updateError;
        updated++;
      } catch (err) {
        failures.push({ id: vehicle.id, name: vehicle.name, error: err.message });
      } finally {
        bitmap?.close();
      }
    }

    onProgress?.(pending.length, pending.length, '');
    return { updated, failures };
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
      user_id: this.user.id, name: vehicle.name, make: vehicle.make, model: vehicle.model, trim: vehicle.trim || null, year: vehicle.year,
      battery: vehicle.battery ? parseFloat(vehicle.battery) : null,
      range: vehicle.range ? parseFloat(vehicle.range) : null,
      power: vehicle.power ? parseFloat(vehicle.power) : null,
      manufacturer_id: vehicle.manufacturer_id ? Number(vehicle.manufacturer_id) : null,
      // Null rather than a default: null means "the palette chooses", and a
      // vehicle created without a color has not made a claim about one.
      color: vehicle.color || null,
      // Only when set: a database without migration 072 has no such columns,
      // and naming one there would refuse the whole insert.
      ...(this.platformsAvailable && vehicle.mechanical_platform_id ? { mechanical_platform_id: Number(vehicle.mechanical_platform_id) } : {}),
      ...(this.platformsAvailable && vehicle.electrical_platform_id ? { electrical_platform_id: Number(vehicle.electrical_platform_id) } : {}),
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
    // Every field guarded on PRESENCE, so a caller may send a partial update.
    //
    // Only manufacturer_id and color used to be. The rest were written
    // unconditionally, which turned "absent" into "null" -- and `power` has no
    // input on the edit form at all, so every save through it silently nulled a
    // column the vehicle record still has. A partial update was therefore not
    // merely unsupported, it was destructive: sending { color } alone would have
    // taken the name, make, model, trim, year, battery and range with it.
    //
    // Presence, not truthiness: an empty string is a real answer meaning "clear
    // this", and `|| null` INSIDE the guard is what carries that through.
    const patch = {};
    const set = (key, value) => { if (value !== undefined) patch[key] = value; };
    set('name',   updates.name);
    set('make',   updates.make);
    set('model',  updates.model);
    set('trim',   updates.trim || null);
    set('year',   updates.year);
    set('battery', updates.battery ? parseFloat(updates.battery) : (updates.battery === undefined ? undefined : null));
    set('range',   updates.range   ? parseFloat(updates.range)   : (updates.range   === undefined ? undefined : null));
    set('power',   updates.power   ? parseFloat(updates.power)   : (updates.power   === undefined ? undefined : null));
    set('manufacturer_id', updates.manufacturer_id !== undefined
        ? (updates.manufacturer_id ? Number(updates.manufacturer_id) : null)
        : undefined);
    // `|| null` is what lets the picker's Auto hand the vehicle back to the
    // palette rather than storing an empty string.
    set('color', updates.color !== undefined ? (updates.color || null) : undefined);
    // The two platform links (#318): an id, or empty for "none". Only where
    // migration 072 is applied: the form always sends them, and naming a
    // column that does not exist would refuse the whole save.
    if (this.platformsAvailable) {
      for (const key of ['mechanical_platform_id', 'electrical_platform_id']) {
        set(key, updates[key] !== undefined ? (updates[key] ? Number(updates[key]) : null) : undefined);
      }
    }
    // Null, not 0: the column is nullable and null means centered, so the form's
    // "not repositioned" and the database's are the same value rather than two
    // things that have to be mapped between. `?? null` rather than `|| null`
    // because 0 is a real answer here -- the top of the photo (#340).
    set('image_focal_y', updates.image_focal_y !== undefined
        ? (updates.image_focal_y === null || updates.image_focal_y === ''
            ? null : Math.round(Number(updates.image_focal_y)))
        : undefined);

    const { error } = await getSupabase().from('vehicles').update(patch).eq('id', vehicleId);
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

  /**
   * A vehicle that inherits everything from `source` and owns nothing yet.
   *
   * Identity fields are copied, because they are what the curator edits first:
   * the name gets " (variant)" so the new card is findable. Everything a reader
   * sees beyond that comes from the source at read time — specs through
   * `spec_source_vehicle_id`, color, photo and tags through the same pointer
   * (vehicleInheritance.js), and tests through one spec link per run in
   * `links` (variantLinkPlan). Color stays null on purpose: null inherits.
   *
   * Not atomic: a failure part-way leaves the vehicle with fewer links, which
   * the Tests & Data link list shows and can finish. The vehicle row is written
   * first so there is never a link without a vehicle.
   */
  async createVariant(source, links = []) {
    const newVehicle = await this.addVehicle({
      name: `${source.name} (variant)`,
      make: source.make, model: source.model, trim: source.trim, year: source.year,
      manufacturer_id: source.manufacturer_id ?? source.manufacturer?.id ?? null,
      color: null,
    });
    if (!this.useSupabase || !this.user) {
      // localStorage mode has no spec links; the pointer alone still inherits
      // specs, color, photo and tags.
      const saved = JSON.parse(localStorage.getItem('evData') || '{"vehicles":[]}');
      saved.vehicles = saved.vehicles.map(v => v.id === newVehicle.id ? { ...v, spec_source_vehicle_id: source.id } : v);
      localStorage.setItem('evData', JSON.stringify(saved));
      return { ...newVehicle, spec_source_vehicle_id: source.id };
    }
    const { error } = await getSupabase()
      .from('vehicles')
      .update({ spec_source_vehicle_id: source.id })
      .eq('id', newVehicle.id);
    if (error) throw error;
    for (const link of links) {
      await this.addSpecLink({ targetVehicleId: newVehicle.id, ...link, notes: null });
    }
    return { ...newVehicle, spec_source_vehicle_id: source.id };
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

  /**
   * Delete a vehicle, passing its own specs, color, photo and tags to the
   * vehicles that inherit from it and re-pointing them at its source, so none
   * of them changes what it shows (migration 075, utils/vehicleDeletion.js).
   */
  async deleteVehicle(vehicleId) {
    if (!this.useSupabase || !this.user) {
      const saved = localStorage.getItem('evData');
      const data = saved ? JSON.parse(saved) : { vehicles: [], selectedVehicles: [] };
      data.vehicles = passDown(data.vehicles, vehicleId);
      data.selectedVehicles = data.selectedVehicles.filter(id => id !== vehicleId);
      localStorage.setItem('evData', JSON.stringify(data));
      return;
    }
    const { error } = await getSupabase().rpc('delete_vehicle_passing_down', { p_vehicle_id: vehicleId });
    if (error) {
      // PGRST202: the function is not there yet. Falling back to a plain delete
      // would orphan the vehicle's variants, which is what the function exists
      // to prevent, so say what to do instead.
      if (error.code === 'PGRST202') {
        throw new Error('Migration 075 has not been applied, so a vehicle cannot be deleted without orphaning the vehicles that inherit from it.');
      }
      throw error;
    }
  }

  async addRun(vehicleId, run) {
    if (!this.useSupabase || !this.user) {
      const saved = localStorage.getItem('evData');
      const data = saved ? JSON.parse(saved) : { vehicles: [], selectedVehicles: [] };
      // No color assigned: a run does not own one since #308, and the chart
      // resolves it from the vehicle. The vehicle lookup that used to sit here
      // existed only to index the per-run palette by run count.
      const newRun = { ...run, id: Date.now() };
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
      is_default: coalesce(run.isDefault,  run.is_default)  || false,
      synthetic:  coalesce(run.synthetic,  run.synthetic)   || false,
      kind: runKindFrom(run),
      source: run.source || null,
      speed_basis: run.speedBasis || run.speed_basis || null,
      start_soc:         numField(run.startSoc,        run.start_soc),
      end_soc:           numField(run.endSoc,          run.end_soc),
      speed_mph:         numField(run.speedMph,        run.speed_mph),
      distance_miles:    numField(run.distanceMiles,   run.distance_miles),
      energy_kwh:        numField(run.energyKwh,       run.energy_kwh),
      charge_energy_kwh: numField(run.chargeEnergyKwh, run.charge_energy_kwh),
      temperature_f:     numField(run.temperatureF,    run.temperature_f),
      altitude_ft:       numField(run.altitudeFt,       run.altitude_ft),
      elevation_gain_ft: numField(run.elevationGainFt, run.elevation_gain_ft),
      avg_wind_speed_mph: numField(run.windSpeedMph,     run.avg_wind_speed_mph),
      wind_direction_deg: numField(run.windDirectionDeg, run.wind_direction_deg),
      source_url: coalesce(run.sourceUrl, run.source_url) || null,
      // Only when recorded: a test added without it never names a column an
      // unmigrated database lacks (migration 073).
      ...(toPreconditioned(run.preconditioned) != null ? { preconditioned: toPreconditioned(run.preconditioned) } : {}),
      // The same rule for the charger's class (migration 076).
      ...(toChargerClass(run.chargerVoltageClass ?? run.charger_voltage_class) != null
        ? { charger_voltage_class: toChargerClass(run.chargerVoltageClass ?? run.charger_voltage_class) } : {}),
    }).select().single();
    if (error) throw error;
    if (run.data?.length > 0) {
      const populatedFields = detectPopulatedFields(run.data);

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
      // Summarized from the points in hand — they were just written, so
      // reading them back would only cost a round trip. Import, duplicate and
      // copy all arrive here.
      if (newRun.kind === 'charging') {
        newRun.charge_summary = await this.writeChargeSummary(newRun.id, run.data);
      }
    }
    return { ...newRun, data: run.data };
  }

  // ── Charging summaries (#346) ─────────────────────────────────────────────
  //
  // A charging session's best 5/10/15-minute average charge rate, stored on
  // runs.charge_summary (migration 071) and recomputed by every call that
  // writes the session's points: addRun, mergeRunData, replaceRunData. The
  // wiring suite holds all three to it. Each vehicle's best is chosen at read
  // time (vehicleFigures.js), never stored.

  /**
   * Summarize points and store the result. A failure here never fails the
   * write that called it: the points are saved, and a stale or missing summary
   * is exactly what the Admin backfill recomputes.
   */
  async writeChargeSummary(runId, points) {
    try {
      const summary = { ...summarizeChargeSession(points), computedAt: new Date().toISOString() };
      const { error } = await getSupabase().from('runs').update({ charge_summary: summary }).eq('id', runId);
      if (error) throw error;
      return summary;
    } catch (err) {
      console.warn('[DataService] charge summary not written for run', runId, err?.message ?? err);
      return null;
    }
  }

  /** Re-read a session's points and re-summarize it; null for a range test. */
  async refreshChargeSummary(runId) {
    const { data: run } = await getSupabase().from('runs').select('kind').eq('id', runId).single();
    if (run?.kind !== 'charging') return null;
    return this.writeChargeSummary(runId, await this.getRunData(runId));
  }

  /**
   * Summarize every charging session whose summary is missing or from an older
   * version of the calculation (Admin → Data checks). One session at a time:
   * each read is a whole time series, and a backfill has no deadline.
   */
  async backfillChargeSummaries({ all = false, onProgress } = {}) {
    const { data: runs, error } = await getSupabase()
      .from('runs').select('id, charge_summary').eq('kind', 'charging');
    if (error) throw error;
    const todo = (runs ?? []).filter(r => all || !isCurrentSummary(r.charge_summary));
    let written = 0, failed = 0;
    for (const [i, r] of todo.entries()) {
      const summary = await this.writeChargeSummary(r.id, await this.getRunData(r.id));
      if (summary) written++; else failed++;
      onProgress?.({ done: i + 1, total: todo.length });
    }
    return { checked: runs?.length ?? 0, written, failed };
  }

  // ── Composite curves (#313, migration 077) ───────────────────────────────

  /** A vehicle's runs straight from the database, shaped as getVehicles shapes them. */
  async getVehicleRuns(vehicleId) {
    const { data, error } = await getSupabase()
      .from('runs').select('*, data_points(count)').eq('vehicle_id', vehicleId);
    if (error) throw error;
    return (data ?? []).map(shapeRun);
  }

  /**
   * Bring a vehicle's stored composite curves up to date with its tests, and
   * return its runs as they now stand.
   *
   * Reads the runs from the database rather than trusting the caller's copy:
   * this runs straight after a write, before React state has caught up. The
   * vehicle object still supplies what a write cannot change — its platforms
   * and specs, for its voltage class. Curators only; a viewer never writes.
   *
   * Each composite is rebuilt IN PLACE where one of its class exists
   * (planCompositeRebuild), so its id, DEF tag and pairings survive.
   */
  async rebuildComposites(vehicle) {
    if (!this.useSupabase || !this.isContributor || !vehicle) return null;
    const runs = await this.getVehicleRuns(vehicle.id);
    const withRuns = { ...vehicle, runs };
    if (!mayHaveComposite(withRuns) && !runs.some(isCompositeRun)) return runs;

    const pointsByRunId = await this.getPointsForRuns(runs.filter(compositeEligible).map(r => r.id));
    const { writes, deletes } = planCompositeRebuild(withRuns, pointsByRunId);

    // A vehicle's composites (800 V and 400 V) are independent, so they are
    // written side by side; each one's row write carries its charge summary,
    // which used to be a request of its own.
    const sb = getSupabase();
    await Promise.all(writes.map(async (w) => {
      const row = {
        name: w.name, composite: w.composite,
        charge_summary: { ...summarizeChargeSession(w.points), computedAt: new Date().toISOString() },
      };
      let id = w.id;
      if (id == null) {
        const { data, error } = await sb.from('runs').insert({
          vehicle_id: vehicle.id, kind: 'charging', synthetic: true, ...row,
          date: new Date().toISOString().split('T')[0],
          upload_date: new Date().toISOString(),
          populated_fields: ['soc', 'chargeRate', 'time'],
        }).select('id').single();
        if (error) throw error;
        id = data.id;
      } else {
        const { error } = await sb.from('runs').update(row).eq('id', id);
        if (error) throw error;
      }
      await this.writeCompositePoints(id, w.points);
    }));
    if (deletes.length) {
      // .select() so a delete RLS filtered out reads as 0 rows, not success:
      // Postgres drops rows a policy hides without an error (migration 077's
      // composite delete policy is what lets a contributor do this at all).
      const { data: gone, error } = await sb.from('runs').delete().in('id', deletes).select('id');
      if (error) throw error;
      if ((gone?.length ?? 0) < deletes.length) {
        throw new Error(`${deletes.length - (gone?.length ?? 0)} obsolete composite curve(s) could not be deleted — is migration 077 applied?`);
      }
    }
    return this.getVehicleRuns(vehicle.id);
  }

  /**
   * Replace a composite's points. Direct writes rather than the
   * replace_run_data_points RPC, which has no column for extra_data — where
   * each point's contributor count and test spread live.
   */
  async writeCompositePoints(runId, points) {
    const sb = getSupabase();
    const { error: delError } = await sb.from('data_points').delete().eq('run_id', runId);
    if (delError) throw delError;
    const rows = points.map((p, frame) => ({
      run_id: runId, frame,
      soc:         roundField(p.soc, 1),
      charge_rate: roundField(p.chargeRate, 2),
      time_value:  roundField(p.time, 1),
      extra_data:  { n: p.n, spreadHi: p.spreadHi ?? null, spreadLo: p.spreadLo ?? null },
    }));
    for (let i = 0; i < rows.length; i += 1000) {
      const { error } = await sb.from('data_points').insert(rows.slice(i, i + 1000));
      if (error) throw error;
    }
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
      software_version: updates.softwareVersion, conditions: updates.conditions,
      ...(updates.calculated_fields !== undefined ? { calculated_fields: updates.calculated_fields } : {}),
      ...(updates.kind !== undefined ? { kind: updates.kind } : {}),
      ...(updates.source !== undefined ? { source: updates.source || null } : {}),
      ...(updates.startSoc !== undefined ? { start_soc: updates.startSoc !== '' ? Number(updates.startSoc) : null } : {}),
      ...(updates.endSoc !== undefined ? { end_soc: updates.endSoc !== '' ? Number(updates.endSoc) : null } : {}),
      ...(updates.speedMph !== undefined ? { speed_mph: updates.speedMph !== '' ? Number(updates.speedMph) : null } : {}),
      ...(updates.distanceMiles !== undefined ? { distance_miles: updates.distanceMiles !== '' ? Number(updates.distanceMiles) : null } : {}),
      ...(updates.energyKwh !== undefined ? { energy_kwh: updates.energyKwh !== '' ? Number(updates.energyKwh) : null } : {}),
      ...(updates.chargeEnergyKwh !== undefined ? { charge_energy_kwh: updates.chargeEnergyKwh !== '' ? Number(updates.chargeEnergyKwh) : null } : {}),
      ...(updates.temperatureF !== undefined ? { temperature_f: updates.temperatureF !== '' ? Number(updates.temperatureF) : null } : {}),
      ...(updates.speedBasis !== undefined ? { speed_basis: updates.speedBasis || null } : {}),
      ...(updates.altitudeFt !== undefined ? { altitude_ft: updates.altitudeFt !== '' ? Number(updates.altitudeFt) : null } : {}),
      ...(updates.elevationGainFt !== undefined ? { elevation_gain_ft: updates.elevationGainFt !== '' ? Number(updates.elevationGainFt) : null } : {}),
      ...(updates.windSpeedMph !== undefined ? { avg_wind_speed_mph: updates.windSpeedMph !== '' ? Number(updates.windSpeedMph) : null } : {}),
      ...(updates.windDirectionDeg !== undefined ? { wind_direction_deg: updates.windDirectionDeg !== '' ? Number(updates.windDirectionDeg) : null } : {}),
      ...(updates.sourceUrl !== undefined ? { source_url: updates.sourceUrl || null } : {}),
      ...(updates.isHidden !== undefined ? { is_hidden: updates.isHidden } : {}),
      ...(updates.isExcluded !== undefined ? { is_excluded: updates.isExcluded } : {}),
      ...(updates.qualityOverride !== undefined ? { quality_override: updates.qualityOverride } : {}),
      ...(updates.preconditioned !== undefined ? { preconditioned: toPreconditioned(updates.preconditioned) } : {}),
      ...(updates.chargerVoltageClass !== undefined ? { charger_voltage_class: toChargerClass(updates.chargerVoltageClass) } : {}),
    }).eq('id', runId);
    if (error) throw error;
  }

  /**
   * Clear a default. Pass the run being cleared: since migration 046 a vehicle
   * holds a default charging run AND a default range test, so clearing every
   * run of the vehicle meant clicking × on one silently dropped the other.
   *
   * With no runId this still clears the lot, which is what deleting a vehicle's
   * data wants; nothing in the UI calls it that way.
   */
  async clearDefaultRun(vehicleId, runId = null) {
    if (!this.useSupabase || !this.user) {
      const saved = localStorage.getItem('evData');
      const data = saved ? JSON.parse(saved) : { vehicles: [], selectedVehicles: [] };
      data.vehicles = data.vehicles.map(v =>
        v.id === vehicleId ? { ...v, runs: clearDefaultRuns(v.runs, runId) } : v);
      localStorage.setItem('evData', JSON.stringify(data));
      return;
    }
    if (runId != null) {
      const { error } = await getSupabase().from('runs').update({ is_default: false }).eq('id', runId);
      if (error) throw error;
      return;
    }
    await getSupabase().from('runs').update({ is_default: false }).eq('vehicle_id', vehicleId);
    await getSupabase().from('spec_links').update({ is_default: false }).eq('target_vehicle_id', vehicleId);
  }

  async setDefaultRun(vehicleId, runId) {
    if (!this.useSupabase || !this.user) {
      const saved = localStorage.getItem('evData');
      const data = saved ? JSON.parse(saved) : { vehicles: [], selectedVehicles: [] };
      data.vehicles = data.vehicles.map(v =>
        v.id === vehicleId ? { ...v, runs: applyDefaultRun(v.runs, runId) } : v);
      localStorage.setItem('evData', JSON.stringify(data));
      return;
    }
    // Defaults are scoped PER KIND since migration 046: a vehicle has both a
    // default charging run (the fallback curve) and a default range test (rank 2
    // of the range-source order). Clearing across both would make setting one
    // silently unset the other.
    const { data: target } = await getSupabase()
      .from('runs').select('kind').eq('id', runId).single();
    const kind = target?.kind ?? 'charging';

    await getSupabase().from('runs')
      .update({ is_default: false }).eq('vehicle_id', vehicleId).eq('kind', kind);
    // Inherited runs are charging curves, so they only compete with that kind.
    if (kind === 'charging') {
      await getSupabase().from('spec_links')
        .update({ is_default: false }).eq('target_vehicle_id', vehicleId);
    }
    const { error } = await getSupabase().from('runs').update({ is_default: true }).eq('id', runId);
    if (error) throw error;
  }

  /**
   * Set (or clear, with null) the curator's default charging test for a range
   * test. Unlike a chart-session pairing, which lives only in the URL, this is
   * what a visitor arriving without one sees. See migration 045.
   */
  async setPairedChargingRun(rangeRunId, chargingRunId) {
    if (!this.useSupabase || !this.user) {
      const saved = localStorage.getItem('evData');
      const data = saved ? JSON.parse(saved) : { vehicles: [], selectedVehicles: [] };
      data.vehicles = (data.vehicles || []).map(v => ({
        ...v,
        runs: (v.runs || []).map(r =>
          r.id === rangeRunId ? { ...r, paired_charging_run_id: chargingRunId ?? null } : r),
      }));
      localStorage.setItem('evData', JSON.stringify(data));
      return;
    }
    const { error } = await getSupabase()
      .from('runs')
      .update({ paired_charging_run_id: chargingRunId ? Number(chargingRunId) : null })
      .eq('id', rangeRunId);
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

  /**
   * The real SoC span of each run, from its data points.
   *
   * runs.start_soc / end_soc cannot be trusted for a charging test. The 046
   * split copied them from the original dual-role row, where they described the
   * DISCHARGE, so a charging run reads 78→10 for a session its points show as
   * 10→78 — and sometimes worse: one run stores 100→1 against points spanning
   * 0→80. The points are the measurement; the columns are a leftover.
   *
   * Aggregated in Postgres (migration 054), one row per run rather than every
   * sample. It used to reduce client-side, which was wasteful and also wrong:
   * PostgREST truncates a response at 1000 rows silently, so at ~200 points per
   * run the span went quietly partial at about FIVE selected runs.
   */
  async getSocRanges(runIds) {
    if (!this.useSupabase || !runIds?.length) return {};
    const real = runIds.filter(id => !isInheritedRunId(id)).map(Number);
    if (!real.length) return {};

    const { data, error } = await getSupabase()
      .rpc('run_soc_ranges', { p_run_ids: real });
    if (error) throw error;

    const out = {};
    // A run with no non-null SoC sample is absent from the result rather than
    // present with nulls, which the caller already reads as "no span known".
    for (const r of data || []) {
      // Coerced because PostgREST may serialise a numeric column as a string,
      // and these are compared and scaled downstream.
      out[r.run_id] = { min: Number(r.min_soc), max: Number(r.max_soc) };
    }
    return out;
  }

  /**
   * Charging tests by id, each with its vehicle's name and its raw points
   * (SoC, charge rate, time, range, temperature, as stored: imperial):
   * read-only, for a preview outside the chart views (an explainer's tests
   * card, via hooks/useChargingTests). Ids that do not resolve are dropped,
   * and the order asked for is kept.
   */
  async getChargingTestsPreview(runIds) {
    if (!this.useSupabase || !runIds?.length) return [];
    const real = runIds.filter(id => !isInheritedRunId(id)).map(Number);
    if (!real.length) return [];
    const { data, error } = await getSupabase()
      .from('runs')
      .select('id, name, kind, vehicle_id, vehicles(name)')
      .in('id', real);
    if (error) throw error;
    const byId = new Map((data || []).map(r => [r.id, r]));
    const found = real.map(id => byId.get(id)).filter(Boolean);
    return Promise.all(found.map(async r => ({
      id: r.id,
      name: r.name,
      vehicleId: r.vehicle_id,
      vehicleName: r.vehicles?.name ?? null,
      points: (await this.getRunData(r.id)).map(p => ({
        soc:         p.soc         != null ? Number(p.soc)         : null,
        chargeRate:  p.chargeRate  != null ? Number(p.chargeRate)  : null,
        time:        p.time        != null ? Number(p.time)        : null,
        range:       p.range       != null ? Number(p.range)       : null,
        temperature: p.temperature != null ? Number(p.temperature) : null,
      })),
    })));
  }

  /**
   * Some vehicles' EPA links, with each link's certification record and the
   * vehicle's range tests, read-only: the raw material for an explainer's
   * modeled-efficiency card (useModeledEfficiency → modeledEfficiencyPreview).
   * Keyed by mapping id, the same id the chart's epa_m= carries.
   */
  async getModeledEfficiencyPreview(mappingIds) {
    if (!this.useSupabase || !mappingIds?.length) return [];
    const ids = mappingIds.map(Number).filter(Number.isFinite);
    if (!ids.length) return [];
    const { data, error } = await getSupabase()
      .from('epa_vehicle_mappings')
      .select(`id, vehicle_id, vehicles(id, name, runs(id, name, kind, synthetic, is_hidden, is_excluded, speed_mph, distance_miles, energy_kwh, temperature_f, altitude_ft, avg_wind_speed_mph, wind_direction_deg, elevation_gain_ft, source)), epa_test_vehicles(${EPA_TEST_VEHICLE_FIELDS})`)
      .in('id', ids);
    if (error) throw error;
    const byId = new Map((data || []).map(m => [m.id, m]));
    return ids.map(id => byId.get(id)).filter(Boolean).map(m => ({
      mappingId: m.id,
      vehicleId: m.vehicle_id,
      vehicleName: m.vehicles?.name ?? null,
      epaTestVehicle: m.epa_test_vehicles,
      runs: m.vehicles?.runs ?? [],
    }));
  }

  async getRunData(runId, efficiencyFactor = 1, capacityFactor = 1) {
    // Inherited runs carry synthetic string ids like "inherited_<linkId>_<realRunId>".
    const actualId = isInheritedRunId(runId)
      ? parseInheritedRunId(runId).realRunId
      : runId;
    // Paged: a long run exceeds the 1000-row cap on its own, and the insert
    // path batches at 1000 precisely because runs that size exist. Unpaged, the
    // chart just stops early with no indication the tail is missing.
    const data = await fetchAllRows(() => getSupabase()
      .from('data_points')
      .select('*')
      .eq('run_id', actualId)
      .order('frame', { ascending: true })
      .order('id', { ascending: true }));
    return (data || []).map(p => shapePoint(p, efficiencyFactor, capacityFactor));
  }

  /**
   * Several runs' points in one paged query, keyed by run id — for a composite
   * rebuild, which needs every test of a vehicle at once. One request (or one
   * per thousand rows) instead of one per test: per-test fetches one after
   * another were most of a rebuild's time. Real runs only; no inherited
   * scaling, which a composite never reads.
   */
  async getPointsForRuns(runIds) {
    const out = Object.fromEntries(runIds.map(id => [id, []]));
    if (!runIds.length) return out;
    const data = await fetchAllRows(() => getSupabase()
      .from('data_points')
      .select('*')
      .in('run_id', runIds)
      .order('run_id', { ascending: true })
      .order('frame', { ascending: true })
      .order('id', { ascending: true }));
    for (const p of data || []) (out[p.run_id] ??= []).push(shapePoint(p));
    return out;
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
    // Shared with the constants bootstrap, which has already fetched this
    // before the app mounted (#261) — so this resolves from cache and costs
    // the startup Promise.all nothing.
    return fetchSiteSettings();
  }

  /**
   * Publish one model constant site-wide, or revert it (value == null).
   *
   * Admin only, enforced in the RPC. Goes through `set_model_constant` rather
   * than an upsert on site_settings for the same reason the header image does:
   * a direct INSERT … ON CONFLICT DO UPDATE trips a double RLS check that
   * fails even for a writer who is allowed to write. The RPC also keeps the
   * read-modify-write of the JSON blob on the server, so two admins editing
   * different knobs cannot clobber each other's key.
   *
   * @returns {Promise<Object>} the full published map after the change
   */
  async setModelConstant(key, value) {
    if (!this.useSupabase) throw new Error('Publishing constants requires a database.');
    const { data, error } = await getSupabase()
      .rpc('set_model_constant', { constant_key: key, constant_value: value ?? null });
    if (error) throw new Error(`[DB] ${error.message}`);
    const map = data ?? {};
    updateCachedSetting(MODEL_CONSTANTS_KEY, JSON.stringify(map));
    return map;
  }

  /** Revert every published constant to its compiled default. Admin only. */
  async clearModelConstants() {
    if (!this.useSupabase) throw new Error('Publishing constants requires a database.');
    const { data, error } = await getSupabase().rpc('clear_model_constants');
    if (error) throw new Error(`[DB] ${error.message}`);
    const map = data ?? {};
    updateCachedSetting(MODEL_CONSTANTS_KEY, JSON.stringify(map));
    return map;
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
    updateCachedSetting('header_image_url', url);
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

      await this.addRun(vehicleId, {
        name: session.runName,
        date: session.date,
        synthetic: session.synthetic,
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
   * matches, then INSERTs any unmatched rows.  One round-trip.  SECURITY
   * DEFINER bypasses RLS, so the function enforces the data_points write rule
   * itself (vehicle owner, admin or contributor — migration 078).
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
    // A merge can add the time or power a summary needs, so the whole
    // session is re-read: the merged rows alone are only part of it.
    result.chargeSummary = await this.refreshChargeSummary(runId);

    return result; // { updated: N, inserted: M, populatedFields?: [...], chargeSummary }
  }

  /**
   * Replace all data points for a run with a new set of rows.
   * Uses a SECURITY DEFINER RPC (delete + re-insert), which enforces the
   * data_points write rule itself: vehicle owner, admin or contributor (078).
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
      timestamp:   p.timestamp ?? null,
      soc:         roundField(p.soc,         1),
      charge_rate: roundField(p.chargeRate,  2),
      time_value:  roundField(p.time,        1),
      range_value: roundField(p.range,       1),
      temperature: roundField(p.temperature, 1),
    }));
    const { error } = await getSupabase()
      .rpc('replace_run_data_points', { p_run_id: runId, p_rows: rows });
    if (error) throw error;

    const populatedFields = detectPopulatedFields(points);
    await getSupabase().from('runs').update({ populated_fields: populatedFields }).eq('id', runId);

    // The points in hand ARE the session now, so no re-read.
    const { data: kindRow } = await getSupabase().from('runs').select('kind').eq('id', runId).single();
    const chargeSummary = kindRow?.kind === 'charging' ? await this.writeChargeSummary(runId, points) : null;

    return { rowCount: points.length, populatedFields, chargeSummary };
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
   * Clear a flag from a specific spec field. Admin only, enforced in the RPC
   * (migration 069); signed-out callers cannot execute it at all.
   */
  async unflagSpecField(vehicleId, fieldKey) {
    if (!this.useSupabase) return;
    const { error } = await getSupabase().rpc('unflag_spec_field', {
      p_vehicle_id: vehicleId,
      p_field_key: fieldKey,
    });
    if (error) throw error;
  }

  // ── EPA Test Groups ───────────────────────────────────────────────────────

  /**
   * Search epa_test_vehicles for the vehicle-linking combobox.
   * Filters by free-text (matched against make + epa_carline_name) and optional
   * model year. Returns at most 50 results, ordered by make and carline name.
   *
   * @param {string} query — free text search string
   * @param {number|null} year — exact model year filter (optional)
   */
  async searchEpaTestVehicles(query, year = null) {
    if (!this.useSupabase) return [];
    let q = getSupabase()
      .from('epa_test_vehicles')
      .select('test_vehicle_id, test_group, model_year, make, epa_carline_name, transmission, drive, fuel_type')
      .order('make')
      .order('epa_carline_name')
      .limit(50);
    if (year) q = q.eq('model_year', year);
    if (query?.trim()) {
      const escaped = query.trim().replace(/[%_]/g, '\\$&');
      // Also search test_vehicle_id and test_group so users can look up
      // by vehicle config code (e.g. "R1S247") or EPA family ID
      q = q.or(
        `make.ilike.%${escaped}%,epa_carline_name.ilike.%${escaped}%,` +
        `test_vehicle_id.ilike.%${escaped}%,test_group.ilike.%${escaped}%`
      );
    }
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  /**
   * EPA test vehicles a variant's configuration might be, for the suggestions on
   * its EPA section (#341): its source's makes and model years. Carries what
   * the suggestion shows — label range, and the tests EPA tested is read from —
   * and what it is ranked on. Narrowed to the model and ranked in
   * variantEpaSuggestions.js; a make is matched loosely there too, so here it
   * is a case-insensitive prefix rather than an exact value.
   */
  async getEpaSuggestionCandidates({ makes = [], years = [] } = {}) {
    if (!this.useSupabase || !makes.length || !years.length) return [];
    const makeFilter = makes
      .map(m => `make.ilike.${String(m).replace(/[%_,()]/g, '')}%`)
      .join(',');
    const { data, error } = await getSupabase()
      .from('epa_test_vehicles')
      .select('test_vehicle_id, model_year, make, epa_carline_name, drive, display_name, label_range_published, preferred_test_number, epa_tests(test_number, test_date, procedure_code, total_dc_energy_kwh)')
      .in('model_year', years)
      .or(makeFilter)
      .limit(200);
    if (error) throw error;
    return data || [];
  }

  /**
   * Link a vehicle to an EPA test vehicle.
   * Contributor-level permission enforced by RLS on epa_vehicle_mappings.
   */
  async linkEpaTestVehicle(vehicleId, epaTestVehicleId, confidence = 'inferred', notes = '') {
    if (!this.useSupabase) return null;
    const { data, error } = await getSupabase()
      .from('epa_vehicle_mappings')
      .insert({ vehicle_id: vehicleId, test_vehicle_id: epaTestVehicleId, confidence, notes: notes || null })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  /**
   * Update the confidence or notes on an existing vehicle → EPA test vehicle mapping.
   */
  async updateEpaMapping(mappingId, updates) {
    if (!this.useSupabase) return;
    const { error } = await getSupabase()
      .from('epa_vehicle_mappings')
      .update(updates)
      .eq('id', mappingId);
    if (error) throw error;
  }

  /**
   * Make a link the vehicle's primary EPA configuration (#322).
   *
   * One UPDATE: migration 067's trigger clears the vehicle's previous primary
   * in the same statement, so the one-primary index is never violated.
   * Contributor-level, like confidence.
   */
  async setPrimaryEpaMapping(mappingId) {
    if (!this.useSupabase) return;
    const { error } = await getSupabase()
      .from('epa_vehicle_mappings')
      .update({ is_primary: true })
      .eq('id', mappingId);
    if (error) throw error;
  }

  /**
   * Remove a vehicle → EPA test vehicle mapping.
   * Admin permission enforced by RLS.
   */
  async unlinkEpaTestVehicle(mappingId) {
    if (!this.useSupabase) return;
    const { error } = await getSupabase()
      .from('epa_vehicle_mappings')
      .delete()
      .eq('id', mappingId);
    if (error) throw error;
  }

  /**
   * Bulk upsert parsed EPA test vehicles into the curator model:
   *   1. epa_test_vehicles            (identity + Section 6 label fields)
   *   2. epa_coefficient_sets       (the primary 'City/Highway' set per test vehicle)
   *
   * Each parsed row carries a private `_coefficientSet` plus `_hasCoeffs` /
   * `_hasMpge` flags (from parseEpaTestCarSheet) — these are stripped before
   * the test vehicle upsert and used to build the coefficient-set upsert.
   *
   * @param {Array<Object>} rows  Output of parseEpaTestCarSheet
   */
  async bulkUpsertEpaTestVehicles(rows) {
    if (!this.useSupabase || !rows.length) return;

    // 1. Test vehicle rows — strip private helpers.
    const testVehicleRows = rows.map(({ _coefficientSet, _hasCoeffs, _hasMpge, ...g }) => g);
    const { error } = await getSupabase()
      .from('epa_test_vehicles')
      .upsert(testVehicleRows, { onConflict: 'test_vehicle_id', ignoreDuplicates: false });
    if (error) throw error;

    // 2. Primary coefficient sets — only for test vehicles that carried coefficients.
    const coeffRows = rows
      .filter(r => r._coefficientSet && r._hasCoeffs)
      .map(r => ({ test_vehicle_id: r.test_vehicle_id, ...r._coefficientSet }));
    if (coeffRows.length) {
      const { error: coeffErr } = await getSupabase()
        .from('epa_coefficient_sets')
        .upsert(coeffRows, { onConflict: 'test_vehicle_id,category', ignoreDuplicates: false });
      if (coeffErr) throw coeffErr;
    }

    // 3. Their certifications (#374). The Test Car List names the Test Group
    //    each test vehicle was certified under.
    await this.recordEpaCertifications(testVehicleRows, 'csv');
  }

  /**
   * Fetch all EPA test vehicles for the admin panel, including which vehicles
   * each test vehicle is currently linked to via epa_vehicle_mappings.
   */
  async getEpaTestVehiclesAdmin() {
    if (!this.useSupabase) return [];
    const { data, error } = await getSupabase()
      .from('epa_test_vehicles')
      .select(`
        test_vehicle_id, test_group,
        model_year, make, epa_carline_name, drive, transmission,
        label_combined_mpge, label_hwy_mpge, display_name,
        source_file, ingested_at,
        epa_coefficient_sets(category, is_primary, target_a, target_b, target_c, equiv_test_weight_lbs),
        epa_vehicle_mappings(
          id, confidence,
          vehicles(id, name, year)
        )
      `)
      .order('make')
      .order('epa_carline_name');
    if (error) throw error;
    return data || [];
  }

  /**
   * Update one or more fields on an EPA test vehicle.
   * Accepts any subset of: { label_method, display_name }.
   */
  async updateEpaTestVehicle(testVehicleId, updates) {
    if (!this.useSupabase) return;
    const { error } = await getSupabase()
      .from('epa_test_vehicles')
      .update(updates)
      .eq('test_vehicle_id', testVehicleId);
    if (error) throw error;
  }

  /**
   * Create a single EPA test vehicle by hand (no CSV) — for vehicles whose data
   * only exists in a lab-submission PDF. Coefficient sets, tests, and phases
   * are added afterward via the curator form. Fails on duplicate test_vehicle_id.
   *
   * @param {Object} testVehicle  epa_test_vehicles fields (test_vehicle_id required)
   */
  async createEpaTestVehicle(testVehicle) {
    if (!this.useSupabase) return null;
    const { data, error } = await getSupabase()
      .from('epa_test_vehicles')
      .insert(testVehicle)
      .select()
      .single();
    if (error) throw error;
    // A record made by hand from a lab PDF often uses the Test Group as its ID;
    // that is a certification too (#374), as migration 082 recorded for the
    // three made before it.
    const tg = testVehicle.test_group ?? (isTestGroup(testVehicle.test_vehicle_id) ? testVehicle.test_vehicle_id : null);
    if (tg) await this.recordEpaCertifications([{ test_vehicle_id: testVehicle.test_vehicle_id, test_group: tg }], 'manual');
    return data;
  }

  /**
   * Which of the given test_vehicle_ids already exist (for overwrite confirmation).
   *
   * Chunked: `.in()` puts every id in the request URL, and a bulk drop of a
   * year's certificates is ~460 ids, ~8 KB — at the edge of what the gateway
   * accepts. 100 per request stays far inside it, and inside the row cap.
   */
  async getExistingEpaTestVehicleIds(ids) {
    if (!this.useSupabase || !ids.length) return [];
    const found = [];
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error } = await getSupabase()
        .from('epa_test_vehicles')
        .select('test_vehicle_id')
        .in('test_vehicle_id', ids.slice(i, i + 100));
      if (error) throw error;
      found.push(...(data || []).map(r => r.test_vehicle_id));
    }
    return found;
  }

  // ── EPA Certifications (#374, migration 082) ─────────────────────────────────
  //
  // One row per Test Group, many-to-many with test vehicles. Written alongside
  // the test vehicle's own identity and Guide-link columns until #374 layer 3
  // switches the readers. Every write here is non-fatal before migration 082
  // is applied: a missing table must not fail an import or a link that worked.

  /**
   * The certifications each of these test vehicles is already in, for the
   * import review: test_vehicle_id → [{ test_group, model_year }]. Empty before
   * migration 082.
   */
  async getEpaCertificationsFor(testVehicleIds) {
    const out = {};
    if (!this.useSupabase || !testVehicleIds?.length) return out;
    for (let i = 0; i < testVehicleIds.length; i += 100) {
      const { data, error } = await getSupabase()
        .from('epa_certification_test_vehicles')
        .select('test_vehicle_id, epa_certifications(test_group, model_year)')
        .in('test_vehicle_id', testVehicleIds.slice(i, i + 100));
      if (error) {
        if (isMissingRelation(error) || error.code === 'PGRST200') return {};
        throw error;
      }
      for (const r of data || []) {
        if (!r.epa_certifications) continue;
        (out[r.test_vehicle_id] ??= []).push(r.epa_certifications);
      }
    }
    return out;
  }

  /**
   * Import one CSI file's certification: the Test Group's row, its covered
   * models, and a link row per test vehicle the file names. Runs after the
   * test vehicles themselves, which the link rows point at.
   *
   * The rules — an earlier filing never replaces a later one, a row no file
   * stood behind takes the file whole — are planCertificationImport's.
   *
   * @param {Object} certification  parseEpaCsiText().certification, plus source_file
   * @param {Array}  members  [{ test_vehicle_id, carryover_test_group, carryover_model_year }]
   * @returns {Promise<{ action, recertified } | { action: 'unavailable' }>}
   */
  async importEpaCertification(certification, members = []) {
    if (!this.useSupabase || !certification?.test_group) return { action: 'unavailable' };
    const supabase = getSupabase();
    const check = ({ error }) => { if (error) throw error; };

    const stored = await supabase.from('epa_certifications')
      .select('*').eq('test_group', certification.test_group).maybeSingle();
    if (stored.error) {
      if (isMissingRelation(stored.error)) return { action: 'unavailable' };
      throw stored.error;
    }

    const plan = planCertificationImport(stored.data, certification);
    let id = stored.data?.id ?? null;
    if (plan.action === 'insert') {
      const res = await supabase.from('epa_certifications').insert(plan.payload).select('id').single();
      check(res);
      id = res.data.id;
    } else if (plan.action === 'update') {
      check(await supabase.from('epa_certifications')
        .update({ ...plan.payload, updated_at: new Date().toISOString() }).eq('id', id));
    }

    if (plan.replaceCoveredModels) {
      check(await supabase.from('epa_covered_models').delete().eq('certification_id', id));
      const rows = uniqueCoveredModels(certification.covered_models ?? [])
        .map(cm => ({ certification_id: id, ...cm }));
      if (rows.length) check(await supabase.from('epa_covered_models').insert(rows));
    }

    // Upsert writes only the columns given, so a Guide link or a skip already
    // on the row is left alone.
    const links = members.map(m => ({
      certification_id:     id,
      test_vehicle_id:      m.test_vehicle_id,
      carryover_test_group: m.carryover_test_group ?? null,
      carryover_model_year: m.carryover_model_year ?? null,
    }));
    if (links.length) {
      check(await supabase.from('epa_certification_test_vehicles')
        .upsert(links, { onConflict: 'certification_id,test_vehicle_id', ignoreDuplicates: false }));
    }
    return { action: plan.action, recertified: plan.recertified };
  }

  /**
   * Certifications for records that did not come from a CSI file: the Test Car
   * List import (basis 'csv') and a record made by hand whose Vehicle ID is a
   * Test Group ('manual'). Never downgrades a certification a file already
   * stands behind — an existing Test Group is left as it is.
   *
   * @param {Array<{ test_vehicle_id, test_group }>} rows
   * @param {'csv'|'manual'} basis
   */
  async recordEpaCertifications(rows, basis) {
    if (!this.useSupabase) return;
    const usable = (rows || []).filter(r => r.test_vehicle_id && testGroupYear(r.test_group) != null);
    if (!usable.length) return;
    const supabase = getSupabase();
    const groups = [...new Set(usable.map(r => r.test_group))];

    const ins = await supabase.from('epa_certifications')
      .upsert(groups.map(tg => ({ test_group: tg, model_year: testGroupYear(tg), basis })),
              { onConflict: 'test_group', ignoreDuplicates: true });
    if (ins.error) {
      if (isMissingRelation(ins.error)) return;
      throw ins.error;
    }
    const ids = {};
    for (let i = 0; i < groups.length; i += 100) {
      const { data, error } = await supabase.from('epa_certifications')
        .select('id, test_group').in('test_group', groups.slice(i, i + 100));
      if (error) throw error;
      for (const c of data || []) ids[c.test_group] = c.id;
    }
    const links = usable
      .filter(r => ids[r.test_group] != null)
      .map(r => ({ certification_id: ids[r.test_group], test_vehicle_id: r.test_vehicle_id }));
    if (links.length) {
      const { error } = await supabase.from('epa_certification_test_vehicles')
        .upsert(links, { onConflict: 'certification_id,test_vehicle_id', ignoreDuplicates: true });
      if (error) throw error;
    }
  }

  /**
   * Put a Guide link on the certification it belongs to — the Guide row's own
   * year and Test Group (guideLinkTarget), the same rule migration 082 moved
   * every existing link by. Written beside the test vehicle's own column until
   * #374 layer 3 reads it.
   */
  async syncCertificationGuideLink(testVehicleId, feRow, statedTestGroup = null) {
    if (!this.useSupabase || !feRow) return;
    const supabase = getSupabase();
    const { data: links, error } = await supabase.from('epa_certification_test_vehicles')
      .select('id, fe_guide_row_id, certification:epa_certifications(test_group, model_year)')
      .eq('test_vehicle_id', testVehicleId);
    if (error) {
      if (isMissingRelation(error) || error.code === 'PGRST200') return;
      throw error;
    }

    // One link per Guide row per test vehicle: a re-link moves it.
    const stale = (links || []).filter(l => l.fe_guide_row_id === feRow.id).map(l => l.id);

    const target = guideLinkTarget(links || [], feRow, statedTestGroup);
    if (!target) return;
    let linkId = target.linkId;
    if (target.create) {
      const c = await supabase.from('epa_certifications')
        .upsert({ ...target.create, basis: 'guide' }, { onConflict: 'test_group', ignoreDuplicates: true });
      if (c.error) throw c.error;
      const { data: cert, error: cErr } = await supabase.from('epa_certifications')
        .select('id').eq('test_group', target.create.test_group).single();
      if (cErr) throw cErr;
      const l = await supabase.from('epa_certification_test_vehicles')
        .upsert({ certification_id: cert.id, test_vehicle_id: testVehicleId },
                { onConflict: 'certification_id,test_vehicle_id', ignoreDuplicates: false })
        .select('id').single();
      if (l.error) throw l.error;
      linkId = l.data.id;
    }
    const others = stale.filter(id => id !== linkId);
    if (others.length) {
      const { error: e1 } = await supabase.from('epa_certification_test_vehicles')
        .update({ fe_guide_row_id: null }).in('id', others);
      if (e1) throw e1;
    }
    const { error: e2 } = await supabase.from('epa_certification_test_vehicles')
      .update({ fe_guide_row_id: feRow.id }).eq('id', linkId);
    if (e2) throw e2;
  }

  /** Take a Guide row off every certification of this test vehicle it was on. */
  async clearCertificationGuideLink(testVehicleId, feRowId) {
    if (!this.useSupabase || feRowId == null) return;
    const { error } = await getSupabase().from('epa_certification_test_vehicles')
      .update({ fe_guide_row_id: null })
      .eq('test_vehicle_id', testVehicleId).eq('fe_guide_row_id', feRowId);
    if (error && !isMissingRelation(error)) throw error;
  }

  /**
   * A skip says "this record has no Guide row", so it holds for each of the
   * record's unlinked years — as migration 082 carried the existing ones over.
   */
  async setCertificationSkips(testVehicleId, skipped, note = null) {
    if (!this.useSupabase) return;
    const { error } = await getSupabase().from('epa_certification_test_vehicles')
      .update(skipped
        ? { fe_guide_skipped_at: new Date().toISOString(), fe_guide_skip_note: note }
        : { fe_guide_skipped_at: null, fe_guide_skip_note: null })
      .eq('test_vehicle_id', testVehicleId)
      .is('fe_guide_row_id', null);
    if (error && !isMissingRelation(error)) throw error;
  }

  /**
   * Import one fully-parsed test vehicle (from a CSI PDF) into the curator model.
   *
   * Updates IN PLACE rather than clean-replacing, matching rows on the identity
   * the certificate gives them (coefficient category, EPA test number, phase
   * index). That keeps row ids stable — so the audit trail, which finds child
   * edits by id, still resolves after a re-import — and leaves any field a
   * curator set by hand (overrides source other than 'pdf') exactly as it was.
   * Everything nobody has touched is still "upload is truth". The rules live in
   * utils/epaImportMerge.js; this method only executes the plan.
   *
   * @param {Object} testVehicle  Output element of parseEpaCsiText().testVehicles
   * @returns {Promise<{kept: Array, guarded: Array}>} curator-held values the PDF disagreed with,
   *   and identity fields an older certification was stopped from overwriting (#374)
   */
  async importEpaTestVehicleFull(testVehicle) {
    if (!this.useSupabase) return { kept: [], guarded: [] };
    const supabase = getSupabase();
    const { coefficient_sets = [], tests = [], covered_models = [], ...g } = testVehicle;
    const tgid = g.test_vehicle_id;
    const check = ({ error }) => { if (error) throw error; };

    // What is stored now.
    const [gRes, cRes, tRes] = await Promise.all([
      supabase.from('epa_test_vehicles').select('*').eq('test_vehicle_id', tgid).maybeSingle(),
      supabase.from('epa_coefficient_sets').select('*').eq('test_vehicle_id', tgid),
      supabase.from('epa_tests').select('*, epa_test_phases(*)').eq('test_vehicle_id', tgid),
    ]);
    [gRes, cRes, tRes].forEach(check);

    const plan = planTestVehicleImport(
      { testVehicle: gRes.data, coefficient_sets: cRes.data || [], tests: tRes.data || [] },
      { testVehicle: { ...g, source_file: g.source_file ?? null }, coefficient_sets, tests },
    );

    // 1. Test vehicle (upsert). Held fields are absent from the payload, so the
    //    upsert leaves those columns alone; `overrides` keeps their tags.
    check(await supabase.from('epa_test_vehicles')
      .upsert({ test_vehicle_id: tgid, ...plan.testVehicle.payload, overrides: plan.testVehicle.overrides },
              { onConflict: 'test_vehicle_id', ignoreDuplicates: false }));

    // 2. Coefficient sets — remove, then update in place, then insert (the
    //    one-primary-per-test-vehicle index is checked per statement).
    const cp = plan.coefficients;
    if (cp.remove.length) check(await supabase.from('epa_coefficient_sets').delete().in('id', cp.remove));
    for (const u of cp.update) {
      check(await supabase.from('epa_coefficient_sets')
        .update({ ...u.payload, overrides: u.overrides }).eq('id', u.id));
    }
    if (cp.insert.length) {
      check(await supabase.from('epa_coefficient_sets')
        .insert(cp.insert.map(r => ({ test_vehicle_id: tgid, ...r }))));
    }

    // 2b. Covered models (clean-replace: certificate-wide, nothing edits them
    //     and nothing refers to their ids). Non-fatal: migration 059 may not be
    //     applied, and a missing table must not fail an import that worked.
    //     Skipped when an older certification meets a newer one: the list is
    //     the newer certificate's, not this file's (#374).
    try {
      if (!plan.holdIdentity) await supabase.from('epa_covered_models').delete().eq('test_vehicle_id', tgid);
      if (!plan.holdIdentity && covered_models.length) {
        const rows = uniqueCoveredModels(covered_models).map(cm => ({ test_vehicle_id: tgid, ...cm }));
        const { error } = await supabase.from('epa_covered_models').insert(rows);
        if (error) throw error;
      }
    } catch (error) {
      if (!isMissingRelation(error)) throw error;
    }

    // 3. Tests + phases.
    //    `mfr_test_vehicle_comments` arrives in migration 059. Retry without it
    //    rather than failing a whole import over a field that is a curator's
    //    reading aid — the numbers matter more than the note.
    const withoutNote = ({ mfr_test_vehicle_comments: _dropped, ...rest }) => rest;
    const writeTest = async (write, row) => {
      let res = await write(row);
      if (res.error && isMissingColumn(res.error)) res = await write(withoutNote(row));
      check(res);
      return res.data;
    };
    const applyPhases = async (testId, pp) => {
      if (pp.remove.length) check(await supabase.from('epa_test_phases').delete().in('id', pp.remove));
      for (const u of pp.update) {
        check(await supabase.from('epa_test_phases')
          .update({ ...u.payload, overrides: u.overrides }).eq('id', u.id));
      }
      if (pp.insert.length) {
        check(await supabase.from('epa_test_phases')
          .insert(pp.insert.map(r => ({ test_id: testId, ...r }))));
      }
    };

    const tp = plan.tests;
    if (tp.remove.length) check(await supabase.from('epa_tests').delete().in('id', tp.remove));
    for (const u of tp.update) {
      await writeTest(
        (row) => supabase.from('epa_tests').update({ ...row, overrides: u.overrides }).eq('id', u.id).select('id').single(),
        u.payload);
      await applyPhases(u.id, u.phases);
    }
    for (const t of tp.insert) {
      const saved = await writeTest(
        (row) => supabase.from('epa_tests').insert({ test_vehicle_id: tgid, ...row }).select('id').single(),
        t.row);
      if (t.phases.length) {
        check(await supabase.from('epa_test_phases')
          .insert(t.phases.map(p => ({ test_id: saved.id, ...p }))));
      }
    }
    return { kept: plan.kept, guarded: plan.guarded };
  }

  /** Convenience alias kept for back-compat. */
  async updateEpaLabelMethod(testVehicleId, method) {
    return this.updateEpaTestVehicle(testVehicleId, { label_method: method || null });
  }

  /**
   * Delete an EPA test vehicle and all its vehicle mappings.
   * The epa_vehicle_mappings FK has no CASCADE so mappings must be deleted first.
   */
  async deleteEpaTestVehicle(testVehicleId) {
    if (!this.useSupabase) return;
    // Step 1: remove all vehicle→test vehicle mappings
    const { error: mapErr } = await getSupabase()
      .from('epa_vehicle_mappings')
      .delete()
      .eq('test_vehicle_id', testVehicleId);
    if (mapErr) throw mapErr;
    // Step 2: remove the test vehicle itself
    const { error } = await getSupabase()
      .from('epa_test_vehicles')
      .delete()
      .eq('test_vehicle_id', testVehicleId);
    if (error) throw error;
  }

  // ── EPA Fuel Economy Guide (published labels, #206) ───────────────────────

  /**
   * Bulk-import parsed Fuel Economy Guide rows.
   *
   * Upserts on the natural key (model year, division, carline, model type
   * index) — NOT on the smog Test Group, which matches almost nothing of ours and is
   * not unique per configuration anyway. The index is part of the key because
   * carline alone is not unique: Audi lists one carline three times at three
   * different ranges. Re-importing the same guide is therefore idempotent,
   * and re-importing a revised one updates in place, which is the whole reason
   * these rows are kept rather than promoted and discarded.
   *
   * @param {Array}  rows        output of parseFeGuide().rows
   * @param {string} [sourceFile] filename, for provenance
   * @returns {{ imported: number, updated: number, failed: number, errors: string[] }}
   */
  async importFeGuideRows(rows, sourceFile = null) {
    const result = { imported: 0, updated: 0, failed: 0, errors: [] };
    if (!this.useSupabase || !rows?.length) return result;
    const supabase = getSupabase();

    // Which keys already exist, so the report can distinguish new from revised.
    // Read before writing: after the upsert everything looks like it was there.
    const years = [...new Set(rows.map(r => r.modelYear))];
    const { data: existing } = await supabase
      .from('epa_fe_guide')
      .select('model_year, division, carline, model_type_index')
      .in('model_year', years);
    const seen = new Set((existing || []).map(e =>
      `${e.model_year}|${e.division}|${e.carline}|${e.model_type_index}`));

    // Chunked: a full guide year is ~320 rows. Postgres rejects the statement,
    // not the row, so a chunk that fails is retried row by row (#218): the good
    // rows land, and each bad one is reported with the identity to find it in
    // the source file and the constraint that rejected it. The happy path pays
    // nothing extra.
    const onConflict = 'model_year,division,carline,model_type_index';
    const keyOf = r => `${r.modelYear}|${r.division}|${r.carline}|${r.modelTypeIndex}`;
    const tally = r => { if (seen.has(keyOf(r))) result.updated++; else result.imported++; };
    const CHUNK = 100;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);

      const { error } = await supabase
        .from('epa_fe_guide')
        .upsert(slice.map(r => feGuidePayload(r, sourceFile)), { onConflict, ignoreDuplicates: false });
      if (!error) { slice.forEach(tally); continue; }

      for (const r of slice) {
        const { error: rowErr } = await supabase
          .from('epa_fe_guide')
          .upsert([feGuidePayload(r, sourceFile)], { onConflict, ignoreDuplicates: false });
        if (rowErr) {
          result.failed++;
          result.errors.push(`${r.modelYear} ${r.division || '(no division)'} / ${r.carline || '(no carline)'} #${r.modelTypeIndex}: ${rowErr.message}`);
        } else {
          tally(r);
        }
      }
    }
    return result;
  }

  /**
   * Staged guide rows that could belong to this test vehicle — ranked candidates for
   * the link picker.
   *
   * EVERY YEAR, not just the test vehicle's. This used to filter server-side on the
   * exact model year, which contradicted both the picker's own copy ("no staged
   * rows in any imported year") and the ranker: `rankFeCandidates` treats the
   * year as a SORT key rather than a filter, and `bestFeCandidate` has a
   * dedicated wrong-year path that declines to auto-propose a borrowed row. All
   * of that was unreachable, and a 2027 ID. Buzz found nothing because VW has
   * only filed through 2026 — the rows were staged and never queried.
   *
   * Make matching stays in JS: it needs containment either way (`Lucid` against
   * `Lucid USA Inc.`), which SQL would need a custom function to express.
   *
   * Only the columns the picker ranks and displays are fetched. The full row is
   * re-read by id when one is actually linked, so pulling ~140 columns for
   * every staged row of every year to show a carline and a range was waste that
   * grew with each import. Paged, because all years together is past the
   * 1000-row cap; `id` orders it since nothing else here is unique.
   */
  async getFeGuideCandidates(testVehicle) {
    if (!this.useSupabase || !testVehicle) return [];
    const rows = await fetchAllRows(() => getSupabase()
      .from('epa_fe_guide')
      .select('id, model_year, division, carline, label_comb_range_mi, label_comb_mpge, motor_count')
      .order('id', { ascending: true }));
    return rankFeCandidates(testVehicle, rows);
  }

  /**
   * Link a guide row to a test vehicle and copy its figures across.
   *
   * The write is a single update so the values, their provenance and the link
   * land together — a partial promotion would leave fields the curator cannot
   * attribute and unlink cannot undo.
   */
  async linkFeGuideRow(testVehicleId, feRowId) {
    if (!this.useSupabase) return { promoted: [], skipped: [] };
    const supabase = getSupabase();

    const [{ data: testVehicle, error: gErr }, { data: feRow, error: fErr }] = await Promise.all([
      supabase.from('epa_test_vehicles')
        .select('*, epa_tests(test_number, test_date, procedure_code, total_dc_energy_kwh, '
                + 'ac_recharge_kwh, epa_test_phases(phase_index, phase_type, distance_mi, dc_energy_kwh))')
        .eq('test_vehicle_id', testVehicleId).single(),
      supabase.from('epa_fe_guide').select('*').eq('id', feRowId).single(),
    ]);
    if (gErr) throw gErr;
    if (fErr) throw fErr;

    const { updates, promoted, skipped } = promotionUpdates(testVehicle, feRow);

    // Which test the figures should come from, now that there is something to
    // decide it with. EPA published one pair of unadjusted figures and we hold
    // the tests, so the published highway figure identifies the run — see
    // utils/epaTestSelection.js for why highway, and why the score is a ratio
    // measured against two targets rather than a plain difference.
    //
    // Declines rather than guesses: one test is not a choice, and two runs too
    // alike to separate leave the most-recent default standing. A declined
    // selection writes null, so re-linking never leaves a stale winner behind.
    const selection = selectTestForGuide(testVehicle?.epa_tests ?? [], {
      unadjHwyMpge:     feRow?.unadj_hwy_mpge,
      labelCityRangeMi: feRow?.label_city_range_mi,
      labelHwyRangeMi:  feRow?.label_hwy_range_mi,
    });
    updates.preferred_test_number = selection.testNumber;
    // No early return on an empty `promoted`. `updates` always carries
    // fe_guide_row_id, and skipping the write when the guide happened to add no
    // new values left the test vehicle unlinked while reporting success.
    const { error } = await supabase
      .from('epa_test_vehicles').update(updates).eq('test_vehicle_id', testVehicleId);
    if (error) throw error;
    // The same link, on the certification it belongs to (#374).
    if (updates.fe_guide_row_id != null) {
      await this.syncCertificationGuideLink(testVehicleId, feRow, testVehicle?.test_group ?? null);
    }
    return { promoted, skipped, selection };
  }

  /**
   * Every test vehicle still awaiting a guide link (#238).
   *
   * Includes what each one would unlock, so the sweep can prioritise: the
   * procedure codes and DC energy that decide whether a link adds a charger
   * efficiency, and the coefficient targets that decide whether it adds a
   * road-load figure. Both are read here rather than counted server-side
   * because the sweep needs the values anyway.
   *
   * Skipped test vehicles are excluded by default. "We looked and there is nothing" is
   * a decision, and a sweep that keeps re-asking it never finishes — but the
   * caller can ask for them, because that is different from having no opinion.
   */
  async getTestVehiclesAwaitingFeLink({ includeSkipped = false } = {}) {
    if (!this.useSupabase) return [];
    let q = getSupabase()
      .from('epa_test_vehicles')
      .select(`
        test_vehicle_id, model_year, make, epa_carline_name, display_name,
        vehicle_config_number, fe_guide_row_id, fe_guide_skipped_at, fe_guide_skip_note, useable_kwh,
        carryover_model_year, cd_range_combined_calc, derived_5cycle_coefficient,
        epa_coefficient_sets(target_a, equiv_test_weight_lbs),
        epa_tests(procedure_code, total_dc_energy_kwh, ac_recharge_kwh, mfr_test_vehicle_comments),
        epa_covered_models(carline_number, carline_name, certification_region, drive_system),
        epa_vehicle_mappings(vehicles(id, name, year))
      `)
      .is('fe_guide_row_id', null)
      .order('test_vehicle_id');
    if (!includeSkipped) q = q.is('fe_guide_skipped_at', null);

    const { data, error } = await q;
    if (error) {
      // The skip columns arrive in migration 058. Without them the sweep still
      // works; it simply cannot remember a decision yet, which is better than
      // an admin panel that will not render.
      if (isMissingColumn(error)) {
        const { data: fallback, error: e2 } = await getSupabase()
          .from('epa_test_vehicles')
          .select(`
            test_vehicle_id, model_year, make, epa_carline_name, display_name,
            vehicle_config_number, fe_guide_row_id, useable_kwh,
            carryover_model_year, cd_range_combined_calc, derived_5cycle_coefficient,
            epa_coefficient_sets(target_a, equiv_test_weight_lbs),
            epa_tests(procedure_code, total_dc_energy_kwh, ac_recharge_kwh),
            epa_vehicle_mappings(vehicles(id, name, year))
          `)
          .is('fe_guide_row_id', null)
          .order('test_vehicle_id');
        if (e2) throw e2;
        return fallback || [];
      }
      throw error;
    }
    return data || [];
  }

  /** How far the sweep has got: linked, skipped, still awaiting a decision. */
  async getFeLinkProgress() {
    if (!this.useSupabase) return null;
    const { data, error } = await getSupabase()
      .from('epa_test_vehicles')
      .select('test_vehicle_id, fe_guide_row_id, fe_guide_skipped_at');
    if (error) {
      if (isMissingColumn(error)) return null;
      throw error;
    }
    const rows = data || [];
    return {
      total:    rows.length,
      linked:   rows.filter(r => r.fe_guide_row_id != null).length,
      skipped:  rows.filter(r => r.fe_guide_row_id == null && r.fe_guide_skipped_at != null).length,
      awaiting: rows.filter(r => r.fe_guide_row_id == null && r.fe_guide_skipped_at == null).length,
    };
  }

  /**
   * Record that a test vehicle has no guide row to link, or undo that.
   *
   * Deliberately not a link and not a deletion: the test vehicle stays unlinked and
   * stays findable, because a curator having looked is worth knowing.
   */
  async setFeLinkSkipped(testVehicleId, skipped, note = null) {
    if (!this.useSupabase) return;
    const { error } = await getSupabase()
      .from('epa_test_vehicles')
      .update(skipped
        ? { fe_guide_skipped_at: new Date().toISOString(), fe_guide_skip_note: note }
        : { fe_guide_skipped_at: null, fe_guide_skip_note: null })
      .eq('test_vehicle_id', testVehicleId);
    if (error) throw error;
    await this.setCertificationSkips(testVehicleId, skipped, note);
  }

  /**
   * Every recorded Data Checks skip (#321, migration 066).
   *
   * `available` is false until the table exists. The panel still shows every
   * finding; it just cannot remember a decision yet — better than an Admin view
   * that will not load, which is 058's fallback for the same reason.
   */
  async getDataCheckSkips() {
    if (!this.useSupabase) return { skips: [], available: false };
    const { data, error } = await getSupabase()
      .from('data_check_skips')
      .select('vehicle_id, check_key, fingerprint, note, skipped_at');
    if (error) {
      if (isMissingRelation(error)) return { skips: [], available: false };
      throw error;
    }
    return { skips: data || [], available: true };
  }

  /**
   * Skip a finding, recording the values it was judged on — or clear the skip
   * when `fingerprint` is null.
   *
   * Skipping again replaces the earlier judgement rather than adding a second:
   * one per (vehicle, check), which is the unique constraint the upsert targets.
   * A skip is kept against its fingerprint, so a finding whose values later
   * change returns on its own; nothing here has to notice.
   */
  async setDataCheckSkip(vehicleId, checkKey, fingerprint, note = null) {
    if (!this.useSupabase) return;
    const table = getSupabase().from('data_check_skips');
    const { error } = fingerprint == null
      ? await table.delete().eq('vehicle_id', vehicleId).eq('check_key', checkKey)
      : await table.upsert({
          vehicle_id: vehicleId,
          check_key: checkKey,
          fingerprint,
          note,
          skipped_at: new Date().toISOString(),
          skipped_by: this.user?.id ?? null,
        }, { onConflict: 'vehicle_id,check_key' });
    if (error) throw error;
  }

  /**
   * Skip several findings in one write — "Skip all" on a vehicle.
   *
   * One upsert rather than a loop over setDataCheckSkip: a vehicle can carry a
   * dozen findings, and a dozen round trips is exactly the lag this replaces.
   *
   * @param {Array<{ vehicleId, checkKey, fingerprint, note }>} skips
   */
  async recordDataCheckSkips(skips = []) {
    if (!this.useSupabase || !skips.length) return;
    const skippedAt = new Date().toISOString();
    const { error } = await getSupabase()
      .from('data_check_skips')
      .upsert(skips.map(s => ({
        vehicle_id: s.vehicleId,
        check_key: s.checkKey,
        fingerprint: s.fingerprint,
        note: s.note ?? null,
        skipped_at: skippedAt,
        skipped_by: this.user?.id ?? null,
      })), { onConflict: 'vehicle_id,check_key' });
    if (error) throw error;
  }

  /**
   * Link many test vehicles in one operation (#238).
   *
   * Exists because the per-link path in AppContext refreshes every vehicle in
   * the app afterwards — correct for one link, since the promoted figures reach
   * a vehicle card through its epa_vehicle_mappings, and catastrophic for
   * ninety-eight: that is ninety-eight sequential re-runs of the largest query
   * the app makes, for one refresh's worth of benefit.
   *
   * Sequential rather than parallel, deliberately. Each link reads its test vehicle,
   * computes what may be promoted and writes it back; firing them all at once
   * makes a mid-way failure impossible to attribute, and a batch that half
   * worked is exactly what a curator must be able to reason about.
   *
   * Never throws for a single failure. One test vehicle with a stale row should not
   * discard ninety-seven good links, so failures are collected and returned
   * with everything that did work.
   */
  async linkFeGuideRows(pairs) {
    const result = { linked: 0, promoted: 0, skipped: 0, failures: [] };
    if (!this.useSupabase || !pairs?.length) return result;

    for (const { testVehicleId, feRowId } of pairs) {
      try {
        const res = await this.linkFeGuideRow(testVehicleId, feRowId);
        result.linked   += 1;
        result.promoted += res.promoted.length;
        result.skipped  += res.skipped.length;
      } catch (error) {
        result.failures.push({ testVehicleId, message: error.message });
      }
    }
    return result;
  }

  /**
   * Test vehicles with everything the statistics derive from (#236).
   *
   * Only test vehicles carrying a guide link, and that is the point rather than a
   * convenience: a cert-side figure has to be groupable by class, brand, parent
   * or drive to be a statistic at all, and those dimensions live on the guide
   * row. An unlinked test vehicle can produce a number but nothing to compare it
   * against — which is why #238 came first and took this population from 45 to
   * 181.
   *
   * The nested guide row carries only the grouping fields plus
   * `nominal_pack_kwh`, which the usable-vs-gross buffer ratio needs.
   */
  /**
   * Every EPA test vehicle with everything the reconciliation checks read (#229).
   *
   * Deliberately NOT filtered to linked test vehicles, unlike getTestVehiclesForCertStats.
   * The question this answers is "which of my records do not reconcile?", and a
   * test vehicle with no guide row still has phases that can contradict its own stated
   * ranges — in fact those are the ones nobody has looked at.
   *
   * Wide, because the checks are wide: epaRecordFromTestVehicle needs the phases,
   * checkUnadjustedMpge needs the promoted unadjusted figures, checkLabelInvariant
   * needs the label range and adjustment factor, and checkRecordIntegrity needs
   * the energies and the coefficient sets. Fetching them separately would mean
   * one round trip per test vehicle.
   *
   * Paged: 211 test vehicles is under PostgREST's 1000-row cap today and the cap is not
   * a thing to be under by luck.
   */
  async getEpaTestVehiclesForAudit() {
    if (!this.useSupabase) return [];
    return fetchAllRows(() => getSupabase()
      .from('epa_test_vehicles')
      .select(`
        test_vehicle_id, test_group, carryover_test_group, carryover_model_year,
        model_year, make, epa_carline_name, display_name, vehicle_config_number,
        source_file, fe_guide_row_id,
        useable_kwh, nominal_pack_kwh, total_voltage,
        cd_range_combined_calc, cd_range_hwy_calc,
        label_range_published, label_adjustment_factor, label_calc_approach,
        preferred_test_number,
        unadj_city_mpge, unadj_hwy_mpge,
        accessory_load_w_override, charger_efficiency_override,
        epa_coefficient_sets(category, is_primary, target_a, target_b, target_c,
                             set_a, set_b, set_c, equiv_test_weight_lbs),
        epa_tests(test_number, test_date, procedure_code,
                  total_dc_energy_kwh, ac_recharge_kwh,
                  cd_range_combined_calc, cd_range_hwy_calc,
                  epa_test_phases(phase_index, phase_type, distance_mi, dc_energy_kwh)),
        epa_vehicle_mappings(id, confidence, vehicles(id, name, year)),
        epa_fe_guide!epa_test_vehicles_fe_guide_row_id_fkey(adjustment_signature)
      `)
      .order('test_vehicle_id', { ascending: true }));
  }

  /**
   * Every test vehicle, for the cert-side statistics.
   *
   * NOT filtered to guide-linked test vehicles any more. It was, because the
   * statistics group by class and drivetrain and those live on the guide row —
   * but a test vehicle with no link still knows its make and still carries the lab's
   * own measurements, and dropping it here meant nothing downstream could even
   * report that it existed. 90 of 413 were being filtered out, taking every GM
   * truck with a 180 kWh pack with them and leaving Chevrolet's usable energy
   * to be described by three cars.
   *
   * `certObservation` handles the missing half: brand falls back to `make`,
   * class and drivetrain read `Unknown`, and `_guideLinked` says which is
   * which.
   */
  async getTestVehiclesForCertStats() {
    if (!this.useSupabase) return [];
    const { data, error } = await getSupabase()
      .from('epa_test_vehicles')
      .select(`
        test_vehicle_id, model_year, make, epa_carline_name, display_name,
        useable_kwh, cd_range_combined_calc, label_range_published,
        derived_5cycle_coefficient, accessory_load_w_override, charger_efficiency_override,
        epa_coefficient_sets(is_primary, category, target_a, target_b, target_c,
                             set_a, set_b, set_c, equiv_test_weight_lbs),
        epa_tests(procedure_code, total_dc_energy_kwh, ac_recharge_kwh,
                  epa_test_phases(phase_index, phase_type, distance_mi, dc_energy_kwh)),
        epa_fe_guide!epa_test_vehicles_fe_guide_row_id_fkey(
          division, carline, carline_class, drive_desc, nominal_pack_kwh,
          label_comb_range_mi, label_comb_mpge, model_year, adjustment_signature
        )
      `)
      .order('test_vehicle_id');
    if (error) throw error;
    return data || [];
  }

  /**
   * Every test vehicle that could be plotted (#237).
   *
   * Unlike getTestVehiclesForCertStats this does NOT require a guide link: 210 of 211
   * test vehicles carry road-load coefficients, and a curve's shape needs nothing else.
   * The link matters for the ENERGY — without it there is no gross pack to fall
   * back on — which is what separates a curve with a range axis from one
   * without, and is surfaced as a tier rather than as a filter applied here.
   */
  async getTestVehiclesForCurves() {
    if (!this.useSupabase) return [];
    const { data, error } = await getSupabase()
      .from('epa_test_vehicles')
      .select(`
        test_vehicle_id, model_year, make, epa_carline_name, display_name,
        useable_kwh, accessory_load_w_override, derived_5cycle_coefficient,
        epa_coefficient_sets(is_primary, category, target_a, target_b, target_c,
                             set_a, set_b, set_c, equiv_test_weight_lbs),
        epa_tests(procedure_code, total_dc_energy_kwh,
                  epa_test_phases(phase_index, phase_type, distance_mi, dc_energy_kwh)),
        epa_fe_guide!epa_test_vehicles_fe_guide_row_id_fkey(
          carline, division, carline_class, drive_desc, nominal_pack_kwh
        )
      `)
      .order('test_vehicle_id');
    if (error) throw error;
    return data || [];
  }

  /** One staged guide row by id — the linked row, for showing what it holds. */
  async getFeGuideRow(id) {
    if (!this.useSupabase || id == null) return null;
    const { data, error } = await getSupabase()
      .from('epa_fe_guide').select('*').eq('id', id).single();
    if (error) throw error;
    return data;
  }

  /**
   * Take the guide's value for fields the curator had been holding.
   *
   * Deliberately overriding an override, so it is an explicit action rather than
   * something the link does on its own.
   */
  async acceptFeGuideValues(testVehicleId, columns) {
    if (!this.useSupabase || !columns?.length) return { accepted: [] };
    const supabase = getSupabase();

    const { data: testVehicle, error: gErr } = await supabase
      .from('epa_test_vehicles').select('*').eq('test_vehicle_id', testVehicleId).single();
    if (gErr) throw gErr;
    const feRow = await this.getFeGuideRow(testVehicle.fe_guide_row_id);
    if (!feRow) return { accepted: [] };

    const { updates, accepted } = acceptGuideUpdates(testVehicle, feRow, columns);
    if (!accepted.length) return { accepted };

    const { error } = await supabase
      .from('epa_test_vehicles').update(updates).eq('test_vehicle_id', testVehicleId);
    if (error) throw error;
    return { accepted };
  }

  /** Unlink, restoring every value the promotion displaced. */
  async unlinkFeGuideRow(testVehicleId) {
    if (!this.useSupabase) return { restored: [] };
    const supabase = getSupabase();

    const { data: testVehicle, error: gErr } = await supabase
      .from('epa_test_vehicles').select('*').eq('test_vehicle_id', testVehicleId).single();
    if (gErr) throw gErr;

    const { updates, restored } = demotionUpdates(testVehicle);

    // The selection was evidence from the guide row, so it goes when the row
    // does. Leaving it would keep steering every derived figure from a source
    // the record no longer has — and unlink is exactly what a curator does when
    // they decide the link was wrong.
    //
    // A curator-set choice is NOT collateral here. Uses the same predicate
    // promotion does rather than a second spelling of it: hand-set fields carry
    // source 'manual', and an earlier version of this guard looked for
    // 'curator', which nothing writes — so it never fired and would have wiped
    // exactly the choice it was meant to protect.
    if (!isCuratorOwned(testVehicle?.overrides, 'preferred_test_number')) {
        updates.preferred_test_number = null;
    }

    const { error } = await supabase
      .from('epa_test_vehicles').update(updates).eq('test_vehicle_id', testVehicleId);
    if (error) throw error;
    await this.clearCertificationGuideLink(testVehicleId, testVehicle?.fe_guide_row_id);
    return { restored };
  }

  /**
   * Staged guide rows, newest model year first. Used by the import summary.
   *
   * Aggregated in Postgres (migration 054) — six rows back, not ~1600.
   *
   * This is the read that exposed the row cap. It used to fetch every staged
   * row and count them in JS, and PostgREST silently returns at most 1000, so
   * with six guide years imported the summary listed 2024-2027, omitted 2022
   * and 2023, and reported them as never imported. The four years it did show
   * summed to exactly 1000.
   */
  async getFeGuideSummary() {
    if (!this.useSupabase) return [];
    const { data, error } = await getSupabase().rpc('fe_guide_summary');
    if (error) throw error;

    // count() returns bigint, which PostgREST may serialise as a string.
    return (data || []).map(r => ({
      modelYear: r.model_year,
      rows:      Number(r.row_count),
      divisions: Number(r.divisions),
    }));
  }

  /**
   * Every staged Fuel Economy Guide row, for the public browser (#235).
   *
   * Paged via fetchAllRows: PostgREST caps a response at 1000 rows with no
   * error and no flag, so a single unbounded select would return 1,175 rows as
   * 1,000 and look complete. Migration 054 documents what that cost last time.
   *
   * Ordered by `id`, and that matters. Paging is only sound on a UNIQUE order,
   * and 28 keys in the guide share a (model_year, division, carline) triple —
   * MY22 lists three Ioniq 5 rows — so tied rows may be ordered differently
   * between the two requests, dropping some and repeating others across the
   * 1000-row boundary. The browser sorts client-side anyway, so the fetch order
   * is free to be the one that is correct rather than the one that reads well.
   * Same reasoning as getFeGuideCandidates above.
   *
   * `raw` is excluded deliberately — 76 columns per row against the ~25 the
   * list needs, which is most of the payload for none of the display. The
   * detail view fetches it for one row on demand via the existing
   * getFeGuideRow(), which already selects `*` including `raw`.
   */
  async getFeGuideRows() {
    if (!this.useSupabase) return [];
    return fetchAllRows(() => getSupabase()
      .from('epa_fe_guide')
      .select(`
        id, model_year, division, carline, model_type_index, smog_test_group,
        label_comb_range_mi, label_city_range_mi, label_hwy_range_mi,
        label_comb_mpge, label_city_mpge, label_hwy_mpge,
        unadj_city_mpge, unadj_hwy_mpge, unadj_comb_mpge,
        adj_city_mpge, adj_hwy_mpge, adj_comb_mpge,
        label_adjustment_factor, calc_approach, adjustment_signature,
        total_voltage_v, batt_capacity_ah, nominal_pack_kwh, batt_specific_energy_wh_kg,
        motor_power_kw, motor_count, charge_time_240v_h, drive_desc, carline_class
      `)
      .order('id', { ascending: true }));
  }

  /**
   * Guide row id → the vehicles we hold test data for.
   *
   * Two indexed hops: `epa_test_vehicles.fe_guide_row_id` is a foreign key with a
   * partial index, and `epa_vehicle_mappings` joins a test vehicle to its vehicles.
   * Only 45 of 204 test vehicles are linked today, so this is a small map fetched once
   * and keyed in memory rather than a lookup per displayed row.
   */
  async getFeGuideVehicleLinks() {
    if (!this.useSupabase) return {};
    const { data, error } = await getSupabase()
      .from('epa_test_vehicles')
      .select('test_vehicle_id, fe_guide_row_id, epa_vehicle_mappings(vehicles(id, name, year))')
      .not('fe_guide_row_id', 'is', null);
    if (error) throw error;

    const byRow = {};
    for (const g of data || []) {
      const vehicles = (g.epa_vehicle_mappings || [])
        .map(m => m.vehicles)
        .filter(Boolean);
      if (!byRow[g.fe_guide_row_id]) byRow[g.fe_guide_row_id] = { testVehicleIds: [], vehicles: [] };
      byRow[g.fe_guide_row_id].testVehicleIds.push(g.test_vehicle_id);
      byRow[g.fe_guide_row_id].vehicles.push(...vehicles);
    }
    return byRow;
  }

  // ── EPA curator model: coefficient sets, tests, phases, audit ─────────────────

  /**
   * Fetch a single EPA test vehicle with its full curator hierarchy:
   * coefficient sets, tests, and each test's phases. Used by the curator
   * form in Tests & Data.
   *
   * @param {string} testVehicleId
   * @returns {Object|null} test vehicle row with nested epa_coefficient_sets and
   *   epa_tests(epa_test_phases), or null if not found.
   */
  async getEpaTestVehicleFull(testVehicleId) {
    if (!this.useSupabase) return null;
    const { data, error } = await getSupabase()
      .from('epa_test_vehicles')
      .select(`
        *,
        epa_coefficient_sets(*),
        epa_tests(*, epa_test_phases(*))
      `)
      .eq('test_vehicle_id', testVehicleId)
      .single();
    if (error) throw error;
    return data || null;
  }

  /**
   * Insert (no id) or update (with id) a single coefficient set.
   * Returns the saved row.
   */
  async saveEpaCoefficientSet(row) {
    if (!this.useSupabase) return null;
    const db = getSupabase().from('epa_coefficient_sets');
    const { id, ...fields } = row;
    const q = id
      ? db.update(fields).eq('id', id)
      : db.insert(fields);
    const { data, error } = await q.select().single();
    if (error) throw error;
    return data;
  }

  async deleteEpaCoefficientSet(id) {
    if (!this.useSupabase) return;
    const { error } = await getSupabase()
      .from('epa_coefficient_sets').delete().eq('id', id);
    if (error) throw error;
  }

  /** Insert (no id) or update (with id) a single test record. Returns the saved row. */
  async saveEpaTest(row) {
    if (!this.useSupabase) return null;
    const db = getSupabase().from('epa_tests');
    const { id, epa_test_phases, ...fields } = row; // never write nested phases here
    const q = id
      ? db.update(fields).eq('id', id)
      : db.insert(fields);
    const { data, error } = await q.select().single();
    if (error) throw error;
    return data;
  }

  async deleteEpaTest(id) {
    if (!this.useSupabase) return;
    const { error } = await getSupabase()
      .from('epa_tests').delete().eq('id', id);
    if (error) throw error;
  }

  /** Insert (no id) or update (with id) a single phase row. Returns the saved row. */
  async saveEpaPhase(row) {
    if (!this.useSupabase) return null;
    const db = getSupabase().from('epa_test_phases');
    const { id, ...fields } = row;
    const q = id
      ? db.update(fields).eq('id', id)
      : db.insert(fields);
    const { data, error } = await q.select().single();
    if (error) throw error;
    return data;
  }

  async deleteEpaPhase(id) {
    if (!this.useSupabase) return;
    const { error } = await getSupabase()
      .from('epa_test_phases').delete().eq('id', id);
    if (error) throw error;
  }

  /**
   * Append a row to the field-edit audit trail. Records who/when/prior/new
   * plus an optional source citation. Insert-only (immutable history).
   *
   * `testVehicleId` is what the history is read back by; `rowKey` is the child's
   * stable identity (coefficient category, EPA test number, "<test> #<phase>")
   * so an entry still says what it was about after a re-import has replaced
   * the row id. See migration 074.
   *
   * @param {{ tableName, rowId, testVehicleId, rowKey, field, priorValue, newValue, sourceCitation }} entry
   */
  async logEpaFieldEdit({ tableName, rowId, testVehicleId, rowKey, field, priorValue, newValue, sourceCitation }) {
    if (!this.useSupabase) return;
    const { error } = await getSupabase()
      .from('epa_field_audit')
      .insert({
        table_name:      tableName,
        row_id:          String(rowId),
        test_vehicle_id:   testVehicleId ?? null,
        row_key:         rowKey ?? null,
        field,
        prior_value:     priorValue != null ? String(priorValue) : null,
        new_value:       newValue != null ? String(newValue) : null,
        source_citation: sourceCitation || null,
        edited_by:       this.user?.id ?? null,
      });
    if (error) throw error;
  }

  /**
   * Read the audit trail for a single row (most recent first).
   *
   * @param {string} tableName
   * @param {string|number} rowId
   */
  async getEpaFieldAudit(tableName, rowId) {
    if (!this.useSupabase) return [];
    const { data, error } = await getSupabase()
      .from('epa_field_audit')
      .select('*')
      .eq('table_name', tableName)
      .eq('row_id', String(rowId))
      .order('edited_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  /**
   * The audit trail for a whole test vehicle — the test vehicle row and everything under
   * it — most recent first. Keyed by `test_vehicle_id`, not by the ids of the
   * children that exist today: those change when rows are replaced, and history
   * that only resolves through live ids goes quiet the moment they do.
   *
   * @param {string} testVehicleId
   */
  async getEpaAuditForTestVehicle(testVehicleId) {
    if (!this.useSupabase) return [];
    const { data, error } = await getSupabase()
      .from('epa_field_audit')
      .select('*')
      .eq('test_vehicle_id', testVehicleId)
      .order('edited_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    return data || [];
  }

  // ── Performance testing (acceleration / braking) ────────────────────────────
  //
  // Deliberately separate from `runs`: a session yields ~8 launches in 90
  // seconds, and runs rows feed the charging/range selectors and vehicle-card
  // counts. See migration 036 for the full rationale.

  /**
   * Performance sessions with runs and split points nested, for one vehicle or
   * a list of them. Single relational query, same shape as getEpaTestVehicleFull().
   *
   * Accepts an array so the comparison charts can load every selected vehicle in
   * ONE round trip — fetching per vehicle meant ~50 queries on a wide selection.
   */
  async getPerformanceSessions(vehicleId) {
    if (!this.useSupabase) return [];
    const ids = Array.isArray(vehicleId) ? vehicleId : [vehicleId];
    if (ids.length === 0) return [];
    const { data, error } = await getSupabase()
      .from('performance_sessions')
      .select(`
        *,
        performance_runs(*, performance_run_points(*))
      `)
      .in('vehicle_id', ids)
      .order('tested_at', { ascending: false });
    if (error) throw error;
    // PostgREST doesn't order nested rows — sort children so runs and their
    // splits read in test order rather than insertion order.
    for (const session of data || []) {
      const runs = session.performance_runs || [];
      runs.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
      for (const run of runs) {
        (run.performance_run_points || []).sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
      }
    }
    return data || [];
  }

  /**
   * Per-vehicle counts of performance runs, split by test type — for the
   * vehicle-card badges.
   *
   * Its own query rather than part of getVehicles: performance tables stay out
   * of that select on purpose (see the note there), and this pulls only the
   * three columns needed instead of the full session/run/point tree.
   *
   * @returns {Promise<Record<number, {accel: number, braking: number}>>}
   */
  async getPerformanceRunCounts() {
    if (!this.useSupabase) return {};
    const { data, error } = await getSupabase()
      .from('performance_sessions')
      .select('vehicle_id, test_type, performance_runs(count)');
    if (error) {
      console.warn('Performance counts unavailable:', error.message);
      return {};
    }
    const out = {};
    for (const row of data || []) {
      const n = Array.isArray(row.performance_runs) ? (row.performance_runs[0]?.count ?? 0) : 0;
      if (!out[row.vehicle_id]) out[row.vehicle_id] = { accel: 0, braking: 0 };
      if (row.test_type === 'braking') out[row.vehicle_id].braking += n;
      else                              out[row.vehicle_id].accel   += n;
    }
    return out;
  }

  /**
   * Find the existing runs a parsed export describes, if any.
   *
   * A Draggy session is exported once per metric set — speed-threshold splits
   * in one file, distance splits in another — for the SAME physical runs. Both
   * carry identical wall-clock timestamps, which makes run_at an exact match
   * key. Importing the second file as a new session would duplicate every run.
   *
   * @returns {Promise<{session, matches: Map<string, object>, matched: number,
   *                    unmatched: string[]}|null>} null when nothing lines up
   */
  async findMatchingPerformanceRuns(vehicleId, parsedRuns) {
    if (!this.useSupabase) return null;
    const stamps = parsedRuns.map(r => r.runAt).filter(Boolean);
    if (stamps.length === 0) return null;

    const sessions = await this.getPerformanceSessions(vehicleId);
    let best = null;
    for (const session of sessions) {
      const byStamp = new Map();
      for (const run of session.performance_runs || []) {
        if (run.run_at) byStamp.set(String(run.run_at), run);
      }
      const matched = stamps.filter(s => byStamp.has(String(s)));
      if (matched.length === 0) continue;
      if (!best || matched.length > best.matched) {
        best = {
          session,
          matches: byStamp,
          matched: matched.length,
          unmatched: stamps.filter(s => !byStamp.has(String(s))),
        };
      }
    }
    return best;
  }

  /**
   * Layer a second export's splits onto runs that already exist.
   *
   * Only adds points whose label isn't already on the run, so re-importing the
   * same file is a no-op rather than a duplicate ladder. Sequence numbers
   * continue from the highest already stored, since (run_id, sequence) is
   * unique.
   *
   * @returns {Promise<{runsUpdated: number, pointsAdded: number}>}
   */
  async mergePerformanceSplits(match, parsedRuns) {
    if (!this.useSupabase || !this.user) throw new Error('Must be logged in to import.');
    let runsUpdated = 0, pointsAdded = 0;
    // Counted so a no-op can say WHICH step produced nothing.
    let runsSeen = 0, runsMatched = 0, splitsSeen = 0, alreadyPresent = 0;

    for (const parsed of parsedRuns) {
      runsSeen += 1;
      splitsSeen += parsed.splits?.length ?? 0;
      const existing = match.matches.get(String(parsed.runAt));
      if (!existing) continue;
      runsMatched += 1;
      if (!parsed.splits?.length) continue;

      const have = new Set((existing.performance_run_points || []).map(p => p.label));
      const fresh = parsed.splits.filter(sp => !have.has(sp.label));
      alreadyPresent += parsed.splits.length - fresh.length;
      if (fresh.length === 0) continue;

      let seq = (existing.performance_run_points || [])
        .reduce((m, p) => Math.max(m, p.sequence ?? 0), -1) + 1;

      const rows = fresh.map(sp => ({
        run_id: existing.id,
        sequence: seq++,
        label: sp.label ?? null,
        speed_mph: sp.speedMph ?? null,
        elapsed_s: sp.elapsedS ?? null,
        distance_ft: sp.distanceFt ?? null,
      }));
      // .select() so the count is what the database actually stored, not what
      // we hoped it would. A merge that silently writes nothing is worse than
      // one that fails, because it looks like it worked.
      const { data: inserted, error } = await getSupabase()
        .from('performance_run_points').insert(rows).select();
      if (error) throw error;

      pointsAdded += inserted?.length ?? 0;
      runsUpdated += 1;
    }

    return { runsUpdated, pointsAdded, runsSeen, runsMatched, splitsSeen, alreadyPresent };
  }

  /** Insert (no id) or update (with id) a session. Returns the saved row. */
  async savePerformanceSession(row) {
    if (!this.useSupabase) return null;
    const db = getSupabase().from('performance_sessions');
    const { id, performance_runs, ...fields } = row; // never write nested runs here
    const q = id ? db.update(fields).eq('id', id) : db.insert(fields);
    const { data, error } = await q.select().single();
    if (error) throw error;
    return data;
  }

  async deletePerformanceSession(id) {
    if (!this.useSupabase) return;
    const { error } = await getSupabase()
      .from('performance_sessions').delete().eq('id', id);
    if (error) throw error;
  }

  /** Insert (no id) or update (with id) a single run. Returns the saved row. */
  async savePerformanceRun(row) {
    if (!this.useSupabase) return null;
    const db = getSupabase().from('performance_runs');
    const { id, performance_run_points, ...fields } = row;
    const q = id ? db.update(fields).eq('id', id) : db.insert(fields);
    const { data, error } = await q.select().single();
    if (error) throw error;
    return data;
  }

  async deletePerformanceRun(id) {
    if (!this.useSupabase) return;
    const { error } = await getSupabase()
      .from('performance_runs').delete().eq('id', id);
    if (error) throw error;
  }

  /**
   * Import a parsed performance CSV as one session with its runs and splits.
   *
   * Takes the output of parsePerformanceCSV() directly. Rolls the session back
   * if any child insert fails, so a partial import can't leave an empty session
   * card behind (there are no transactions over PostgREST).
   *
   * @param {number} vehicleId
   * @param {{session: object, runs: object[]}} parsed
   * @param {{trimId?: number, sourceName?: string, sourceUrl?: string,
   *          spreadsheetUrl?: string, notes?: string}} [meta]
   * @returns {Promise<object>} the created session row
   */
  async importPerformanceSession(vehicleId, parsed, meta = {}) {
    if (!this.useSupabase || !this.user) throw new Error('Must be logged in to import.');
    const { session, runs } = parsed;

    const sessionRow = await this.savePerformanceSession({
      vehicle_id: vehicleId,
      trim_id: meta.trimId ?? null,
      test_type: session.testType,
      tested_at: session.testedAt,
      location_name: session.locationName ?? null,
      latitude: session.latitude ?? null,
      longitude: session.longitude ?? null,
      temperature_f: session.temperatureF ?? null,
      humidity_pct: session.humidityPct ?? null,
      pressure_inhg: session.pressureInHg ?? null,
      wind_speed_mph: session.windSpeedMph ?? null,
      wind_bearing_deg: session.windBearingDeg ?? null,
      cloud_cover_pct: session.cloudCoverPct ?? null,
      visibility_mi: session.visibilityMi ?? null,
      source_name: meta.sourceName ?? null,
      // Only when there is one, so a session with no source still writes
      // against a database without migration 068.
      ...(meta.sourceId != null ? { source_id: meta.sourceId } : {}),
      source_url: meta.sourceUrl ?? null,
      spreadsheet_url: meta.spreadsheetUrl ?? null,
      notes: meta.notes ?? null,
    });

    try {
      for (const run of runs) {
        const runRow = await this.savePerformanceRun({
          session_id: sessionRow.id,
          sequence: run.sequence,
          drive_mode: run.driveMode ?? null,
          run_at: run.runAt ?? null,
          altitude_ft: run.altitudeFt ?? null,
          density_altitude_ft: run.densityAltitudeFt ?? null,
          slope_pct: run.slopePct ?? null,
          distance_run_ft: run.distanceRunFt ?? null,
          max_g_force: run.maxGForce ?? null,
          zero_to_60_sec: run.zeroTo60Sec ?? null,
          zero_to_60_rollout_sec: run.zeroTo60RolloutSec ?? null,
          braking_distance_ft: run.brakingDistanceFt ?? null,
          braking_from_mph: run.brakingFromMph ?? null,
        });

        if (run.splits?.length) {
          const points = run.splits.map((s, i) => ({
            run_id: runRow.id,
            sequence: i,
            label: s.label ?? null,
            speed_mph: s.speedMph ?? null,
            elapsed_s: s.elapsedS ?? null,
            distance_ft: s.distanceFt ?? null,
          }));
          const { error } = await getSupabase().from('performance_run_points').insert(points);
          if (error) throw error;
        }
      }
    } catch (err) {
      await this.deletePerformanceSession(sessionRow.id).catch(() => {});
      throw err;
    }

    return sessionRow;
  }

  /**
   * Reported summaries with their variable-window intervals, for one vehicle or
   * (omit the argument) all of them — the cross-vehicle compare charts need the
   * whole set.
   *
   * Fetched separately from getVehicles() on purpose: this is new-table
   * territory, and embedding it in the main vehicles query meant an unapplied
   * migration blanked the entire app. Here a missing table degrades to "no
   * performance data" and is logged, rather than taking the vehicle list with it.
   */
  async getPerformanceSummaries(vehicleId = null) {
    if (!this.useSupabase) return [];
    let q = getSupabase()
      .from('performance_summaries')
      .select('*, performance_intervals(*)');
    // Array form keeps the comparison charts to one query across the selection.
    if (Array.isArray(vehicleId)) {
      if (vehicleId.length === 0) return [];
      q = q.in('vehicle_id', vehicleId);
    } else if (vehicleId != null) {
      q = q.eq('vehicle_id', vehicleId);
    }
    const { data, error } = await q;
    if (error) {
      console.warn('Performance summaries unavailable (migrations 039/040 applied?):', error.message);
      return [];
    }
    return data || [];
  }

  /** Insert (no id) or update (with id) a reported summary. Returns the saved row. */
  async savePerformanceSummary(row) {
    if (!this.useSupabase) return null;
    const db = getSupabase().from('performance_summaries');
    const { id, performance_intervals, ...fields } = row; // intervals saved separately
    const q = id
      ? db.update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id)
      : db.insert(fields);
    const { data, error } = await q.select().single();
    if (error) throw error;
    return data;
  }

  /**
   * Create one published result and its speed windows together, from a parsed
   * paste (see parsePublishedResults.js).
   *
   * The windows go in a single insert so they land atomically. If they fail,
   * the summary is removed again rather than left behind holding half a result
   * — a result card missing its braking rows looks like a source that didn't
   * report them, which is a different claim from an import that broke.
   *
   * @param {{ fields: object, intervals: object[] }} parsed
   * @returns {object} the saved summary row
   */
  async importPublishedResult({ fields, intervals = [] }) {
    if (!this.useSupabase) return null;
    const summary = await this.savePerformanceSummary(fields);
    if (!intervals.length) return summary;

    const { error } = await getSupabase()
      .from('performance_intervals')
      .insert(intervals.map(iv => ({ ...iv, summary_id: summary.id })));

    if (error) {
      await this.deletePerformanceSummary(summary.id).catch(() => {});
      throw new Error(`Speed windows could not be saved (${error.message}). Nothing was imported.`);
    }
    return summary;
  }

  /**
   * Replace an earlier import of the same result — same vehicle, source and
   * link — with a fresh read of it (#327).
   *
   * The new speed windows go in BEFORE the old ones come out, so a failed
   * insert leaves the earlier result whole instead of a result with none —
   * which would read as a source that reported no windows.
   */
  async replacePublishedResult(summaryId, { fields, intervals = [] }) {
    if (!this.useSupabase) return null;
    const db = getSupabase();
    const { data: old, error: readError } = await db
      .from('performance_intervals').select('id').eq('summary_id', summaryId);
    if (readError) throw readError;

    if (intervals.length) {
      const { error } = await db
        .from('performance_intervals')
        .insert(intervals.map(iv => ({ ...iv, summary_id: summaryId })));
      if (error) throw new Error(`Speed windows could not be saved (${error.message}). The earlier result is unchanged.`);
    }
    const oldIds = (old ?? []).map(r => r.id);
    if (oldIds.length) {
      const { error } = await db.from('performance_intervals').delete().in('id', oldIds);
      if (error) throw error;
    }
    return this.savePerformanceSummary({ ...fields, id: summaryId });
  }

  // ── Platforms (#318, migration 072) ───────────────────────────────────────

  /** The platform list, both kinds. `available` is false until migration 072 is applied. */
  async getPlatforms() {
    if (!this.useSupabase) return { platforms: [], available: false };
    const { data, error } = await getSupabase().from('platforms').select('*').order('name');
    if (error) {
      if (isMissingRelation(error)) { this.platformsAvailable = false; return { platforms: [], available: false }; }
      throw error;
    }
    // Remembered, so a vehicle write names the link columns only where they exist.
    this.platformsAvailable = true;
    return { platforms: data || [], available: true };
  }

  /**
   * Insert (no id) or update (with id) a platform. Aliases and chemistries are
   * stored trimmed and de-duplicated. A mechanical platform's electrical
   * properties are cleared rather than refused, so switching a row's kind in
   * the editor saves instead of tripping the table's CHECK.
   */
  async savePlatform(row) {
    if (!this.useSupabase) return null;
    const unique = (list) => [...new Set((list ?? []).map(s => String(s).trim()).filter(Boolean))];
    const { id, ...fields } = row;
    if ('name' in fields) fields.name = String(fields.name ?? '').trim();
    if ('maker_group' in fields) fields.maker_group = String(fields.maker_group ?? '').trim() || null;
    if ('aliases' in fields) fields.aliases = unique(fields.aliases);
    if ('chemistries' in fields) fields.chemistries = unique(fields.chemistries);
    if (fields.kind === 'mechanical') {
      Object.assign(fields, { voltage_class_v: null, dc_400v_charging: null, chemistries: [], cell_format: null });
    }
    const db = getSupabase();
    const q = id
      ? db.from('platforms').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id)
      : db.from('platforms').insert(fields);
    const { data, error } = await q.select().single();
    if (error) throw error;
    return data;
  }

  /** Delete a platform. Its vehicles are unlinked by the foreign key, never deleted. */
  async deletePlatform(id) {
    if (!this.useSupabase) return;
    const { error } = await getSupabase().from('platforms').delete().eq('id', id);
    if (error) throw error;
  }

  // ── Sources (#327, migration 068) ─────────────────────────────────────────

  /** The source list. `available` is false until migration 068 is applied. */
  async getSources() {
    if (!this.useSupabase) return { sources: [], available: false };
    const { data, error } = await getSupabase().from('sources').select('*').order('name');
    if (error) {
      if (isMissingRelation(error)) return { sources: [], available: false };
      throw error;
    }
    return { sources: data || [], available: true };
  }

  /**
   * Insert (no id) or update (with id) a source.
   *
   * Aliases and domains are stored trimmed and de-duplicated; a domain is
   * stored as a bare host, so "https://www.caranddriver.com/" and
   * "caranddriver.com" are one entry. A rename is carried onto every result
   * linked to the source, so the text column never keeps the old name.
   */
  async saveSource(row) {
    if (!this.useSupabase) return null;
    const unique = (list) => [...new Set((list ?? []).map(s => String(s).trim()).filter(Boolean))];
    const { id, ...fields } = row;
    if ('name' in fields) fields.name = String(fields.name ?? '').trim();
    if ('aliases' in fields) fields.aliases = unique(fields.aliases);
    if ('domains' in fields) {
      fields.domains = unique(fields.domains.map(d => String(d).trim().toLowerCase()
        .replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '')));
    }
    const db = getSupabase();
    const q = id
      ? db.from('sources').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id)
      : db.from('sources').insert(fields);
    const { data, error } = await q.select().single();
    if (error) throw error;

    if (id && 'name' in fields) {
      for (const table of ['performance_summaries', 'performance_sessions']) {
        const { error: renameError } = await db.from(table).update({ source_name: data.name }).eq('source_id', id);
        if (renameError) throw renameError;
      }
    }
    return data;
  }

  /** Delete a source. Its results keep their source_name text; the foreign key unlinks them. */
  async deleteSource(id) {
    if (!this.useSupabase) return;
    const { error } = await getSupabase().from('sources').delete().eq('id', id);
    if (error) throw error;
  }

  async deletePerformanceSummary(id) {
    if (!this.useSupabase) return;
    const { error } = await getSupabase()
      .from('performance_summaries').delete().eq('id', id);
    if (error) throw error;
  }

  /**
   * Insert (no id) or update (with id) one variable-window result — a braking
   * distance, passing time, or a non-canonical accel window. Values are stored
   * in the unit they were reported in; see migration 040.
   */
  async savePerformanceInterval(row) {
    if (!this.useSupabase) return null;
    const db = getSupabase().from('performance_intervals');
    const { id, ...fields } = row;
    const q = id ? db.update(fields).eq('id', id) : db.insert(fields);
    const { data, error } = await q.select().single();
    if (error) throw error;
    return data;
  }

  async deletePerformanceInterval(id) {
    if (!this.useSupabase) return;
    const { error } = await getSupabase()
      .from('performance_intervals').delete().eq('id', id);
    if (error) throw error;
  }

  // ── Access logging ──────────────────────────────────────────────────────────

  /**
   * Record an unauthorised access attempt (RLS violation or permission error).
   * Writes via a SECURITY DEFINER RPC so anonymous callers can always insert.
   * Errors are silently swallowed — logging must never surface to the user.
   *
   * @param {{ operation, resourceType, resourceId, errorCode, errorMessage }} opts
   */
  async logAccessAttempt({ operation, resourceType, resourceId, errorCode, errorMessage }) {
    if (!this.useSupabase) return;
    try {
      await getSupabase().rpc('log_access_attempt', {
        p_user_id:       this.user?.id        ?? null,
        p_user_email:    this.user?.email      ?? null,
        p_operation:     operation,
        p_resource_type: resourceType          ?? null,
        p_resource_id:   String(resourceId ?? ''),
        p_error_code:    errorCode             ?? null,
        p_error_message: errorMessage          ?? null,
        p_user_agent:    navigator.userAgent,
      });
    } catch {
      // Intentionally swallowed — logging failures are invisible to the user.
    }
  }
}


/**
 * One parsed Fuel Economy Guide row → its `epa_fe_guide` shape.
 *
 * Exported and separated from the request that sends it so the column names can
 * be tested: a mistyped key here does not throw, it silently drops a field or
 * writes it somewhere unintended, and the row still imports looking healthy.
 */
export function feGuidePayload(r, sourceFile = null) {
  return {
    model_year: r.modelYear,
    division:   r.division,
    carline:    r.carline,
    smog_test_group:  r.smogTestGroup,
    model_type_index: r.modelTypeIndex,

    label_comb_range_mi: r.labelCombRangeMi,
    label_city_range_mi: r.labelCityRangeMi,
    label_hwy_range_mi:  r.labelHwyRangeMi,
    label_comb_mpge:     r.labelCombMpge,
    label_city_mpge:     r.labelCityMpge,
    label_hwy_mpge:      r.labelHwyMpge,

    unadj_city_mpge: r.unadjCityMpge,
    unadj_hwy_mpge:  r.unadjHwyMpge,
    unadj_comb_mpge: r.unadjCombMpge,
    adj_city_mpge:   r.adjCityMpge,
    adj_hwy_mpge:    r.adjHwyMpge,
    adj_comb_mpge:   r.adjCombMpge,

    label_adjustment_factor: r.labelAdjustmentFactor,
    calc_approach:           r.calcApproach,
    adjustment_signature:    r.adjustmentSignature,

    total_voltage_v:            r.totalVoltageV,
    batt_capacity_ah:           r.battCapacityAh,
    nominal_pack_kwh:           r.nominalPackKwh,
    batt_specific_energy_wh_kg: r.battSpecificEnergyWhKg,

    motor_power_kw:     r.motorPowerKw,
    motor_count:        r.motorCount,
    charge_time_240v_h: r.chargeTime240vH,
    drive_desc:    r.driveDesc,
    carline_class: r.carlineClass,

    raw: r.raw ?? null,
    source_file: sourceFile,
    imported_at: new Date().toISOString(),
  };
}

export const dataService = new DataService();

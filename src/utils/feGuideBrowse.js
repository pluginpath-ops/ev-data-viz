/**
 * The Fuel Economy Guide browser — columns, derived fields, filtering, sorting
 * (#235, phase 1 of #234).
 *
 * Pure module. Knows about the shape of an `epa_fe_guide` row and nothing about
 * React, Supabase or the DOM, so the rules below are testable as statements
 * about the data rather than about a component.
 *
 * ── Why this filters in the browser ─────────────────────────────────────────
 *
 * The issue originally called for server-side RPCs, on the strength of
 * migration 054. That migration is about AGGREGATES: PostgREST truncates a
 * response at 1000 rows with no error and no flag, so a count computed over a
 * truncated set is confidently wrong, and the guide summary really did show four
 * model years instead of six.
 *
 * A browser is not an aggregate. `DataService.getFeGuideRows` pages until the
 * source is exhausted, which is correct rather than truncated, and the whole
 * corpus minus `raw` is ~1,175 rows — small enough that filtering here is
 * instant and costs one request on load instead of one per keystroke.
 *
 * The ceiling is real but distant: the guide adds a few hundred rows per model
 * year. `ROW_BUDGET` marks where this stops being reasonable, and the view says
 * so out loud rather than degrading quietly. Phase 2's statistics still need
 * RPCs — you cannot page your way to a correct median.
 */

/** Rows past which the load-everything approach should be revisited (#236). */
export const ROW_BUDGET = 5000;

// ── Derived fields ───────────────────────────────────────────────────────────

/**
 * Wheel diameter in inches, read from the carline name.
 *
 * EPA has no wheel column. Some makers write the size into the name — BMW as
 * `i4 eDrive40 Gran Coupe (19'' Wheels)`, Rivian as `R1S Dual Max (20in)` — and
 * most do not, so this resolves on about 43% of rows (504 of 1,175), heavily
 * concentrated in Rivian and BMW.
 *
 * That partial coverage is the whole reason it is a derived field and not a
 * promoted column: absent means "this maker does not state it", NOT "this car
 * has no wheels", and a filter on wheel size is therefore a filter on a subset
 * that the UI has to name. Observed values run 17–23 inches.
 */
export function wheelSizeIn(carline) {
    const m = /(\d{2})\s*(?:in\b|inch|''|")/i.exec(String(carline ?? ''));
    if (!m) return null;
    const n = Number(m[1]);
    // Guard the regex against numbers that are not wheels. Nothing in the
    // corpus sits outside this band, and a "35in" read out of a trim name
    // would otherwise become a filter value nobody can explain.
    return n >= 15 && n <= 26 ? n : null;
}

/**
 * EPA's carline class, split into body type and size.
 *
 * `carline_class` bakes the drivetrain into the string — `Standard SUV 4WD` and
 * `Standard SUV 2WD` are the same body — which makes the raw column useless for
 * the obvious question. "2025 pickups" has to union `Standard Pick-up Trucks
 * 4WD` (128 rows) with its 2WD twin (3 rows), and grouping on the unsplit value
 * silently reports two separate classes instead.
 *
 * Drivetrain is not lost: it has its own column (`drive_desc`), which is both
 * more precise and more complete than the suffix here.
 *
 * A hand-written map over 18 observed values, deliberately. This is NOT the
 * carline-parsing problem — that is unbounded free text written differently by
 * every manufacturer, where this is a small closed vocabulary EPA controls. An
 * unrecognised value passes through as its own body type rather than being
 * bucketed into something plausible-looking.
 */
const CLASS_SIZES = ['Small', 'Standard', 'Midsize', 'Compact', 'Subcompact', 'Minicompact', 'Large'];

export function splitCarlineClass(carlineClass) {
    const raw = String(carlineClass ?? '').trim();
    if (!raw) return { body: null, size: null };

    // Strip the drivetrain suffix first so it cannot end up in the body name.
    let s = raw.replace(/\b[24]WD\b/g, '').replace(/\s+/g, ' ').trim();

    let size = null;
    for (const candidate of CLASS_SIZES) {
        const re = new RegExp(`^${candidate}\\b`, 'i');
        if (re.test(s)) { size = candidate; s = s.replace(re, '').trim(); break; }
    }

    let body;
    if (/pick-?up/i.test(s))                    body = 'Pickup';
    else if (/SUV/i.test(s))                    body = 'SUV';
    else if (/station wagon|wagon/i.test(s))    body = 'Wagon';
    else if (/minivan/i.test(s))                body = 'Minivan';
    else if (/special purpose/i.test(s))        body = 'Special Purpose';
    else if (/^cars?$/i.test(s))                body = 'Car';
    else if (/two seaters?/i.test(s))         { body = 'Two Seater'; size = null; }
    else                                        body = s || null;

    return { body, size };
}

/** "Small SUV", "Pickup", "Large Car" — the grouping label for a row. */
export function bodyClassLabel(carlineClass) {
    const { body, size } = splitCarlineClass(carlineClass);
    if (!body) return null;
    return size ? `${size} ${body}` : body;
}

/**
 * City ÷ highway MPGe.
 *
 * Mostly aerodynamics and mass, which is what makes it a verdict on the
 * drivetrain and body rather than on battery size: a car that loses little on
 * the highway says so here more clearly than either figure says alone. Observed
 * corpus range is 0.875–1.329 against a median of 1.140 — and the sub-1.0 end,
 * a car more efficient at highway speed than in town, is the interesting tail.
 */
export function cityHwyRatio(row) {
    const c = Number(row?.label_city_mpge), h = Number(row?.label_hwy_mpge);
    return Number.isFinite(c) && Number.isFinite(h) && h > 0 ? c / h : null;
}

/**
 * Whether a row describes several configurations EPA collapsed into one.
 *
 * `# Drive Motor Gen` is a union when that happens — MY27's EX90 Twin Motor
 * carries four motor powers for a two-motor car — and `parseMotorPowerKw` warns
 * that no arithmetic over such a cell describes a real vehicle. A count above
 * four is the signal, since no EV in the corpus has five traction motors: the
 * Taycan reads 9 and sums to 1,854 kW, which is not a Taycan.
 *
 * Surfaced rather than hidden. The row is still EPA's published record; it just
 * cannot be read as one car, and a reader comparing motor power needs to know.
 */
export function isCollapsedRow(row) {
    const n = Number(row?.motor_count);
    return Number.isFinite(n) && n > 4;
}

// ── Brand resolution (#243) ──────────────────────────────────────────────────

/**
 * alias → brand, built once from `brand_aliases`.
 *
 * EPA's `division` is the text a manufacturer filed under, so the same company
 * appears more than once: `Lucid` and `Lucid USA Inc.`, `KIA` and `KIA MOTORS
 * CORPORATION`. Faceting on the raw column splits a brand in two and a filter
 * on one half quietly returns part of the answer — 52 of 61 configurations for
 * Lucid.
 *
 * Keyed lowercased and trimmed to match the generated `alias_key` in migration
 * 057, because EPA shouts and `KIA` and `Kia` are one brand.
 */
export function buildBrandIndex(aliases = []) {
    const index = new Map();
    for (const a of aliases) {
        const key = String(a.alias_key ?? a.alias ?? '').trim().toLowerCase();
        if (!key) continue;
        index.set(key, {
            brand:  a.manufacturers?.name ?? null,
            parent: a.manufacturers?.parent_name ?? null,
        });
    }
    return index;
}

/**
 * The brand and corporate parent a raw division resolves to.
 *
 * Falls back to the raw text when nothing claims it. That fallback is the
 * honest behaviour rather than a stopgap: an unmapped division is a decision a
 * curator has not made yet, and hiding the configurations until they make it
 * would be worse than showing them under EPA's own spelling. The admin panel
 * is where the unmapped ones are surfaced for deciding.
 */
export function resolveBrand(division, brandIndex) {
    const raw = String(division ?? '').trim();
    if (!raw) return { brand: null, parent: null, mapped: false };
    // Guarded rather than assumed. `decorateRow` is legitimately called before
    // the aliases have loaded, and `rows.map(decorateRow)` would hand this the
    // array index — a number, which would throw on .get and take the whole
    // table down over a cosmetic feature.
    const hit = brandIndex instanceof Map ? brandIndex.get(raw.toLowerCase()) : undefined;
    if (!hit?.brand) return { brand: raw, parent: null, mapped: false };
    return { brand: hit.brand, parent: hit.parent, mapped: true };
}

/** Every derived field, attached once at load so filters and sorts share them. */
export function decorateRow(row, brandIndex) {
    const { brand, parent, mapped } = resolveBrand(row.division, brandIndex);
    return {
        ...row,
        wheel_size_in:   wheelSizeIn(row.carline),
        body_class:      bodyClassLabel(row.carline_class),
        city_hwy_ratio:  cityHwyRatio(row),
        is_collapsed:    isCollapsedRow(row),
        brand,
        parent_name:     parent,
        brand_mapped:    mapped,
    };
}

// ── Columns ──────────────────────────────────────────────────────────────────

/**
 * Every column the browser can show.
 *
 * `group` drives the column picker's sections and the detail view's headings,
 * so the two never drift apart — one list, two renderings.
 *
 * `unit` is separate from `label` so a header can stay short while the value
 * still carries its unit. `digits` is fixed per column rather than inferred:
 * EPA publishes the label figures rounded and the unadjusted ones to three
 * decimals, and showing 154.2 where the source says 154.214 quietly discards
 * the precision that makes the derivation check meaningful.
 */
export const GUIDE_COLUMNS = [
    // Identity. Configuration leads and is sticky in the table — it is the only
    // column that says which car a row is, so it has to survive a sideways
    // scroll that pushes everything else off screen.
    { key: 'carline',          label: 'Configuration', group: 'Identity', default: true, sticky: true },
    { key: 'brand',            label: 'Make',        group: 'Identity',   default: true,
      hint: 'The curated brand name. EPA files under several spellings — `Lucid` and `Lucid USA Inc.` are one company — so this resolves them; an unmapped division falls back to EPA’s own text.' },
    { key: 'parent_name',      label: 'Parent',      group: 'Identity',
      hint: 'Corporate parent: Chevrolet, Cadillac and GMC all read General Motors. Blank until a curator sets it.' },
    { key: 'division',         label: 'EPA division', group: 'Identity',
      hint: 'The division exactly as EPA filed it, before brand resolution.' },
    { key: 'model_year',       label: 'Year',        group: 'Identity',   numeric: true,  digits: 0, default: true },
    { key: 'model_type_index', label: 'Model type',  group: 'Identity',
      hint: 'EPA’s own index for a model type. Part of the natural key — carline alone is not unique.' },
    { key: 'smog_test_group',  label: 'Test group',  group: 'Identity',
      hint: 'EPA’s smog test group. Configurations certified together share one; it is not unique per configuration.' },

    // Label figures — the window sticker. Range first: it is what people come for.
    { key: 'label_comb_range_mi', label: 'Range',      unit: 'mi',   group: 'Label', numeric: true, digits: 0, default: true, bar: true },
    { key: 'label_hwy_range_mi',  label: 'Hwy range',  unit: 'mi',   group: 'Label', numeric: true, digits: 0, default: true, bar: true },
    { key: 'label_city_range_mi', label: 'City range', unit: 'mi',   group: 'Label', numeric: true, digits: 0, default: true, bar: true },
    { key: 'label_comb_mpge',     label: 'Combined',   unit: 'MPGe', group: 'Label', numeric: true, digits: 0, default: true },
    { key: 'label_city_mpge',     label: 'City',       unit: 'MPGe', group: 'Label', numeric: true, digits: 0 },
    { key: 'label_hwy_mpge',      label: 'Hwy',        unit: 'MPGe', group: 'Label', numeric: true, digits: 0 },
    { key: 'city_hwy_ratio',      label: 'City:Hwy',   group: 'Label', numeric: true, digits: 3, derived: true,
      hint: 'City MPGe ÷ highway MPGe. Mostly aerodynamics and mass, so it reads as a verdict on the body and drivetrain rather than on battery size.' },

    // Battery
    { key: 'nominal_pack_kwh', label: 'Pack', unit: 'kWh', group: 'Battery', numeric: true, digits: 1, default: true, bar: true,
      hint: 'GROSS pack energy — voltage × amp-hours. Not usable capacity, which is smaller and is a curator judgement. Reported per test group, so every configuration in a group shares one value.' },
    { key: 'total_voltage_v',  label: 'Voltage', unit: 'V',    group: 'Battery', numeric: true, digits: 0 },
    { key: 'batt_capacity_ah', label: 'Capacity', unit: 'Ah',  group: 'Battery', numeric: true, digits: 0 },
    { key: 'batt_specific_energy_wh_kg', label: 'Specific energy', unit: 'Wh/kg', group: 'Battery', numeric: true, digits: 0 },

    // Powertrain
    { key: 'drive_desc',     label: 'Drive',       group: 'Powertrain', default: true },
    { key: 'motor_power_kw', label: 'Motor power', unit: 'kW', group: 'Powertrain', numeric: true, digits: 0, bar: true,
      hint: 'Summed across motors. On a row EPA collapsed from several configurations this is a union of them, not one car’s output — those rows carry a "multi" flag.' },
    // Off by default: `# Drive Motor Gen` is a union wherever EPA folded
    // several configurations into one row, which puts nine motors on a Taycan.
    // Still offered, because it is right for the ~94% of rows that are not
    // collapsed, and those rows are flagged.
    { key: 'motor_count',    label: 'Motors',      group: 'Powertrain', numeric: true, digits: 0,
      hint: 'EPA’s motor-generator count. A union on collapsed rows — see the "multi" flag — so read it alongside that.' },
    { key: 'wheel_size_in',  label: 'Wheels', unit: 'in', group: 'Powertrain', numeric: true, digits: 0, derived: true,
      hint: 'Read from the configuration name. EPA has no wheel column, and only some makers state it — about 43% of rows resolve, mostly Rivian and BMW. Blank means the maker did not say.' },

    // Classification
    { key: 'body_class',    label: 'Class',      group: 'Classification', derived: true, default: true,
      hint: 'EPA’s carline class with the drivetrain suffix removed, so "Standard SUV 4WD" and "Standard SUV 2WD" group as one body. Drivetrain has its own column.' },
    { key: 'carline_class', label: 'EPA class',  group: 'Classification',
      hint: 'EPA’s class string verbatim, drivetrain suffix and all.' },

    // Charging
    { key: 'charge_time_240v_h', label: '240V charge', unit: 'h', group: 'Charging', numeric: true, digits: 1 },

    // Unadjusted and adjusted, as EPA publishes them
    { key: 'unadj_city_mpge', label: 'Unadj city', unit: 'MPGe', group: 'Unadjusted & adjusted', numeric: true, digits: 3 },
    { key: 'unadj_hwy_mpge',  label: 'Unadj hwy',  unit: 'MPGe', group: 'Unadjusted & adjusted', numeric: true, digits: 3 },
    { key: 'unadj_comb_mpge', label: 'Unadj comb', unit: 'MPGe', group: 'Unadjusted & adjusted', numeric: true, digits: 3 },
    { key: 'adj_city_mpge',   label: 'Adj city',   unit: 'MPGe', group: 'Unadjusted & adjusted', numeric: true, digits: 3 },
    { key: 'adj_hwy_mpge',    label: 'Adj hwy',    unit: 'MPGe', group: 'Unadjusted & adjusted', numeric: true, digits: 3 },
    { key: 'adj_comb_mpge',   label: 'Adj comb',   unit: 'MPGe', group: 'Unadjusted & adjusted', numeric: true, digits: 3 },
    { key: 'label_adjustment_factor', label: 'Adj factor', group: 'Unadjusted & adjusted', numeric: true, digits: 4,
      hint: 'The adjustment EPA applied to THIS configuration. Not a flat 0.7 — the 2027 R2 is 0.7051 at 20" and 0.7294 at 21".' },
    { key: 'adjustment_signature', label: 'Signature', group: 'Unadjusted & adjusted',
      hint: 'Read from the numbers, not from EPA’s declaration: 57% of rows declaring a 5-cycle label carry exactly 0.700000, the fixed factor. This is the value to trust.' },
    { key: 'calc_approach', label: 'Calc approach', group: 'Unadjusted & adjusted',
      hint: 'EPA’s own statement of method. Kept because it is the source’s claim, but it disagrees with the signature often enough that the signature leads.' },
];

export const COLUMN_GROUPS = [...new Set(GUIDE_COLUMNS.map(c => c.group))];
export const DEFAULT_COLUMNS = GUIDE_COLUMNS.filter(c => c.default).map(c => c.key);
export const columnByKey = (key) => GUIDE_COLUMNS.find(c => c.key === key) ?? null;

/** Format one cell. Null renders as an em dash — a fact, not a zero. */
export function formatCell(row, col) {
    const v = row?.[col.key];
    if (v == null || v === '') return '—';
    if (col.numeric) {
        const n = Number(v);
        if (!Number.isFinite(n)) return String(v);
        return n.toFixed(col.digits ?? 0);
    }
    return String(v);
}

// ── Filtering and sorting ────────────────────────────────────────────────────

/** The empty filter state — also the shape the URL round-trips. */
export const EMPTY_FILTERS = {
    years: [], makes: [], parents: [], bodyClasses: [], drives: [], motorCounts: [], wheelSizes: [],
    search: '',
    minRange: null, maxRange: null, minMpge: null, maxMpge: null,
};

/** Distinct values for each faceted filter, in the order they should render. */
export function buildFacets(rows) {
    const uniq = (fn, numeric = false) => {
        const vals = [...new Set(rows.map(fn).filter(v => v != null && v !== ''))];
        return numeric ? vals.sort((a, b) => a - b) : vals.sort((a, b) => String(a).localeCompare(String(b)));
    };
    return {
        years:       uniq(r => r.model_year, true).reverse(),
        makes:       uniq(r => r.brand),
        parents:     uniq(r => r.parent_name),
        bodyClasses: uniq(r => r.body_class),
        drives:      uniq(r => r.drive_desc),
        // Only counts that describe a real vehicle. A collapsed row reads 9
        // motors, and offering that as a filter value invites someone to
        // select it believing such a car exists.
        motorCounts: uniq(r => (r.is_collapsed ? null : r.motor_count), true),
        wheelSizes:  uniq(r => r.wheel_size_in, true),
    };
}

const inList = (list, v) => list.length === 0 || list.includes(v);
const within = (v, min, max) => {
    if (min != null && !(Number(v) >= min)) return false;
    if (max != null && !(Number(v) <= max)) return false;
    return true;
};

export function filterRows(rows, filters) {
    const f = { ...EMPTY_FILTERS, ...filters };
    const needle = f.search.trim().toLowerCase();
    return rows.filter((r) => {
        if (!inList(f.years, r.model_year))          return false;
        if (!inList(f.makes, r.brand))               return false;
        if (!inList(f.parents, r.parent_name))       return false;
        if (!inList(f.bodyClasses, r.body_class))    return false;
        if (!inList(f.drives, r.drive_desc))         return false;
        if (!inList(f.motorCounts, r.motor_count))   return false;
        if (!inList(f.wheelSizes, r.wheel_size_in))  return false;
        if (!within(r.label_comb_range_mi, f.minRange, f.maxRange)) return false;
        if (!within(r.label_comb_mpge, f.minMpge, f.maxMpge))       return false;
        if (needle) {
            // Both spellings are searchable: someone may type either what EPA
            // filed or the name we display.
            const hay = `${r.brand ?? ''} ${r.division} ${r.carline} ${r.smog_test_group ?? ''}`.toLowerCase();
            if (!hay.includes(needle)) return false;
        }
        return true;
    });
}

/**
 * Sort by one column.
 *
 * Nulls sort last in both directions, deliberately. They are absences, not low
 * values, and floating them to the top of an ascending sort by range would
 * bury the actual answer under rows that have none.
 */
export function sortRows(rows, key, dir = 'asc') {
    const col = columnByKey(key);
    if (!col) return rows;
    const sign = dir === 'desc' ? -1 : 1;
    return [...rows].sort((a, b) => {
        const av = a[key], bv = b[key];
        const aNull = av == null || av === '', bNull = bv == null || bv === '';
        if (aNull && bNull) return 0;
        if (aNull) return 1;
        if (bNull) return -1;
        if (col.numeric) return sign * (Number(av) - Number(bv));
        return sign * String(av).localeCompare(String(bv));
    });
}

// ── URL round-trip ───────────────────────────────────────────────────────────

/**
 * Filters, sort and page ↔ query string (#235).
 *
 * A filtered view is the shareable artefact here — "2026 pickups by range" is
 * the thing someone sends to someone else — so the state that defines one lives
 * in the URL rather than only in component state.
 *
 * Only non-default values are written. A bare `?tab=epa` therefore stays bare,
 * and a link carries exactly the decisions its sender made rather than a
 * snapshot of every default alongside them.
 *
 * Decoding is total: an unparseable or hostile value falls back to the default
 * rather than throwing, because this parses whatever a URL happens to contain.
 */
const LIST_PARAMS = {
    years: 'y', makes: 'mk', parents: 'pa', bodyClasses: 'cl', drives: 'dr',
    motorCounts: 'mo', wheelSizes: 'wh',
};
const NUM_PARAMS = {
    minRange: 'rmin', maxRange: 'rmax', minMpge: 'emin', maxMpge: 'emax',
};
const NUMERIC_LISTS = new Set(['years', 'motorCounts', 'wheelSizes']);

export function encodeGuideParams({ filters, sortKey, sortDir, page, selectedIds }) {
    const p = new URLSearchParams();
    for (const [key, param] of Object.entries(LIST_PARAMS)) {
        const v = filters[key];
        if (v?.length) p.set(param, v.join(','));
    }
    for (const [key, param] of Object.entries(NUM_PARAMS)) {
        if (filters[key] != null) p.set(param, String(filters[key]));
    }
    if (filters.search?.trim()) p.set('q', filters.search.trim());
    if (sortKey) p.set('sort', sortKey);
    if (sortDir === 'asc') p.set('dir', 'asc');   // desc is the default
    if (page > 0) p.set('pg', String(page + 1));  // 1-based for a human reading it
    // The comparison itself is shareable: `sel` carries the checked rows, so a
    // link reproduces the side-by-side someone built rather than only the
    // filters they used to find it. Guide row ids are stable primary keys —
    // the import upserts on the natural key rather than reinserting — so a
    // link keeps working across re-imports of the same model year.
    if (selectedIds?.length) p.set('sel', selectedIds.join(','));
    return p;
}

export function decodeGuideParams(search) {
    const p = new URLSearchParams(search ?? '');
    const filters = { ...EMPTY_FILTERS };

    for (const [key, param] of Object.entries(LIST_PARAMS)) {
        const raw = p.get(param);
        if (!raw) continue;
        const parts = raw.split(',').filter(Boolean);
        filters[key] = NUMERIC_LISTS.has(key)
            ? parts.map(Number).filter(Number.isFinite)
            : parts;
    }
    for (const [key, param] of Object.entries(NUM_PARAMS)) {
        const n = Number(p.get(param));
        if (p.get(param) != null && Number.isFinite(n)) filters[key] = n;
    }
    filters.search = p.get('q') ?? '';

    // An unknown sort column would sort by nothing and look like a no-op, so
    // it falls back rather than being trusted.
    const sortKey = columnByKey(p.get('sort')) ? p.get('sort') : 'label_comb_range_mi';
    const pageNum = Number(p.get('pg'));
    const selectedIds = (p.get('sel') ?? '')
        .split(',')
        .filter(Boolean)
        .map(Number)
        // Ids arrive from the URL as text and are compared against numeric row
        // ids, so a string would silently match nothing and the comparison
        // would come back empty with no explanation.
        .filter(Number.isFinite);
    return {
        filters,
        sortKey,
        sortDir: p.get('dir') === 'asc' ? 'asc' : 'desc',
        page: Number.isFinite(pageNum) && pageNum > 1 ? pageNum - 1 : 0,
        selectedIds,
    };
}

// ── Magnitude bars ───────────────────────────────────────────────────────────

/**
 * The largest value behind each bar, keyed by the unit the bar is measured in.
 *
 * Columns sharing a unit share a scale. The three range columns are the same
 * physical quantity, so scaling each against its own maximum would make a
 * combined range of 520 fill the cell while a LONGER city range of 521 filled
 * 96% of the next one — the bars would contradict the numbers printed on them.
 * Sharing the scale also makes the city/highway gap visible as a shape, which
 * on a pickup is the whole story.
 *
 * Different units keep their own scales: kWh of battery and kW of motor have no
 * common ruler, and putting them on one would be arithmetic on unlike things.
 *
 * Scaled against the CURRENT FILTER, not the whole corpus, so the comparison is
 * against what the reader asked to see: filter to pickups and the longest-range
 * pickup fills the cell, rather than every bar collapsing to a third because a
 * Lucid Air exists somewhere off screen. Computed over every filtered row rather
 * than the visible page, so paging does not rescale the bars underneath them.
 *
 * Zero-based by design. A range bar is a share of the longest range, which is
 * what makes "about 60% filled" mean 330 of 545 miles; scaling from the minimum
 * instead would make the shortest-range car empty and imply a zero it does not
 * have.
 */
export function computeBarMaxima(rows) {
    const maxima = {};
    for (const col of GUIDE_COLUMNS) {
        if (!col.bar) continue;
        const scale = col.unit ?? col.key;
        let max = maxima[scale] ?? 0;
        for (const r of rows) {
            const v = r?.[col.key];
            if (v == null || v === '') continue;
            const n = Number(v);
            if (Number.isFinite(n) && n > max) max = n;
        }
        maxima[scale] = max;
    }
    return maxima;
}

/** A value's share of its unit's maximum, 0–100, or null when there is no bar. */
export function barPercent(row, col, maxima) {
    if (!col.bar) return null;
    const max = maxima?.[col.unit ?? col.key];
    const v = row?.[col.key];
    // Number(null) is 0 and 0 is finite, so an absent value would draw an
    // empty bar — which reads as a measured zero rather than as no data.
    if (v == null || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || !(max > 0)) return null;
    return Math.max(0, Math.min(100, (n / max) * 100));
}

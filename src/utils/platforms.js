/**
 * Platforms (#318): what a vehicle is built on, in two kinds.
 *
 *   mechanical   body, structure, suspension — dimensions, twins, inheritance
 *   electrical   pack, drive units, power electronics — the charging curve
 *
 * They usually coincide and diverge exactly where a curator must not lump cars
 * together: the 2022–24 and 2025+ Rivian R1 share a skateboard and nothing
 * electrical; the Lucid Air and Gravity share an electrical system and not a body.
 * So a vehicle links one of each (`mechanical_platform_id`,
 * `electrical_platform_id`, migration 072), and a platform is its own row, so
 * what is true of it is said once.
 *
 * Section 1 of #318 holds and shows the data; section 2 (#352) makes the
 * platform the last fallback for a vehicle's specs (`PLATFORM_PROVIDES`).
 * Suggesting spec links between cars on one platform, grouping by platform,
 * and reading the electrical platform when comparing charging curves come
 * later.
 *
 * Pure module: no data access, no React.
 */

export const PLATFORM_KINDS = [
    { key: 'mechanical', label: 'Mechanical platform', short: 'Mechanical',
      note: 'Body, structure and suspension: what twins share.' },
    { key: 'electrical', label: 'Electrical platform', short: 'Electrical',
      note: 'Pack, drive units and power electronics: what shapes the charging curve.' },
];

/** The vehicle column that links each kind. */
export const PLATFORM_COLUMN = {
    mechanical: 'mechanical_platform_id',
    electrical: 'electrical_platform_id',
};

/**
 * The voltage classes a platform can be. The column takes any positive number
 * (migration 072), so a class is added here, not by a migration. Lucid's
 * "900 V" is marketing for an 800 V-class architecture, and is filed as one.
 */
export const VOLTAGE_CLASSES = [400, 800];

/** How an electrical platform takes DC from a 400 V charger. */
export const DC_400V_CHARGING = [
    { key: 'native',      label: 'Native',      note: 'A 400 V pack: nothing to convert.' },
    { key: 'dc-booster',  label: 'DC booster',  note: 'A dedicated converter steps 400 V up to the pack.' },
    { key: 'motor-boost', label: 'Motor boost', note: 'The drive inverter and motor windings step the voltage up.' },
    { key: 'split-pack',  label: 'Split pack',  note: 'The pack is switched into two 400 V halves charged in parallel.' },
    { key: 'none',        label: 'Not possible', note: 'It cannot charge from a 400 V DC charger.' },
];

export const CHEMISTRIES = ['LFP', 'LMFP', 'NMC', 'NCA', 'NMCA'];
export const CELL_FORMATS = ['cylindrical', 'prismatic', 'pouch', 'blade'];

const lower = (s) => String(s ?? '').trim().toLowerCase();

/**
 * A short description of an electrical platform's charging hardware —
 * "800 V · motor boost on 400 V" — or null for a mechanical one, or one that
 * says nothing yet.
 */
export function electricalSummary(p) {
    if (p?.kind !== 'electrical') return null;
    const parts = [];
    if (p.voltage_class_v) parts.push(`${p.voltage_class_v} V`);
    const method = DC_400V_CHARGING.find(m => m.key === p.dc_400v_charging);
    if (method && method.key !== 'native') parts.push(`${method.label.toLowerCase()} on 400 V`);
    return parts.join(' · ') || null;
}

/**
 * The platform of one kind a name refers to, by name or alias, ignoring case —
 * what a spreadsheet column says. Null when none, or when two platforms claim
 * the same alias: the importer then reports it rather than guessing.
 */
export function matchPlatform(name, platforms = [], kind) {
    const want = lower(name);
    if (!want) return null;
    const ofKind = platforms.filter(p => p.kind === kind);
    const byName = ofKind.find(p => lower(p.name) === want);
    if (byName) return byName;
    const byAlias = ofKind.filter(p => (p.aliases ?? []).some(a => lower(a) === want));
    return byAlias.length === 1 ? byAlias[0] : null;
}

/**
 * A vehicle's two platforms, as rows, from its (possibly inherited) link ids.
 *
 * @param {Object} vehicle   as AppContext provides it (withInheritance resolves the ids)
 * @param {Map}    byId      platforms by id
 * @returns {{ mechanical: Object|null, electrical: Object|null }}
 */
export function vehiclePlatforms(vehicle, byId) {
    const get = (id) => (id == null ? null : byId?.get(Number(id)) ?? null);
    return {
        mechanical: get(vehicle?.mechanical_platform_id),
        electrical: get(vehicle?.electrical_platform_id),
    };
}

/** Platforms of one kind, grouped by maker for a picker, each group sorted by name. */
export function platformGroups(platforms = [], kind) {
    const groups = new Map();
    for (const p of platforms.filter(x => x.kind === kind)) {
        const key = p.maker_group || 'Other';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(p);
    }
    return [...groups.entries()]
        .sort(([a], [b]) => (a === 'Other') - (b === 'Other') || a.localeCompare(b))
        .map(([maker, list]) => ({ maker, platforms: list.sort((a, b) => a.name.localeCompare(b.name)) }));
}

/**
 * A vehicle's platforms as one line: the electrical name alone when it already
 * names the structure ("E-GMP 800 V" says E-GMP), else both.
 */
export function platformLineText({ mechanical, electrical }) {
    if (mechanical && electrical) {
        return electrical.name.toLowerCase().startsWith(mechanical.name.toLowerCase())
            ? electrical.name
            : `${mechanical.name} · ${electrical.name}`;
    }
    return mechanical?.name ?? electrical?.name ?? null;
}

/**
 * Where a nominal pack voltage splits the classes, when a vehicle has no
 * electrical platform to say: below it a 400 V pack (they sit around
 * 350–450 V nominal), from it up an 800 V one (600 V and above). A class
 * beyond these two is only ever a platform's word.
 */
export const VOLTAGE_CLASS_SPLIT_V = 475;

/**
 * A vehicle's voltage class, and where it came from.
 *
 *   platform   its electrical platform's class (inherited like the link)
 *   nominal    derived from its own nominal pack voltage, with no platform
 *
 * @returns {{ v: number, basis: 'platform'|'nominal', platform?: Object, nominalV?: number } | null}
 */
export function resolveVoltageClass(electrical, nominalV) {
    if (electrical?.voltage_class_v) return { v: electrical.voltage_class_v, basis: 'platform', platform: electrical };
    const n = Number(nominalV);
    if (nominalV == null || nominalV === '' || !Number.isFinite(n) || n <= 0) return null;
    return { v: n < VOLTAGE_CLASS_SPLIT_V ? 400 : 800, basis: 'nominal', nominalV: n };
}

// ── What a platform provides (#352) ─────────────────────────────────────────

/**
 * The vehicle spec fields a platform provides, and from which property.
 *
 * Spec resolution is the vehicle's own value, then its source vehicle's
 * (`spec_source_vehicle_id`), then its platform's (specHelpers.js
 * `specProvenance`). A platform PROVIDES a vehicle's values and never stands
 * in for them: what it supplies lands on the vehicle's own spec field, is
 * overridden by setting that field, and is marked "from <platform>" wherever
 * it is shown.
 *
 * Only what is true of every vehicle on the platform belongs here:
 *
 *   400 V support        the electrical platform's method, as the spec's label.
 *                        A vehicle that differs (a Taycan's booster was
 *                        optional) sets its own.
 *
 * Deliberately NOT provided:
 *
 *   max DC on 400 V      the rate changed by model year within one platform
 *                        (early E-GMP about 80 kW, later about 150 kW), so it is
 *                        the vehicle's alone.
 *   voltage class        not a spec field. It stays the vehicle's resolved
 *                        figure (`resolveVoltageClass`): the platform's class,
 *                        else worked out from the nominal voltage.
 *   chemistries          the platform's POSSIBLE set. A Mach-E is NMC or LFP,
 *                        not both, so the list is offered as suggestions for
 *                        the vehicle's chemistry (`chemistrySuggestions`) and
 *                        never fills it in.
 *   anything mechanical  twins on one structure still differ in every
 *                        dimension the schema records — the Ioniq 5, EV6 and
 *                        Ioniq 6 share E-GMP and not one length, width, height
 *                        or wheelbase. What twins share is said by linking specs
 *                        to a source vehicle, which already inherits field by
 *                        field.
 */
export const PLATFORM_PROVIDES = [
    {
        spec: 'charging.dc_400v_charging',
        kind: 'electrical',
        value: (p) => DC_400V_CHARGING.find(m => m.key === p?.dc_400v_charging)?.label ?? null,
    },
];

/**
 * The spec values a vehicle's platforms provide, shaped like `vehicle.specs`,
 * with the platform behind each.
 *
 * @param {{ mechanical?: Object|null, electrical?: Object|null }} [platforms]
 * @returns {{ specs: Object, from: Map<string, Object> }}  `from` maps a
 *          "category.field" key to the platform that provided it
 */
export function platformProvides(platforms) {
    const specs = {};
    const from = new Map();
    for (const { spec, kind, value } of PLATFORM_PROVIDES) {
        const platform = platforms?.[kind];
        const v = platform ? value(platform) : null;
        if (v == null || v === '') continue;
        const [cat, field] = spec.split('.');
        specs[cat] = { ...(specs[cat] ?? {}), [field]: v };
        from.set(spec, platform);
    }
    return { specs, from };
}

/**
 * The fleet with each vehicle's platform rows attached as `platforms`
 * ({ mechanical, electrical }), from its resolved links — so spec resolution
 * can read what the platform provides without being handed the platform list.
 * Run after `withInheritance`, which resolves a variant's links.
 */
export function withPlatforms(vehicles = [], byId) {
    return vehicles.map(v => ({ ...v, platforms: vehiclePlatforms(v, byId) }));
}

/**
 * Chemistries to offer for a vehicle's battery chemistry: its electrical
 * platform's possible set. Suggestions only — never a value (see above).
 */
export function chemistrySuggestions(electrical) {
    return (electrical?.chemistries ?? []).filter(c => CHEMISTRIES.includes(c));
}

// ── Platforms readers can browse (#354) ─────────────────────────────────────

/** Where a platform's page lives, as a query string — a real href. */
export function platformHref(id) {
    return `?tab=reference&pid=${encodeURIComponent(id)}`;
}

/**
 * The vehicles built on a platform, through their RESOLVED links (a variant
 * that inherits its source's platform is on it too), sorted by name.
 */
export function vehiclesOnPlatform(platform, vehicles = []) {
    if (!platform) return [];
    const column = PLATFORM_COLUMN[platform.kind];
    return vehicles
        .filter(v => v[column] != null && Number(v[column]) === Number(platform.id))
        .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')));
}

/**
 * The platform list's rows: every platform of the kinds asked for, with how
 * many vehicles are on it — electrical before mechanical (the kind a reader
 * comes for), then by maker group and name.
 *
 * @param {'all'|'electrical'|'mechanical'} [kind]
 */
export function platformListRows(platforms = [], vehicles = [], kind = 'all') {
    const order = { electrical: 0, mechanical: 1 };
    return platforms
        .filter(p => kind === 'all' || p.kind === kind)
        .map(p => ({ platform: p, vehicleCount: vehiclesOnPlatform(p, vehicles).length }))
        .sort((a, b) => (order[a.platform.kind] ?? 2) - (order[b.platform.kind] ?? 2)
            || String(a.platform.maker_group ?? '~').localeCompare(String(b.platform.maker_group ?? '~'))
            || a.platform.name.localeCompare(b.platform.name));
}

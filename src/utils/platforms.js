/**
 * Platforms (#318): what a vehicle is built on, in two kinds.
 *
 *   mechanical   body, structure, suspension — dimensions, twins, inheritance
 *   electrical   pack, drive units, power electronics — the charging curve
 *
 * They usually coincide and diverge exactly where a curator must not lump cars
 * together: the 2022–24 and 2025+ Rivian R1 share a skateboard and nothing
 * electrical; the Lucid Air and Gravity share a 900 V system and not a body.
 * So a vehicle links one of each (`mechanical_platform_id`,
 * `electrical_platform_id`, migration 072), and a platform is its own row, so
 * what is true of it is said once.
 *
 * Section 1 of #318 holds and shows the data. Suggesting spec links between
 * cars on one platform, grouping by platform, and reading the electrical
 * platform when comparing charging curves come later.
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

/** Nominal pack architecture. */
export const VOLTAGE_CLASSES = [400, 800, 900];

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

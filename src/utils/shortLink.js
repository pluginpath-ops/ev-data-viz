/**
 * The short link (#476): a chart link packed into one parameter, `?k=1.…`.
 *
 * It is the SAME state as the readable chart link, not a second record of it.
 * The key packs a query string that chartUrlState.js wrote, and unpacks back to
 * a query string that chartUrlState.js reads — nothing here knows what a
 * setting means. The address bar keeps the readable form; the toolbar's URL
 * button copies this one.
 *
 * ── The key ──────────────────────────────────────────────────────────────────
 *   <version>.<URL-safe base64 of the packed parameters>
 *
 * The version tag is what keeps an old key readable: a key is decoded by the
 * decoder of the version it names, so a later change to the format adds a
 * version rather than changing what an old key means. An unknown version is
 * reported as one (made by a newer site), not as garbage.
 *
 * Version 1, per parameter:
 *   head   varint((name << 2) | kind) — name is an index into NAMES_V1, 0 for a
 *          name written out as a string straight after
 *   kind 0 a string            varint length, UTF-8
 *   kind 1 a word              varint index into WORDS_V1
 *   kind 2 a comma list        varint count, then each item (below)
 *   kind 3 a whole number      varint
 * A list item is varint((n << 2) | tag):
 *   tag 0  a whole number n    tag 1  word n    tag 2  a string of length n
 *   tag 3  n = 0  inherited_v<a>_<b>, then a and b as varints
 *          n = 1  inherited_<a>_<b>,  then a and b
 *          n = 2  <item>::<item>, a pair key (pairings.js), then both items
 *
 * NAMES_V1 and WORDS_V1 are APPEND-ONLY. Decoding indexes into them, so an
 * entry moved or removed would change what every key already shared says; one
 * appended is only ever reached by keys written after it. The golden keys in
 * the tests fail if an entry moves.
 *
 * ── What a key leaves out ────────────────────────────────────────────────────
 * The settings in IMPLIED_V1 are dropped when they hold that value and put back
 * when the key is read. Unlike the readable link, which leaves out whatever is
 * the default TODAY, these values are frozen with the version: a key shared now
 * still opens the same chart after a default moves (Road Trip's Y axis moved
 * once, #78). The caller writes every default out before packing
 * (chartUrlState.js `chartShortLink`), so a setting that sits on a moved
 * default is kept.
 *
 * Pure module, and a leaf: main.jsx reads a key before the app is loaded, and
 * may import nothing that reaches the constants (see main.jsx).
 */

/** The address parameter that carries a short link. */
export const SHORT_LINK_PARAM = 'k';

export const SHORT_LINK_VERSION = '1';

// Commonest first: an index under 32 packs with its kind into one byte.
const NAMES_V1 = [
    null,
    'tab', 'm', 'v', 'r', 'x', 'y', 'y2', 'rt', 'ax', 'corr', 'c_spd', 'c_tmp', 'c_alt', 'c_acc',
    'raw', 'line', 'pts', 'cspread', 'aspread', 'pairs', 'rc', 'eff',
    'cmp_soc', 'cmp_mins', 'cmp_mi', 'cmp_o', 'cmp_sel',
    'rt_m', 'rt_ss', 'rt_ms', 'rt_ld', 'rt_ct', 'rt_td', 'rt_sp', 'rt_oh', 'rt_ya', 'rt_xa', 'rt_sya',
    'rt_tw', 'rt_te', 'rt_tr', 'rt_r',
    'sf', 'ss', 'scx', 'scy', 'epa_ya', 'epa_m', 'epa_ov',
    'vt_preset', 'vt_cols', 'vt_sort', 'vt_dir', 'vt_win', 'vt_add', 'vt_home', 'vt_fast', 'vt_basis',
    'q', 'rt_otd', 'rt_oc', 'rt_bp', 'rt_osn', 'rt_osx',
    // Cost to Drive: its key (costToDriveKey.js), carried as a string.
    'cd',
    // Home Charger's chart (`hc=time`), appended after #476.
    'hc',
];

// Values that recur: tabs, modes, axes, chart types, units, presets, and the
// vehicle table's column keys (sf, scx, scy, vt_cols, vt_sort). Under 128 is one
// byte.
const WORDS_V1 = [
    'efficiency', 'specifications', 'performance', 'epatested',
    'charging', 'range', 'compare', 'roadtrip', 'epacurves', 'specs', 'specscatter', 'specstable',
    'perfcompare', 'perfcurve',
    'soc', 'deltaSoc', 'chargeRate', 'time', 'deltaRange', 'rangeEpa', 'deltaRangeEpa', 'temperature',
    'cRate', 'rangeRate', 'frame',
    'range-vehicle-bar', 'eff-vehicle-bar', 'range-speed-line', 'eff-speed-line', 'range-temp-line', 'eff-temp-line',
    'mi_kwh', 'wh_mi', 'kwh100mi', 'mpge', 'range_mi',
    'none', 'aero', 'aero_wind', 'corrected', 'uncorrected', 'vertical', 'horizontal', 'all', 'desc',
    'distance', 'chargeTime', 'byTest', 'totalTime', 'driveTime', 'speed', 'tripDist',
    'overview', 'under-the-skin', 'road-trips', 'value', 'size-and-cargo', 'custom', 'tested',
    'name', 'make', 'model', 'trim', 'year', 'tags', 'platform.mechanical', 'platform.electrical',
    'figures.voltageClass', 'figures.socWindowKwh', 'figures.epaRangeMi', 'figures.epaCityMi',
    'figures.epaHwyMi', 'figures.epaEfficiency',
    'calc.efficiency', 'calc.rangePerChargeMin', 'calc.timeToAdd', 'calc.avgChargeKw', 'calc.peakCRate',
    'calc.pctOfEpaHwy', 'calc.pricePerMile', 'calc.pricePerKwh', 'calc.costPer100Home',
    'calc.costPer100Fast', 'calc.weightPerHp', 'calc.totalCargo', 'calc.batteryBuffer',
    'tested.zero_to_60_rollout_sec', 'tested.zero_to_60_sec', 'tested.quarter_mile_sec',
    'tested.quarter_mile_trap_mph', 'tested.zero_to_100_sec', 'tested.top_speed_mph', 'tested.skidpad_g',
    'tested.range_mi', 'tested.efficiency_mi_kwh', 'tested.composite_range_mi',
    'tested.composite_efficiency_mi_kwh', 'tested.when_new_range_mi', 'tested.capacity_retention',
    'tested.charge_window_min', 'tested.charge_best_5min_kw', 'tested.charge_best_10min_kw',
    'tested.charge_best_15min_kw',
    'pricing.base_price_usd', 'powertrain.drive_type', 'powertrain.motors', 'powertrain.motor_type',
    'powertrain.transmission_speeds', 'powertrain.horsepower_hp', 'powertrain.torque_lbft',
    'powertrain.battery_gross_kwh',
    'performance.zero_to_60_mph_sec', 'performance.quarter_mile_sec', 'performance.quarter_mile_mph',
    'performance.top_speed_mph', 'performance.weight_lbs', 'performance.braking_60_0_ft',
    'performance.braking_70_0_ft', 'performance.lateral_g', 'performance.figure_8_sec',
    'performance.slalom_mph', 'performance.elk_test_mph',
    'compute.lidar', 'compute.radars', 'compute.ultrasonics', 'compute.cameras', 'compute.processing_chip',
    'infotainment.android_auto', 'infotainment.carplay', 'infotainment.operating_system',
    'infotainment.supported_apps',
    'dimensions.length_in', 'dimensions.width_in', 'dimensions.height_in', 'dimensions.wheelbase_in',
    'dimensions.ground_clearance_in', 'dimensions.bed_length_in',
    'wheels.wheel_size_in', 'wheels.tire_size',
    'suspension.front_type', 'suspension.rear_type', 'suspension.adaptive_damping',
    'suspension.adjustable_height',
    'lighting.adaptive_headlights', 'lighting.headlight_type', 'lighting.auto_high_beam',
    'lighting.ambient_lighting',
    'charging.battery_usable_kwh', 'charging.battery_nominal_voltage_v', 'charging.max_dc_kw',
    'charging.max_ac_kw', 'charging.charge_time_10_to_80_pct_min', 'charging.charge_port', 'charging.v2l',
    'charging.v2h', 'charging.v2g', 'charging.plug_and_charge', 'charging.native_supercharger_access',
    'charging.dc_400v_charging', 'charging.max_dc_400v_kw', 'charging.battery_chemistry',
    'charging.preconditioning', 'charging.heat_pump',
    'towing.towing_capacity_lbs', 'towing.payload_lbs',
    'warranty.battery_years', 'warranty.battery_miles', 'warranty.basic_years', 'warranty.basic_miles',
    'range.expected_epa_mi', 'range.expected_epa_basis',
    'interior.seating', 'interior.cargo_cuft', 'interior.frunk_cuft', 'interior.max_cargo_cuft',
    'interior.screen_size_in', 'interior.hud', 'interior.front_heated_seats',
    'interior.front_ventilated_seats', 'interior.rear_heated_seats', 'interior.heated_steering_wheel',
    'interior.sound_system_speakers', 'interior.sound_system_watts',
    'optimizer', 'map', 'avgSpeed',
    // Cost to Drive's tab and its sub-tabs, all four appended at once so the
    // later layers of the stack need not touch this table.
    'cost', 'drivesetup', 'drivecost', 'driveplan', 'drivecharger',
    // The vehicle table's EPA charger efficiency column, appended.
    'figures.chargerEfficiency',
];

/**
 * The settings a version-1 key leaves out when they hold these values, by the
 * chart the link opens (`m`, Charging Curves when absent). Frozen: these are
 * the defaults as of version 1, not whatever chartDefaults.js says now. The
 * towing pair is implied only on a towing link, the only one that writes it.
 */
const IMPLIED_V1 = {
    charging: { x: 'soc', y: 'chargeRate' },
    compare:  { cmp_soc: '10', cmp_mins: '15', cmp_mi: '150' },
    roadtrip: {
        rt_m: 'distance', rt_ss: '90', rt_ms: '10', rt_ld: '150', rt_ct: '30', rt_td: '500',
        rt_sp: '70', rt_oh: '5', rt_ya: 'chargeTime', rt_xa: 'totalTime', rt_sya: 'totalTime',
    },
    // Trip Optimizer is drawn by Road Trip's view and carries its settings too.
    optimizer: { rt_otd: '700', rt_oc: 'map', rt_bp: '1', rt_osn: '55', rt_osx: '80' },
    towing:   { rt_te: '1.5', rt_tr: '70' },
};

function impliedOf(p) {
    const mode = p.get('m') ?? 'charging';
    const trip = mode === 'roadtrip' || mode === 'optimizer';
    return {
        ...(trip ? IMPLIED_V1.roadtrip : IMPLIED_V1[mode]),
        ...(mode === 'optimizer' && IMPLIED_V1.optimizer),
        ...(trip && p.get('rt_tw') === '1' && IMPLIED_V1.towing),
    };
}

// ── Bytes ──────────────────────────────────────────────────────────────────

const WHOLE = /^(0|[1-9]\d{0,14})$/;   // round-trips exactly: no "07", no "1e3"
const INHERITED_V = /^inherited_v(0|[1-9]\d{0,14})_(0|[1-9]\d{0,14})$/;
const INHERITED = /^inherited_(0|[1-9]\d{0,14})_(0|[1-9]\d{0,14})$/;
const PAIR_SEP = '::';

const NAME_INDEX = new Map(NAMES_V1.map((n, i) => [n, i]));
const WORD_INDEX = new Map(WORDS_V1.map((w, i) => [w, i]));

// Arithmetic rather than bit operators, which would wrap a number past 2^31.
function pushVarint(out, n) {
    while (n >= 128) { out.push((n % 128) + 128); n = Math.floor(n / 128); }
    out.push(n);
}
function pushString(out, s, tag = null) {
    const bytes = new TextEncoder().encode(s);
    pushVarint(out, tag == null ? bytes.length : bytes.length * 4 + tag);
    out.push(...bytes);
}

function pushItem(out, item) {
    let m;
    if (WHOLE.test(item)) return pushVarint(out, Number(item) * 4);
    if (WORD_INDEX.has(item)) return pushVarint(out, WORD_INDEX.get(item) * 4 + 1);
    if ((m = INHERITED_V.exec(item)) || (m = INHERITED.exec(item))) {
        pushVarint(out, (item.startsWith('inherited_v') ? 0 : 1) * 4 + 3);
        pushVarint(out, Number(m[1]));
        pushVarint(out, Number(m[2]));
        return;
    }
    const sep = item.indexOf(PAIR_SEP);
    if (sep >= 0 && item.indexOf(PAIR_SEP, sep + 1) < 0) {
        pushVarint(out, 2 * 4 + 3);
        pushItem(out, item.slice(0, sep));
        pushItem(out, item.slice(sep + PAIR_SEP.length));
        return;
    }
    pushString(out, item, 2);
}

// `name` is written after the head for a parameter NAMES_V1 does not list.
function pushValue(out, nameIndex, value, name = null) {
    const head = (kind) => {
        pushVarint(out, nameIndex * 4 + kind);
        if (nameIndex === 0) pushString(out, name);
    };
    if (WHOLE.test(value)) { head(3); pushVarint(out, Number(value)); return; }
    if (WORD_INDEX.has(value)) { head(1); pushVarint(out, WORD_INDEX.get(value)); return; }
    const items = value.split(',');
    // A list only when it beats the plain string — a lone free-text value
    // ("Model 3") is shorter as itself.
    if (items.length > 1 || INHERITED_V.test(value) || INHERITED.test(value) || value.includes(PAIR_SEP)) {
        head(2);
        pushVarint(out, items.length);
        for (const item of items) pushItem(out, item);
        return;
    }
    head(0);
    pushString(out, value);
}

const toBase64Url = (bytes) => btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function fromBase64Url(text) {
    if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('not base64url');
    const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(bin, c => c.charCodeAt(0));
}

/**
 * A query string as a short link key.
 *
 * @param {string} search  a chart link's query, with or without the `?`, every
 *                         default written out (chartUrlState `chartShortLink`)
 * @returns {string} e.g. `1.BQEQ…`
 */
export function encodeShortLink(search) {
    const p = new URLSearchParams(search ?? '');
    p.delete(SHORT_LINK_PARAM);
    const implied = impliedOf(p);
    const out = [];
    for (const [name, value] of p) {
        if (implied[name] === value) continue;
        // A parameter version 1 has no name for travels spelled out.
        pushValue(out, NAME_INDEX.get(name) ?? 0, value, name);
    }
    return `${SHORT_LINK_VERSION}.${toBase64Url(out)}`;
}

// ── Reading ────────────────────────────────────────────────────────────────

class Reader {
    constructor(bytes) { this.bytes = bytes; this.at = 0; }
    get done() { return this.at >= this.bytes.length; }
    varint() {
        let n = 0, scale = 1;
        for (let i = 0; i < 8; i++) {
            if (this.done) throw new Error('cut off');
            const b = this.bytes[this.at++];
            n += (b % 128) * scale;
            if (b < 128) return n;
            scale *= 128;
        }
        throw new Error('varint too long');
    }
    string(length = this.varint()) {
        if (this.at + length > this.bytes.length) throw new Error('cut off');
        const s = new TextDecoder('utf-8', { fatal: true }).decode(this.bytes.subarray(this.at, this.at + length));
        this.at += length;
        return s;
    }
    word(i) {
        if (i >= WORDS_V1.length) throw new Error('unknown word');
        return WORDS_V1[i];
    }
    item() {
        const v = this.varint();
        const n = Math.floor(v / 4);
        switch (v % 4) {
            case 0: return String(n);
            case 1: return this.word(n);
            case 2: return this.string(n);
            default:
                if (n === 0) return `inherited_v${this.varint()}_${this.varint()}`;
                if (n === 1) return `inherited_${this.varint()}_${this.varint()}`;
                if (n === 2) return `${this.item()}${PAIR_SEP}${this.item()}`;
                throw new Error('unknown item');
        }
    }
}

function decodeV1(body) {
    const r = new Reader(fromBase64Url(body));
    const p = new URLSearchParams();
    while (!r.done) {
        const head = r.varint();
        const index = Math.floor(head / 4);
        if (index >= NAMES_V1.length) throw new Error('unknown name');
        const name = index === 0 ? r.string() : NAMES_V1[index];
        let value;
        switch (head % 4) {
            case 0: value = r.string(); break;
            case 1: value = r.word(r.varint()); break;
            case 2: {
                const count = r.varint();
                const items = [];
                for (let i = 0; i < count; i++) items.push(r.item());
                value = items.join(',');
                break;
            }
            default: value = String(r.varint());
        }
        p.append(name, value);
    }
    for (const [name, value] of Object.entries(impliedOf(p))) if (!p.has(name)) p.set(name, value);
    return p.toString();
}

const DECODERS = { 1: decodeV1 };

/** What the reader is told, by what went wrong. */
export const SHORT_LINK_ERRORS = {
    newer:      'This short link was made by a newer version of EVBench. Reload the page to read it.',
    unreadable: 'This short link could not be read — part of it may have been lost when it was copied. Showing Home instead.',
};

/**
 * A key back to its query string.
 *
 * @returns {{ search: string } | { error: string }}  never throws: a key is
 *   whatever someone pasted, and a bad one must not blank the page
 */
export function decodeShortLink(key) {
    const text = String(key ?? '').trim();
    const dot = text.indexOf('.');
    const version = dot > 0 ? text.slice(0, dot) : '';
    if (!/^\d+$/.test(version)) return { error: SHORT_LINK_ERRORS.unreadable };
    const decode = DECODERS[version];
    if (!decode) {
        return { error: Number(version) > Number(SHORT_LINK_VERSION) ? SHORT_LINK_ERRORS.newer : SHORT_LINK_ERRORS.unreadable };
    }
    try {
        return { search: decode(text.slice(dot + 1)) };
    } catch {
        return { error: SHORT_LINK_ERRORS.unreadable };
    }
}

/**
 * An address's query with its short link opened out, for main.jsx to put in
 * the address bar before anything reads it. Parameters beside `k` (a pop-out's
 * `popout=1`) are kept.
 *
 * @returns {{ search: string, error?: string } | null}  null for an address
 *   with no `k`; on a bad key, the query without it (so the page opens on
 *   Home) and the message to show
 */
export function expandShortLink(search) {
    const p = new URLSearchParams(search ?? '');
    const key = p.get(SHORT_LINK_PARAM);
    if (key == null) return null;
    p.delete(SHORT_LINK_PARAM);
    const decoded = decodeShortLink(key);
    if (decoded.error) return { search: p.toString(), error: decoded.error };
    const out = new URLSearchParams(decoded.search);
    for (const [name, value] of p) out.append(name, value);
    return { search: out.toString() };
}

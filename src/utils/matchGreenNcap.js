/**
 * Propose an EVBench vehicle for each Green NCAP car — for the owner to
 * confirm, never to link on its own (docs/green-ncap-plan.md, step 1).
 *
 * A car is matched on brand and model, then ranked by drive, battery and
 * year. `status` says how sure the proposal is:
 *   match  one vehicle agrees on all three
 *   check  a best guess with a stated doubt (a mismatch, a missing figure, a tie)
 *   none   no vehicle of that brand and model
 * Green NCAP tests European cars; an EU-only pack or trim stays `check` or
 * `none` rather than being forced onto the nearest US vehicle.
 *
 * Pure: the vehicles come in already fetched (scripts/matchGreenNcap.mjs).
 */

const BATTERY_TOLERANCE = 0.05;

const MAKE_ALIASES = { vw: 'volkswagen', mercedesbenz: 'mercedes' };
// EVBench's model name on the right.
const MODEL_ALIASES = { mustangmache: 'mache' };
const MODEL_NOISE = /\b(electric|e-tech|e tech)\b/g;

const squash = s => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

export function makeKey(make) {
    const k = squash(make);
    return MAKE_ALIASES[k] ?? k;
}

/** Model without its brand, filler words or punctuation; "Model 3" and "3" agree. */
export function modelKey(model, make) {
    let s = String(model ?? '').toLowerCase().replace(MODEL_NOISE, ' ');
    const brand = String(make ?? '').toLowerCase();
    if (brand && s.startsWith(brand + ' ')) s = s.slice(brand.length + 1);
    let k = squash(s).replace(/^model(?=[a-z0-9])/, '');
    return MODEL_ALIASES[k] ?? k;
}

/** 'exact', 'loose' (one name starts the other, e.g. "EQE 350+" and "EQE"), or null. */
export function modelAgreement(a, b) {
    if (!a || !b) return null;
    if (a === b) return 'exact';
    const [short, long] = a.length <= b.length ? [a, b] : [b, a];
    return short.length >= 3 && long.startsWith(short) ? 'loose' : null;
}

/** FWD / RWD / AWD, '2WD' for Green NCAP's "4x2", or null. */
export function driveOf(text) {
    const t = String(text ?? '').toLowerCase();
    if (/\b(awd|4x4|quattro|xdrive|4matic|e-4orce|4motion|dual motor|twin motor|eawd)\b/.test(t)) return 'AWD';
    if (/\bfwd\b/.test(t)) return 'FWD';
    if (/\brwd\b|\bedrive|single motor/.test(t)) return 'RWD';
    if (/\b4x2\b/.test(t)) return '2WD';
    return null;
}

const driveAgrees = (car, vehicle) =>
    car === '2WD' ? vehicle === 'FWD' || vehicle === 'RWD' : car === vehicle;

/** "2024-2026" → [2024, 2026]; "2025" → [2025, 2025]. */
export function yearSpan(year) {
    const ys = String(year ?? '').match(/\d{4}/g)?.map(Number) ?? [];
    return ys.length ? [Math.min(...ys), Math.max(...ys)] : null;
}

/** Specs merged up the spec-source chain, own field first (the platform tier is not read). */
export function lineageSpecs(vehicle, byId, seen = new Set()) {
    const own = vehicle?.specs ?? {};
    const parent = byId.get(vehicle?.spec_source_vehicle_id);
    if (!parent || seen.has(parent.id)) return own;
    const above = lineageSpecs(parent, byId, new Set([...seen, vehicle.id]));
    const merged = { ...above };
    for (const [cat, fields] of Object.entries(own)) merged[cat] = { ...(above[cat] ?? {}), ...fields };
    return merged;
}

const DRIVE_WORDS = new Set(['awd', 'rwd', 'fwd', 'eawd']);
const words = s => new Set(String(s ?? '').toLowerCase().split(/[^a-z0-9+]+/).filter(w => w.length > 1));

function judge(car, vehicle, specs) {
    const doubts = [];
    let score = 0;

    const agreement = modelAgreement(car.modelKey, modelKey(vehicle.model, vehicle.make));
    if (agreement === 'exact') score += 1;
    else doubts.push(`model name differs ("${vehicle.model}")`);

    // An unknown figure ranks above a known mismatch.
    const vDrive = specs.powertrain?.drive_type ?? driveOf(`${vehicle.trim ?? ''} ${vehicle.name ?? ''}`);
    if (!car.drive || !vDrive) { score += 1; doubts.push('drive unknown'); }
    else if (driveAgrees(car.drive, vDrive)) score += 4;
    else doubts.push(`drive ${vDrive} vs ${car.drive}`);

    const usable = specs.charging?.battery_usable_kwh ?? null;
    const gross = specs.powertrain?.battery_gross_kwh ?? null;
    const carKwh = [car.declaredKwh, car.netKwh].filter(k => k != null);
    const nearUsable = usable != null && carKwh.some(k => Math.abs(k - usable) / usable <= BATTERY_TOLERANCE);
    // Gross sits a few percent above usable; Green NCAP's figures can land on either.
    const fitsGross = gross != null && carKwh.some(k => k <= gross * (1 + BATTERY_TOLERANCE) && k >= gross * 0.85);
    if (usable != null && gross != null && usable > gross) doubts.push(`EVBench usable ${usable} kWh is above gross ${gross}`);
    if (!carKwh.length) { score += 1; doubts.push('no Green NCAP battery figure'); }
    else if (nearUsable) score += 4;
    else if (fitsGross) { score += 3; doubts.push(usable != null ? `usable ${usable} kWh vs ${carKwh[0]}, gross ${gross} fits` : `battery checked against gross ${gross} kWh`); }
    else if (usable == null && gross == null) { score += 1; doubts.push('no EVBench battery figure'); }
    else doubts.push(`battery ${usable ?? gross} kWh ${usable != null ? 'usable' : 'gross'} vs ${carKwh[0]}`);

    const span = yearSpan(vehicle.year);
    if (car.year && span) {
        const off = car.year < span[0] ? span[0] - car.year : car.year > span[1] ? car.year - span[1] : 0;
        if (off === 0) score += 2;
        else { score -= off * 0.5; doubts.push(`year ${vehicle.year} vs ${car.year}`); }
    }

    // The whole trim named in the variant ("eDrive35", "GT-line") outweighs a
    // year apart; drive words are left out, drive is scored above.
    const trim = [...words(vehicle.trim)].filter(w => !DRIVE_WORDS.has(w));
    const variant = words(car.variant);
    const shared = trim.filter(w => variant.has(w)).length;
    score += trim.length && shared === trim.length ? 3 : Math.min(shared, 2) * 0.5;

    return { vehicle, score, doubts, drive: vDrive, kwh: usable ?? gross };
}

/**
 * @param car  { make, model, variant, drive, year, declaredKwh, netKwh }
 *             year is the VIN model year when known, else the test year
 * @param vehicles  EVBench rows: id, name, make, model, trim, year, specs, spec_source_vehicle_id
 * @returns { status, best, others, reason }
 */
export function matchGreenNcapCar(car, vehicles, byId = new Map(vehicles.map(v => [v.id, v]))) {
    const c = { ...car, modelKey: modelKey(car.model, car.make) };
    const brand = vehicles.filter(v => makeKey(v.make) === makeKey(car.make));
    if (!brand.length) return { status: 'none', best: null, others: [], reason: `no ${car.make} vehicles in EVBench` };

    const ranked = brand
        .filter(v => modelAgreement(c.modelKey, modelKey(v.model, v.make)))
        .map(v => judge(c, v, lineageSpecs(v, byId)))
        .sort((a, b) => b.score - a.score || a.vehicle.id - b.vehicle.id);
    if (!ranked.length) return { status: 'none', best: null, others: [], reason: `no ${car.make} ${car.model} in EVBench` };

    const [best, ...rest] = ranked;
    const tied = rest.filter(r => r.score === best.score);
    const doubts = [...best.doubts];
    if (tied.length) doubts.push(`ties with ${tied.map(r => r.vehicle.id).join(', ')}`);
    return {
        status: doubts.length ? 'check' : 'match',
        best,
        others: rest.slice(0, 3),
        reason: doubts.length ? doubts.join('; ') : 'model, drive, battery and year agree',
    };
}

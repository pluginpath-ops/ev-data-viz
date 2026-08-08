/**
 * Chart-session pairings — which range test supplies the miles for which
 * charging test, chosen by the user.
 *
 * A pairing is rank 1 of the resolution order in utils/rangeSource.js: it beats
 * the vehicle default, the charging run's own range half, and the recorded
 * range column. Everything below rank 1 still applies wherever the user has not
 * paired explicitly, so an empty pairing map means "resolve everything
 * automatically" rather than "show nothing".
 *
 * ── Shape ────────────────────────────────────────────────────────────────────
 *
 *     { [rangeRunId]: [chargingRunId, ...] }
 *
 * Keyed by the RANGE test, because that is the axis worth enumerating: a
 * charging curve is a property of the car and varies little, while a range test
 * is a property of the day — wind, temperature, HVAC, tyres, elevation,
 * humidity and load all move it, often drastically. So the list shows the
 * variable thing and you pick the stable one for it.
 *
 * The value is a list because a range test may be compared against several
 * charging curves, and each entry becomes its own chart series. The tuple is
 * symmetric — (range, charging) either way — so only the enumeration order
 * changes, never the maths.
 *
 * Keys are stringified because run ids arrive as numbers from the database and
 * as strings from the URL, and inherited runs (spec_links) carry synthetic
 * string ids. Normalising once here keeps every consumer from having to care.
 *
 * ── Scope ────────────────────────────────────────────────────────────────────
 *
 * Global to the chart session, never per-view: if Charge Compare honours a
 * pairing while the charging chart's range axis does not, two charts on the
 * same screen disagree about what "range" means.
 *
 * Persisted to the URL (shareable, and what the pop-out BroadcastChannel
 * carries). Deliberately NOT localStorage — a per-browser preference that
 * silently diverges from what everyone else sees is a support problem on a
 * curated site. The curator-set default lives in the database instead, on
 * runs.paired_range_run_id.
 */

const key = id => String(id);

// ── Pair identity ────────────────────────────────────────────────────────────
//
// One range test plotted against three charging curves is three series, so a
// run id is no longer enough to identify a selection or a chart series. The pair is.
// '::' because synthetic inherited-run ids already contain '-'.

const PAIR_SEP = '::';

export function pairKey(rangeRunId, chargingRunId) {
    return `${key(rangeRunId)}${PAIR_SEP}${chargingRunId == null ? '' : key(chargingRunId)}`;
}

export function parsePairKey(k) {
    const [rangeRunId, chargingRunId] = String(k).split(PAIR_SEP);
    return { rangeRunId, chargingRunId: chargingRunId || null };
}

/** Charging partners explicitly chosen for a range test. Empty when unpaired. */
export function partnersFor(pairings, rangeRunId) {
    return pairings?.[key(rangeRunId)] ?? [];
}

/** True when the user has explicitly paired this range test. */
export function isPaired(pairings, rangeRunId) {
    return partnersFor(pairings, rangeRunId).length > 0;
}

/**
 * The inverse lookup: range tests explicitly paired to a given charging run.
 *
 * The map is keyed by range test because that is the axis worth enumerating,
 * but Road Trip and the charging chart are charging-primary — they plot a
 * charging curve and need to know which range test prices it. Without this,
 * a pairing chosen in Charge Compare would not reach them, and two charts on
 * one screen would disagree about what "range" means, which is precisely what
 * making pairings global was meant to prevent.
 *
 * Usually returns zero or one. Several means the user deliberately compared one
 * charging curve against multiple conditions, which a charging-primary view
 * cannot show in a single series — callers take the first and should say so.
 */
export function rangePartnersOfCharging(pairings, chargingRunId) {
    const target = key(chargingRunId);
    return Object.entries(pairings || {})
        .filter(([, partners]) => partners.includes(target))
        .map(([rangeRunId]) => rangeRunId);
}

/**
 * Write from the charging side: give this charging run the given range test,
 * or `null` to return it to automatic resolution.
 *
 * The map stays keyed by range test — there is exactly one map, so a pairing
 * made in a charging-primary view is the same pairing Charge Compare shows.
 * That means detaching the charging run from wherever it currently sits before
 * attaching it to the new range test, or the two views would disagree about a
 * pairing they are both meant to be reading.
 */
export function setChargingPartner(pairings, chargingRunId, rangeRunId) {
    const target = key(chargingRunId);
    const out = {};
    for (const [primaryId, partners] of Object.entries(pairings || {})) {
        const kept = partners.filter(id => id !== target);
        if (kept.length) out[primaryId] = kept;
    }
    return rangeRunId ? addPartner(out, rangeRunId, chargingRunId) : out;
}

/**
 * Add a charging partner. Returns a new map — never mutates, so React state
 * updates and the URL/broadcast effects fire correctly.
 */
export function addPartner(pairings, rangeRunId, chargingRunId) {
    const k = key(rangeRunId);
    const existing = pairings[k] ?? [];
    if (existing.includes(key(chargingRunId))) return pairings;
    return { ...pairings, [k]: [...existing, key(chargingRunId)] };
}

/** Replace one partner with another, preserving its position in the list. */
export function replacePartner(pairings, rangeRunId, oldChargingRunId, newChargingRunId) {
    const k = key(rangeRunId);
    const existing = pairings[k] ?? [];
    const idx = existing.indexOf(key(oldChargingRunId));
    if (idx === -1) return addPartner(pairings, rangeRunId, newChargingRunId);
    const next = [...existing];
    next[idx] = key(newChargingRunId);
    return { ...pairings, [k]: next };
}

/** Drop one partner; drops the range test's entry entirely when it empties. */
export function removePartner(pairings, rangeRunId, chargingRunId) {
    const k = key(rangeRunId);
    const existing = pairings[k] ?? [];
    const next = existing.filter(id => id !== key(chargingRunId));
    const out = { ...pairings };
    if (next.length === 0) delete out[k];
    else out[k] = next;
    return out;
}

/**
 * Drop every pairing whose range test or charging partner is no longer present.
 *
 * Called when the vehicle selection changes: a pairing referencing a run the
 * user can no longer see is dead weight that would otherwise ride along in the
 * URL forever, and would silently resurrect if that vehicle came back.
 */
export function prunePairings(pairings, availableRunIds) {
    const live = new Set([...availableRunIds].map(key));
    const out = {};
    for (const [primaryId, partners] of Object.entries(pairings || {})) {
        if (!live.has(primaryId)) continue;
        const kept = partners.filter(id => live.has(id));
        if (kept.length) out[primaryId] = kept;
    }
    return out;
}

// ── URL encoding ─────────────────────────────────────────────────────────────
//
// `12:5,7;13:9` — range test 12 paired with charging runs 5 and 7; 13 with 9.
// Compact enough that a chart with a dozen pairs still yields a usable link.

export function encodePairings(pairings) {
    const parts = Object.entries(pairings || {})
        .filter(([, partners]) => partners?.length)
        .map(([primaryId, partners]) => `${primaryId}:${partners.join(',')}`);
    return parts.join(';');
}

export function decodePairings(raw) {
    if (!raw) return {};
    const out = {};
    for (const group of String(raw).split(';')) {
        if (!group) continue;
        const [primaryId, partnerList] = group.split(':');
        if (!primaryId || !partnerList) continue;
        const partners = partnerList.split(',').filter(Boolean);
        if (partners.length) out[primaryId] = partners;
    }
    return out;
}

/**
 * Chart-session pairings — which range test supplies the miles for which
 * charging test, chosen by the user.
 *
 * A pairing is rank 1 of the resolution order in utils/rangeSource.js: it beats
 * the vehicle default, the charging run's own range half, and the recorded
 * range column. Everything below rank 1 still applies to any charging run the
 * user has not paired explicitly, so an empty pairing map means "resolve
 * everything automatically" rather than "show nothing".
 *
 * ── Shape ────────────────────────────────────────────────────────────────────
 *
 *     { [chargingRunId]: [rangeRunId, ...] }
 *
 * A charging run may carry several range partners — one curve against 70 mph
 * mild AND 80 mph cold is the case the whole epic exists for — so the value is
 * a list, and each entry becomes its own chart series.
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
// One charging run plotted against three range tests is three series, so a run
// id is no longer enough to identify a selection or a chart series. The pair is.
// '::' because synthetic inherited-run ids already contain '-'.

const PAIR_SEP = '::';

export function pairKey(chargingRunId, rangeRunId) {
    return `${key(chargingRunId)}${PAIR_SEP}${rangeRunId == null ? '' : key(rangeRunId)}`;
}

export function parsePairKey(k) {
    const [chargingRunId, rangeRunId] = String(k).split(PAIR_SEP);
    return { chargingRunId, rangeRunId: rangeRunId || null };
}

/** Range partners explicitly chosen for a charging run. Empty when unpaired. */
export function partnersFor(pairings, chargingRunId) {
    return pairings?.[key(chargingRunId)] ?? [];
}

/** True when the user has explicitly paired this charging run. */
export function isPaired(pairings, chargingRunId) {
    return partnersFor(pairings, chargingRunId).length > 0;
}

/**
 * Add a range partner. Returns a new map — never mutates, so React state
 * updates and the URL/broadcast effects fire correctly.
 */
export function addPartner(pairings, chargingRunId, rangeRunId) {
    const k = key(chargingRunId);
    const existing = pairings[k] ?? [];
    if (existing.includes(key(rangeRunId))) return pairings;
    return { ...pairings, [k]: [...existing, key(rangeRunId)] };
}

/** Replace one partner with another, preserving its position in the list. */
export function replacePartner(pairings, chargingRunId, oldRangeRunId, newRangeRunId) {
    const k = key(chargingRunId);
    const existing = pairings[k] ?? [];
    const idx = existing.indexOf(key(oldRangeRunId));
    if (idx === -1) return addPartner(pairings, chargingRunId, newRangeRunId);
    const next = [...existing];
    next[idx] = key(newRangeRunId);
    return { ...pairings, [k]: next };
}

/** Drop one partner; drops the charging run's entry entirely when it empties. */
export function removePartner(pairings, chargingRunId, rangeRunId) {
    const k = key(chargingRunId);
    const existing = pairings[k] ?? [];
    const next = existing.filter(id => id !== key(rangeRunId));
    const out = { ...pairings };
    if (next.length === 0) delete out[k];
    else out[k] = next;
    return out;
}

/**
 * Drop every pairing whose charging run or range partner is no longer present.
 *
 * Called when the vehicle selection changes: a pairing referencing a run the
 * user can no longer see is dead weight that would otherwise ride along in the
 * URL forever, and would silently resurrect if that vehicle came back.
 */
export function prunePairings(pairings, availableRunIds) {
    const live = new Set([...availableRunIds].map(key));
    const out = {};
    for (const [chargingId, partners] of Object.entries(pairings || {})) {
        if (!live.has(chargingId)) continue;
        const kept = partners.filter(id => live.has(id));
        if (kept.length) out[chargingId] = kept;
    }
    return out;
}

// ── URL encoding ─────────────────────────────────────────────────────────────
//
// `12:5,7;13:9` — charging run 12 paired with range runs 5 and 7; 13 with 9.
// Compact enough that a chart with a dozen pairs still yields a usable link.

export function encodePairings(pairings) {
    const parts = Object.entries(pairings || {})
        .filter(([, partners]) => partners?.length)
        .map(([chargingId, partners]) => `${chargingId}:${partners.join(',')}`);
    return parts.join(';');
}

export function decodePairings(raw) {
    if (!raw) return {};
    const out = {};
    for (const group of String(raw).split(';')) {
        if (!group) continue;
        const [chargingId, partnerList] = group.split(':');
        if (!chargingId || !partnerList) continue;
        const partners = partnerList.split(',').filter(Boolean);
        if (partners.length) out[chargingId] = partners;
    }
    return out;
}

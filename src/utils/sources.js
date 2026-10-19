/**
 * Sources of performance results: who published or recorded them — a magazine,
 * a channel, EVBench itself (#327, migration 068).
 *
 * A source carries its canonical name, the other spellings it has turned up
 * under, the website domains that identify it from a link, and how it prints
 * 0–60 when a block does not say.
 *
 * Pure module: no data access, no React.
 */

const STOP_WORDS = new Set(['and', 'the', 'of']);
const letters = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const initials = (name, dropStopWords) => String(name ?? '')
    .split(/[\s&]+/)
    .filter(Boolean)
    .filter(w => !dropStopWords || !STOP_WORDS.has(w.toLowerCase()))
    .map(w => w[0].toLowerCase())
    .join('');

/**
 * One source under two spellings: punctuation and case, or an abbreviation of
 * the words. "C&D" is Car and Driver without the "and"; "OoS" is Out of Spec
 * with the "of".
 */
export function sameSource(a, b) {
    if (!letters(a) || !letters(b)) return false;
    if (letters(a) === letters(b)) return true;
    const [short, long] = letters(a).length <= letters(b).length ? [a, b] : [b, a];
    const abbrev = letters(short);
    if (abbrev.length < 2 || String(long).trim().split(/\s+/).length < 2) return false;
    return abbrev === initials(long, true) || abbrev === initials(long, false);
}

/** A link's host without "www.", lower-cased; null when it is not a link. */
export function domainOf(url) {
    const s = String(url ?? '').trim();
    if (!s) return null;
    try {
        const host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`).hostname;
        return host.includes('.') ? host.replace(/^www\./, '').toLowerCase() : null;
    } catch {
        return null;
    }
}

const onDomain = (host, domain) => {
    const d = String(domain ?? '').toLowerCase().replace(/^www\./, '');
    return !!d && (host === d || host.endsWith(`.${d}`));
};

/**
 * Websites many sources publish on. A link to one says where a test was
 * hosted, not who made it, so it never names a source — otherwise one listed
 * `youtube.com` would credit every YouTube link to the same channel (#426).
 */
const SHARED_HOSTS = [
    'youtube.com', 'youtu.be', 'youtube-nocookie.com', 'vimeo.com',
    'x.com', 'twitter.com', 'facebook.com', 'instagram.com', 'tiktok.com', 'reddit.com',
];

/** Whether a link's website is one that says nothing about its source. */
const isSharedHost = (url) => {
    const host = domainOf(url);
    return !!host && SHARED_HOSTS.some(d => onDomain(host, d));
};

/**
 * The listed source a name or link refers to, and how it was recognised.
 *
 *   name       the canonical name, ignoring case
 *   alias      a listed alias, ignoring case
 *   spelling   the same letters, or an abbreviation of the name — "C & D"
 *   domain     the link's website is one the source lists
 *
 * A name wins over a link: "MotorTrend" with a caranddriver.com link is a
 * disagreement to show, not something to settle silently by the domain. So the
 * domain is only tried when no name was given, or the name matched nothing.
 *
 * @param {Array} sources  rows of the sources table
 * @param {{ name?: string, url?: string }} ref
 * @returns {{ source, by: 'name'|'alias'|'spelling'|'domain' } | null}
 */
export function findSource(sources = [], { name, url } = {}) {
    const n = String(name ?? '').trim();
    if (n) {
        const lower = n.toLowerCase();
        const byName = sources.find(s => s.name?.toLowerCase() === lower);
        if (byName) return { source: byName, by: 'name' };
        const byAlias = sources.find(s => (s.aliases ?? []).some(a => a.toLowerCase() === lower));
        if (byAlias) return { source: byAlias, by: 'alias' };
        const bySpelling = sources.find(s => [s.name, ...(s.aliases ?? [])].some(x => sameSource(x, n)));
        if (bySpelling) return { source: bySpelling, by: 'spelling' };
    }
    const host = domainOf(url);
    if (host && !isSharedHost(host)) {
        const byDomain = sources.find(s => (s.domains ?? []).some(d => onDomain(host, d)));
        if (byDomain) return { source: byDomain, by: 'domain' };
    }
    return null;
}

/**
 * What a source picker's value comes to.
 *
 *   { sourceId }   a listed source the curator chose
 *   { newName }    a name typed as new — resolved to a listed source if it is
 *                  one under another spelling, so typing "C&D" cannot split
 *                  Car and Driver again
 *   neither        whatever the link's domain names, or nothing
 *
 * @returns {{ source: Object|null, newName: string|null }}
 */
export function pickedSource(sources = [], { sourceId = null, newName = null } = {}, url = '') {
    if (newName != null) {
        const name = newName.trim();
        if (!name) return { source: null, newName: null };
        const existing = findSource(sources, { name });
        return existing ? { source: existing.source, newName: null } : { source: null, newName: name };
    }
    if (sourceId != null) return { source: sources.find(s => Number(s.id) === Number(sourceId)) ?? null, newName: null };
    return { source: findSource(sources, { url })?.source ?? null, newName: null };
}

/**
 * The name to offer a test when its source is chosen and it has none yet:
 * "<source> ", ready for what the test was ("Out of Spec 70mph"). Null when
 * there is nothing to offer — the name is already started, or the source is
 * not a listed one (a half-typed new name must not seed the field).
 */
export function startingName(currentName, source) {
    if (String(currentName ?? '').trim() || !source?.name) return null;
    return `${source.name} `;
}

/**
 * The picker value a test's stored source text comes to: the listed source it
 * names under any spelling, or null when it is blank or not a listed source.
 * Read when the form is drawn, so the edit form never depends on the list
 * having loaded before it opened.
 */
export function storedSourcePick(sources = [], stored = '') {
    const name = String(stored ?? '').trim();
    const found = name ? findSource(sources, { name }) : null;
    return found ? { sourceId: found.source.id, newName: null } : null;
}

/**
 * What to write to a test's `source` text for a picker's value. Always the
 * canonical name of a listed source, so one outlet keeps one spelling.
 *
 * `pick` null means the curator has not touched the picker, so the test keeps
 * what it stored — under its canonical spelling when it names a listed source,
 * as written when it does not (never blanked behind the curator's back). A
 * touched picker with nothing chosen falls back to the link's domain.
 *
 * @returns {string} '' when there is no source
 */
export function runSourceText(sources = [], pick = null, url = '', stored = '') {
    const kept = String(stored ?? '').trim();
    if (pick == null && kept) return findSource(sources, { name: kept })?.source.name ?? kept;
    const picked = pickedSource(sources, pick ?? {}, url);
    return picked.source?.name ?? picked.newName ?? '';
}

/** How each rollout basis is described wherever it is chosen. */
export const ROLLOUT_BASES = [
    { key: 'rollout', label: '1-ft rollout omitted', note: 'Drag-strip convention: the printed 0–60 does not count the first foot. Saved to 0–60 (1ft).' },
    { key: 'none',    label: 'Standing start',       note: 'The clock ran from 0 mph. Saved to 0–60 mph.' },
];

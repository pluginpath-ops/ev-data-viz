/**
 * Batch import of published performance results (#327).
 *
 * The per-vehicle paste modal takes one block for one vehicle. A stack of
 * results from several magazines meant opening it once per car and retyping the
 * source each time — which is how "Car and Driver" and "C&D" came to split.
 * This reads many results at once and plans each one for review:
 *
 *   readBatch(text, fileName)       what was supplied: `##` blocks, CSV or JSON
 *   planRow(item, context)          what importing it would do — vehicle, source,
 *                                   rollout basis, figures, duplicate — with any
 *                                   curator overrides applied
 *   rowWrite(row, sourceId)         the summary and speed windows to write
 *
 * Blocks go through parsePublishedResults and buildSummaryPayload unchanged, so
 * a block reads here exactly as it would in the per-vehicle modal.
 *
 * Pure module: no data access, no React.
 */

import Papa from 'papaparse';
import { parsePublishedResults, buildSummaryPayload } from './parsePublishedResults';
import { SUMMARY_FIELDS } from './performanceSummaryFields';
import { findSource } from './sources';

/** A two-result example, shown as the paste box's placeholder. */
export const BATCH_EXAMPLE = `## 2026 Porsche Macan 4S | Car and Driver | https://www.caranddriver.com/…
60 mph: 4.0 sec
1/4-Mile: 12.4 sec @ 110 mph
Results above omit 1-ft rollout of 0.3 sec.
Braking, 70-0 mph: 158 ft

## 2025 Rivian R1S Quad | Out of Spec | https://www.youtube.com/…
60 mph: 2.9 sec`;

const FIELD_KEYS = SUMMARY_FIELDS.map(f => f.key);

/** The columns a CSV or JSON row may carry. */
export const TABLE_COLUMNS = ['vehicle', 'vehicle_id', 'source', 'source_url', 'trim_label', 'notes', ...FIELD_KEYS];

// ── Reading ─────────────────────────────────────────────────────────────────

const HEADER = /^##\s*(.*)$/;

/**
 * Split a paste into blocks, each opened by a header line:
 *
 *   ## vehicle | source | link | trim
 *
 * Only the vehicle is required. Lines before the first header belong to no
 * result and are reported, not guessed at.
 */
export function splitBatchText(text) {
    const blocks = [];
    const stray = [];
    let current = null;
    String(text ?? '').split(/\r?\n/).forEach((line, i) => {
        const m = HEADER.exec(line.trim());
        if (m) {
            const [vehicle = '', source = '', url = '', trim = ''] = m[1].split('|').map(s => s.trim());
            current = { kind: 'block', line: i + 1, vehicleText: vehicle, sourceText: source, sourceUrl: url, trimLabel: trim, body: [] };
            blocks.push(current);
        } else if (current) {
            current.body.push(line);
        } else if (line.trim()) {
            stray.push(line.trim());
        }
    });
    return { blocks: blocks.map(b => ({ ...b, body: b.body.join('\n').trim() })), stray };
}

const blank = (v) => v == null || (typeof v === 'string' && v.trim() === '');
const text = (v) => (blank(v) ? '' : String(v).trim());

/** CSV or JSON records as items. Figures are taken as written — there is no footnote to read. */
function fromRecords(records, firstLine) {
    const known = new Set(TABLE_COLUMNS);
    const unknown = new Set();
    const items = records.map((rec, i) => {
        for (const key of Object.keys(rec ?? {})) if (!known.has(key)) unknown.add(key);
        const fields = {};
        for (const key of FIELD_KEYS) {
            if (blank(rec?.[key])) continue;
            const n = Number(rec[key]);
            if (Number.isFinite(n)) fields[key] = n;
        }
        if (!blank(rec?.notes)) fields.notes = text(rec.notes);
        return {
            kind: 'table',
            line: firstLine + i,
            vehicleText: text(rec?.vehicle),
            vehicleId: blank(rec?.vehicle_id) ? null : rec.vehicle_id,
            sourceText: text(rec?.source),
            sourceUrl: text(rec?.source_url),
            trimLabel: text(rec?.trim_label),
            tableFields: fields,
        };
    });
    const issues = unknown.size ? [`Ignored column${unknown.size === 1 ? '' : 's'}: ${[...unknown].join(', ')}.`] : [];
    return { items, issues };
}

/**
 * Read a batch.
 *
 * JSON when the file says so or the text opens with [ or {; CSV when the file
 * says so or there is no `##` header and the first line has commas; otherwise a
 * paste of blocks.
 *
 * @returns {{ format: 'blocks'|'csv'|'json'|null, items: Array, issues: string[] }}
 */
export function readBatch(input, fileName = '') {
    const trimmed = String(input ?? '').trim();
    if (!trimmed) return { format: null, items: [], issues: [] };

    if (/\.json$/i.test(fileName) || /^[[{]/.test(trimmed)) {
        let data;
        try {
            data = JSON.parse(trimmed);
        } catch (e) {
            return { format: 'json', items: [], issues: [`Not valid JSON: ${e.message}`] };
        }
        return { format: 'json', ...fromRecords(Array.isArray(data) ? data : [data], 1) };
    }

    const hasHeader = /^\s*##/m.test(trimmed);
    if (/\.csv$/i.test(fileName) || (!hasHeader && trimmed.split(/\r?\n/)[0].includes(','))) {
        const { data, errors } = Papa.parse(trimmed, { header: true, skipEmptyLines: true, transformHeader: h => h.trim() });
        const out = fromRecords(data, 2);
        return { format: 'csv', items: out.items, issues: [...out.issues, ...errors.map(e => `Row ${e.row + 2}: ${e.message}`)] };
    }

    const { blocks, stray } = splitBatchText(trimmed);
    const issues = [];
    if (!blocks.length) issues.push('No "##" header lines. Each result starts with "## vehicle | source | link".');
    else if (stray.length) issues.push(`${stray.length} line${stray.length === 1 ? '' : 's'} before the first "##" header ${stray.length === 1 ? 'was' : 'were'} ignored.`);
    return { format: 'blocks', items: blocks, issues };
}

// ── Matching ────────────────────────────────────────────────────────────────

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** The ways a result might name a vehicle: its name, with year, make, model and trim in the usual orders. */
const spellingsOf = (v) => [
    [v.name], [v.year, v.name], [v.make, v.name], [v.year, v.make, v.name], [v.year, v.name, v.trim],
    [v.make, v.model, v.trim], [v.year, v.make, v.model, v.trim], [v.make, v.model], [v.year, v.make, v.model],
].map(parts => norm(parts.filter(Boolean).join(' '))).filter(Boolean);

/**
 * The vehicle a result names. A bare id ("#52") or a vehicle_id column wins;
 * otherwise exactly one vehicle must match a spelling. Several matching is
 * reported, never settled by picking one.
 *
 * @returns {{ vehicle, by: 'id'|'name'|null, problem?: string }}
 */
export function matchVehicle(vehicleText, vehicles = [], vehicleId = null) {
    const idRef = vehicleId ?? /^#\s*(\d+)$/.exec(String(vehicleText ?? '').trim())?.[1] ?? null;
    if (idRef != null) {
        const byId = vehicles.find(v => Number(v.id) === Number(idRef));
        return byId ? { vehicle: byId, by: 'id' } : { vehicle: null, by: null, problem: `No vehicle has id ${idRef}.` };
    }
    const t = norm(vehicleText);
    if (!t) return { vehicle: null, by: null, problem: 'No vehicle named.' };
    const hits = vehicles.filter(v => spellingsOf(v).includes(t));
    if (hits.length === 1) return { vehicle: hits[0], by: 'name' };
    return {
        vehicle: null,
        by: null,
        problem: hits.length ? `${hits.length} vehicles match "${vehicleText}". Choose one.` : `No vehicle matches "${vehicleText}". Choose one.`,
    };
}

/** A link reduced to what identifies the page: no protocol, no www, no trailing slash. */
const pageKey = (url) => {
    const s = String(url ?? '').trim();
    if (!s) return '';
    try {
        const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
        return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}${u.search}`.toLowerCase();
    } catch {
        return s.toLowerCase();
    }
};

/**
 * An existing result for the same vehicle, source and link — the one a batch
 * row would duplicate. Two results with no link from the same source for the
 * same car count as the same result.
 */
export function findDuplicate(existing = [], { vehicleId, source, sourceName, sourceUrl }) {
    const name = String(source?.name ?? sourceName ?? '').trim().toLowerCase();
    return existing.find(r =>
        Number(r.vehicle_id) === Number(vehicleId)
        && (source?.id != null && r.source_id != null
            ? Number(r.source_id) === Number(source.id)
            : String(r.source_name ?? '').trim().toLowerCase() === name)
        && pageKey(r.source_url) === pageKey(sourceUrl),
    ) ?? null;
}

// ── Planning ────────────────────────────────────────────────────────────────

/**
 * Which rollout basis a block's 0–60 is filed under, and why.
 *
 *   chosen     the curator picked it on this row
 *   footnote   the block says ("omit 1-ft rollout" → rollout); read the same
 *              way as the per-vehicle modal, whose comments explain the verb
 *   source     the source's default, for a block with no footnote
 *   default    neither: the rollout convention published road tests now use
 */
export function rolloutBasisFor({ chosen = null, parsed = null, source = null } = {}) {
    if (chosen) return { basis: chosen, from: 'chosen' };
    const stated = parsed?.rollout?.stated;
    if (stated === 'omit') return { basis: 'rollout', from: 'footnote' };
    if (stated === 'include') return { basis: 'none', from: 'footnote' };
    if (source?.default_rollout_basis) return { basis: source.default_rollout_basis, from: 'source' };
    return { basis: 'rollout', from: 'default' };
}

/**
 * What importing one item would do.
 *
 * @param {Object} item       from readBatch
 * @param {Object} context
 * @param {Array}  context.vehicles
 * @param {Array}  context.sources     rows of the sources table
 * @param {Array}  context.existing    performance_summaries rows, for duplicates
 * @param {Object} [context.chosen]    curator overrides: { vehicleId, sourceId, basis, action }
 * @returns {Object} the row the preview shows and the import writes
 */
export function planRow(item, { vehicles = [], sources = [], existing = [], chosen = {} } = {}) {
    const vehicleMatch = chosen.vehicleId != null
        ? matchVehicle('', vehicles, chosen.vehicleId)
        : matchVehicle(item.vehicleText, vehicles, item.vehicleId);
    const vehicle = vehicleMatch.vehicle;

    const sourceMatch = chosen.sourceId != null
        ? { source: sources.find(s => Number(s.id) === Number(chosen.sourceId)) ?? null, by: 'chosen' }
        : findSource(sources, { name: item.sourceText, url: item.sourceUrl });
    const source = sourceMatch?.source ?? null;
    // A name that matches nothing becomes a new source on import, once, however
    // many rows name it.
    const newSourceName = !source && item.sourceText ? item.sourceText : null;

    const parsed = item.kind === 'block' ? parsePublishedResults(item.body) : null;
    const rollout = rolloutBasisFor({ chosen: chosen.basis, parsed, source });
    const payload = parsed
        ? buildSummaryPayload(parsed, { rolloutBasis: rollout.basis })
        : { fields: { ...(item.tableFields ?? {}) }, intervals: [] };
    const figureCount = Object.keys(payload.fields).filter(k => k !== 'notes').length + payload.intervals.length;
    // The basis only matters where there is a 0–60 to file.
    const hasSixty = !!parsed?.accelWindows?.some(w => w.unit === 'mph' && w.toSpeed === 60);

    const duplicate = vehicle
        ? findDuplicate(existing, { vehicleId: vehicle.id, source, sourceName: item.sourceText, sourceUrl: item.sourceUrl })
        : null;

    const problems = [];
    if (!vehicle) problems.push(vehicleMatch.problem);
    if (!figureCount) problems.push('No figures read.');

    // A duplicate is updated or skipped, never inserted again; there is nothing
    // to update without one.
    let action = 'blocked';
    if (!problems.length) {
        const wanted = chosen.action ?? (duplicate ? 'skip' : 'create');
        action = wanted === 'update' && !duplicate ? 'create'
            : wanted === 'create' && duplicate ? 'skip'
            : wanted;
    }

    return {
        line: item.line,
        kind: item.kind,
        vehicleText: item.vehicleText,
        vehicle,
        vehicleBy: vehicleMatch.by,
        sourceText: item.sourceText,
        source,
        sourceBy: sourceMatch?.by ?? null,
        newSourceName,
        sourceUrl: item.sourceUrl,
        trimLabel: item.trimLabel,
        rollout: hasSixty ? rollout : null,
        footnote: parsed?.rollout?.raw ?? null,
        fields: payload.fields,
        intervals: payload.intervals,
        figureCount,
        unmatched: parsed?.unmatched ?? [],
        warnings: parsed?.warnings ?? [],
        duplicate,
        action,
        problems,
    };
}

/**
 * The summary and speed windows to write for a planned row.
 *
 * `source_name` is written as the source's canonical name, so every reader
 * that still reads the text column sees one spelling. `source_id` is sent only
 * when there is one, so a result with no source still writes against a
 * database without migration 068.
 *
 * Replacing an earlier import clears the figures the new read no longer
 * carries, rather than leaving stale ones beside it.
 */
export function rowWrite(row, sourceId = row.source?.id ?? null, { replacing = false } = {}) {
    const cleared = replacing ? Object.fromEntries([...FIELD_KEYS, 'notes'].map(k => [k, null])) : {};
    return {
        fields: {
            ...cleared,
            ...row.fields,
            vehicle_id: row.vehicle.id,
            ...(sourceId != null ? { source_id: sourceId } : {}),
            source_name: row.source?.name ?? row.newSourceName ?? null,
            source_url: row.sourceUrl || null,
            trim_label: row.trimLabel || null,
        },
        intervals: row.intervals,
    };
}

// ── Templates ───────────────────────────────────────────────────────────────

/** A CSV header and one example row. */
export function buildResultsCsvTemplate() {
    const example = {
        vehicle: '2026 Porsche Macan 4S', vehicle_id: '', source: 'Car and Driver',
        source_url: 'https://www.caranddriver.com/…', trim_label: '', notes: '',
        zero_to_60_rollout_sec: '4.0', quarter_mile_sec: '12.4', quarter_mile_trap_mph: '110',
    };
    return `${TABLE_COLUMNS.join(',')}\n${TABLE_COLUMNS.map(c => example[c] ?? '').join(',')}\n`;
}

/** A one-result JSON skeleton with every column present. */
export function buildResultsJsonTemplate() {
    const row = Object.fromEntries(TABLE_COLUMNS.map(c => [c, null]));
    return JSON.stringify([{
        ...row,
        vehicle: '2026 Porsche Macan 4S', source: 'Car and Driver',
        source_url: 'https://www.caranddriver.com/…', zero_to_60_rollout_sec: 4.0,
    }], null, 2);
}

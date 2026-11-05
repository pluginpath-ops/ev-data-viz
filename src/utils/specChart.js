/**
 * What the spec chart plots, read off the vehicle table's columns (#450).
 *
 * The chart used to read the spec schema's fields directly. The table's
 * figures, tested and calculated columns do not live there — they are worked
 * out per vehicle by `buildVehicleRows` and depend on the reader's correction
 * and assumptions — so the chart now reads the same row values the cell shows,
 * and cannot disagree with the cell the reader came from.
 *
 * Everything here is pure: rows and columns in, plottable values out.
 */
import { displayNumber, formatVehicleCell, unitFor } from './vehicleTable';
import { isBlank } from './tableColumns';

/**
 * The keys the old chart saved in links (`sf`, `scx`, `scy`) that the table
 * names differently. Spec fields share a key in both (`category.field`), so
 * only the three "vehicle" fields moved.
 */
const LEGACY_KEYS = {
    'vehicle.year': 'year',
    'vehicle.socWindowKwh': 'figures.socWindowKwh',
    'vehicle.epaRangeMi': 'figures.epaRangeMi',
};

/** A saved field key as the table names it, so an old link keeps its field. */
export const currentFieldKey = (key) => LEGACY_KEYS[key] ?? key;

/** Whether a scatter can take the column: only numbers have an axis. */
export const isPlottableOnScatter = (col) => Boolean(col?.numeric);

/** The row label is what the bars are NAMED by, not something to plot. */
export const isPlottableColumn = (col) => Boolean(col) && col.key !== 'name';

/** Columns the chart offers, in the table's picker order. */
export function chartColumns(columns = [], { numericOnly = false } = {}) {
    return columns.filter(c => isPlottableColumn(c) && (!numericOnly || isPlottableOnScatter(c)));
}

/**
 * The columns the picker lists by default: those the table is showing, in the
 * table's order, plus whatever is plotted now (so the current field is never
 * hidden from the list that chooses it).
 */
export function tableScopedColumns(columns = [], visibleKeys = [], pinnedKeys = []) {
    const keep = new Set([...visibleKeys, ...pinnedKeys]);
    const byKey = new Map(columns.map(c => [c.key, c]));
    const ordered = [...visibleKeys, ...pinnedKeys.filter(k => !visibleKeys.includes(k))]
        .map(k => byKey.get(k)).filter(Boolean);
    return ordered.length ? ordered : columns.filter(c => keep.has(c.key));
}

/** Columns grouped as the table's column picker groups them, in first-seen order. */
export function groupColumns(columns = []) {
    const groups = [];
    for (const col of columns) {
        const name = col.group ?? 'Other';
        let group = groups.find(g => g.group === name);
        if (!group) groups.push(group = { group: name, columns: [] });
        group.columns.push(col);
    }
    return groups;
}

/**
 * One column over the rows given, as the chart draws it.
 *
 * `kind` is 'numeric' (bars with a length) or 'text' (a yes/no or a word,
 * which has no length — every vehicle gets the same bar with the value in it).
 * A vehicle with no value is NOT drawn and is counted in `missing`: an em dash
 * at full height would read as a measurement.
 *
 * @returns {{ kind, points: Array<{row, value, text, note}>, missing: number, total: number }}
 */
export function plotValues(rows = [], col, units = 'imperial') {
    const kind = col?.numeric ? 'numeric' : 'text';
    const points = [];
    for (const row of rows) {
        const raw = row?.values?.[col?.key];
        if (isBlank(raw)) continue;
        const text = formatVehicleCell(row, col, units);
        const note = row.notes?.[col.key] ?? null;
        if (kind === 'numeric') {
            const value = displayNumber(col, raw, units);
            if (!Number.isFinite(value)) continue;
            points.push({ row, value, text, note });
        } else {
            points.push({ row, value: null, text, note });
        }
    }
    return { kind, points, missing: rows.length - points.length, total: rows.length };
}

/** "Highway range (mi)": the column's name and the unit its figures are shown in. */
export function axisTitle(col, units = 'imperial') {
    const unit = unitFor(col, units);
    return unit ? `${col.label} (${unit})` : col.label;
}

/** Which way is better, said in words — or null where the column has no best. */
export function betterNote(col) {
    if (col?.better === 'higher') return 'higher is better';
    if (col?.better === 'lower') return 'lower is better';
    return null;
}

/** How many vehicles dropped for a blank value, or null when none did. `scope` is 'selection' or 'all' (the vehicles the filters leave). */
export function missingNote(missing, total, scope = 'selection') {
    if (!missing) return null;
    const which = scope === 'all' ? 'shown' : 'selected';
    if (missing === total) return `None of the ${which} vehicles has a value for this.`;
    return `${missing} of ${total} ${which} ${total === 1 ? 'vehicle' : 'vehicles'} ${missing === 1 ? 'has' : 'have'} no value and ${missing === 1 ? 'is' : 'are'} not plotted.`;
}

/**
 * The column to open on when none is chosen: the first the table is showing
 * (after the row label) that at least one selected vehicle has a value for.
 */
export function defaultFieldKey(columns = [], visibleKeys = [], rows = [], { numericOnly = false } = {}) {
    const usable = chartColumns(columns, { numericOnly });
    const hasData = (col) => rows.some(r => !isBlank(r?.values?.[col.key]));
    const byKey = new Map(usable.map(c => [c.key, c]));
    const ordered = [...visibleKeys.map(k => byKey.get(k)).filter(Boolean), ...usable];
    return ordered.find(hasData)?.key ?? ordered[0]?.key ?? null;
}

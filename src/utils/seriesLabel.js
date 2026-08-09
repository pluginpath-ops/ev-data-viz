/**
 * Chart series labels — name by difference, not by identity.
 *
 * A label should carry only what distinguishes a series from the others on
 * screen. Everything else is noise the context already supplies:
 *
 *     3 model years, same trim   →  2024 / 2025 / 2026
 *     4 tests on one car         →  70 mph cold / 80 mph / …
 *     3 cars × 4 tests           →  Model 3 · 70 mph / …
 *
 * All three fall out of one rule — take an atom only while the labels are still
 * ambiguous without it — rather than three special cases.
 *
 * The test is MARGINAL discriminating power, not variation. Dropping only the
 * atoms that never vary is too weak: eight cars of eight different models across
 * four model years all have a varying year, so every label carried one, even
 * though the model alone already told them apart.
 *
 * ── The atoms ────────────────────────────────────────────────────────────────
 *
 *     year · make · model · trim · range test · charging test
 *
 * The vehicle's free-text `name` is deliberately NOT an atom. It is a selection
 * label, entered by hand and inconsistent — some carry the year, some the trim —
 * so eliding against it is unreliable. It survives only as a last-resort
 * fallback when the composed label would otherwise be empty.
 *
 * Elision at this granularity is what makes the year case work: treating the
 * vehicle as one blob would leave "2024 Model 3 LR" against "2025 Model 3 LR"
 * and elide nothing, because the blobs differ.
 *
 * ── Two tiers ────────────────────────────────────────────────────────────────
 *
 * `short` is the elided form for legends and axes; `full` always carries every
 * atom, for tooltips and for the verbose toggle used when screen-capturing a
 * chart out of its context. Nothing is ever lost, only moved one hover away.
 *
 * Pure module — no React, no chart library.
 */

const SEPARATOR = ' · ';

/**
 * The order atoms are CONSIDERED in, which is not the order they are displayed
 * in. Vehicle identity first, then what was done to the vehicle: given a choice
 * between naming two series by model year and by test name, the year is the
 * more fundamental fact about which thing is being compared.
 */
const VEHICLE_PRIORITY = ['model', 'trim', 'year', 'make'];

/** Atom order is display order; `key` is what a surface names when suppressing one. */
const VEHICLE_ATOMS = [
    { key: 'year',  of: s => s.vehicle?.year },
    { key: 'make',  of: s => s.vehicle?.make },
    { key: 'model', of: s => s.vehicle?.model },
    { key: 'trim',  of: s => s.vehicle?.trim },
];

/**
 * What was done to the vehicle. Charging and range charts distinguish series by
 * their two tests; the performance charts distinguish them by drive mode, run
 * number and who published the figure. Both sit below the vehicle atoms in
 * priority and are passed in by the surface, since a chart should not have to
 * carry atoms belonging to a subsystem it never shows.
 */
const TEST_ATOMS = [
    { key: 'range',    of: s => s.rangeRun?.name },
    { key: 'charging', of: s => s.chargingRun?.name },
];

const clean = v => {
    const s = v == null ? '' : String(v).trim();
    return s.length ? s : null;
};

/**
 * Build short and full labels for a set of series.
 *
 * @param {Array} series  [{ key, vehicle, rangeRun, chargingRun, sessionName }]
 * @param {Object} [opts]
 * @param {string[]} [opts.supplied]  atoms the surface already shows, and which
 *        its labels should therefore omit — a bar chart grouped by vehicle
 *        passes ['year','make','model','trim'] because the axis says them.
 * @param {Array} [opts.atoms]  the non-vehicle atoms for this subsystem, in
 *        priority order: [{ key, of }]. Defaults to the range/charging pair.
 * @param {string[]} [opts.required]  atoms to include whether or not they are
 *        needed to disambiguate. Minimality decides what is NECESSARY; a surface
 *        still gets to say what is always MEANINGFUL — "one bar per source"
 *        names the source on every bar, including a vehicle that only has one.
 * @param {Object} [opts.overrides]  key → user-supplied name, winning outright.
 *        The free-text override of #170 is shelved; this is the seam it needs.
 *        An overridden series short-circuits BEFORE elision — manual must beat
 *        auto — and is also excluded from the ambiguity computation, since a
 *        hand-named series is already distinct and must not force its
 *        neighbours to grow longer labels to differ from it.
 * @param {boolean} [opts.useSessionName]  when both halves of a pair come from
 *        one session, prefer that session's name as the short label: "Ottawa
 *        loop" beats "10→80% DC fast × 70 mph highway" at a quarter the width.
 * @returns {Map<key, { short, full }>}
 */
export function buildSeriesLabels(
    series,
    { supplied = [], atoms = TEST_ATOMS, required = [], overrides = {}, useSessionName = true } = {},
) {
    const out = new Map();
    if (!series?.length) return out;

    const ATOMS = [...VEHICLE_ATOMS, ...atoms];
    const PRIORITY = [...VEHICLE_PRIORITY, ...atoms.map(a => a.key)];

    const suppliedSet = new Set(supplied);
    const requiredSet = new Set(required.filter(k => !suppliedSet.has(k)));

    // A surface that names the vehicle itself (bar charts group by it on the
    // axis) makes the free-text vehicle name a redundant fallback — it would
    // print the group heading a second time inside the group. Fall back to the
    // test name there instead.
    const vehicleShown = ['year', 'make', 'model', 'trim'].some(k => suppliedSet.has(k));

    // Values per atom, per series — computed once, read twice below.
    const values = series.map(s => {
        const row = {};
        for (const atom of ATOMS) row[atom.key] = clean(atom.of(s));
        return row;
    });

    // ── Choose the smallest set of atoms that keeps the labels unambiguous ───
    //
    // Series the surface has ALREADY separated are not ambiguous. A bar chart
    // that groups by vehicle and prints the name on the axis has said which car
    // each bar belongs to, so two bars under different cars never need a further
    // atom to tell them apart. Partitioning by the supplied atoms encodes that:
    // uniqueness is required within a partition, never across them.
    //
    // Required atoms deliberately do NOT partition. A source name present on
    // every bar would technically separate a 2025 from a 2026 Model 3, but the
    // reader could not tell whether the two bars differ by car or by source, so
    // minimality is computed as if the required atoms were not there and they
    // are appended afterwards.
    const overrideOf = s => clean(overrides?.[s.key]);

    const partitions = new Map();
    series.forEach((s, i) => {
        if (overrideOf(s)) return;              // named by hand; not in the contest
        const k = supplied.map(key => values[i][key] ?? '').join(' | ');
        if (!partitions.has(k)) partitions.set(k, []);
        partitions.get(k).push(i);
    });

    const chosen = series.map(() => new Set(requiredSet));
    const selectable = PRIORITY.filter(key => !suppliedSet.has(key) && !requiredSet.has(key));

    // Refine per AMBIGUITY GROUP rather than globally, so one collision does not
    // tax every label. Two model years of one car need the year; the other six
    // cars in the comparison, already distinct by model, do not have to carry a
    // year just because those two do.
    const refine = (indices, remaining) => {
        if (indices.length <= 1) return;

        for (let n = 0; n < remaining.length; n++) {
            const key = remaining[n];

            const groups = new Map();
            for (const i of indices) {
                const v = values[i][key] ?? '';
                if (!groups.has(v)) groups.set(v, []);
                groups.get(v).push(i);
            }
            // Constant within this group: it separates nothing HERE, whatever it
            // does elsewhere in the chart. Try the next atom.
            if (groups.size <= 1) continue;

            for (const i of indices) chosen[i].add(key);
            // Atoms 0..n were either constant here or just taken; neither can
            // split a subgroup, so only what follows is worth trying.
            for (const g of groups.values()) refine(g, remaining.slice(n + 1));
            return;
        }
        // Nothing left that varies — these series are identical on every atom,
        // and the fallback below handles them.
    };

    for (const indices of partitions.values()) refine(indices, selectable);

    // Two atoms that read the same say it once. The 046 split gave a run's
    // charging and range halves the same name, so an honest pair label came out
    // "Theoretical · Theoretical" — twice the width, none of the information.
    // Distinct pairs ("OoS 70mph · Out of Spec & Forums") are untouched.
    const compose = (atoms, row) => {
        const seen = new Set();
        const parts = [];
        for (const atom of atoms) {
            const val = row[atom.key];
            if (!val) continue;
            const norm = val.toLowerCase();
            if (seen.has(norm)) continue;
            seen.add(norm);
            parts.push(val);
        }
        return parts.join(SEPARATOR);
    };

    series.forEach((s, i) => {
        const row = values[i];

        // Manual wins outright, in both tiers: the user named this series
        // something the data cannot express, and a tooltip that quietly
        // reverted to the composed name would contradict the legend.
        const manual = overrideOf(s);
        if (manual) {
            out.set(s.key, { short: manual, full: manual });
            return;
        }

        const full = compose(ATOMS, row);

        let short = compose(ATOMS.filter(a => chosen[i].has(a.key)), row);

        // A session names the pair better than either half does, and is shorter.
        if (!short && useSessionName && clean(s.sessionName)) short = clean(s.sessionName);

        // Everything elided means one series, or a set identical on every atom —
        // fall back rather than render a blank legend entry.
        if (!short) {
            const chain = vehicleShown
                ? [s.rangeRun?.name, s.chargingRun?.name, s.vehicle?.name]
                : [s.vehicle?.name, s.rangeRun?.name, s.chargingRun?.name];
            short = chain.map(clean).find(Boolean) ?? full ?? '';
        }

        out.set(s.key, { short, full: full || short });
    });

    return out;
}

import { Fragment, useState, useMemo } from 'react';
import { CURVE_TIERS, tierByKey } from '../../../utils/epaCurveSubjects';

import InfoIcon from '../../InfoIcon';

/**
 * Choose certification records to plot (#237).
 *
 * Not a vehicle selector. The subject here is the certification record itself,
 * which is why this view exists apart from EPA Curves: 210 records can be
 * plotted and only a fraction of them belong to a vehicle in the database.
 *
 * The tier filter is the important control. Every curve's SHAPE is measured —
 * road-load coefficients are the lab's own numbers — but the energy that turns
 * consumption into range is measured for 73 records and borrowed from the
 * guide's gross pack for another 108. Mixing the two silently would put an
 * estimate and a measurement on one axis with nothing to tell them apart.
 */
export default function CurveSubjectPicker({ subjects, selected, onToggle, onClear, colors }) {
    const [query, setQuery] = useState('');
    // `corrected` was missing from this default, which hid a tier that is
    // strictly BETTER than `nominal` — its capacity is the record's own —
    // while showing the worse one. `shape` stays opt-in: it is the only tier
    // that cannot answer the range axis at all.
    const [tiers, setTiers] = useState(['measured', 'corrected', 'nominal']);


    const shown = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return subjects.filter(s => {
            if (tiers.length && !tiers.includes(s.tier)) return false;
            if (!needle) return true;
            return `${s.label} ${s.sublabel} ${s.key}`.toLowerCase().includes(needle);
        });
    }, [subjects, tiers, query]);

    /**
     * The shown records, cut into runs by tier.
     *
     * Walked in order rather than grouped-and-sorted, because `curveSubjects`
     * already returns them best-grounded first and re-deriving that here would
     * be a second opinion on the same question. A tier can therefore only
     * appear once, which is what makes the divider a divider.
     */
    const groups = useMemo(() => {
        const out = [];
        for (const s of shown) {
            const last = out[out.length - 1];
            if (last && last.tier === s.tier) last.rows.push(s);
            else out.push({ tier: s.tier, rows: [s] });
        }
        return out;
    }, [shown]);

    const toggleTier = (key) =>
        setTiers(prev => (prev.includes(key) ? prev.filter(t => t !== key) : [...prev, key]));

    return (
        <div className="guide-filter-bar">
            {/* No label above it. The placeholder already says what the field
                takes, and a heading that repeats the field's own text is a row
                of the sidebar spent twice. */}
            <div className="guide-facet guide-facet-search">
                <input
                    type="search"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Filter make, model, or ID"
                    aria-label="Filter records by make, model, or test group ID"
                    className="form-input guide-search-input"
                />
            </div>

            <div className="guide-facet">
                <div className="guide-facet-label">
                    Energy model basis
                    {/* Two things vary across the tiers, not one, and a reader who
                        misses that takes the middle chip for a better CONSUMPTION
                        curve than the last. It isn't: consumption is road load and
                        η, identical for both. Only capacity — and so range —
                        separates them. Detail rather than a standing caption, so
                        the control reads as a control. */}
                    <InfoIcon position="below" tooltipClassName="info-icon-tooltip--on-panel">
                        <div className="mb-1">
                            Every curve’s shape is measured road load. What differs is the
                            energy behind it.
                        </div>
                        {CURVE_TIERS.map(t => (
                            <div key={t.key} className="curve-tier-legend">
                                <span className="curve-tier-legend-name">{t.label}</span>
                                {t.tooltip}
                            </div>
                        ))}
                    </InfoIcon>
                </div>
                <div className="guide-facet-values">
                    {CURVE_TIERS.map(t => (
                        <button key={t.key} type="button"
                            className={`guide-chip ${tiers.includes(t.key) ? 'active' : ''}`}
                            onClick={() => toggleTier(t.key)}
                            title={`${t.label} — ${t.hint}`}>
                            {/* The short form, and no count: the list's own
                                dividers now carry both the full label and the
                                number, so a chip repeating them was spending
                                three rows of a 320px sidebar to say it twice.
                                The full label is on hover with the explanation
                                it belongs to. */}
                            {t.badge}
                        </button>
                    ))}
                </div>
            </div>

            <div className="guide-facet curve-picker-list-facet">
                <div className="guide-facet-label">
                    Records <span className="text-note">{shown.length} shown · {selected.length} plotted</span>
                </div>
                <div className="curve-picker-list">
                    {groups.map(g => (
                        <Fragment key={g.tier}>
                            {/* The tier, said once for everything beneath it.
                                It used to be a badge on every row, which was
                                repeating what the row's POSITION already said —
                                the list is sorted best-grounded first — while
                                taking the width the record's name needed. */}
                            <div className="curve-picker-group text-micro">
                                {tierByKey(g.tier)?.label ?? g.tier}
                                <span className="curve-picker-group-count">{g.rows.length}</span>
                            </div>
                            {g.rows.map(s => (
                                <label key={s.key} className={`curve-picker-row ${selected.includes(s.key) ? 'selected' : ''}`}>
                                    <input
                                        type="checkbox"
                                        checked={selected.includes(s.key)}
                                        onChange={() => onToggle(s.key)}
                                    />
                                    {/* The colour the curve is drawn in, so a row
                                        and a line can be matched. */}
                                    <span
                                        className={`series-swatch${colors?.get(s.key) ? '' : ' is-empty'}`
                                            + `${s.etaMeasured ? '' : ' is-qualified'}`}
                                        style={colors?.get(s.key) ? { backgroundColor: colors.get(s.key) } : undefined}
                                        title={s.etaMeasured
                                            ? undefined
                                            : 'Drivetrain efficiency is assumed, not measured — the curve\'s shape is real, its magnitude scales with η'}
                                    />
                                    <span className="curve-picker-name">
                                        <span className="curve-picker-title">{s.label}</span>
                                        <span className="curve-picker-meta">{s.sublabel}</span>
                                    </span>
                                </label>
                            ))}
                        </Fragment>
                    ))}
                    {shown.length === 0 && (
                        <div className="text-note p-2">Nothing matches this filter.</div>
                    )}
                </div>
                {selected.length > 0 && (
                    <button type="button" className="section-action self-start" onClick={onClear}>
                        Clear {selected.length}
                    </button>
                )}
            </div>
        </div>
    );
}

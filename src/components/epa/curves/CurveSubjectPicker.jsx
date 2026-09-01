import { useState, useMemo } from 'react';
import { CURVE_TIERS, tierCounts } from '../../../utils/epaCurveSubjects';
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
export default function CurveSubjectPicker({ subjects, selected, onToggle, onClear }) {
    const [query, setQuery] = useState('');
    const [tiers, setTiers] = useState(['measured', 'nominal']);

    const counts = useMemo(() => tierCounts(subjects), [subjects]);

    const shown = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return subjects.filter(s => {
            if (tiers.length && !tiers.includes(s.tier)) return false;
            if (!needle) return true;
            return `${s.label} ${s.sublabel} ${s.key}`.toLowerCase().includes(needle);
        });
    }, [subjects, tiers, query]);

    const toggleTier = (key) =>
        setTiers(prev => (prev.includes(key) ? prev.filter(t => t !== key) : [...prev, key]));

    return (
        <div className="guide-filter-bar">
            <div className="guide-facet guide-facet-search">
                <div className="guide-facet-label">Search</div>
                <input
                    type="search"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Make, carline or test group"
                    className="guide-search-input"
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
                            title={t.hint}>
                            {t.label}
                            <span className="guide-chip-count">{counts[t.key]}</span>
                        </button>
                    ))}
                </div>
            </div>

            <div className="guide-facet curve-picker-list-facet">
                <div className="guide-facet-label">
                    Records <span className="text-note">{shown.length} shown · {selected.length} plotted</span>
                </div>
                <div className="curve-picker-list">
                    {shown.map(s => (
                        <label key={s.key} className={`curve-picker-row ${selected.includes(s.key) ? 'selected' : ''}`}>
                            <input
                                type="checkbox"
                                checked={selected.includes(s.key)}
                                onChange={() => onToggle(s.key)}
                            />
                            <span className="curve-picker-name">
                                {s.label}
                                <span className="text-meta"> · {s.sublabel}</span>
                            </span>
                            {/* Named on the row, not only in the filter: once a
                                mixed set is plotted the tier is the only thing
                                saying which curves carry a measured range. */}
                            <span className={`curve-tier-badge tier-${s.tier}`}>
                                {s.tier === 'measured' ? 'test cycle'
                                    : s.tier === 'nominal' ? 'published pack'
                                        : 'no range'}
                            </span>
                        </label>
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

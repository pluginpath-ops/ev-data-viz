import { useState, useMemo } from 'react';
import { CURVE_TIERS, tierCounts } from '../../../utils/epaCurveSubjects';

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
                <div className="guide-facet-label">How the energy was obtained</div>
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
                <div className="text-hint">
                    Every curve’s shape is measured. What differs is the energy behind the range axis.
                </div>
            </div>

            <div className="guide-facet curve-picker-list-facet">
                <div className="guide-facet-label">
                    Records <span className="text-hint">{shown.length} shown · {selected.length} plotted</span>
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
                                <span className="text-faint"> · {s.sublabel}</span>
                            </span>
                            {/* Named on the row, not only in the filter: once a
                                mixed set is plotted the tier is the only thing
                                saying which curves carry a measured range. */}
                            <span className={`curve-tier-badge tier-${s.tier}`}>
                                {s.tier === 'measured' ? 'measured'
                                    : s.tier === 'nominal' ? 'nominal'
                                        : 'no range'}
                            </span>
                        </label>
                    ))}
                    {shown.length === 0 && (
                        <div className="text-caption text-muted p-2">Nothing matches this filter.</div>
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

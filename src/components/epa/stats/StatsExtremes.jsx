import { observationLabel } from '../../../utils/epaGuideStats';

/**
 * Both tails, named.
 *
 * A distribution says what is typical and never says which car. "The one EV
 * more efficient on the highway than in town" is the shareable fact, and it
 * only exists once something is named — so both ends are listed, not just the
 * winners. The bottom of a city:hwy ranking is the more interesting end.
 */
function List({ title, items, measure, digits, unit }) {
    if (!items.length) return null;
    return (
        <div className="stats-extremes-list">
            <div className="text-label">{title}</div>
            {items.map((o, i) => (
                <div key={`${observationLabel(o)}-${i}`} className="stats-extreme-row">
                    <span className="stats-extreme-name">{observationLabel(o)}</span>
                    <span className="text-data">
                        {Number(o[measure]).toFixed(digits)}
                        {unit && <span className="text-meta"> {unit}</span>}
                    </span>
                </div>
            ))}
        </div>
    );
}

export default function StatsExtremes({ data, measure, measureDef }) {
    const m = measureDef;
    return (
        <div className="stats-extremes">
            <List title="Highest" items={data.highest} measure={measure} digits={m?.digits ?? 1} unit={m?.unit} />
            <List title="Lowest"  items={data.lowest}  measure={measure} digits={m?.digits ?? 1} unit={m?.unit} />
        </div>
    );
}

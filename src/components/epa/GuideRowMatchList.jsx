import { useState } from 'react';
import { guideRowMatches } from '../../utils/guideRowMatches';

/**
 * Every test vehicle of a Guide row's certification, badged by how it matches
 * the row (utils/guideRowMatches.js), under the row on a vehicle's EPA Label
 * and its candidates.
 *
 * A badge is colored by what it means for this vehicle, not by the match
 * alone: "no match" is quiet on a test vehicle nobody linked, and a warning or
 * a danger on one the vehicle links — that is the configuration to look at.
 */

const MATCH = {
    exact:         { label: 'exact',       title: 'Reproduces the row’s unadjusted kWh/100mi within the precision the Guide printed' },
    near:          { label: 'near',        title: 'Reproduces the row, just past rounding' },
    blend:         { label: 'blend',       title: 'One of the test vehicles the row lies between' },
    alternative:   { label: 'alternative', title: 'Explains the row as well as the test vehicles Tested via named — the row is ambiguous' },
    possible:      { label: 'possible',    title: 'No row names it, but it could be one end of a blend behind this row' },
    'other-label': { label: 'other label', title: 'Another Guide row of the certification names it' },
    'no-match':    { label: 'no match',    title: 'It could not stand behind this row' },
    'no-lab-data': { label: 'no lab data', title: 'Its tests cannot give both city and highway kWh/100mi' },
};

function intentOf(m) {
    if (['exact', 'near', 'blend'].includes(m.match)) return 'is-good';
    if (!m.linked) return ['possible', 'alternative'].includes(m.match) ? 'is-warning' : '';
    return m.match === 'no-match' ? 'is-danger' : 'is-warning';
}

const pct = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1)}%`;

/**
 * @param {Object} props
 * @param {Object} props.row  { guide, via, pool }
 * @param {Array} props.others  other rows of the certification: { rowId, guide, via }
 * @param {Map<string, Object>} props.mappings  test_vehicle_id → the vehicle's mapping
 * @param {boolean} props.canEdit
 * @param {(testVehicleId: string) => Promise} [props.onLink]
 * @param {(mapping: Object) => Promise} [props.onUnlink]
 */
export default function GuideRowMatchList({ row, others = [], mappings = new Map(), canEdit = false, onLink, onUnlink }) {
    const [busy, setBusy] = useState(null);
    const matches = guideRowMatches(row, others, new Set(mappings.keys()));
    if (!matches.length) return <p className="text-caption mt-1">No test vehicle of its certification is imported.</p>;

    const titleOf = (rowId) => {
        const g = others.find(o => o.rowId === rowId)?.guide;
        return g ? [g.model_year, g.carline, g.drive_desc].filter(Boolean).join(' ') : null;
    };
    const act = async (id, fn) => {
        setBusy(id);
        try { await fn(); } finally { setBusy(null); }
    };

    return (
        <ul className="guide-match-list" aria-label="Test vehicles in its certification">
            {matches.map(m => {
                const mapping = mappings.get(m.test_vehicle_id);
                const why = m.match === 'other-label' && titleOf(m.otherRowId);
                return (
                    <li key={m.test_vehicle_id} className="guide-match-row">
                        <span className="guide-match-fit">
                            <span className={`badge-micro ${intentOf(m)}`} title={MATCH[m.match].title}>
                                {MATCH[m.match].label}
                            </span>
                            {m.nearest && <span className="badge-micro is-good" title="The blend member nearest the row: it stands for the vehicle">nearest</span>}
                        </span>
                        <span className="min-w-0">
                            <span className="font-mono">{m.test_vehicle_id}</span>
                            {m.carline && <span className="text-meta"> · {m.carline}</span>}
                            {why && <span className="text-meta block truncate">behind {why}</span>}
                        </span>
                        <span className="guide-match-delta" title="Its unadjusted kWh/100mi against the row’s">
                            {m.delta ? `city ${pct(m.delta.city)} · hwy ${pct(m.delta.hwy)}` : '—'}
                        </span>
                        <span className="guide-match-action">
                            {mapping && (
                                <span className="badge-micro is-accent" title="A configuration of this vehicle">
                                    {mapping.isPrimary ? 'primary' : 'linked'}
                                </span>
                            )}
                            {canEdit && mapping && onUnlink && (
                                <button type="button" className="btn btn-secondary text-xs py-0.5 px-2 disabled:opacity-40"
                                    disabled={busy != null} onClick={() => act(m.test_vehicle_id, () => onUnlink(mapping))}
                                    title="Remove this configuration from the vehicle">
                                    {busy === m.test_vehicle_id ? '…' : 'Unlink'}
                                </button>
                            )}
                            {canEdit && !mapping && onLink && m.match !== 'no-lab-data' && (
                                <button type="button" className="btn btn-secondary text-xs py-0.5 px-2 disabled:opacity-40"
                                    disabled={busy != null} onClick={() => act(m.test_vehicle_id, () => onLink(m.test_vehicle_id))}
                                    title="Link this test vehicle to the vehicle as a configuration">
                                    {busy === m.test_vehicle_id ? '…' : 'Link'}
                                </button>
                            )}
                        </span>
                    </li>
                );
            })}
        </ul>
    );
}

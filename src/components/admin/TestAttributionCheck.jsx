import { useState, useMemo, useCallback } from 'react';
import { useAppContext } from '../../context/AppContext';
import { useAsyncResource } from '../../hooks/useAsyncResource';
import { useSources } from '../../hooks/useSources';
import { dataService } from '../../services/DataService';
import { testAttribution, ATTRIBUTION_FINDINGS } from '../../utils/dataChecks';
import { domainOf } from '../../utils/sources';
import { testHref } from '../../utils/testDetails';

const FINDING_LABEL = Object.fromEntries(ATTRIBUTION_FINDINGS.map(f => [f.key, f.label]));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Admin → Data Checks → Across the fleet: who each test says made it (#426).
 *
 * One row per test whose source, name or link disagrees with the others, with
 * the stored curve's SoC window beside the name that states one. Read-only:
 * Edit opens that test's own edit form in Tests & Data, where the source is
 * chosen from the one list.
 *
 * The curve's span is read from its points (one aggregate per charging test),
 * never from the run's start/end SoC columns, which are not the curve.
 */
export default function TestAttributionCheck() {
    const { vehicles } = useAppContext();
    const { sources, loading: sourcesLoading } = useSources();
    const [only, setOnly] = useState('');

    const fleet = useMemo(() => vehicles ?? [], [vehicles]);
    const chargingIds = useMemo(
        () => fleet.flatMap(v => (v.runs ?? []).filter(r => r.kind === 'charging').map(r => r.id)),
        [fleet],
    );
    const idsKey = chargingIds.join(',');
    // Keyed on the ids themselves: every save hands back a new vehicles array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const loadRanges = useCallback(() => dataService.getSocRanges(chargingIds), [idsKey]);
    const { data: socRanges, loading: rangesLoading, error } = useAsyncResource(loadRanges, [loadRanges]);

    const result = useMemo(
        () => testAttribution(fleet, { sources, socRanges: socRanges ?? {} }),
        [fleet, sources, socRanges],
    );
    const shown = only ? result.rows.filter(r => r.findings.some(f => f.key === only)) : result.rows;

    if (error) return <p className="text-note">Test attribution could not be checked: {error.message}</p>;
    if (rangesLoading || sourcesLoading) return <p className="text-note">Checking who made each test…</p>;

    return (
        <div>
            <p className="text-note mb-2">
                {plural(result.rows.length, 'test')} of {result.checked} {result.rows.length === 1 ? 'has' : 'have'} a
                finding. A source is chosen from the source list when a test is edited; its name starts with it, and
                its link follows the source’s rule.
            </p>
            {result.rows.length === 0 ? (
                <p className="text-note">Every test names its source one way, starts its name with it and links to it.</p>
            ) : (
                <>
                    <label className="flex items-center gap-2 mb-2">
                        <span className="text-meta">Finding</span>
                        <select className="form-input" value={only} onChange={e => setOnly(e.target.value)}>
                            <option value="">All findings ({result.rows.length})</option>
                            {ATTRIBUTION_FINDINGS.filter(f => result.counts[f.key] > 0).map(f => (
                                <option key={f.key} value={f.key}>{f.label} ({result.counts[f.key]})</option>
                            ))}
                        </select>
                    </label>
                    <div className="import-table-container">
                        <table className="w-full text-meta">
                            <thead>
                                <tr className="text-left text-secondary">
                                    <th className="p-2">Vehicle</th>
                                    <th className="p-2">Kind</th>
                                    <th className="p-2">Name</th>
                                    <th className="p-2">Source</th>
                                    <th className="p-2">Link</th>
                                    <th className="p-2">SoC window</th>
                                    <th className="p-2">Finding</th>
                                    <th className="p-2" />
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {shown.map(row => (
                                    <tr key={row.runId} className="align-top">
                                        <td className="p-2">{row.vehicle}</td>
                                        <td className="p-2">{row.kind}</td>
                                        <td className="p-2">{row.name || '—'}</td>
                                        <td className="p-2">{row.source || '—'}</td>
                                        <td className="p-2">
                                            {row.url
                                                ? <a href={row.url} target="_blank" rel="noopener noreferrer">{domainOf(row.url) ?? row.url}</a>
                                                : '—'}
                                        </td>
                                        <td className="p-2 tabular-nums">
                                            {row.curve ? `${Math.round(row.curve.min)}–${Math.round(row.curve.max)}%` : '—'}
                                        </td>
                                        <td className="p-2">
                                            <ul>
                                                {row.findings.map(f => (
                                                    <li key={f.key} title={FINDING_LABEL[f.key]}>{f.text}</li>
                                                ))}
                                            </ul>
                                        </td>
                                        <td className="p-2">
                                            <a
                                                className="btn btn-secondary text-sm"
                                                href={testHref({ vehicleId: row.vehicleId, runId: row.runId, sub: 'tests', edit: true })}
                                            >
                                                Edit
                                            </a>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </div>
    );
}

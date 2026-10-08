import { useState, useEffect, useCallback } from 'react';
import { useAppContext } from '../../../context/AppContext';
import { useAsyncResource } from '../../../hooks/useAsyncResource';
import { GUIDE_COLUMNS, COLUMN_GROUPS, columnByKey, formatCell } from '../../../utils/feGuideBrowse';
import GuideCertificationResults from './GuideCertificationResults';
import { guidePlausibilityFlags } from '../../../utils/guidePlausibility';

// The label, kept short: what a window sticker says. Everything else sits
// behind "Show all fields".
const LABEL_KEYS = ['label_comb_range_mi', 'label_city_range_mi', 'label_hwy_range_mi',
    'label_comb_mpge', 'label_adjustment_factor', 'adjustment_signature'];
const LABEL_COLUMNS = LABEL_KEYS.map(columnByKey).filter(Boolean);

/**
 * One configuration, every field (#235).
 *
 * Grouped by the same `group` the column picker uses, so the vocabulary is the
 * same whichever way a reader arrives.
 *
 * `raw` is fetched on open rather than with the list: it is the entire 76-column
 * source row, which is most of the payload and none of the display. Migration
 * 053 kept it precisely so "a question we have not thought of yet does not need
 * a re-import to answer", and the disclosure below is where that pays off — it
 * is the only place a reader can see a field we never mapped.
 */
export default function GuideDetailModal({ row, vehicles, testVehicleIds = [], configCount = 1, onClose }) {
    const { getFeGuideRow } = useAppContext();
    const [showRaw, setShowRaw] = useState(false);
    const [showAll, setShowAll] = useState(false);

    const loadRow = useCallback(() => getFeGuideRow(row.id), [getFeGuideRow, row.id]);
    const { data: full, error: rawError } = useAsyncResource(loadRow, [row.id]);
    const raw = full?.raw ?? null;

    // Escape closes, matching every other modal in the app.
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    // The verbatim source row, under EPA's own column names.
    //
    // Deliberately NOT filtered against GUIDE_COLUMNS: `raw` is keyed by EPA's
    // headings ("Comb FE (Guide) - Conventional Fuel") where our columns are
    // keyed by database names (`label_comb_mpge`), so a set difference between
    // them compares two different vocabularies and subtracts almost nothing.
    // Showing the row whole is also the point — migration 053 kept it so that
    // a question we have not thought of yet can be answered without a
    // re-import, and that only works if nothing is hidden.
    const rawEntries = raw
        ? Object.entries(raw).sort(([a], [b]) => a.localeCompare(b))
        : [];

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-panel guide-detail-panel" onClick={e => e.stopPropagation()}>
                <div className="modal-header px-6 py-4">
                    <div>
                        <div className="section-title">{row.carline}</div>
                        <div className="text-note">
                            {row.model_year} {row.division}
                            {row.body_class && ` · ${row.body_class}`}
                            {row.smog_test_group && ` · Test Group ${row.smog_test_group}`}
                        </div>
                    </div>
                    <button onClick={onClose} className="btn btn-secondary">Close</button>
                </div>

                <div className="modal-body">
                    {row.is_collapsed && (
                        <div className="guide-warning">
                            EPA collapsed several configurations into this row. Its motor count and
                            motor power are the union of those configurations, so no arithmetic over them
                            describes one vehicle.
                        </div>
                    )}

                    {guidePlausibilityFlags(row).length > 0 && (
                        <div className="guide-warning">
                            The published EPA data for this vehicle appears to be incorrect based on
                            automated checks.
                            <ul>
                                {guidePlausibilityFlags(row).map(f => <li key={f.kind}>{f.text}</li>)}
                            </ul>
                            There may be corrected data available from the EPA.
                        </div>
                    )}

                    {vehicles.length > 0 && (
                        <div className="guide-tested-note">
                            We hold test data for {vehicles.map(v => `${v.year} ${v.name}`).join(', ')}.
                        </div>
                    )}

                    <div className="guide-detail-group">
                        <div className="text-label guide-detail-group-title">On the label</div>
                        <dl className="guide-detail-grid">
                            {LABEL_COLUMNS.map(col => (
                                <div key={col.key} className="guide-detail-item" title={col.hint || ''}>
                                    <dt className="text-label">
                                        {col.label}{col.unit ? ` (${col.unit})` : ''}
                                    </dt>
                                    <dd className="text-data">{formatCell(row, col)}</dd>
                                </div>
                            ))}
                        </dl>
                    </div>

                    <div className="guide-detail-group">
                        <div className="text-label guide-detail-group-title">Certification results</div>
                        <GuideCertificationResults
                            guideRowId={row.id}
                            testVehicleIds={testVehicleIds}
                            vehicles={vehicles}
                            configCount={configCount}
                        />
                    </div>

                    <div className="guide-detail-group">
                        <button
                            type="button"
                            className="section-action"
                            onClick={() => setShowAll(v => !v)}
                        >
                            {showAll ? 'Hide' : 'Show'} all fields
                        </button>
                    </div>

                    {showAll && (
                        <>
                            {COLUMN_GROUPS.map(group => {
                                const cols = GUIDE_COLUMNS.filter(c => c.group === group);
                                return (
                                    <div key={group} className="guide-detail-group">
                                        <div className="text-label guide-detail-group-title">{group}</div>
                                        <dl className="guide-detail-grid">
                                            {cols.map(col => (
                                                <div key={col.key} className="guide-detail-item" title={col.hint || ''}>
                                                    <dt className="text-label">
                                                        {col.label}{col.unit ? ` (${col.unit})` : ''}
                                                    </dt>
                                                    <dd className="text-data">{formatCell(row, col)}</dd>
                                                </div>
                                            ))}
                                        </dl>
                                    </div>
                                );
                            })}

                            <div className="guide-detail-group">
                                <button
                                    type="button"
                                    className="section-action"
                                    onClick={() => setShowRaw(s => !s)}
                                >
                                    {showRaw ? 'Hide' : 'Show'} EPA source row
                                    {rawEntries.length > 0 && ` (${rawEntries.length} fields, verbatim)`}
                                </button>
                                {showRaw && (
                                    <div className="guide-raw">
                                        {rawError && <div className="text-note">The source row could not be loaded.</div>}
                                        {!rawError && raw == null && <div className="text-note">Loading…</div>}
                                        {rawEntries.map(([k, v]) => (
                                            <div key={k} className="guide-raw-row">
                                                <span className="text-label">{k}</span>
                                                <span className="text-data">{v == null || v === '' ? '—' : String(v)}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </>
                    )}

                </div>
            </div>
        </div>
    );
}

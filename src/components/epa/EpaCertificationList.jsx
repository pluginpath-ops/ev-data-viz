/**
 * The EPA Certifications an EPA test vehicle is in, one row each (#374).
 *
 * A test vehicle carried over across years is in several certifications —
 * one per Test Group, so one per model year — and each has its own Fuel
 * Economy Guide link, because the Guide is published by year. This lists them
 * oldest first, with what the certificate itself states (its Test Group, a
 * revision date shown as "Recertified") and how the row came to exist when no
 * CSI file stands behind it.
 *
 * A table to read, not a list to pick from, so rows do not react to hover —
 * the owner found that suggested an interaction that was not obvious. The row
 * the vehicle reads (the certification its year resolves to) is filled. A
 * curator gets an explicit button on every other row that aims the Guide
 * picker below at that certification, so each year can be linked in turn; the
 * row it is aimed at is outlined.
 */
import { certificationsOf } from '../../utils/epaCertifications';

/** What a certification's Basis says, when it is not a CSI file. */
const BASIS_NOTE = {
    csv:    'Test Car List, no CSI file',
    guide:  'From a Guide link, no CSI file',
    manual: 'Made by hand',
};

function notesFor(c, readLinkId) {
    const notes = [];
    if (c.linkId === readLinkId) notes.push('This vehicle');
    if (c.certificate_revision_date) notes.push(`Recertified ${c.certificate_revision_date}`);
    if (c.carryover_model_year != null && c.carryover_model_year !== c.model_year) {
        notes.push(`Carries over MY${c.carryover_model_year}`);
    }
    if (BASIS_NOTE[c.basis]) notes.push(BASIS_NOTE[c.basis]);
    return notes.join(' · ');
}

export default function EpaCertificationList({ testVehicle, canEdit = false, targetLinkId = null, onTarget }) {
    const certs = certificationsOf(testVehicle);
    if (!certs.length) return null;
    const readLinkId = testVehicle?._certification?.linkId ?? null;

    return (
        <div className="certification-list" role="table" aria-label="EPA Certifications">
            <div className={`certification-row is-header text-micro${canEdit ? ' has-action' : ''}`} role="row">
                <span>Year</span>
                <span>Test Group</span>
                <span />
                <span className="certification-guide">Guide</span>
                {canEdit && <span />}
            </div>
            {certs.map(c => {
                const aimed = targetLinkId === c.linkId;
                return (
                    <div
                        key={c.linkId}
                        role="row"
                        className={`certification-row${c.linkId === readLinkId ? ' is-read' : ''}`
                            + `${canEdit && aimed && c.linkId !== readLinkId ? ' is-targeted' : ''}${canEdit ? ' has-action' : ''}`}
                    >
                        <span className="font-mono">MY{c.model_year}</span>
                        <span className="font-mono truncate">{c.test_group}</span>
                        <span className="text-caption truncate">{notesFor(c, readLinkId)}</span>
                        <span className="certification-guide">
                            {c.fe_guide_row_id != null
                                ? <span className="badge-micro is-good">linked</span>
                                : c.fe_guide_skipped_at != null
                                    ? <span className="badge-micro" title={c.fe_guide_skip_note ?? undefined}>skipped</span>
                                    : <span className="text-caption">—</span>}
                        </span>
                        {canEdit && (
                            <span className="certification-guide">
                                {!aimed && (
                                    <button
                                        type="button"
                                        className="btn btn-secondary text-xs py-0.5 px-2"
                                        onClick={() => onTarget?.(c.linkId)}
                                        title={`Aim the Guide picker below at the MY${c.model_year} certification`}
                                    >
                                        {c.fe_guide_row_id != null ? 'Change' : 'Link'}
                                    </button>
                                )}
                            </span>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

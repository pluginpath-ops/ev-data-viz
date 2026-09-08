/**
 * The chips that describe one EPA certification record on a selector row.
 *
 * Its own file because the row it sits on is now the shared `RunSelector`'s,
 * and this is the only part of the row that is about certification rather than
 * about selection. EPA Curves and the record-anchored explorer both put the
 * same four facts beside a record — link confidence, the rated figure, the η
 * the curve runs on, and the pack the range axis divides by — and before this
 * they said them in two different shapes.
 *
 * Everything here is a `.badge-micro`: mono, one line, and an intent only where
 * a reading carries a caveat. The prose it replaces ran to three lines a row
 * ("η_eff: 93.1% · steady-state DC (65 mph)"), which in a 320px sidebar is a
 * paragraph per record and a name truncated to make room for it. The caveat now
 * lives in the badge's title, where it is read once by whoever wonders.
 */

/** How sure we are that this group is the car it is linked to. */
const CONFIDENCE_INTENT = { verified: 'is-good', likely: 'is-qualified' };

export function ConfidenceBadge({ confidence }) {
    return (
        <span
            className={`badge-micro ${CONFIDENCE_INTENT[confidence] ?? ''}`.trim()}
            title={`Link to this vehicle: ${confidence}`}
        >
            {confidence}
        </span>
    );
}

/**
 * Where the η came from, and whether that is this record's own measurement.
 * `corrected` and `estimated` are both borrowed — from the fleet median ratio
 * and from the default respectively — so both are qualified.
 */
const ETA_SOURCE = {
    measured: {
        short: 'steady-state DC',
        note: 'Back-solved from this record\'s own constant-speed phases, at the 65 mph J1634 specifies.',
    },
    corrected: {
        short: 'from Hwy DC',
        note: 'No constant-speed phase on this record, so its highway η was scaled to a cruise basis by the fleet median ratio — borrowed from other vehicles.',
        intent: 'is-qualified',
    },
    estimated: {
        short: 'default',
        note: 'Nothing on this record to back-solve η from, so the default is used. The curve\'s shape is still measured road load; its magnitude scales with this number.',
        intent: 'is-qualified',
    },
};

/** What the range axis divides by, and how sure that number is. */
const KWH_SOURCE = {
    EPA:   { short: 'EPA',   note: 'Useable capacity from this record\'s own filing.' },
    spec:  { short: 'spec',  note: 'Useable capacity from the vehicle\'s spec sheet.' },
    gross: { short: 'gross', note: 'No useable capacity on record — the guide\'s GROSS pack is used, so the range axis reads high.', intent: 'is-qualified' },
};

export default function EpaRecordMeta({ row }) {
    const { group, eta, useableKwh, useableKwhSource } = row;

    // Combined is the rated figure; a record certified on procedures 81 and 84
    // never ran a combined cycle and has only the highway one, which is a
    // different claim rather than the same claim measured differently.
    const combined = group.label_combined_mpge < 500 ? group.label_combined_mpge : null;
    const hwyOnly  = !combined && group.label_hwy_mpge < 500 ? group.label_hwy_mpge : null;

    const etaSource = ETA_SOURCE[eta?.source];
    // Correcting a highway η can land above 1, in which case the default is
    // substituted — the one state here that is a fault rather than a caveat.
    const etaBroken = eta?.flags?.includes('correction-nonphysical');
    const kwhSource = KWH_SOURCE[useableKwhSource];

    return (
        <>
            {/* The record's own coordinates, in the caption voice the
                certification browser uses for the same pair. */}
            <span className="text-caption truncate" title={group.test_group_id}>
                {group.model_year} · {group.test_group_id}
            </span>

            {(combined || hwyOnly) && (
                <span
                    className={`badge-micro ${hwyOnly ? 'is-qualified' : ''}`.trim()}
                    title={hwyOnly
                        ? 'Highway-only (procedure 84) — this record has no combined multi-cycle test'
                        : 'EPA rated combined efficiency'}
                >
                    {combined ?? hwyOnly} MPGe{hwyOnly ? ' hwy' : ''}
                </span>
            )}

            {eta?.value != null && (
                <span
                    className={`badge-micro ${etaBroken ? 'is-warning' : (etaSource?.intent ?? '')}`.trim()}
                    title={etaBroken
                        ? 'Correcting this record\'s highway η put it above 1, so the default is used instead'
                        : etaSource?.note}
                >
                    η {!eta.certain && '~'}{(eta.value * 100).toFixed(1)}% {etaBroken ? '⚠' : etaSource?.short}
                </span>
            )}

            {useableKwh != null && (
                <span className={`badge-micro ${kwhSource?.intent ?? ''}`.trim()} title={kwhSource?.note}>
                    {Number(useableKwh).toFixed(1)} kWh {kwhSource?.short}
                </span>
            )}
        </>
    );
}

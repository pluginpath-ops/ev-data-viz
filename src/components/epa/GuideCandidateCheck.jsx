/**
 * The EPA tab's verdict on a Guide row before it is linked — a badge beside
 * each suggested link, in the picker and the link sweep (#374).
 *
 * Same words as the tab ("matches EPA", "near EPA", "disagrees with EPA", and
 * an impossible label as its own badge), so a curator reads one scale before
 * and after linking. The figures go in the title: the badge is the verdict,
 * and a row of numbers per candidate would be a second table inside the first.
 */
import { useMemo } from 'react';
import { checkGuideCandidate } from '../../utils/guideCandidateCheck';
import { CHECK_STATUS_LABELS } from '../../utils/epaDerivationCheck';

const INTENT = { agrees: 'is-good', close: 'is-qualified', disagrees: 'is-danger', impossible: 'is-danger' };
const signed = (pct) => `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;

export default function GuideCandidateCheck({ testVehicle, row }) {
    const result = useMemo(() => checkGuideCandidate(testVehicle, row), [testVehicle, row]);
    if (!result) return null;
    const { mpge, invariant, verdict, reason } = result;

    if (verdict == null) {
        return <span className="badge-micro" title={reason ?? undefined}>unchecked</span>;
    }

    const worst = mpge?.checked
        ? mpge.cycles.reduce((a, c) => (Math.abs(c.deltaPct) > Math.abs(a.deltaPct) ? c : a))
        : null;
    const lines = [
        ...(mpge?.checked ? mpge.cycles.map(c => `${c.label}: ours ${c.ours.toFixed(1)} vs EPA ${c.epa.toFixed(1)} unadjusted MPGe (${signed(c.deltaPct)})`) : []),
        ...(invariant?.violated
            ? [`Impossible label: ${Math.round(invariant.labeledMi)} mi is above the ${Math.round(invariant.computedMi)} mi the lab work produces.`]
            : []),
        'The check the EPA tab runs after linking, run on this row first.',
    ];

    // Two badges, not one combined verdict: in the sweep over the 2026-10-08
    // backup, 4 of 52 rows with an impossible label still matched EPA's MPGe
    // within 1%, and folding the two together hid which half was wrong.
    const title = lines.join('\n');
    return (
        <>
            {mpge?.checked && (
                <span className={`badge-micro ${INTENT[mpge.worst]}`} title={title}>
                    {`${CHECK_STATUS_LABELS[mpge.worst]}${worst ? ` ${signed(worst.deltaPct)}` : ''}`}
                </span>
            )}
            {invariant?.violated && (
                <span className={`badge-micro ${INTENT.impossible}`} title={title}>impossible label</span>
            )}
        </>
    );
}

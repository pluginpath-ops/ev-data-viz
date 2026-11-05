/**
 * What stands behind one Guide row, in a line: its Tested via verdict and the
 * test vehicles it names (utils/guideTestedVia.js). Shared by the vehicle's
 * EPA Label, its candidates, and Admin → Data Checks.
 *
 * A blend shows the span of its members' figures, never a weighting: the
 * weights are sales mix and unpublished (owner, 2026-10-31). An untested row
 * shows the nearest tested trim as a suggestion — never linked on the numbers.
 */

const VERDICT = {
    exact:              { label: 'exact',       intent: 'is-good' },
    near:               { label: 'near',        intent: 'is-good' },
    blend:              { label: 'blend',       intent: '' },
    untested:           { label: 'untested',    intent: 'is-warning' },
    'no-lab-data':      { label: 'no lab data', intent: 'is-warning' },
    'no-guide-figures': { label: 'no figures',  intent: 'is-warning' },
};

const kwh = (v) => v.toFixed(2);
const pct = (v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
const span = ([lo, hi]) => (Math.abs(hi - lo) < 0.005 ? kwh(lo) : `${kwh(lo)}–${kwh(hi)}`);

export function TestedViaBadge({ via }) {
    const v = VERDICT[via?.verdict];
    if (!v) return null;
    return (
        <span className={`badge-micro ${v.intent}`} title="Tested via: which EPA test vehicles reproduce this EPA Label's unadjusted kWh/100mi">
            {v.label}
        </span>
    );
}

export default function TestedViaSummary({ via }) {
    if (!via) return <span className="text-meta">Tested via…</span>;
    const ids = (via.members ?? []).map(m => m.test_vehicle_id);
    return (
        <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
            <TestedViaBadge via={via} />
            {via.verdict === 'exact' || via.verdict === 'near' ? (
                <span>
                    Tested via <span className="font-mono">{ids[0]}</span>
                    {via.verdict === 'near' && ' — just past rounding'}
                    {via.ambiguous && via.alternatives?.length > 0 && (
                        <span className="text-meta"> · {via.alternatives.join(', ')} matches as well</span>
                    )}
                </span>
            ) : via.verdict === 'blend' ? (
                <span>
                    Between <span className="font-mono">{ids.join(', ')}</span>
                    {via.span && (
                        <span className="text-meta">
                            {' '}· city {span(via.span.city)}, highway {span(via.span.hwy)} kWh/100mi
                        </span>
                    )}
                </span>
            ) : via.verdict === 'untested' ? (
                <span>
                    No test vehicle reproduces it
                    {via.closest && (
                        <span className="text-meta">
                            {' '}· closest tested trim <span className="font-mono">{via.closest.test_vehicle_id}</span>
                            {' '}(city {pct(via.closest.cityShare)}, highway {pct(via.closest.hwyShare)}) — a suggestion, not linked
                        </span>
                    )}
                </span>
            ) : via.verdict === 'no-lab-data' ? (
                <span className="text-meta">Its certification has no lab data to check it against</span>
            ) : (
                <span className="text-meta">The Guide row has no unadjusted figures</span>
            )}
            {via.otherCarline && <span className="text-meta">· from another carline in the certification</span>}
        </span>
    );
}

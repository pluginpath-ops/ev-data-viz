/**
 * The routes a manufacturer can take to a label range, and which one each
 * vehicle on screen took (#206).
 *
 * One grid, two labelled rows, fixed-size cells — a table rather than a flow
 * chart, so the eye compares across a row instead of tracing connectors. The
 * unadjusted city+highway step is deliberately absent: it is the OUTPUT of the
 * first row, not a stage of its own, and drawing it added a box that explained
 * nothing.
 *
 * The 5-cycle cell spans BOTH rows. That is the whole statement about it — a
 * test that drove the conditions the others infer has no adjustment step, and
 * a cell reaching past the adjustment row says so without a caption. It
 * replaced a bypass rail that had to explain itself in words.
 *
 * The choice between paths is not neutral, which is what the effort line and
 * the regression's note are for: lab time is why the short path exists, and
 * the regression's treatment of efficient vehicles is why an efficient BEV
 * would decline the alternative to the flat factor.
 */
import InfoIcon from '../InfoIcon';
import { PATH_EFFORT, LABEL_ADJUSTMENT, LABEL_WEIGHT_CITY, LABEL_WEIGHT_HWY } from '../../constants/epa';
import { derived5CycleCrossoverFe } from '../../utils/epaMethodology';

const METHODS = [
    {
        key: 'mct',
        title: 'Multi-cycle (MCT)',
        detail: 'City and highway phases interleaved in one depletion run',
    },
    {
        key: 'sct',
        title: 'Single-cycle (SCT)',
        detail: 'Two depletion runs, one bag each',
    },
    {
        key: 'five_cycle',
        title: '5-cycle',
        detail: 'Adds high speed, cold weather and hot weather',
    },
];

export default function EpaCertificationPaths({ models = [] }) {
    const namesFor = (methodKey) => models
        .filter(m => m.testMethod === methodKey)
        .map(m => m.vehicleName)
        .filter(Boolean);

    const crossover = derived5CycleCrossoverFe('city');

    return (
        <div className="cert-paths">
            <div className="cert-grid">
                {/* Row 0 — who took which path */}
                <div />
                {METHODS.map(m => (
                    <div key={`chips-${m.key}`} className="cert-chips">
                        {namesFor(m.key).map(n => <span key={n} className="path-chip">{n}</span>)}
                    </div>
                ))}

                {/* Row 1 — the test */}
                <div className="cert-grid-label">Test cycle options</div>
                {METHODS.map(m => {
                    const taken = namesFor(m.key).length > 0;
                    return (
                        <div
                            key={m.key}
                            className={[
                                'cert-cell',
                                taken ? 'cert-cell-active' : '',
                                // 5-cycle reaches into the adjustment row because it
                                // has no adjustment step to take.
                                m.key === 'five_cycle' ? 'cert-cell-span' : '',
                            ].filter(Boolean).join(' ')}
                        >
                            <span className="font-semibold text-secondary">{m.title}</span>
                            <span className="text-xs text-muted">{m.detail}</span>
                            {m.key === 'five_cycle' && (
                                <span className="text-xs text-faint">
                                    No adjustment — these conditions were measured, not estimated
                                </span>
                            )}
                            <span className="cert-cell-effort">{PATH_EFFORT[m.key]} of lab time</span>
                        </div>
                    );
                })}

                {/* Row 2 — the adjustment MCT and SCT must take */}
                <div className="cert-grid-label">Adjustment</div>
                <div className="cert-cell">
                    <span className="font-semibold text-secondary">× {LABEL_ADJUSTMENT} fixed factor</span>
                    <span className="text-xs text-muted">
                        EPA-allowed value to replace 5-cycle testing
                    </span>
                </div>
                <div className="cert-cell">
                    <span className="font-semibold text-secondary">
                        Derived 5-cycle
                        <InfoIcon position="below" tooltipClassName="info-icon-tooltip--wide">
                            <span className="block font-semibold mb-1">How the regression works</span>
                            <span className="block mb-2">
                                1 / FE_adjusted = intercept + slope / FE_unadjusted, with the city
                                fit at 0.003259 + 1.1805 / FE.
                            </span>
                            <span className="block mb-2">
                                The intercept is a fixed cost in the INVERSE domain, so it does not
                                scale with efficiency. As FE rises, slope/FE shrinks and the
                                intercept dominates — capping adjusted economy near 307 MPGe city
                                however efficient the vehicle is. The flat factor has no such
                                ceiling, which is why the two cross.
                            </span>
                            <span className="block">
                                ⚠ The regression is fitted on gasoline vehicles and is not validated
                                against any EV certification record. This is what its published
                                equations do, not evidence of how they are applied to EVs — and by
                                the same token, how well the flat {LABEL_ADJUSTMENT} matches a real
                                5-cycle EV result is itself untested.
                            </span>
                        </InfoIcon>
                    </span>
                    <span className="text-xs text-muted">
                        EPA mathematical regression to estimate 5-cycle — returns a worse result
                        than × {LABEL_ADJUSTMENT} once a vehicle is above ~{crossover.toFixed(0)} MPGe
                        unadjusted city
                    </span>
                </div>
            </div>

            <div className="cert-result">
                <div className="cert-cell cert-cell-result">
                    <span className="font-semibold text-secondary">Combined label range</span>
                    <span className="text-xs text-muted">
                        {LABEL_WEIGHT_CITY} city + {LABEL_WEIGHT_HWY} highway
                    </span>
                </div>
            </div>
        </div>
    );
}

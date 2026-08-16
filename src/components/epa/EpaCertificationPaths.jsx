/**
 * The routes a manufacturer can take to a label range, and which one each
 * vehicle on screen took (#206).
 *
 * Laid out as a table rather than a flow chart: two labelled rows with
 * fixed-height cells, so the columns line up and the eye can compare across a
 * row instead of following connectors around. The unadjusted city+highway step
 * is deliberately absent — it is the OUTPUT of the row above, not a stage of
 * its own, and drawing it added a box that explained nothing.
 *
 * The choice between paths is not neutral, which is the point of the effort
 * column and the note under the regression: lab time is the reason the short
 * path exists, and the regression's treatment of efficient vehicles is the
 * reason an efficient BEV would decline the alternative.
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

/** Vehicles that took this path, as chips above it. */
function TakenBy({ names }) {
    return (
        <div className="path-taken">
            {names.map(n => <span key={n} className="path-chip">{n}</span>)}
        </div>
    );
}

export default function EpaCertificationPaths({ models = [] }) {
    const namesFor = (methodKey) => models
        .filter(m => m.testMethod === methodKey)
        .map(m => m.vehicleName)
        .filter(Boolean);

    const crossover = derived5CycleCrossoverFe('city');

    return (
        <div className="cert-paths">
            {/* ── Row 1: which test was run ─────────────────────────────── */}
            <div className="cert-row">
                <div className="cert-row-label">Test cycle options</div>
                <div className="cert-row-cells cert-row-cells-3">
                    {METHODS.map(m => {
                        const names = namesFor(m.key);
                        return (
                            <div key={m.key} className="cert-cell-stack">
                                <TakenBy names={names} />
                                <div className={`cert-cell ${names.length ? 'cert-cell-active' : ''}`}>
                                    <span className="font-semibold text-secondary">{m.title}</span>
                                    <span className="text-xs text-muted">{m.detail}</span>
                                    <span className="cert-cell-effort">{PATH_EFFORT[m.key]} of lab time</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* ── Row 2: how the result is adjusted ──────────────────────────
                MCT and SCT each reach both adjustment methods; a 5-cycle test
                already drove the conditions the others infer, so it bypasses
                this row entirely — the rail down the right-hand side. */}
            <div className="cert-row cert-row-adjust">
                <div className="cert-row-label">Adjustment</div>
                <div className="cert-row-cells cert-row-cells-2">
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
                                    1 / FE_adjusted = intercept + slope / FE_unadjusted, with the
                                    city fit at 0.003259 + 1.1805 / FE.
                                </span>
                                <span className="block mb-2">
                                    The intercept is a fixed cost in the INVERSE domain, so it does
                                    not scale with efficiency. As FE rises, slope/FE shrinks and the
                                    intercept dominates — capping adjusted economy near 307 MPGe
                                    city however efficient the vehicle is. The flat factor has no
                                    such ceiling, which is why the two cross.
                                </span>
                                <span className="block">
                                    ⚠ The regression is fitted on gasoline vehicles and is not
                                    validated against any EV certification record. This is what its
                                    published equations do, not evidence of how they are applied to
                                    EVs — and by the same token, how well the flat 0.7 matches a
                                    real 5-cycle EV result is itself untested.
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

                {/* The 5-cycle lane, running past the adjustment row */}
                <div className="cert-bypass" aria-hidden="true">
                    <span className="cert-bypass-note">5-cycle skips this row</span>
                </div>
            </div>

            {/* ── The answer ─────────────────────────────────────────────── */}
            <div className="cert-row cert-row-result">
                <div className="cert-row-label" />
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

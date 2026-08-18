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
 * The 5-cycle column is NOT a third way to measure range. That was the earlier
 * reading and it is wrong: the R2 ran the multi-cycle test AND the other three
 * cycles. Its range comes from the depletion run like everyone else's, and the
 * three extra cycles produce the FACTOR that scales it — per 40 CFR 600.116-12,
 * "testing to generate a 5-cycle adjustment factor".
 *
 * So the column carries an addition on the top row (three more cycles, run on
 * top of either test beside it) and its product on the second (a measured
 * factor, beside the two estimated ones). Both rows now hold three cells, which
 * is the layout saying the same thing: every path takes an adjustment, and they
 * differ only in where the number came from.
 *
 * The choice between paths is not neutral, which is what the effort line and
 * the regression's note are for: lab time is why the short path exists, and
 * the regression's treatment of efficient vehicles is why an efficient BEV
 * would decline the alternative to the flat factor.
 */
import InfoIcon from '../InfoIcon';

/**
 * A real measured factor, named so the contrast with 0.700 is concrete rather
 * than abstract. From EPA's MY27 Fuel Economy Guide for the R2 20" AT, and it
 * reproduces that configuration's published city, highway and combined ranges
 * exactly — see epaMethodologyFixtures.
 */
const R2_EXAMPLE_FACTOR = 0.7051;
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
        // Additive, not alternative — hence the leading "+". These are run in
        // ADDITION to the MCT or SCT beside them, never instead of one.
        key: 'five_cycle',
        title: '+ 3 more cycles',
        detail: 'US06, SC03 and cold FTP, on top of either test',
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
                            className={['cert-cell', taken ? 'cert-cell-active' : '']
                                .filter(Boolean).join(' ')}
                        >
                            <span className="font-semibold text-secondary">{m.title}</span>
                            <span className="text-xs text-muted">{m.detail}</span>
                            <span className="cert-cell-effort">{PATH_EFFORT[m.key]} of lab time</span>
                        </div>
                    );
                })}

                {/* Row 2 — every path takes an adjustment. They differ only in
                    where the number came from: assumed, regressed, or measured. */}
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
                <div className="cert-cell">
                    <span className="font-semibold text-secondary">Measured 5-cycle factor</span>
                    <span className="text-xs text-muted">
                        Generated from the three cycles above rather than assumed — per vehicle,
                        and the only route that measures the conditions instead of pricing them.
                        The R2 20&quot; is {R2_EXAMPLE_FACTOR}, not {LABEL_ADJUSTMENT}.
                    </span>
                    <span className="text-xs text-faint">
                        Requires EPA approval to use SAE J1634 App B/C (40 CFR 600.116-12)
                    </span>
                </div>

                {/* Inside the grid, spanning the three method columns — the
                    result of all of them, so it should sit under all of them. */}
                <div />
                <div className="cert-cell cert-cell-result">
                    <span className="font-semibold text-secondary">Combined label range</span>
                    <span className="text-xs text-muted">
                        {LABEL_WEIGHT_CITY} city + {LABEL_WEIGHT_HWY} highway
                    </span>
                </div>
            </div>

            <p className="text-xs text-faint mt-3">
                Lab times are approximate and <strong>per configuration</strong>, not per model —
                certification is keyed to a test group and vehicle configuration, so a model line
                with several packs, drive layouts and wheel sizes multiplies every figure above.
            </p>
        </div>
    );
}

/**
 * The routes a manufacturer can take to a label range, and which one each
 * vehicle on screen took (#206).
 *
 * Three test methods feed two adjustment methods, and the choice is not
 * arbitrary — it trades lab time against how the adjustment treats you. The
 * effort column is why anyone picks the short path; the note under the
 * regression is why an efficient EV in particular does.
 */
import { PATH_EFFORT, LABEL_ADJUSTMENT, LABEL_WEIGHT_CITY, LABEL_WEIGHT_HWY } from '../../constants/epa';
import { derived5CycleCrossoverFe } from '../../utils/epaMethodology';

const METHODS = [
    {
        key: 'mct',
        title: 'Multi-cycle (MCT)',
        detail: 'City and highway phases interleaved in one depletion run',
        adjusts: true,
    },
    {
        key: 'sct',
        title: 'Single-cycle (SCT)',
        detail: 'Two depletion runs, one bag each',
        adjusts: true,
    },
    {
        key: 'five_cycle',
        title: '5-cycle depletion',
        detail: 'Adds US06, SC03 and cold FTP — the conditions the factor stands in for',
        adjusts: false,
    },
];

/** Vehicles that took this path, as chips above it. */
function TakenBy({ names }) {
    if (!names.length) return <div className="path-taken-empty" aria-hidden="true" />;
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
            <div className="cert-paths-methods">
                {METHODS.map(m => (
                    <div key={m.key} className="cert-path-col">
                        <TakenBy names={namesFor(m.key)} />
                        <div className={`cert-path-card ${namesFor(m.key).length ? 'cert-path-card-active' : ''}`}>
                            <span className="font-semibold text-secondary">{m.title}</span>
                            <span className="text-xs text-muted">{m.detail}</span>
                            <span className="cert-path-effort">{PATH_EFFORT[m.key]} of lab time</span>
                        </div>
                    </div>
                ))}
            </div>

            <div className="cert-paths-merge" aria-hidden="true" />

            <div className="cert-path-card cert-path-card-wide">
                <span className="font-semibold text-secondary">Unadjusted city + highway</span>
                <span className="text-xs text-muted">
                    A 5-cycle test needs no adjustment — it drove the conditions the others infer
                </span>
            </div>

            <div className="cert-paths-adjust">
                <div className="cert-path-card">
                    <span className="font-semibold text-secondary">× {LABEL_ADJUSTMENT} fixed factor</span>
                    <span className="text-xs text-muted">
                        One number for every vehicle, whatever it is
                    </span>
                </div>
                <div className="cert-path-card">
                    <span className="font-semibold text-secondary">Derived 5-cycle</span>
                    <span className="text-xs text-muted">
                        Regression on the unadjusted result
                    </span>
                    {/* The reason the choice is not neutral. Computed rather than
                        asserted — see adjustmentComparison() for the mechanism. */}
                    <span className="cert-path-warn">
                        Harsher above ~{crossover.toFixed(0)} MPGe unadjusted city, and the gap widens
                        with efficiency — its fixed intercept caps adjusted economy no matter how
                        efficient the vehicle is.
                    </span>
                </div>
            </div>

            <div className="cert-paths-merge" aria-hidden="true" />

            <div className="cert-path-card cert-path-card-wide cert-path-card-result">
                <span className="font-semibold text-secondary">Combined label range</span>
                <span className="text-xs text-muted">
                    {LABEL_WEIGHT_CITY} city + {LABEL_WEIGHT_HWY} highway
                </span>
            </div>

            <p className="text-xs text-faint mt-3">
                The regression is fitted on gasoline vehicles and is not validated against any EV
                certification record — the comparison above is what its published equations do, not
                evidence of how they are applied.
            </p>
        </div>
    );
}

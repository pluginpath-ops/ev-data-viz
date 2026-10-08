import { useState, useCallback } from 'react';
import { useAppContext } from '../../../context/AppContext';
import { useAsyncResource } from '../../../hooks/useAsyncResource';
import DerivedValues from '../DerivedValues';
import InfoIcon from '../../InfoIcon';
import { EPA_EXPLAINERS } from '../../../utils/epaExplainers';
import { certificationTests, certificationCoefficients, linkedVehicleLinks } from '../../../utils/guideCertification';

const fmt = (v, digits = 2) => (v == null ? '—' : Number(v).toFixed(digits));

/**
 * The CSI lab results behind a guide row's label (#337).
 *
 * One block per test vehicle a curator has linked to the row. A test vehicle is
 * certified once and rated per configuration, so the block says how many
 * configurations share it — the lab result is not specific to this one.
 *
 * Read-only: editing stays in Tests & Data, and so does everything that needs a
 * vehicle, so the modal links there rather than reproducing it.
 */
export default function GuideCertificationResults({ testVehicleIds, vehicles, configCount }) {
    const { getEpaTestVehicleFull } = useAppContext();
    const idsKey = testVehicleIds.join('|');

    const load = useCallback(
        () => Promise.all(testVehicleIds.map(id => getEpaTestVehicleFull(id))),
        // idsKey stands for testVehicleIds, which is a new array on every render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [getEpaTestVehicleFull, idsKey],
    );
    const { data: testVehicles, loading, error } = useAsyncResource(load, [idsKey]);

    if (testVehicleIds.length === 0) {
        return (
            <div className="text-note">
                No certification results linked. A curator links a test vehicle to a guide
                row, and most rows have none yet — the label figures above are EPA’s own.
            </div>
        );
    }
    if (error) return <div className="text-note">The certification results could not be loaded.</div>;
    if (loading || !testVehicles) return <div className="text-note">Loading…</div>;

    const links = linkedVehicleLinks(vehicles);

    return (
        <div className="guide-certification">
            {testVehicles.filter(Boolean).map(testVehicle => (
                <TestVehicleResults key={testVehicle.test_vehicle_id} testVehicle={testVehicle} configCount={configCount} />
            ))}
            {links.length > 0 && (
                <div className="text-note">
                    On Tests &amp; Data → EPA:{' '}
                    {links.map((l, i) => (
                        <span key={l.id}>{i > 0 && ', '}<a href={l.href}>{l.label}</a></span>
                    ))}
                </div>
            )}
        </div>
    );
}

function TestVehicleResults({ testVehicle, configCount }) {
    const tests = certificationTests(testVehicle);
    const coefficients = certificationCoefficients(testVehicle);

    return (
        <div className="guide-certification-test-vehicle">
            <div className="text-label">
                Test vehicle {testVehicle.test_vehicle_id}
                {testVehicle.epa_carline_name && ` · ${testVehicle.epa_carline_name}`}
                {testVehicle.model_year && ` · MY${testVehicle.model_year}`}
            </div>
            {configCount > 1 && (
                <div className="text-note">
                    Certified with {configCount} configurations — the lab result is shared, so it
                    does not describe this one alone.
                </div>
            )}

            {tests.length === 0 ? (
                <div className="text-note">No tests imported for this testVehicle.</div>
            ) : (
                <div className="epa-phase-table">
                    <table>
                        <thead>
                            <tr><th>Test</th><th>Date</th><th>Procedure</th><th className="is-numeric">DC energy (kWh)</th><th /></tr>
                        </thead>
                        <tbody>
                            {tests.map(t => <TestRows key={t.id} test={t} />)}
                        </tbody>
                    </table>
                </div>
            )}

            {coefficients.length > 0 && (
                <div className="epa-phase-table">
                    <table>
                        <thead>
                            <tr>
                                <th />
                                <th colSpan={3} className="coeff-group-head">Target (used)</th>
                                <th colSpan={3} className="coeff-group-head">Set (dyno)</th>
                                <th />
                            </tr>
                            <tr>
                                <th>Road load</th>
                                <th className="is-numeric">A</th><th className="is-numeric">B</th><th className="is-numeric">C</th>
                                <th className="is-numeric">A</th><th className="is-numeric">B</th><th className="is-numeric">C</th>
                                <th className="is-numeric">Weight (lb)</th>
                            </tr>
                        </thead>
                        <tbody>
                            {coefficients.map(c => (
                                <tr key={c.id ?? c.category}>
                                    <td>{c.category ?? '—'}{c.primary && ' (primary)'}</td>
                                    {c.target.map((v, i) => (
                                        <td key={`t${i}`} className={`is-numeric ${c.used === 'target' ? 'coeff-used' : 'coeff-unused'}`}>{fmt(v, 4)}</td>
                                    ))}
                                    {c.set.map((v, i) => (
                                        <td key={`s${i}`} className={`is-numeric ${c.used === 'set' ? 'coeff-used' : 'coeff-unused'}`}>{fmt(v, 4)}</td>
                                    ))}
                                    <td className="is-numeric">{fmt(c.weightLbs, 0)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <div className="text-note">
                        Highlighted is the set the curves and derived values use. The set
                        coefficients are the dynamometer’s programming, not the road load.
                        {' '}<InfoIcon text={EPA_EXPLAINERS.targetVsSet} />
                    </div>
                </div>
            )}

            <DerivedValues testVehicle={testVehicle} />
        </div>
    );
}

function TestRows({ test }) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <tr>
                <td>{test.number ?? '—'}</td>
                <td>{test.date ?? '—'}</td>
                <td>
                    {test.procedure}
                    {test.isEpaTested && ' · EPA tested'}
                </td>
                <td className="is-numeric">{fmt(test.dcKwh)}</td>
                <td className="is-numeric">
                    {test.phases.length > 0 && (
                        <button type="button" className="section-action" onClick={() => setOpen(o => !o)}>
                            {open ? 'Hide' : 'Show'} {test.phases.length} phases
                        </button>
                    )}
                </td>
            </tr>
            {open && test.phases.map(p => (
                <tr key={p.index}>
                    <td />
                    <td>Phase {p.index}</td>
                    <td>{p.type ?? '—'}{p.distanceMi != null && ` · ${fmt(p.distanceMi)} mi`}</td>
                    <td className="is-numeric">{fmt(p.dcKwh)}</td>
                    <td />
                </tr>
            ))}
        </>
    );
}

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
 * One block per test group a curator has linked to the row. A test group is
 * certified once and rated per configuration, so the block says how many
 * configurations share it — the lab result is not specific to this one.
 *
 * Read-only: editing stays in Tests & Data, and so does everything that needs a
 * vehicle, so the modal links there rather than reproducing it.
 */
export default function GuideCertificationResults({ testGroupIds, vehicles, configCount }) {
    const { getEpaTestGroupFull } = useAppContext();
    const idsKey = testGroupIds.join('|');

    const load = useCallback(
        () => Promise.all(testGroupIds.map(id => getEpaTestGroupFull(id))),
        // idsKey stands for testGroupIds, which is a new array on every render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [getEpaTestGroupFull, idsKey],
    );
    const { data: groups, loading, error } = useAsyncResource(load, [idsKey]);

    if (testGroupIds.length === 0) {
        return (
            <div className="text-note">
                No certification results linked. A curator links a test group to a guide
                row, and most rows have none yet — the label figures above are EPA’s own.
            </div>
        );
    }
    if (error) return <div className="text-note">The certification results could not be loaded.</div>;
    if (loading || !groups) return <div className="text-note">Loading…</div>;

    const links = linkedVehicleLinks(vehicles);

    return (
        <div className="guide-certification">
            {groups.filter(Boolean).map(group => (
                <CertificationGroup key={group.test_group_id} group={group} configCount={configCount} />
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

function CertificationGroup({ group, configCount }) {
    const tests = certificationTests(group);
    const coefficients = certificationCoefficients(group);

    return (
        <div className="guide-certification-group">
            <div className="text-label">
                Test group {group.test_group_id}
                {group.epa_carline_name && ` · ${group.epa_carline_name}`}
                {group.model_year && ` · MY${group.model_year}`}
            </div>
            {configCount > 1 && (
                <div className="text-note">
                    Certified with {configCount} configurations — the lab result is shared, so it
                    does not describe this one alone.
                </div>
            )}

            {tests.length === 0 ? (
                <div className="text-note">No tests imported for this group.</div>
            ) : (
                <div className="epa-phase-table">
                    <table>
                        <thead>
                            <tr><th>Test</th><th>Date</th><th>Procedure</th><th>DC energy (kWh)</th><th /></tr>
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
                                <th>A</th><th>B</th><th>C</th>
                                <th>A</th><th>B</th><th>C</th>
                                <th>Weight (lb)</th>
                            </tr>
                        </thead>
                        <tbody>
                            {coefficients.map(c => (
                                <tr key={c.id ?? c.category}>
                                    <td>{c.category ?? '—'}{c.primary && ' (primary)'}</td>
                                    {c.target.map((v, i) => (
                                        <td key={`t${i}`} className={c.used === 'target' ? 'coeff-used' : 'coeff-unused'}>{fmt(v, 4)}</td>
                                    ))}
                                    {c.set.map((v, i) => (
                                        <td key={`s${i}`} className={c.used === 'set' ? 'coeff-used' : 'coeff-unused'}>{fmt(v, 4)}</td>
                                    ))}
                                    <td>{fmt(c.weightLbs, 0)}</td>
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

            <DerivedValues group={group} />
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
                <td>{fmt(test.dcKwh)}</td>
                <td>
                    {test.phases.length > 0 && (
                        <button type="button" className="row-toggle" onClick={() => setOpen(o => !o)}>
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
                    <td>{fmt(p.dcKwh)}</td>
                    <td />
                </tr>
            ))}
        </>
    );
}

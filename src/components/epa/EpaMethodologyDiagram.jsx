/**
 * Where the EPA label range came from, drawn (#206).
 *
 * A pure template over a model built by utils/epaMethodology.js — every box
 * here is a number decided there, nothing is computed at render time. That is
 * deliberate: the diagram's whole claim is that these figures are traceable, so
 * it must not be a place where new arithmetic quietly appears.
 *
 * It reads top to bottom as the label is actually produced, two columns because
 * the label is two cycles blended:
 *
 *     cycle → consumption → unadjusted range → ×0.7 → 55/45 blend → label
 *
 * The shape carries the argument. City range sits well above highway, the blend
 * leans city, so the sticker is mostly a city number — and neither cycle was
 * driven anywhere near highway speed.
 */
import { useState } from 'react';
import { CHECK_STATUS_LABELS, CHECK_SHAPE_ADVICE } from '../../utils/epaDerivationCheck';

const mi   = (v) => v == null ? '—' : `${v.toFixed(1)} mi`;
const whmi = (v) => v == null ? '—' : `${v.toFixed(1)} Wh/mi`;
const pct  = (v) => v == null ? '—' : `${v.toFixed(2)}%`;

const METHOD_LABEL = {
    mct: 'Multi-Cycle Test — one depletion run, cycles interleaved',
    sct: 'Single-Cycle Tests — two separate depletion runs',
};

/** One value in the flow: a number, what it is, and where it came from. */
function Box({ label, value, note, tone = 'plain', ghost = null }) {
    return (
        <div className={`epa-flow-box epa-flow-box-${tone}`}>
            <span className="text-label">{label}</span>
            <span className="epa-flow-value">{value}</span>
            {/* The flat-0.700 counterfactual, drawn beside the real figure rather
                than instead of it. Rendered only when the two differ, which is
                why the common case stays uncluttered: 57% of configurations are
                published at exactly 0.700 and the ghost never appears. */}
            {ghost && <span className="epa-flow-ghost">{ghost}</span>}
            {note && <span className="text-xs text-faint">{note}</span>}
        </div>
    );
}

function Arrow({ annotation }) {
    return (
        <div className="epa-flow-arrow" aria-hidden="true">
            <span className="epa-flow-arrow-line" />
            {annotation && <span className="epa-flow-arrow-note">{annotation}</span>}
        </div>
    );
}

export default function EpaMethodologyDiagram({ model, check = null }) {
    const [showDetail, setShowDetail] = useState(false);
    if (!model) return null;

    const { cycles, weights, adjustment, cycleSpeeds, combinedMi, combinedMpge,
            labeledMi, deratePct, chargeEfficiency, testMethod, phases, runs,
            adjustmentSource, adjustmentFixed, adjustmentDeclared,
            combinedFixedMi, combinedHarmMi, blendAgreeing } = model;

    // Whether this vehicle's real factor differs from the flat shortcut at all.
    // Everything counterfactual below hangs off this, so a 0.700 vehicle renders
    // exactly as it did before.
    const showsFixed = adjustmentSource === 'guide'
        && Math.abs(adjustment - adjustmentFixed) > 1e-6;

    const basisNote = testMethod === 'sct'
        ? 'measured — driven to depletion'
        : 'computed — total energy ÷ consumption';

    return (
        <div className="epa-methodology">
            <p className="text-sm text-muted mb-4">{METHOD_LABEL[testMethod]}</p>

            <div className="epa-flow-columns">
                {[
                    // Both names, every time. A certification record labels these
                    // phases UDDS and HWY; the window sticker calls the same
                    // driving FTP-75 city and HWFET highway. Showing one and not
                    // the other is how the two vocabularies stay disconnected.
                    ['city', 'City', 'UDDS phases · FTP-75 city trace'],
                    ['hwy',  'Highway', 'HWY phases · HWFET trace'],
                ].map(([key, title, cycleName]) => (
                    <div key={key} className="epa-flow-column">
                        <div className="epa-flow-head">
                            <span className="font-semibold text-secondary">{title}</span>
                            {/* The single most useful fact on the page for anyone
                                who ran their own test at 70 mph. */}
                            <span className="text-xs text-faint">
                                {cycleName} · {cycleSpeeds[key]} mph avg
                            </span>
                        </div>

                        <Box label="Consumption" value={whmi(cycles[key].whPerMi)} />
                        <Arrow />
                        <Box label="Range" value={mi(cycles[key].rangeUnadjMi)} note={basisNote} />
                        <Arrow annotation={showsFixed
                            ? `× ${adjustment.toFixed(4)} (this vehicle)`
                            : `× ${adjustment}`} />
                        <Box
                            label="Adjusted range"
                            value={mi(cycles[key].rangeAdjMi)}
                            ghost={showsFixed
                                ? `${mi(cycles[key].rangeAdjFixedMi)} at the flat ${adjustmentFixed}`
                                : null}
                            note="stands in for untested conditions"
                            tone="strong"
                        />
                        <span className="epa-flow-weight">
                            {Math.round(weights[key] * 100)}% of the label
                        </span>
                    </div>
                ))}
            </div>

            <div className="epa-flow-merge" aria-hidden="true" />

            <div className="epa-flow-result">
                <Box
                    label="Computed combined"
                    value={mi(blendAgreeing === 'harmonic' ? combinedHarmMi : combinedMi)}
                    ghost={showsFixed ? `${mi(combinedFixedMi)} at the flat ${adjustmentFixed}` : null}
                    // Which blend, stated rather than assumed. Arithmetic
                    // reproduces EPA's published combined on 72% of the rows
                    // where the two differ and harmonic on the rest, and nothing
                    // in a record says which a configuration uses.
                    //
                    // 'neither' is NOT reported as a discrepancy. A maker may
                    // label below the computed range and most do, so neither
                    // blend lands on a derated label — saying so here read as a
                    // fault in the derivation when it is the derate, which the
                    // next arrow already states as a percentage.
                    note={`${Math.round(weights.city * 100)}/${Math.round(weights.hwy * 100)} blend, ${
                        blendAgreeing === 'harmonic' ? 'harmonic' : 'arithmetic'}`}
                    tone="strong"
                />
                <Arrow annotation={deratePct != null ? `− ${pct(deratePct)}` : null} />
                <Box
                    label="Labeled range"
                    value={mi(labeledMi)}
                    note="a maker may label at or below the computed value, never above"
                    tone="label"
                />
            </div>

            {/* The point of the whole diagram, said once, in the one place a
                reader is already looking at every number it refers to.
                Deliberately NOT "compare your test to the highway column" — the
                adjusted highway figure is not a 70 mph range either, and
                offering it as the fair comparison would swap one wrong
                benchmark for another. */}
            <p className="epa-methodology-callout">
                An independent highway test should not be compared against any range above —
                city or highway, adjusted or unadjusted. These come from variable-speed cycles
                averaging <strong>{cycleSpeeds.city} mph</strong> and{' '}
                <strong>{cycleSpeeds.hwy} mph</strong>, then adjusted downward to stand in for
                conditions that were never driven: sustained high speed and hard acceleration,
                air conditioning in hot weather, and cold-weather operation.
            </p>

            <div className="epa-methodology-footer">
                <span>
                    Combined MPGe{' '}
                    <strong className="text-secondary">
                        {combinedMpge == null ? '—' : combinedMpge.toFixed(1)}
                    </strong>{' '}
                    {/* MPGe is wall-to-wheels. A DC-basis record has had the
                        charging loss added back to get there, and whether that
                        loss was measured or assumed changes how much to trust
                        the figure — so the diagram says which. */}
                    <span className="text-faint">
                        (harmonic
                        {cycles.city.energyBasis === 'dc' &&
                            (chargeEfficiency.measured
                                ? ', AC basis from measured charging loss'
                                : ', AC basis from assumed charging loss')}
                        )
                    </span>
                </span>
                <span>
                    Charging efficiency{' '}
                    <strong className="text-secondary">
                        {chargeEfficiency.value == null ? '—' : `${(chargeEfficiency.value * 100).toFixed(1)}%`}
                    </strong>{' '}
                    <span className="text-faint">
                        {chargeEfficiency.measured
                            ? '(measured — AC and DC both reported)'
                            : '(not reported for this test method)'}
                    </span>
                </span>
            </div>

            {/* Our derivation against EPA's own published unadjusted figures.
                Shown for every configuration with a linked guide row, because
                until now the chain was verified against exactly one vehicle by
                hand — and two groups for the same car currently derive charging
                efficiencies 7 points apart, so at least one reading in the fleet
                is wrong and nothing said which.

                The UNADJUSTED figure is the one compared: the adjusted value
                embeds the adjustment factor, so a wrong factor and a wrong
                efficiency could cancel and pass. */}
            {check?.checked && (
                <div className={`epa-check epa-check-${check.worst}`}>
                    <span className="text-label">
                        Unadjusted MPGe vs EPA
                        <span className="epa-check-verdict">{CHECK_STATUS_LABELS[check.worst]}</span>
                    </span>
                    {check.cycles.map(c => (
                        <span key={c.cycle} className="epa-check-row">
                            {c.label}
                            <strong className="text-secondary">{c.ours.toFixed(1)}</strong>
                            <span className="text-faint">vs {c.epa.toFixed(1)}</span>
                            <span className="epa-check-delta">
                                {c.deltaPct >= 0 ? '+' : ''}{c.deltaPct.toFixed(2)}%
                            </span>
                        </span>
                    ))}
                    <span className="text-xs text-faint">
                        {check.worst === 'agrees'
                            ? 'The derivation reproduces EPA\u2019s published figures.'
                            : (CHECK_SHAPE_ADVICE[check.shape]
                                ?? 'Outside rounding, and the two cycles do not agree on how.')}
                    </span>
                </div>
            )}

            <button
                type="button"
                onClick={() => setShowDetail(v => !v)}
                className="chart-info-toggle mt-3"
            >
                <span style={{ display: 'inline-block', transform: showDetail ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>▼</span>
                {testMethod === 'mct' ? 'Test phases' : 'Depletion runs'}
            </button>

            {showDetail && (
                <div className="epa-phase-table">
                    {testMethod === 'mct' ? (
                        <table>
                            <thead>
                                <tr><th>Phase</th><th>Cycle</th><th>Consumption</th></tr>
                            </thead>
                            <tbody>
                                {(phases ?? []).map(p => (
                                    <tr key={p.index}>
                                        <td>{p.index}</td>
                                        <td>
                                            {p.cycle}
                                            {/* The cold bag is why city consumption is
                                                energy-share weighted rather than averaged. */}
                                            {p.wh != null && p.cycle === 'UDDS' && (
                                                <span className="text-faint"> · cold start</span>
                                            )}
                                        </td>
                                        <td className="font-mono">{whmi(p.whPerMi)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : (
                        <table>
                            <thead>
                                <tr><th>Procedure</th><th>Cycle</th><th>Recharge</th><th>Distance</th></tr>
                            </thead>
                            <tbody>
                                {(runs ?? []).map(r => (
                                    <tr key={r.procedureCode}>
                                        <td>{r.procedureCode}</td>
                                        <td>{r.cycle}</td>
                                        <td className="font-mono">{(r.rechargeWh / 1000).toFixed(3)} kWh</td>
                                        <td className="font-mono">{r.rangeMi.toFixed(3)} mi</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                    {testMethod === 'sct' && (
                        <p className="text-xs text-faint mt-2">
                            Recharge energy is frequently replicated verbatim across an SCT pair.
                            Matching values are not independent corroboration.
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}

/**
 * Section 8 — read-only derived values, computed live from the curator model
 * via epaDerivations.deriveAll(). Each shows its value, a provenance badge
 * (measured / assumed / estimated / manual), and a ⚠ when a sanity-band flag
 * fires. Per-derivation provenance: η can be measured while charger eff is
 * assumed on the same record.
 */
import { deriveAll, SS_CYCLE_SPEED_MPH } from '../../utils/epaDerivations';
import { resolveUseableKwh, resolveUseableKwhSource } from '../../utils/epaPhysics';
import { SOC_WINDOW_BASIS } from '../../utils/vehicleFigures';
import InfoIcon from '../InfoIcon';
import { EPA_EXPLAINERS } from '../../utils/epaExplainers';

const SOURCE_LABEL = {
    measured:            { text: 'measured',  cls: 'status-text is-good' },
    'measured-fallback': { text: 'measured (proc 84)', cls: 'status-text is-good' },
    assumed:             { text: 'assumed',   cls: 'status-text is-warning' },
    estimated:           { text: 'estimated', cls: 'status-text is-warning' },
    manual:              { text: 'manual',    cls: 'status-text is-info' },
    computed:            { text: 'computed',  cls: 'status-text is-good' },
    // Amber, with the others that are not this vehicle's own measurement. A
    // corrected η is a real highway measurement scaled by a fleet constant —
    // better than the highway figure for a cruise curve, and still borrowed.
    corrected:           { text: 'corrected', cls: 'status-text is-warning' },
};

function DerivedRow({ label, tooltip, result, format }) {
    const { value, source, certain, flags = [] } = result || {};
    const meta = SOURCE_LABEL[source] || { text: source || '—', cls: 'text-meta' };
    return (
        <div className="flex items-center justify-between gap-2 py-0.5">
            <span className="text-secondary flex items-center gap-1">
                {label}
                {tooltip && <InfoIcon text={tooltip} />}
            </span>
            <span className="flex items-center gap-1.5">
                <span className="font-mono">
                    {value == null ? '—' : `${!certain ? '~' : ''}${format(value)}`}
                </span>
                {source && <span className={`text-[10px] ${meta.cls}`}>{meta.text}</span>}
                {flags.length > 0 && value != null && (
                    <span title={flags.join(', ')} className="status-text is-warning text-xs">⚠</span>
                )}
            </span>
        </div>
    );
}

export default function DerivedValues({ testVehicle, vehicle = null }) {
    const d = deriveAll(testVehicle);
    return (
        <div>
            <div className="text-meta text-[10px] uppercase tracking-wide mb-1 font-semibold">
                Derived Values
            </div>
            <DerivedRow
                label="Drivetrain η (HWFET)" tooltip={EPA_EXPLAINERS.hwfetCalibration}
                result={d.eta} format={v => `${(v * 100).toFixed(1)}%`}
            />
            {/* The second opinion, shown only when the phases support one.
                It is not a correction of the row above — the two measure the
                same quantity at different operating points, and the gap between
                them is what the HWFET figure absorbs from a transient cycle.
                THIS is the one the speed curves run on. The row above remains
                what the sanity band and the corpus statistics measure, which is
                why both are shown rather than one replacing the other. */}
            {d.steadyStateEta?.value != null && (
                <DerivedRow
                    label={`Drivetrain η (steady state, ${d.steadyStateEta.basis?.cycle_speed_mph ?? SS_CYCLE_SPEED_MPH} mph)`}
                    tooltip={EPA_EXPLAINERS.steadyStateEta}
                    result={d.steadyStateEta} format={v => `${(v * 100).toFixed(1)}%`}
                />
            )}
            <DerivedRow
                label="Charging efficiency" result={d.chargerEfficiency}
                format={v => `${(v * 100).toFixed(1)}%`}
            />
            {/* Usable, not gross. The guide's voltage x amp-hours is the pack's
                gross capacity and is promoted to nominal_pack_kwh; what the
                range math needs is what the pack delivers, which the resolver
                picks from the EPA figure, the spec, or the vehicle in that
                order — and names its source. */}
            <DerivedRow
                label="Battery kWh"
                result={{
                    value: resolveUseableKwh(testVehicle, vehicle),
                    source: SOC_WINDOW_BASIS[resolveUseableKwhSource(testVehicle, vehicle)]?.label
                        ?? resolveUseableKwhSource(testVehicle, vehicle),
                    certain: ['EPA', 'epa-tested'].includes(resolveUseableKwhSource(testVehicle, vehicle)),
                }}
                format={v => `${v.toFixed(1)} kWh`}
            />
            {/* Adjusted factor and implied steady-state speed were here and are
                not: both are internal to the derivation and nobody reading a
                vehicle card has a use for either. epaDerivations still computes
                them — the curve and the sanity flags need them — they are simply
                not shown. */}
        </div>
    );
}

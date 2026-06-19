/**
 * Section 8 — read-only derived values, computed live from the curator model
 * via epaDerivations.deriveAll(). Each shows its value, a provenance badge
 * (measured / assumed / estimated / manual), and a ⚠ when a sanity-band flag
 * fires. Per-derivation provenance: η can be measured while charger eff is
 * assumed on the same record.
 */
import { deriveAll } from '../../utils/epaDerivations';
import InfoIcon from '../InfoIcon';
import { EPA_EXPLAINERS } from '../../utils/epaExplainers';

const SOURCE_LABEL = {
    measured:            { text: 'measured',  cls: 'text-green-600 dark:text-green-400' },
    'measured-fallback': { text: 'measured (proc 84)', cls: 'text-green-600 dark:text-green-400' },
    assumed:             { text: 'assumed',   cls: 'text-amber-600 dark:text-amber-400' },
    estimated:           { text: 'estimated', cls: 'text-amber-600 dark:text-amber-400' },
    manual:              { text: 'manual',    cls: 'text-indigo-600 dark:text-indigo-400' },
    computed:            { text: 'computed',  cls: 'text-green-600 dark:text-green-400' },
};

function DerivedRow({ label, tooltip, result, format }) {
    const { value, source, certain, flags = [] } = result || {};
    const meta = SOURCE_LABEL[source] || { text: source || '—', cls: 'text-faint' };
    return (
        <div className="flex items-center justify-between gap-2 py-0.5">
            <span className="text-muted flex items-center gap-1">
                {label}
                {tooltip && <InfoIcon text={tooltip} position="right" />}
            </span>
            <span className="flex items-center gap-1.5">
                <span className="font-mono">
                    {value == null ? '—' : `${!certain ? '~' : ''}${format(value)}`}
                </span>
                {source && <span className={`text-[10px] ${meta.cls}`}>{meta.text}</span>}
                {flags.length > 0 && value != null && (
                    <span title={flags.join(', ')} className="text-amber-500 text-xs">⚠</span>
                )}
            </span>
        </div>
    );
}

export default function DerivedValues({ group }) {
    const d = deriveAll(group);
    return (
        <div>
            <div className="text-faint text-[10px] uppercase tracking-wide mb-1 font-semibold">
                Derived Values
            </div>
            <DerivedRow
                label="Drivetrain η" tooltip={EPA_EXPLAINERS.hwfetCalibration}
                result={d.eta} format={v => `${(v * 100).toFixed(1)}%`}
            />
            <DerivedRow
                label="Charger eff." result={d.chargerEfficiency}
                format={v => `${(v * 100).toFixed(1)}%`}
            />
            <DerivedRow
                label="Adj. factor" result={d.effectiveAdjustmentFactor}
                format={v => v.toFixed(3)}
            />
            <DerivedRow
                label="Implied SS speed" result={d.impliedSsSpeed}
                format={v => `${v.toFixed(0)} mph`}
            />
            {d.effectiveAdjustmentFactor?.basis?.method && (
                <p className="text-[10px] text-faint italic mt-1">
                    Method: {d.effectiveAdjustmentFactor.basis.method}
                </p>
            )}
        </div>
    );
}

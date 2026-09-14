/**
 * Which linked EPA configuration stands for the vehicle (#322).
 *
 * Shown only when there is something to choose between. Each configuration's
 * label range, EPA tested capacity and test weight sit beside it, because those
 * are the figures the choice settles — picking from names alone is how a vehicle
 * ends up represented by a trim it is not.
 */
import { epaConfigurationFigures } from '../../utils/epaConfiguration';

const miles  = (v) => (v != null ? `${Math.round(v)} mi` : '—');
const kwh    = (v) => (v != null ? `${Math.round(v * 10) / 10} kWh` : '—');
const pounds = (v) => (v != null ? `${Math.round(v).toLocaleString('en-US')} lb` : '—');

export default function PrimaryConfigurationPicker({ vehicle, mappings, canEdit, onChoose }) {
    const linked = mappings.filter(m => m.epaGroup);
    if (linked.length < 2) return null;
    const hasPrimary = linked.some(m => m.isPrimary);

    return (
        <div className="primary-config-picker" role="radiogroup" aria-label="Primary EPA configuration">
            <div className="primary-config-option is-header text-micro">
                <span />
                <span>Primary configuration</span>
                <span className="primary-config-figure">Label range</span>
                <span className="primary-config-figure">EPA tested</span>
                <span className="primary-config-figure">Test weight</span>
            </div>
            {linked.map(m => {
                const c = epaConfigurationFigures(m.epaGroup);
                return (
                    <label
                        key={m.id}
                        className={`primary-config-option option-row ${m.isPrimary ? 'is-selected' : ''} ${canEdit ? '' : 'is-readonly'}`}
                    >
                        <input
                            type="radio"
                            name={`primary-config-${vehicle.id}`}
                            checked={!!m.isPrimary}
                            disabled={!canEdit}
                            onChange={() => onChoose?.(vehicle.id, m.id)}
                        />
                        <span className="min-w-0">
                            <span className="block truncate">{c.name}</span>
                            <span className="block font-mono text-caption truncate">{c.id}</span>
                        </span>
                        <span className="primary-config-figure">{miles(c.labelRangeMi)}</span>
                        <span className="primary-config-figure">{kwh(c.testedKwh)}</span>
                        <span className="primary-config-figure">{pounds(c.testWeightLbs)}</span>
                    </label>
                );
            })}
            {!hasPrimary && (
                <p className="primary-config-note text-caption">
                    None is primary yet, so Data Checks judges this vehicle against all {linked.length}.
                    {canEdit && ' Choose the one whose figures are this vehicle’s.'}
                </p>
            )}
        </div>
    );
}

import { CORRECTION_MODES } from '../utils/conditionCorrection';
import CorrectionTargetFields from './CorrectionTargetFields';
import { DEFAULT_READER_MODE } from '../utils/correctionSettings';

/**
 * Choose what a chart corrects measured range and efficiency for, and to what.
 *
 * Default is corrected, for everything the model can (correctionSettings.js
 * DEFAULT_READER_MODE says why it stopped being None). "No correction" is
 * still here, and choosing it is what a link records.
 *
 * Each option names the axes it actually corrects, so nobody infers a
 * completeness the model does not have — "temp" is air density plus an ASSUMED
 * heating or cooling load, not a measurement of either, and battery
 * conditioning, cold tyres and regen limits are not modelled.
 *
 * The target (correctionSettings.js) appears once a mode is chosen: with None
 * there is nothing for it to do. It is the same setting the vehicle table's
 * composite range reads.
 *
 * Lives in chartConfig, so it rides the pop-out sync and is set once for
 * every chart and the vehicle table.
 *
 * `fields` passes through to CorrectionTargetFields: Road Trip leaves out the
 * speed, because a trip is corrected to the speed it is driven.
 */
export default function CorrectionControl({ mode = DEFAULT_READER_MODE, target, setChartConfig, fields = null }) {
    return (
        <>
            <label className="rail-select-row" title="Re-price measured range and efficiency to a common basis. Temperature covers air density and an assumed heating or cooling load; battery conditioning, cold tyres and regen limits are not modelled.">
                {/* .text-label rather than a hand-written `text-sm font-medium
                    text-secondary`: it is the semantic class for exactly this, and
                    sharing it is what makes this row and the color row above it
                    read as one block. */}
                <span className="text-label">Correct:</span>
                <select
                    value={mode}
                    onChange={e => setChartConfig(prev => ({ ...prev, correctionMode: e.target.value }))}
                    className="form-input"
                >
                    {CORRECTION_MODES.map(m => (
                        <option key={m.key} value={m.key}>{m.label}</option>
                    ))}
                </select>
            </label>
            {mode !== 'none' && (
                <CorrectionTargetFields
                    target={target}
                    fields={fields}
                    onChange={t => setChartConfig(prev => ({ ...prev, correctionTarget: t }))}
                />
            )}
        </>
    );
}

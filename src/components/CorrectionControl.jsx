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
 * completeness the model does not have — "temp (aero)" is not the same claim as
 * "corrected to 70°F", because cabin heating and battery conditioning are not
 * modelled and they dominate a winter test.
 *
 * The target (correctionSettings.js) appears once a mode is chosen: with None
 * there is nothing for it to do. It is the same setting the vehicle table's
 * composite range reads.
 *
 * Lives in chartConfig, so it rides the pop-out sync and is set once for
 * every chart and the vehicle table.
 */
export default function CorrectionControl({ mode = DEFAULT_READER_MODE, target, setChartConfig }) {
    return (
        <>
            <label className="rail-select-row" title="Re-price measured range and efficiency to a common basis. Only the aerodynamic effect of temperature is modelled.">
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
                    onChange={t => setChartConfig(prev => ({ ...prev, correctionTarget: t }))}
                />
            )}
        </>
    );
}

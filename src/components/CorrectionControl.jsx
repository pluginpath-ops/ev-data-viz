import { CORRECTION_MODES } from '../utils/conditionCorrection';

/**
 * Choose what a chart corrects measured range and efficiency for.
 *
 * Default is None, deliberately: a range number passing straight through needs
 * no explanation, and correcting is the sort of thing that should be a
 * deliberate act rather than a default a reader has to notice.
 *
 * Each option names the axes it actually corrects, so nobody infers a
 * completeness the model does not have — "temp (aero)" is not the same claim as
 * "corrected to 70°F", because cabin heating and battery conditioning are not
 * modelled and they dominate a winter test.
 *
 * Lives in chartConfig beside Auto Color and Full Labels, so it rides the
 * pop-out sync and is set once for every chart.
 */
export default function CorrectionControl({ mode = 'none', setChartConfig }) {
    return (
        <label className="flex items-center gap-1.5" title="Re-price measured range and efficiency to a common basis: 70 mph, sea level, 70°F. Only the aerodynamic effect of temperature is modelled.">
            <span className="text-sm font-medium text-secondary">Correct:</span>
            <select
                value={mode}
                onChange={e => setChartConfig(prev => ({ ...prev, correctionMode: e.target.value }))}
                className="form-input form-input"
            >
                {CORRECTION_MODES.map(m => (
                    <option key={m.key} value={m.key}>{m.label}</option>
                ))}
            </select>
        </label>
    );
}

/**
 * Auto Color — override each run's stored colour with a perceptually distinct
 * Okabe-Ito palette slot for the duration of this chart session.
 *
 * Extracted so it can sit beside Full Labels in the run selector's header on
 * every chart. It was previously written out four times, which is how the four
 * charts drifted into showing it in four different places.
 */
export default function AutoColorToggle({ autoColor = false, setChartConfig }) {
    return (
        <label
            className="toggle-label"
            title="Override stored colors with perceptually distinct Okabe-Ito palette colors"
        >
            <input
                type="checkbox"
                checked={autoColor}
                onChange={e => setChartConfig(prev => ({ ...prev, autoColor: e.target.checked }))}
                className="w-4 h-4"
            />
            <span className="text-sm font-medium">Auto Color</span>
        </label>
    );
}

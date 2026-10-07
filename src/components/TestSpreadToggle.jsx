/**
 * Show or hide the test spread on the bar charts that draw it (Range &
 * Efficiency, Charge Stop): a line from a vehicle's lowest range test to its
 * highest, with a dot per test. See utils/rangeTestSpread.js.
 *
 * In chartConfig, like Full Labels, so it rides the pop-out sync and one
 * setting covers every chart that draws the mark. On unless switched off.
 */
export default function TestSpreadToggle({ on = true, setChartConfig }) {
    return (
        <label
            className="toggle-label"
            title="Where each of the vehicle's range tests landed: a dot per test on a line from the lowest to the highest, drawn on every bar. Follows the condition correction. None where a vehicle has only one usable test."
        >
            <input
                type="checkbox"
                checked={on}
                onChange={e => setChartConfig(prev => ({ ...prev, testSpread: e.target.checked }))}
                className="w-4 h-4"
            />
            <span className="text-sm font-medium">Test spread</span>
        </label>
    );
}

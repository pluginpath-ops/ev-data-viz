/**
 * The safety valve for label elision.
 *
 * Series labels drop every atom that doesn't distinguish them, which is right
 * on screen and wrong the moment a chart is cropped into a screenshot and read
 * somewhere else: a legend of "70 mph cold" / "80 mph" is unambiguous in a view
 * that names the car elsewhere, and says nothing on its own. This forces the
 * full label — every atom, on every series — for exactly that case.
 *
 * Lives in chartConfig so it rides the existing pop-out sync and applies to
 * every chart at once; a per-chart toggle would leave a presenter setting it
 * four times.
 */
export default function VerboseLabelToggle({ verbose = false, setChartConfig }) {
    return (
        <label
            className="toggle-label"
            title="Show every part of each series name — vehicle, trim and test — rather than only what tells them apart. Useful when screenshotting a chart out of context."
        >
            <input
                type="checkbox"
                checked={verbose}
                onChange={e => setChartConfig(prev => ({ ...prev, verboseLabels: e.target.checked }))}
                className="w-4 h-4"
            />
            <span className="text-sm font-medium">Full Labels</span>
        </label>
    );
}

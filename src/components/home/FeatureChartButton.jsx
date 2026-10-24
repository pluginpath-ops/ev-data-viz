import { useFeaturedComparisonsContext } from '../../context/FeaturedComparisonsContext';

/**
 * "Save as featured comparison" in a chart's toolbar (#448): the curator's way
 * to put the chart on screen, as they have set it up, into a featured
 * comparison. `className` is the toolbar's small button by default; the vehicle
 * table, which has no toolbar, draws it as an ordinary button in its control row.
 * Not drawn for anyone who cannot curate, nor in the pop-out.
 */
export default function FeatureChartButton({ className = 'chart-copy-btn' }) {
    const { canCurate, featureThisChart } = useFeaturedComparisonsContext();
    if (!canCurate || !featureThisChart) return null;
    return (
        <button
            type="button"
            onClick={featureThisChart}
            className={className}
            title="Save this chart, as you have it set up, into a featured comparison shown on Home"
        >
            ★ Save as featured comparison
        </button>
    );
}

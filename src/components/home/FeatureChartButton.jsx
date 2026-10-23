import { useFeaturedComparisonsContext } from '../../context/FeaturedComparisonsContext';

/**
 * "Save as featured comparison" in a chart's toolbar (#448): the curator's way
 * to put the chart on screen, as they have set it up, into a featured
 * comparison. Not drawn for anyone who cannot curate, nor in the pop-out.
 */
export default function FeatureChartButton() {
    const { canCurate, featureThisChart } = useFeaturedComparisonsContext();
    if (!canCurate || !featureThisChart) return null;
    return (
        <button
            type="button"
            onClick={featureThisChart}
            className="chart-copy-btn"
            title="Save this chart, as you have it set up, into a featured comparison shown on Home"
        >
            ★ Save as featured comparison
        </button>
    );
}

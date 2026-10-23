import { useMemo, useState } from 'react';
import PresentedChart from '../PresentedChart';
import { useAppContext } from '../../context/AppContext';
import { useInView } from '../../hooks/useInView';
import { chartStateOf, defaultChartTitle } from '../../utils/featuredComparisons';

/**
 * One chart of a featured comparison, drawn on Home from its saved settings.
 *
 * The chart is the same view the pop-out shows, fed its own copy of the state
 * rather than the site's live state: the reader's selection and tweaks neither
 * change it nor are changed by it. It holds that copy because the chart writes
 * to it as it settles (which tests, pairs or curves are plotted, once it has
 * bootstrapped them) — a chart with nowhere to write that stays blank.
 *
 * The whole panel opens the chart on the real tab, where the reader can change
 * anything; the panel is a shop window, so the chart under the glass takes no
 * clicks. Charts draw only once they are near the viewport.
 *
 * Remount it (key) when the saved chart changes — the state is seeded once.
 */
export default function FeaturedChartPanel({ comparison, index, onOpen }) {
    const { vehicles } = useAppContext();
    const chart = comparison.charts[index];
    const [ref, near] = useInView();

    const seed = useMemo(() => chartStateOf(comparison, index, vehicles), [comparison, index, vehicles]);
    const [chartConfig, setChartConfig] = useState(() => seed?.chartConfig);
    const [compareConfig, setCompareConfig] = useState(() => seed?.compareConfig);
    const [roadTripConfig, setRoadTripConfig] = useState(() => seed?.roadTripConfig);
    const [epaConfig, setEpaConfig] = useState(() => seed?.epaConfig);

    if (!seed || !chart) return null;
    const shown = vehicles.filter(v => seed.vehicleIds.some(id => String(id) === String(v.id)));

    return (
        <section ref={ref} className="home-panel" aria-label={chart.title}>
            <header className="home-panel-head">
                <div className="home-panel-heading">
                    <h3 className="section-title">{chart.title}</h3>
                    <span className="text-micro">{defaultChartTitle(seed.chartMode)}</span>
                </div>
                <button type="button" className="btn btn-secondary home-panel-open" onClick={onOpen}>
                    Open chart →
                </button>
            </header>
            <div className="home-panel-body">
                {near && shown.length > 0 && (
                    <PresentedChart
                        vehicles={shown}
                        selectedVehicles={shown.map(v => v.id)}
                        chartMode={seed.chartMode}
                        chartConfig={chartConfig}
                        setChartConfig={setChartConfig}
                        compareConfig={compareConfig}
                        setCompareConfig={setCompareConfig}
                        roadTripConfig={roadTripConfig}
                        setRoadTripConfig={setRoadTripConfig}
                        epaConfig={epaConfig}
                        setEpaConfig={setEpaConfig}
                        pairings={seed.pairings}
                    />
                )}
                {near && shown.length === 0 && (
                    <p className="text-note">None of this comparison's vehicles are available any more.</p>
                )}
                {/* Over the chart, so a click anywhere on the panel opens it. */}
                <button type="button" className="home-panel-cover" onClick={onOpen} aria-label={`Open ${chart.title}`} tabIndex={-1} />
            </div>
        </section>
    );
}

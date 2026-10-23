import PresentedChart from './PresentedChart';
import { DEFAULT_READER_MODE } from '../utils/correctionSettings';
import VehicleTable from './VehicleTable';
import EpaCurveExplorer from './epa/curves/EpaCurveExplorer';

/**
 * Minimal fullscreen chart-only view rendered in the pop-out tab.
 * No navigation, no sidebar, no controls — chart fills the viewport.
 * State is driven entirely by BroadcastChannel messages from the main tab.
 */
export default function PopoutView({
    vehicles, selectedVehicles, chartMode, chartConfig,
    setChartConfig, compareConfig, roadTripConfig, epaConfig, pairings, onUpdateRunColor, epaExplorer,
}) {
    // The EPA curve explorer is not a chart mode and needs no vehicle selection,
    // so when the main tab is on it nothing below applies (#259).
    if (epaExplorer) {
        return (
            <div className="popout-root">
                <div className="popout-watermark">EVBench | Live</div>
                <EpaCurveExplorer presentationMode synced={epaExplorer} />
            </div>
        );
    }

    return (
        <div className="popout-root">
            <div className="popout-watermark">EVBench | Live</div>

            {selectedVehicles.length === 0 && chartMode !== 'specstable' && (
                <div className="popout-waiting">
                    Waiting for selection in main tab…
                </div>
            )}

            {/* The vehicle table pops out like every other view under the Charts
                nav, and needs no selection — it is where one is made (#315). */}
            {chartMode === 'specstable' && <VehicleTable correctionTarget={chartConfig?.correctionTarget} correctionMode={chartConfig?.correctionMode ?? DEFAULT_READER_MODE} />}

            <PresentedChart
                vehicles={vehicles}
                selectedVehicles={selectedVehicles}
                chartMode={chartMode}
                chartConfig={chartConfig}
                setChartConfig={setChartConfig}
                compareConfig={compareConfig}
                roadTripConfig={roadTripConfig}
                epaConfig={epaConfig}
                pairings={pairings}
            />
        </div>
    );
}

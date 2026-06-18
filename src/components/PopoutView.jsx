import ChargingView from './ChargingView';
import ChargeCompareView from './ChargeCompareView';
import RoadTripView from './RoadTripView';
import SpecsChartView from './SpecsChartView';
import EpaCurvesView from './EpaCurvesView';

/**
 * Minimal fullscreen chart-only view rendered in the pop-out tab.
 * No navigation, no sidebar, no controls — chart fills the viewport.
 * State is driven entirely by BroadcastChannel messages from the main tab.
 */
export default function PopoutView({
    vehicles, selectedVehicles, chartMode, chartConfig,
    setChartConfig, compareConfig, roadTripConfig, epaConfig, onUpdateRunColor,
}) {
    return (
        <div className="popout-root">
            <div className="popout-watermark">EVBench | Live</div>

            {selectedVehicles.length === 0 && (
                <div className="popout-waiting">
                    Waiting for selection in main tab…
                </div>
            )}

            {selectedVehicles.length > 0 && chartMode === 'specs' && (
                <SpecsChartView
                    vehicles={vehicles.filter(v => selectedVehicles.includes(v.id))}
                    selectedField={chartConfig.specsField}
                    presentationMode
                />
            )}

            {selectedVehicles.length > 0 && chartMode === 'roadtrip' && roadTripConfig && (
                <RoadTripView
                    vehicles={vehicles}
                    selectedVehicleIds={selectedVehicles}
                    roadTripConfig={roadTripConfig}
                    setRoadTripConfig={() => {}}
                    presentationMode
                />
            )}

            {selectedVehicles.length > 0 && chartMode !== 'compare' && chartMode !== 'specs' && chartMode !== 'roadtrip' && (
                <ChargingView
                    vehicles={vehicles}
                    selectedVehicleIds={selectedVehicles}
                    chartConfig={chartConfig}
                    setChartConfig={setChartConfig}
                    onUpdateRunColor={onUpdateRunColor}
                    chartMode={chartMode}
                    presentationMode
                />
            )}

            {selectedVehicles.length > 0 && chartMode === 'compare' && (
                <ChargeCompareView
                    vehicles={vehicles}
                    selectedVehicleIds={selectedVehicles}
                    xMinutes={compareConfig.xMinutes}
                    mMiles={compareConfig.mMiles}
                    startSoc={compareConfig.startSoc}
                    presentationMode
                />
            )}

            {chartMode === 'epacurves' && (
                <EpaCurvesView
                    vehicles={vehicles}
                    selectedVehicleIds={selectedVehicles}
                    epaConfig={epaConfig || { yAxis: 'kwh100mi' }}
                    setEpaConfig={() => {}}
                    presentationMode
                />
            )}
        </div>
    );
}

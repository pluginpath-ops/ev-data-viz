import ChargingView from './ChargingView';
import ChargeCompareView from './ChargeCompareView';

/**
 * Minimal fullscreen chart-only view rendered in the pop-out tab.
 * No navigation, no sidebar, no controls — chart fills the viewport.
 * State is driven entirely by BroadcastChannel messages from the main tab.
 */
export default function PopoutView({
    vehicles, selectedVehicles, chartMode, chartConfig,
    setChartConfig, compareConfig, onUpdateRunColor,
}) {
    return (
        <div className="popout-root">
            <div className="popout-watermark">EVBench | Live</div>

            {selectedVehicles.length === 0 && (
                <div className="popout-waiting">
                    Waiting for selection in main tab…
                </div>
            )}

            {selectedVehicles.length > 0 && chartMode !== 'compare' && (
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
        </div>
    );
}

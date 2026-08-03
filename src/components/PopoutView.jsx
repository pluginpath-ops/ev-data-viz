import ChargingView from './ChargingView';
import ChargeCompareView from './ChargeCompareView';
import RoadTripView from './RoadTripView';
import SpecsChartView from './SpecsChartView';
import SpecsScatterView from './SpecsScatterView';
import SpecsView from './SpecsView';
import EpaCurvesView from './EpaCurvesView';
import PerformanceCompareView from './PerformanceCompareView';
import PerformanceCurveView from './PerformanceCurveView';

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

            {selectedVehicles.length > 0 && chartMode === 'perfcompare' && (
                <PerformanceCompareView
                    vehicles={vehicles}
                    selectedVehicleIds={selectedVehicles}
                    presentationMode
                />
            )}

            {selectedVehicles.length > 0 && chartMode === 'perfcurve' && (
                <PerformanceCurveView
                    vehicles={vehicles}
                    selectedVehicleIds={selectedVehicles}
                    presentationMode
                />
            )}

            {/* Compare Specs — the table. Moved under the Charts nav, so it pops
                out like every other view there. */}
            {selectedVehicles.length > 0 && chartMode === 'specstable' && (
                <SpecsView selectedVehicleIds={selectedVehicles} />
            )}

            {selectedVehicles.length > 0 && chartMode === 'specscatter' && (
                <SpecsScatterView
                    vehicles={vehicles.filter(v => selectedVehicles.includes(v.id))}
                    xField={chartConfig.scatterXField}
                    yField={chartConfig.scatterYField}
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

            {/* Charging + Range only — ChargingView delegates to RangeChartView when
                chartMode === 'range'. Other modes have their own explicit branches so
                they no longer fall through to the charging chart. */}
            {selectedVehicles.length > 0 && (chartMode === 'charging' || chartMode === 'range') && (
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

            {selectedVehicles.length > 0 && chartMode === 'epacurves' && (
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

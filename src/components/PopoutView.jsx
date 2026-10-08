import ChargingView from './ChargingView';
import { VEHICLE_PALETTE } from '../utils/colorUtils';
import ChargeCompareView from './ChargeCompareView';
import RoadTripView from './RoadTripView';
import SpecsChartView from './SpecsChartView';
import SpecsScatterView from './SpecsScatterView';
import VehicleTable from './VehicleTable';
import EpaCurvesView from './EpaCurvesView';
import PerformanceCompareView from './PerformanceCompareView';
import PerformanceCurveView from './PerformanceCurveView';
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

            {/* The vehicle table pops out like every other view under the Charts
                nav, and needs no selection — it is where one is made (#315). */}
            {chartMode === 'specstable' && <VehicleTable />}

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
                    pairings={pairings}
                    setRoadTripConfig={() => {}}
                    correctionMode={chartConfig?.correctionMode ?? 'none'}
                    handSet={chartConfig?.handSet ?? false}
                    verboseLabels={chartConfig?.verboseLabels ?? false}
                    palette={chartConfig?.seriesPalette ?? VEHICLE_PALETTE}
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
                    chartMode={chartMode}
                    pairings={pairings}
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
                    pairings={pairings}
                    verboseLabels={chartConfig?.verboseLabels ?? false}
                    palette={chartConfig?.seriesPalette ?? VEHICLE_PALETTE}
                    testSpread={chartConfig?.testSpread ?? true}
                    correctionMode={chartConfig?.correctionMode ?? 'none'}
                    handSet={chartConfig?.handSet ?? false}
                    presentationMode
                />
            )}

            {selectedVehicles.length > 0 && chartMode === 'epacurves' && (
                <EpaCurvesView
                    vehicles={vehicles}
                    selectedVehicleIds={selectedVehicles}
                    epaConfig={epaConfig || { yAxis: 'kwh100mi' }}
                    setEpaConfig={() => {}}
                    palette={chartConfig?.seriesPalette ?? VEHICLE_PALETTE}
                    presentationMode
                />
            )}
        </div>
    );
}

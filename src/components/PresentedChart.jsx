import ChargingView from './ChargingView';
import { VEHICLE_PALETTE } from '../utils/colorUtils';
import ChargeCompareView from './ChargeCompareView';
import RoadTripView from './RoadTripView';
import SpecsChartView from './SpecsChartView';
import SpecsScatterView from './SpecsScatterView';
import { DEFAULT_READER_MODE } from '../utils/correctionSettings';
import EpaCurvesView from './EpaCurvesView';
import PerformanceCompareView from './PerformanceCompareView';
import PerformanceCurveView from './PerformanceCurveView';
import { AxisLimitsProvider } from '../hooks/useAxisLimits';

/**
 * One chart, drawn from a bundle of state with no controls around it.
 *
 * The pop-out draws it from the state the main tab broadcasts; a Home panel
 * draws it from a featured comparison's saved settings (#448). Both are a chart
 * shown rather than operated, so they share the switch that picks the view for
 * a mode and the props each takes — one copy of "which view, fed what", which
 * the wiring suite checks against App's own.
 *
 * The setters are optional. The pop-out gives none: it follows the main tab, so
 * a chart that settles its own selection (which pairs are plotted, which curves)
 * changes nothing there. A Home panel gives them, because nothing else will
 * settle that selection for it — without them a chart that starts empty and
 * fills itself on first sight of its vehicles stays blank.
 *
 * Its axis limits are the chartConfig's (`axisLimits`, #478), served to whichever
 * view draws through AxisLimitsProvider below. A Home panel's chartConfig is its
 * own copy, so the limits a curator saved are the ones it draws with; the
 * pop-out's is the main tab's.
 *
 * The vehicle table is not here: it reads the site's live selection, filters
 * and URL, so it cannot be drawn from a bundle.
 */
export default function PresentedChart({
    vehicles, selectedVehicles, chartMode, chartConfig,
    setChartConfig, compareConfig, roadTripConfig, epaConfig, pairings,
    setCompareConfig = null, setRoadTripConfig = null, setEpaConfig = null,
}) {
    return (
        <AxisLimitsProvider chartConfig={chartConfig} setChartConfig={setChartConfig}>
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
                setRoadTripConfig={setRoadTripConfig ?? (() => {})}
                correctionMode={chartConfig?.correctionMode ?? DEFAULT_READER_MODE}
                correctionTarget={chartConfig?.correctionTarget}
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
                orientation={compareConfig.orientation}
                selectedKeys={compareConfig.selected}
                onSelectedChange={setCompareConfig ? keys => setCompareConfig(p => ({ ...p, selected: keys })) : undefined}
                pairings={pairings}
                verboseLabels={chartConfig?.verboseLabels ?? false}
                palette={chartConfig?.seriesPalette ?? VEHICLE_PALETTE}
                testSpread={chartConfig?.testSpread ?? true}
                correctionMode={chartConfig?.correctionMode ?? DEFAULT_READER_MODE}
                correctionTarget={chartConfig?.correctionTarget}
                handSet={chartConfig?.handSet ?? false}
                presentationMode
            />
        )}

        {selectedVehicles.length > 0 && chartMode === 'epacurves' && (
            <EpaCurvesView
                vehicles={vehicles}
                selectedVehicleIds={selectedVehicles}
                epaConfig={epaConfig || { yAxis: 'kwh100mi' }}
                setEpaConfig={setEpaConfig ?? (() => {})}
                palette={chartConfig?.seriesPalette ?? VEHICLE_PALETTE}
                correctionTarget={chartConfig?.correctionTarget}
                presentationMode
            />
        )}
        </AxisLimitsProvider>
    );
}

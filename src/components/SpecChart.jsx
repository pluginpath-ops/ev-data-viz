import { useCallback, useMemo, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { useVehicleRows } from '../hooks/useVehicleRows';
import { useRememberedOpen } from '../hooks/useRememberedOpen';
import SpecsChartView from './SpecsChartView';
import SpecsScatterView from './SpecsScatterView';
import SpecChartKind from './SpecChartKind';
import SelectionEmptyState from './SelectionEmptyState';
import { useFilteredVehicles } from '../hooks/useFilteredVehicles';
import { EMPTY_VEHICLE_FILTERS } from '../utils/vehicleFilters';
import SpecChartSidebar from './specchart/SpecChartSidebar';
import { resolveChartColors, VEHICLE_PALETTE } from '../utils/colorUtils';
import { readMemory } from '../utils/vehicleTableStorage';
import { DEFAULT_CORRECTION_TARGET, DEFAULT_READER_MODE } from '../utils/correctionSettings';
import {
    VEHICLE_COLUMNS, DEFAULT_ASSUMPTIONS, decodeVehicleTableParams, vehicleTableStartSearch,
    vehicleColumnByKey, labelledColumn,
} from '../utils/vehicleTable';
import {
    chartColumns, currentFieldKey, defaultFieldKey, plotValues, isPlottableColumn, isPlottableOnScatter,
} from '../utils/specChart';

/**
 * The spec chart (#450): any column of the vehicle table, plotted for the
 * selected vehicles — one as bars, two as a scatter.
 *
 * It reads the table's own rows (useVehicleRows), not the spec schema, so a
 * figure, a tested result or a calculated ratio is the number its cell shows,
 * under the same correction and assumptions. Both of those are App's
 * (chartConfig), which is what lets the sidebar steer the chart and the table
 * from one place.
 *
 * `mode` is `specs` (bars) or `specscatter`; the two stay separate chart modes
 * so links, pop-outs and help bubbles are unchanged.
 */
export default function SpecChart({
    mode, onModeChange, vehicles, fleet = null, filters = null, onFiltersChange = null, chartConfig, setChartConfig,
    correctionMode = DEFAULT_READER_MODE, correctionTarget = DEFAULT_CORRECTION_TARGET,
    presentationMode = false,
}) {
    const { units, vehicles: allVehicles, performanceCounts } = useAppContext();
    const assumptions = chartConfig.assumptions ?? DEFAULT_ASSUMPTIONS;
    const scatter = mode === 'specscatter';

    // Which vehicles: the selection, or every vehicle the filters leave (the
    // same filters as Cards, List and Table — App's). The pop-out has no
    // filters to apply, so it draws the selection it was handed.
    const canFilter = Boolean(fleet && filters && onFiltersChange) && !presentationMode;
    const scope = canFilter && chartConfig.specScope === 'all' ? 'all' : 'selection';
    const { ctx: filterCtx, filtered } = useFilteredVehicles(allVehicles, filters ?? EMPTY_VEHICLE_FILTERS, performanceCounts);
    const plotted = useMemo(() => {
        if (scope !== 'all') return vehicles;
        const shown = new Set(filtered.map(v => v.id));
        return fleet.filter(v => shown.has(v.id));
    }, [scope, vehicles, fleet, filtered]);

    // The columns the table is showing, read as it opens: the picker lists
    // these first. The table cannot change while this is on screen.
    const [tableKeys] = useState(() => decodeVehicleTableParams(
        vehicleTableStartSearch(window.location.search, readMemory()),
    ).columns);

    // Old links named three fields differently (specChart.js currentFieldKey).
    const barKey = currentFieldKey(chartConfig.specsField);
    const xKey = currentFieldKey(chartConfig.scatterXField);
    const yKey = currentFieldKey(chartConfig.scatterYField);

    const label = useCallback(
        (col) => labelledColumn(col, assumptions, units, correctionTarget, correctionMode),
        [assumptions, units, correctionTarget, correctionMode],
    );
    const allColumns = useMemo(() => chartColumns(VEHICLE_COLUMNS).map(label), [label]);
    const offered = useMemo(
        () => (scatter ? allColumns.filter(isPlottableOnScatter) : allColumns),
        [allColumns, scatter],
    );

    const plottedKeys = (scatter ? [xKey, yKey] : [barKey]).filter(Boolean);
    const { rows, wantsPerformance, performanceLoading } = useVehicleRows({
        keys: [...plottedKeys, ...tableKeys], assumptions, correctionTarget, correctionMode,
    });
    const selectedRows = useMemo(() => {
        const byId = new Map(rows.map(r => [r.id, r]));
        return plotted.map(v => byId.get(v.id)).filter(Boolean);
    }, [rows, plotted]);

    // Nothing chosen (or a key the table no longer has): open on the first
    // column the table shows that the selected vehicles have a value for.
    const valid = (key, numericOnly) => {
        const col = key && vehicleColumnByKey(key);
        return col && isPlottableColumn(col) && (!numericOnly || isPlottableOnScatter(col)) ? key : null;
    };
    const fallbackBar = defaultFieldKey(allColumns, tableKeys, selectedRows);
    const fallbackNum = defaultFieldKey(allColumns, tableKeys, selectedRows, { numericOnly: true });
    const barField = valid(barKey, false) ?? fallbackBar;
    const xField = valid(xKey, true) ?? fallbackNum;
    const yField = valid(yKey, true) ?? [fallbackNum, ...offered.map(c => c.key)].find(k => k && k !== xField) ?? fallbackNum;

    const colOf = (key) => offered.find(c => c.key === key) ?? null;
    const barCol = colOf(barField);
    const xCol = colOf(xField);
    const yCol = colOf(yField);

    // A vehicle's color is the same here as on every chart: its own (curated,
    // or the base set from its chip), the palette only filling the gaps.
    const palette = chartConfig.seriesPalette ?? VEHICLE_PALETTE;
    const colorMap = useMemo(() => resolveChartColors(
        plotted.map(v => ({ id: v.id, created_at: v.created_at })),
        {}, palette, plotted.map(v => ({ ...v, runs: [{ id: v.id }] })),
    ), [plotted, palette]);
    const colorOf = useCallback((id) => colorMap[id], [colorMap]);

    const barPlot = useMemo(() => (barCol ? plotValues(selectedRows, barCol, units) : null), [selectedRows, barCol, units]);
    const xPlot = useMemo(() => (xCol ? plotValues(selectedRows, xCol, units) : null), [selectedRows, xCol, units]);
    const yPlot = useMemo(() => (yCol ? plotValues(selectedRows, yCol, units) : null), [selectedRows, yCol, units]);

    const [fieldsOpen, setFieldsOpen] = useRememberedOpen('spec-chart-fields', true);

    const setBar = (key) => setChartConfig(p => ({ ...p, specsField: key }));
    const setAxes = ({ x, y }) => setChartConfig(p => ({ ...p, scatterXField: x, scatterYField: y }));
    const setAssumptions = (next) => setChartConfig(p => ({ ...p, assumptions: next }));

    const nothingToDraw = scatter
        ? !(xPlot?.points.length && yPlot?.points.length)
        : !barPlot?.points.length;
    const plot = scatter
        ? (xCol && yCol && xPlot && yPlot && (
            <SpecsScatterView xPlot={xPlot} yPlot={yPlot} xCol={xCol} yCol={yCol} colorOf={colorOf} units={units} scope={scope} presentationMode={presentationMode} />
        ))
        : (barCol && barPlot && (
            <SpecsChartView plot={barPlot} col={barCol} colorOf={colorOf} units={units} scope={scope} presentationMode={presentationMode} />
        ));

    const main = (
        <div className="chart-main">
            {wantsPerformance && performanceLoading && <p className="text-meta">loading tested results…</p>}
            {scope === 'selection' && vehicles.length === 0 && (
                <SelectionEmptyState chart="Chart" extra="Or switch the sidebar to All." />
            )}
            {plot}
            {vehicles.length + plotted.length > 0 && nothingToDraw && (
                <p className="text-note spec-chart-dropped">
                    {scatter
                        ? 'No selected vehicle has a value for both fields.'
                        : 'No selected vehicle has a value for this field.'}
                </p>
            )}
        </div>
    );
    if (presentationMode) return main;

    return (
        <div className="chart-layout">
            <SpecChartSidebar
                scatter={scatter}
                scope={scope}
                canFilter={canFilter}
                onScopeChange={(next) => setChartConfig(p => ({ ...p, specScope: next }))}
                selectedCount={vehicles.length}
                allVehicles={allVehicles}
                filters={filters}
                onFiltersChange={onFiltersChange}
                filterCtx={filterCtx}
                shownCount={filtered.length}
                kindSwitch={<SpecChartKind mode={mode} onChange={onModeChange} />}
                columns={offered}
                tableKeys={tableKeys}
                units={units}
                barField={barField}
                axes={{ x: xField, y: yField }}
                onBar={setBar}
                onAxes={setAxes}
                fieldsOpen={fieldsOpen}
                onFieldsOpenChange={setFieldsOpen}
                plottedKeys={[barField, xField, yField].filter(Boolean)}
                assumptions={assumptions}
                onAssumptionsChange={setAssumptions}
                correctionMode={correctionMode}
                correctionTarget={correctionTarget}
                setChartConfig={setChartConfig}
            />
            {main}
        </div>
    );
}

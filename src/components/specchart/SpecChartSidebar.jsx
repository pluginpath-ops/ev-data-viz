import SectionBand from '../SectionBand';
import VehicleFilterBar from '../vehicles/VehicleFilterBar';
import FieldPicker from '../tables/FieldPicker';
import SidebarDisplaySection from '../SidebarDisplaySection';
import CorrectionControl from '../CorrectionControl';
import VehicleAssumptionFields, { assumptionSummary } from '../VehicleAssumptionFields';
import { useRememberedOpen } from '../../hooks/useRememberedOpen';
import { assumptionsFor, unitFor, DEFAULT_ASSUMPTIONS } from '../../utils/vehicleTable';
import { correctionSummary, DEFAULT_CORRECTION_TARGET } from '../../utils/correctionSettings';

/**
 * The spec chart's sidebar (#450), laid out like every other chart's: the
 * column picker where the others pick vehicles and runs, then the table's
 * assumptions, then Display.
 *
 * Assumptions appear only when a plotted column reads one, as in the table's
 * own Assumptions menu, and are the very same controls
 * (VehicleAssumptionFields): the chart's "Time to add" and the table's cell are
 * made from one setting. They sit behind a section band, collapsed, with a
 * summary of what the reader changed, so a moved slider is never hidden.
 */
export default function SpecChartSidebar({
    scatter, scope, canFilter, onScopeChange, selectedCount, allVehicles, filters, onFiltersChange, filterCtx, shownCount,
    kindSwitch, columns, tableKeys, units, barField, axes, onBar, onAxes,
    fieldsOpen, onFieldsOpenChange, plottedKeys,
    assumptions, onAssumptionsChange, correctionMode, correctionTarget, setChartConfig,
}) {
    const [assumptionsOpen, setAssumptionsOpen] = useRememberedOpen('spec-chart-assumptions', false);
    const needed = assumptionsFor(plottedKeys);
    const summary = assumptionSummary({ assumptions, needed, units, correctionTarget });
    const unitOf = (col) => unitFor(col, units);
    const corrects = needed.has('conditions');

    return (
        <aside className="chart-rail">
            {kindSwitch}

            {canFilter && (
                <div className="chart-rail-group">
                    <span className="text-micro">Vehicles</span>
                    <div className="stats-segmented" role="group" aria-label="Vehicles plotted">
                        {[['selection', `Selection · ${selectedCount}`], ['all', `All · ${allVehicles.length}`]].map(([key, label]) => (
                            <button
                                key={key}
                                type="button"
                                className={scope === key ? 'active' : ''}
                                aria-pressed={scope === key}
                                title={key === 'selection' ? 'The vehicles you have selected' : 'Every vehicle the filters leave'}
                                onClick={() => onScopeChange(key)}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                    {scope === 'all' && (
                        <VehicleFilterBar
                            vehicles={allVehicles}
                            filters={filters}
                            onChange={onFiltersChange}
                            ctx={filterCtx}
                            shownCount={shownCount}
                        />
                    )}
                </div>
            )}
            <div className="chart-rail-group">
                <SectionBand
                    open={fieldsOpen}
                    onToggle={onFieldsOpenChange}
                    label="Data"
                    count={`${columns.length} fields`}
                    note={fieldsOpen ? null : (scatter
                        ? [axes.x, axes.y].map(k => columns.find(c => c.key === k)?.label).filter(Boolean).join(' vs ')
                        : columns.find(c => c.key === barField)?.label)}
                />
                {fieldsOpen && (
                    scatter
                        ? <FieldPicker mode="dual" columns={columns} tableKeys={tableKeys} unitOf={unitOf} axes={axes} onChange={onAxes} />
                        : <FieldPicker mode="single" columns={columns} tableKeys={tableKeys} unitOf={unitOf} value={barField} onChange={onBar} />
                )}
            </div>

            {needed.size > 0 && (
                <div className="chart-rail-group">
                    <SectionBand
                        open={assumptionsOpen}
                        onToggle={setAssumptionsOpen}
                        label="Assumptions"
                        active={summary.length > 0}
                        activeLabel="An assumption differs from its default"
                        note={assumptionsOpen ? null : (summary.join(' · ') || null)}
                    />
                    {assumptionsOpen && (
                        <VehicleAssumptionFields
                            assumptions={assumptions} needed={needed} units={units} onChange={onAssumptionsChange}
                            correctionTarget={correctionTarget}
                            onCorrectionTargetChange={t => setChartConfig(p => ({ ...p, correctionTarget: t }))}
                        />
                    )}
                    {assumptionsOpen && summary.length > 0 && (
                        <button type="button" className="section-action" onClick={() => {
                            onAssumptionsChange(DEFAULT_ASSUMPTIONS);
                            if (corrects) setChartConfig(p => ({ ...p, correctionTarget: DEFAULT_CORRECTION_TARGET }));
                        }}>
                            reset assumptions
                        </button>
                    )}
                </div>
            )}

            {corrects && (
                <SidebarDisplaySection title="Display and corrections" active={correctionMode !== 'none'} summary={correctionSummary(correctionMode, correctionTarget, units)}>
                    <CorrectionControl mode={correctionMode} target={correctionTarget} setChartConfig={setChartConfig} />
                </SidebarDisplaySection>
            )}
        </aside>
    );
}

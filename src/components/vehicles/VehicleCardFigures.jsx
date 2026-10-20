import StatCell from '../StatCell';
import TestedFigure from './TestedFigure';
import { PlatformLine } from './PlatformLine';
import { TestCountLink } from './TestCounts';
import { distanceValue, distanceUnit } from '../../utils/unitConversions';
import { testedRangeSummary } from '../../utils/testedRange';
import { DATA_CATEGORIES, vehicleDataCategories, vehiclePooledCounts } from '../../utils/vehicleDataCategories';
import { SOC_WINDOW_BASIS, EPA_RANGE_BASIS } from '../../utils/vehicleFigures';
import { fromYearNote } from '../../utils/epaCertifications';

/*
 * The figures of a vehicle card, below its photo band: battery, EPA range,
 * the reported range test, platform, test counts, tags.
 *
 * Extracted from VehiclesView so the card on the Cards grid and the card the
 * vehicle table opens in a popover are one thing, not two that drift.
 */

/**
 * The card's EPA range figure: the resolved range, or — with several EPA
 * configurations and no primary — the span of their labels, rather than one
 * picked silently.
 */
export function epaRangeValue(vehicle, units) {
    if (vehicle.epaRangeMi) return distanceValue(vehicle.epaRangeMi, units);
    const span = vehicle.epaRange?.spanMi;
    return span ? span.map(mi => distanceValue(mi, units)).join('–') : null;
}

/**
 * A word beside the range only when it is not this vehicle's own EPA label:
 * an expected or unsorted figure, or a label from another model year's
 * certification — "From MY2024" (#374).
 */
export function epaRangeBasisMark(vehicle) {
    if (['expected', 'unsorted'].includes(vehicle.epaRangeBasis)) return vehicle.epaRangeBasis;
    return fromYearNote(vehicle.epaRange?.certification)?.short ?? null;
}

/** Why the range reads as it does, for a title. */
export function epaRangeTitle(vehicle) {
    return fromYearNote(vehicle.epaRange?.certification)?.long
        ?? EPA_RANGE_BASIS[vehicle.epaRangeBasis]?.note;
}


// ── Test-count row ────────────────────────────────────────────────────────────

/**
 * Renders a "Tests: Charging (n) Range (n) EPA (n)" line that matches the
 * styling of Battery/Range rows. "Tests:" inherits the parent's text-sm color;
 * the type names are 1pt smaller and colored. Zero-count categories omitted.
 */
export function TestCountPills({ vehicle, performanceCounts = {}, onOpenSubtab }) {
    const counts = vehicleDataCategories(vehicle, performanceCounts);
    const pooled = vehiclePooledCounts(vehicle);
    const shown = DATA_CATEGORIES.filter(c => counts[c.key] > 0 || pooled[c.key] > 0);
    if (shown.length === 0) return null;

    // "Charging (4/2)": listed tests, then in grey the unlisted ones that still
    // count in the statistics (#394, the pool).
    return (
        <p className="flex flex-wrap items-baseline gap-x-1.5">
            <span>Tests:</span>
            {shown.map(c => (
                <TestCountLink key={c.key} className={`card-test-count ${c.colorClass}`} category={c} vehicle={vehicle}
                    count={counts[c.key]} pooled={pooled[c.key]} onOpenSubtab={onOpenSubtab}>
                    {c.label} ({counts[c.key]}{pooled[c.key] > 0 && <span className="test-count-pool">/{pooled[c.key]}</span>})
                </TestCountLink>
            ))}
        </p>
    );
}

export function TagPills({ vehicle }) {
    if (!vehicle.tags?.length) return null;
    return (
        <div className="vehicle-tags">
            {vehicle.tags.map(tag => {
                // A tag that came down the inheritance chain is drawn as
                // one, so a curator can tell it from a tag set here.
                const from = vehicle.inheritedFrom?.tags?.[tag.id];
                return (
                    <span
                        key={tag.id}
                        className={`vehicle-tag${from ? ' is-inherited' : ''}`}
                        title={from ? `Inherited from ${from.name}` : undefined}
                    >
                        {tag.name}
                    </span>
                );
            })}
        </div>
    );
}

/**
 * Props:
 *   onOpenTest     {(TestReference) => void}  open a test from the tested figure
 *   onOpenSubtab   {(vehicle, subtab) => void}  open the vehicle's Tests & Data
 */
export default function VehicleCardFigures({ vehicle, units, performanceCounts = {}, onOpenTest, onOpenSubtab }) {
    return (
        <>
            {/* The figures, set as figures. They were prose —
                "Battery: 82 kWh" in the same face and weight
                as the sentence beside it — which made the
                LABELS the loudest thing on a card whose whole
                job is to compare numbers. */}
            <div className="stat-grid">
                <StatCell
                    label="Battery"
                    value={vehicle.socWindowKwh}
                    unit="kWh"
                    basis={SOC_WINDOW_BASIS[vehicle.socWindowBasis]?.label}
                    title={SOC_WINDOW_BASIS[vehicle.socWindowBasis]?.note}
                />
                <StatCell
                    label="EPA range"
                    value={epaRangeValue(vehicle, units)}
                    unit={distanceUnit(units)}
                    basis={epaRangeBasisMark(vehicle)}
                    title={epaRangeTitle(vehicle)}
                />
                {vehicle.power != null && (
                    <StatCell label="Power" value={vehicle.power} unit="kW" />
                )}
            </div>

            {/* The measurement, with the conditions that
                produced it and no verdict attached. */}
            <TestedFigure vehicle={vehicle} tested={testedRangeSummary(vehicle)} units={units} onOpenTest={onOpenTest} />

            <PlatformLine vehicle={vehicle} />

            <TestCountPills vehicle={vehicle} performanceCounts={performanceCounts} onOpenSubtab={onOpenSubtab} />

            {vehicle.tags?.length > 0 && <TagPills vehicle={vehicle} />}
        </>
    );
}

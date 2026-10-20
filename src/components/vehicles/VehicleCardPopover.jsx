import Popover from '../Popover';
import VehicleMedia from './VehicleMedia';
import VehicleCardFigures from './VehicleCardFigures';
import { CARD_BAND_HEIGHT } from '../../utils/cardBand';

/**
 * A vehicle's name that opens the vehicle's card in a popover.
 *
 * For places that name a vehicle in a row of figures — the vehicle table — where
 * the name used to do something else (select the row) and the reader had no way
 * to see the vehicle without leaving. The card here is the Cards grid's card,
 * read-only: the same band and figures (VehicleCardFigures), then the two actions
 * anyone can take, View Tests & Data and Specs. Selecting and curating stay on
 * the row and the grid.
 *
 * The header is a close button and nothing else: the card's band already names
 * the vehicle, and a title above it said the same thing twice. Click outside or
 * Escape closes it too.
 *
 * Closing it does not open the row beneath (see swallowNextClick).
 *
 * Panel clicks are stopped at the panel: it renders in a portal, but React
 * bubbles events through portals to the row that owns the trigger, and a click
 * on the card must not also open the row.
 *
 * Props:
 *   vehicle, units, performanceCounts
 *   selected      {boolean}  draws the card's accent border
 *   onViewRuns    {(vehicle, subtab?) => void}
 *   onViewSpecs   {(vehicle) => void}
 *   onOpenTest    {(TestReference) => void}
 *   children      the trigger's content (the name)
 */
/**
 * Swallow the click that finishes the gesture that dismissed the popover.
 *
 * Light dismiss fires on pointerdown, so the click that follows lands on
 * whatever was under the pointer — here a table row, which opens View Specs.
 * Closing a popover must not also do that. One capture-phase click is
 * stopped, and the listener is dropped after a moment either way, because an
 * Escape or a button inside the panel closes it with no click to come.
 */
function swallowNextClick() {
    const stop = (e) => { e.stopPropagation(); e.preventDefault(); };
    window.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 300);
}

export default function VehicleCardPopover({
    vehicle, units, performanceCounts, selected = false, onViewRuns, onViewSpecs, onOpenTest, children,
}) {
    return (
        <Popover
            className="vehicle-card-popover-anchor"
            width="340px"
            onOpenChange={(open) => { if (!open) swallowNextClick(); }}
            trigger={(props) => (
                <button
                    type="button"
                    className="vehicle-name-button"
                    {...props}
                    onClick={(e) => { e.stopPropagation(); props.onClick(e); }}
                >
                    {children}
                </button>
            )}
        >
            {({ close }) => (
                <>
                    {/* A direct child of the panel, so it runs full width. */}
                    <div className="popover-head" onClick={e => e.stopPropagation()}>
                        <button type="button" className="popover-close ml-auto" onClick={close} aria-label="Close">×</button>
                    </div>
                    <div className="vehicle-card-popover" onClick={e => e.stopPropagation()}>
                        <div className={`vehicle-card${selected ? ' is-selected' : ''}`}>
                            <VehicleMedia vehicle={vehicle} height={CARD_BAND_HEIGHT} className="is-card-band">
                                <div className="vehicle-media-title">
                                    <h3>{vehicle.name}</h3>
                                    <p>{[vehicle.make, vehicle.model, vehicle.trim, vehicle.year].filter(Boolean).join(' · ')}</p>
                                </div>
                            </VehicleMedia>
                            <div className="vehicle-card-body">
                                <VehicleCardFigures
                                    vehicle={vehicle}
                                    units={units}
                                    performanceCounts={performanceCounts}
                                    onOpenTest={onOpenTest && ((ref) => { close(); onOpenTest(ref); })}
                                    onOpenSubtab={onViewRuns && ((v, sub) => { close(); onViewRuns(v, sub); })}
                                />
                                <div className="vehicle-card-actions">
                                    <div className="flex items-center gap-1.5">
                                        {onViewRuns && (
                                            <button type="button" className="btn btn-primary flex-1" onClick={() => { close(); onViewRuns(vehicle); }}>
                                                View Tests &amp; Data →
                                            </button>
                                        )}
                                        <button type="button" className="btn btn-secondary" onClick={() => { close(); onViewSpecs(vehicle); }}>
                                            Specs
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </Popover>
    );
}

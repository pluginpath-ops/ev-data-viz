/**
 * A vehicle on the Cards grid with its source chain stacked above it.
 *
 * Every vehicle that passes the filters is the top card of its own stack, so
 * a source can appear twice: as a result, and as a rolodex card above each of
 * its variants. That is deliberate: the top card is the search result, and
 * the stack says where it came from.
 *
 * The rolodex cards are one trigger. Clicking them fans the stack out in a
 * popover, every member a full card as it would be on top, each selectable
 * on its own. Sources the filters removed are a gap above the card and are
 * left out of the fan.
 *
 * `stack` is `vehicleStack(...)` from vehicleInheritance.js; `renderCard`
 * draws one full card, the same function the grid uses; `isSelected(id)`
 * gives a selected source's rolodex card the card's accent border.
 *
 * Every card on the grid is wrapped, stack or not: the wrapper is a two-row
 * subgrid (rolodex cards, then the card), so cards in a row start level
 * whether or not they carry a stack.
 */
import Popover from '../Popover';
import { RolodexCard, RolodexGap, RolodexMore } from './RolodexCard';
import { lineageRole } from '../../utils/vehicleInheritance';

export default function VehicleStack({ vehicle, stack, index, units, renderCard, isSelected, children }) {
    if (stack.members.length === 0) return <div className="vehicle-stack">{children}</div>;
    return (
        <div className="vehicle-stack">
            <Popover
                className="vehicle-stack-anchor"
                title={`${vehicle.name} and its sources`}
                width="min(1040px, calc(100vw - 2rem))"
                trigger={(props) => (
                    <button
                        type="button"
                        className="vehicle-stack-rolodex"
                        aria-label={`Show ${vehicle.name} with its ${stack.members.length - 1} sources`}
                        {...props}
                    >
                        {stack.more > 0 && <RolodexMore count={stack.more} />}
                        {stack.rolodex.map((entry, i) => entry.gap
                            ? <RolodexGap key={`gap-${i}`} count={entry.gap} />
                            : <RolodexCard key={entry.vehicle.id} vehicle={entry.vehicle} role={lineageRole(entry.vehicle, index)} units={units} selected={isSelected(entry.vehicle.id)} />)}
                    </button>
                )}
            >
                <div className="vehicle-stack-fan">
                    {stack.members.map(member => (
                        <div key={member.id} className="contents">{renderCard(member)}</div>
                    ))}
                </div>
            </Popover>
            {children}
        </div>
    );
}

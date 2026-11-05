/**
 * A vehicle on the Cards grid with its source chain stacked above it.
 *
 * Every vehicle that passes the filters is the top card of its own stack, so
 * a source can appear twice: as a result, and as a rolodex card above each of
 * its variants. That is deliberate: the top card is the search result, and
 * the stack says where it came from.
 *
 * The rolodex cards are one trigger. Clicking them fans the stack out in a
 * popover, every member a List row, furthest source first, each selectable
 * on its own: rows rather than cards, so a long lineage stays a short list. Sources the filters removed are a gap above the card, and
 * sources unlisted for this reader an "Unlisted record"; both are left out
 * of the fan.
 *
 * `stack` is `vehicleStack(...)` from vehicleInheritance.js; `renderMembers`
 * draws the members as the List view's rows, and is given the popover's
 * `close` for the row actions that open a dialog; `isSelected(id)` gives a
 * selected source's rolodex card the card's accent border.
 *
 * Every card on the grid is wrapped, stack or not: the wrapper is a two-row
 * subgrid (rolodex cards, then the card), so cards in a row start level
 * whether or not they carry a stack.
 */
import Popover from '../Popover';
import { RolodexCard, RolodexGap, RolodexMore, RolodexUnlisted } from './RolodexCard';
import { lineageRole } from '../../utils/vehicleInheritance';

export default function VehicleStack({ vehicle, stack, index, units, renderMembers, isSelected, children }) {
    if (stack.members.length === 0) return <div className="vehicle-stack">{children}</div>;
    const rolodex = (
        <>
            {stack.more > 0 && <RolodexMore count={stack.more} />}
            {stack.rolodex.map((entry, i) => entry.unlisted
                ? <RolodexUnlisted key={`unlisted-${i}`} count={entry.unlisted} />
                : entry.gap
                    ? <RolodexGap key={`gap-${i}`} count={entry.gap} />
                    : <RolodexCard key={entry.vehicle.id} vehicle={entry.vehicle} role={lineageRole(entry.vehicle, index)} units={units} selected={isSelected(entry.vehicle.id)} />)}
        </>
    );
    // Nothing to fan out (every source is unlisted for this reader): the
    // rolodex card says so, and is not a control.
    if (stack.members.length < 2) {
        return (
            <div className="vehicle-stack">
                <div className="vehicle-stack-anchor popover-anchor"><div className="vehicle-stack-rolodex is-static">{rolodex}</div></div>
                {children}
            </div>
        );
    }
    return (
        <div className="vehicle-stack">
            <Popover
                className="vehicle-stack-anchor"
                title={`${vehicle.name} and its sources`}
                width="min(1180px, calc(100vw - 2rem))"
                trigger={(props) => (
                    <button
                        type="button"
                        className="vehicle-stack-rolodex"
                        aria-label={`Show ${vehicle.name} with its ${stack.members.length - 1} sources`}
                        {...props}
                    >
                        {rolodex}
                    </button>
                )}
            >
                {({ close }) => renderMembers(stack.members, close)}
            </Popover>
            {children}
        </div>
    );
}

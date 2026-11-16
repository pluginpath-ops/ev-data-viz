import InfoIcon from '../InfoIcon';

/**
 * How Road Trip's gas car stops, in an ⓘ beside the picker's "Car" label (owner,
 * 2026-11-12: not a paragraph under the fields). The popover does not break
 * lines in a string, so each short line is its own block.
 */
const LINES = [
    'Stops for fuel when the tank runs down to the fill-up level.',
    'Range is its highway mpg times the fuel above that level.',
    "Each stop takes the fill-up's minutes. That is the total time off the route, and nothing is added to it.",
    'Cold costs mpg (about 7% at 20°F, none from 75°F up), only while the trip is corrected to a temperature.',
    'Set once: Cost & Time reads the same car, and prices its fuel.',
];

export default function GasCarStopsInfo() {
    return (
        <InfoIcon
            className="ml-1"
            title="How the gas car stops"
            text={LINES.map(line => <span key={line} className="block mt-1 first:mt-0">{line}</span>)}
        />
    );
}

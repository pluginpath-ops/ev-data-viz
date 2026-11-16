/**
 * The gas car's settings: its picker, its mpg and tank, its price, and what a
 * fill-up is. Written once and shared by the two tabs that draw the gas car —
 * Cost & Time (Your Driving's card and the sidebar's group) and Road Trip's
 * sidebar — so the car and its defaults cannot drift between them (#555). They
 * read and write the one set of settings (`costToDrive` in App), so a car
 * picked in either tab is the car in the other.
 *
 * Props:
 *   compact   the sidebar's form: shorter note, and no car picker unless `picker`
 *   picker    show the car picker (default: everywhere but a `compact` Cost & Time
 *             sidebar, whose groups tune a week rather than pick one)
 *   timeOnly  Road Trip: it prices no fuel and has no city driving, so the
 *             price and city mpg are left out — they are Cost & Time's
 */
import { DriveNumberField } from './DriveFields';
import GasCarPicker from './GasCarPicker';
import GasCarStopsInfo from './GasCarStopsInfo';

export default function GasCarFields({ settings, onChange, compact = false, picker = !compact, timeOnly = false }) {
    const props = { settings, onChange };
    // The car's own figures: changing one makes it the reader's own car.
    const ownCar = { settings, onChange: (patch) => onChange({ ...patch, gasCar: 'custom' }) };
    return (
        <>
            {picker && <GasCarPicker settings={settings} onChange={onChange} info={timeOnly ? <GasCarStopsInfo /> : null} />}
            <div className="flex flex-col gap-2">
                {!timeOnly && <DriveNumberField {...ownCar} field="gasCity" label="City" unit="mpg" />}
                <DriveNumberField {...ownCar} field="gasHwy" label="Highway" unit="mpg" />
                {!timeOnly && <DriveNumberField {...props} field="gasPrice" label="Price" unit="$/gal" />}
                <DriveNumberField {...ownCar} field="gasTank" label="Tank" unit="gal" />
                <DriveNumberField {...props} field="gasFillAt" label="Fill up at" unit="% left" />
                <DriveNumberField {...props} field="gasFillMin" label="Each fill-up" unit="min" />
            </div>
            {/* Road Trip says how the car stops in the ⓘ beside "Car", not in a
                paragraph under the fields (owner, 2026-11-12). Cost & Time's
                note stays a caption: it is what that card has always had. */}
            {!timeOnly && (
                <span className="text-note">
                    {!compact && 'A car fills in its EPA mpg and tank. Change one and it becomes your own, named as you like. '}
                    It drives the same week as the EVs. A fill-up&rsquo;s minutes are the total time off the route:
                    pulling off, pumping, paying and pulling back. Cold costs mpg: about 15% city and
                    7% highway at 20°F, none from 75°F up. Road Trip reads the same car.
                </span>
            )}
        </>
    );
}

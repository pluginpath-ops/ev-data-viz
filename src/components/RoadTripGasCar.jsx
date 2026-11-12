import { gasCarName } from '../utils/costToDrive';
import { useRememberedOpen } from '../hooks/useRememberedOpen';
import SectionBand from './SectionBand';
import GasCarFields from './costToDrive/GasCarFields';

/**
 * Road Trip's and Trip Optimizer's gas car, in their sidebar behind a section
 * band: the same picker and fields Cost & Time has, over the same shared
 * settings (#555), so picking a car here is picking it there. Closed, the band
 * says which car it is — the name the chart's line carries.
 *
 * Time only (owner, 2026-11-12): no price and no city mpg here, since this
 * chart prices no fuel and drives no city miles. Cost & Time has them.
 */
export default function RoadTripGasCar({ settings, onChange }) {
    const [open, setOpen] = useRememberedOpen('roadtrip-gas-car', false);
    const note = `${gasCarName(settings)} · ${settings.gasHwy} hwy mpg · ${settings.gasTank} gal · fill at ${settings.gasFillAt}% left`;
    return (
        <div className="chart-rail-group">
            <SectionBand open={open} onToggle={setOpen} label="Your gas car" note={open ? null : note} />
            {open && (
                <div className="flex flex-col gap-3">
                    <GasCarFields settings={settings} onChange={onChange} compact picker timeOnly />
                </div>
            )}
        </div>
    );
}

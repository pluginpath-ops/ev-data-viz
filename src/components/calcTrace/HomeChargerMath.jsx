import { useCallback, useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { createTrace } from '../../utils/calcTrace';
import { sessionFor } from '../../utils/testSessions';
import { vehicleLabel } from '../../utils/specHelpers';
import { dollars, homeCostCeiling, minutesText, perMonth } from '../../utils/costToDrive';
import { priceVehicle } from '../../hooks/useCostToDrive';
import HomeLevelPicker from '../costToDrive/HomeLevelPicker';
import ShowTheMath from './ShowTheMath';
import MathPass from './MathPass';

/**
 * "Show the math" for Cost & Time › Charging Speeds: one vehicle at one home
 * charger, priced by the same call the page makes for that column
 * (useCostToDrive's priceVehicle, the level swapped in), then the dashed line
 * (homeCostCeiling). Opens at the reader's own charger.
 */
function HomeChargerMathBody({ vehicles, shown, settings }) {
    const { testSessions } = useAppContext();
    const [level, setLevel] = useState(settings.level);
    const options = shown.map(p => ({ id: p.vehicle.id, label: vehicleLabel(p.vehicle) }));
    const buildTrace = useCallback((id) => {
        const vehicle = vehicles.find(v => v.id === id);
        const s = { ...settings, level };
        const trace = createTrace();
        const { profile, comparison: c } = priceVehicle(vehicle, vehicles, s, (r) => sessionFor(testSessions, r), trace);
        const ceiling = c ? homeCostCeiling(profile, s, trace.group('The dashed line')) : null;
        const home = c && perMonth(c.week.homeCost), fast = c && perMonth(c.week.fastCost);
        return {
            trace,
            summary: c && `Column: ${dollars(home)} home + ${dollars(fast)} fast = ${dollars(home + fast)} a month · ${minutesText(perMonth(c.week.fastMinutes))} fast charging${ceiling == null ? '' : ` · most it could cost at home ${dollars(ceiling)}`}`,
        };
    }, [vehicles, settings, level, testSessions]);
    return (
        <MathPass
            intro={`One car at one home charger, the ${settings.season} week as the page simulates it. A column is that week's home and fast cost × 52 ÷ 12; the dashed line is the charger at full power for the whole plug-in window, every night.`}
            options={options}
            buildTrace={buildTrace}
            picks={(
                <label className="calc-trace-pick">
                    <span className="text-micro">At</span>
                    <HomeLevelPicker compact settings={{ level }} onChange={(c) => setLevel(c.level)} />
                </label>
            )}
        />
    );
}

export default function HomeChargerMath(props) {
    return <ShowTheMath Body={HomeChargerMathBody} {...props} />;
}

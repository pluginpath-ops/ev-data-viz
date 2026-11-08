import { useCallback } from 'react';
import { useAppContext } from '../../context/AppContext';
import { createTrace } from '../../utils/calcTrace';
import { sessionFor } from '../../utils/testSessions';
import { vehicleLabel } from '../../utils/specHelpers';
import { dollars, minutesText, perMonth, savedText } from '../../utils/costToDrive';
import { priceVehicle } from '../../hooks/useCostToDrive';
import ShowTheMath from './ShowTheMath';
import MathPass from './MathPass';

/**
 * "Show the math" for Cost & Time › Compare: one vehicle priced by the same
 * call the page makes (useCostToDrive's priceVehicle), with the reader's
 * settings and a trace on.
 */
function CostMathBody({ vehicles, shown, settings }) {
    const { testSessions } = useAppContext();
    const options = shown.map(p => ({ id: p.vehicle.id, label: vehicleLabel(p.vehicle) }));
    const buildTrace = useCallback((id) => {
        const vehicle = vehicles.find(v => v.id === id);
        const trace = createTrace();
        const { comparison: c } = priceVehicle(vehicle, vehicles, settings, (r) => sessionFor(testSessions, r), trace);
        return {
            trace,
            summary: c && `Card: ${savedText(c.monthly.saved)} · ${dollars(c.monthly.ev)}/mo to charge against ${dollars(c.monthly.gas)}/mo in gas · ${minutesText(perMonth(c.week.fastMinutes))} fast charging a month`,
        };
    }, [vehicles, settings, testSessions]);
    return (
        <MathPass
            intro={`The ${settings.season} week as the page simulates it, for one car. The other season runs the same steps at its own temperature.`}
            options={options}
            buildTrace={buildTrace}
        />
    );
}

export default function CostMath(props) {
    return <ShowTheMath Body={CostMathBody} {...props} />;
}

import { useCallback } from 'react';
import { useAppContext } from '../../context/AppContext';
import { createTrace, traceNumber } from '../../utils/calcTrace';
import { pairRangeSource } from '../../utils/rangeSource';
import { correctionCaption } from '../../utils/correctionSettings';
import { sessionFor } from '../../utils/testSessions';
import ShowTheMath from './ShowTheMath';
import MathPass from './MathPass';

/**
 * "Show the math" for Charge Stop: one plotted row's range basis — the miles a
 * percent of charge is worth — by the call the chart makes (pairRangeSource),
 * with the reader's correction. Reading the charging curve for the minutes is
 * the chart's own and not traced yet.
 *
 * Props:
 *   pairs  the chart's plotted rows (activePairs)
 *   mode, target  the reader's correction
 */
function ChargeStopMathBody({ pairs, mode, target }) {
    const { testSessions } = useAppContext();
    const options = pairs.map(p => ({ id: p.key, label: p.fullLabel ?? p.label }));
    const buildTrace = useCallback((key) => {
        const p = pairs.find(x => x.key === key);
        const trace = createTrace();
        trace.note(`Correction: ${correctionCaption(mode, target)}`);
        pairRangeSource(p.chargingRun, p.rangeRun, {
            vehicle: p.vehicle,
            correction: { mode, target },
            session: sessionFor(testSessions, p.rangeRun),
            trace,
        });
        trace.note('The chart prices each % the charging test adds at this many miles, reading the minutes off its curve');
        const src = p.rangeSrc;
        return {
            trace,
            summary: src?.miPerSoc != null
                ? `Chart: ${traceNumber(src.miPerSoc)} mi per % SoC${src.correction?.note ? ` · ${src.correction.note}` : ''}`
                : 'Chart: the charging test\'s own recorded range',
        };
    }, [pairs, mode, target, testSessions]);
    return (
        <MathPass
            intro="The range basis behind one row: which range test prices a percent of charge, and how. Figures in miles; the chart converts to your units after."
            options={options}
            buildTrace={buildTrace}
        />
    );
}

export default function ChargeStopMath(props) {
    return <ShowTheMath Body={ChargeStopMathBody} {...props} />;
}

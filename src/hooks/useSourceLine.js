import { useMemo } from 'react';
import { useAppContext } from '../context/AppContext';
import { useSources } from './useSources';
import { attributionFor, sourceLineText } from '../utils/sources';

const NONE = [];

/**
 * The source line a chart prints under its plot, from what it plots.
 *
 * Returns `{ entries, unattributed, showGaps, text }`. `PlotFrame` draws it as
 * links; `text` goes to `useChartPng`'s frame, because the export is a canvas
 * and a link cannot live there. Curators see how many plotted runs have no
 * source; viewers see only what is known.
 *
 * `runs` and `epa` should be stable between renders when the plot has not
 * changed (memoise them), since the line is recomputed when they change.
 *
 * @param {{ runs?: Array, allRuns?: Array, epa?: { label?: boolean, tests?: boolean } }} plotted
 */
export function useSourceLine({ runs = NONE, allRuns = NONE, epa }) {
    const { isContributor } = useAppContext();
    const { sources } = useSources();
    const label = epa?.label === true;
    const tests = epa?.tests === true;
    return useMemo(() => {
        const byId = new Map(allRuns.map(r => [r.id, r]));
        const line = attributionFor({ runs, sources, runById: id => byId.get(id), epa: { label, tests } });
        const showGaps = !!isContributor;
        return { ...line, showGaps, text: sourceLineText(line, showGaps) };
    }, [runs, allRuns, sources, label, tests, isContributor]);
}

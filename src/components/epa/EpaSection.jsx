import EpaGuideView from './guide/EpaGuideView';
import EpaStatsView from './stats/EpaStatsView';
import EpaCurveExplorer from './curves/EpaCurveExplorer';

/**
 * The EPA top-level section and its sub-nav (#234).
 *
 * Two views over the same corpus: the browser from #235, which answers "what is
 * this car", and the statistics from #236, which answer "what is typical".
 *
 * The sub-tab lives in the URL as `?tab=epa&sub=…` so a link lands where the
 * sender was. Each child writes its own parameters and re-sets `sub` when it
 * does — see EPA_SUBTABS below — because both own state worth sharing and
 * neither can be allowed to wipe the other's.
 */
/**
 * Three siblings, not two with a switch inside one.
 *
 * The label figures and the lab measurements are separate datasets, not two
 * views of one: a certification covers MANY configurations — one Rivian
 * certificate lists 24 — so 211 certifications sit behind 1,175 guide rows and
 * the two can never be put side by side row for row. No measure is computable
 * from both, either.
 *
 * Folding the choice into the measure picker would hide that, and would leave
 * the unit-of-analysis control appearing and vanishing depending on which
 * measure was selected. Separate tabs let each carry only the controls that
 * mean something in it — the unit question exists for guide rows, where a
 * configuration, a test group and a make are three different populations, and
 * not for certifications, where the record IS the unit.
 */
export const EPA_SUBTABS = [
    { id: 'browse',    label: 'Browse' },
    { id: 'labelstats', label: 'Label Statistics' },
    { id: 'certstats',  label: 'Certification Statistics' },
    { id: 'curves',     label: 'Speed-Consumption Curves' },
];
export const EPA_SUBTAB_IDS = EPA_SUBTABS.map(t => t.id);
export const DEFAULT_EPA_SUBTAB = 'browse';

/** Links shared before the split named the statistics tab `stats`. */
const LEGACY_SUBTABS = { stats: 'labelstats' };

/**
 * Resolve the `sub` parameter to a real sub-tab id, honouring the legacy spelling.
 *
 * Exported because the state now lives in App.jsx — see the component below.
 */
export function epaSubtabFromParam(raw) {
    const sub = LEGACY_SUBTABS[raw] ?? raw;
    return EPA_SUBTAB_IDS.includes(sub) ? sub : DEFAULT_EPA_SUBTAB;
}

/**
 * The sub-tab STRIP is not here.
 *
 * It is rendered by App.jsx into the nav, on the active tab's own fill, exactly
 * as the chart categories are — which is what makes a sub-tab read as being
 * inside its section rather than as a second row of buttons on the page. EPA
 * drew its own rail below the chrome and was the odd one out.
 *
 * The state went with it, to App.jsx, alongside the runs and admin sub-tabs
 * that were already lifted for the same reason: the URL is owned up there.
 */
export default function EpaSection({ subtab = DEFAULT_EPA_SUBTAB }) {
    return (
        <div className="flex flex-col gap-4">
            {subtab === 'browse'     && <EpaGuideView subtab={subtab} />}
            {subtab === 'labelstats' && <EpaStatsView subtab={subtab} dataset="guide" />}
            {subtab === 'certstats'  && <EpaStatsView subtab={subtab} dataset="cert" />}
            {subtab === 'curves'     && <EpaCurveExplorer />}
        </div>
    );
}

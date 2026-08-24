import { useState, useEffect } from 'react';
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
    { id: 'curves',     label: 'Certification Curves' },
];
export const EPA_SUBTAB_IDS = EPA_SUBTABS.map(t => t.id);
export const DEFAULT_EPA_SUBTAB = 'browse';

/** Links shared before the split named the statistics tab `stats`. */
const LEGACY_SUBTABS = { stats: 'labelstats' };

export default function EpaSection() {
    const [subtab, setSubtab] = useState(() => {
        const raw = new URLSearchParams(window.location.search).get('sub');
        const sub = LEGACY_SUBTABS[raw] ?? raw;
        return EPA_SUBTAB_IDS.includes(sub) ? sub : DEFAULT_EPA_SUBTAB;
    });

    // Keep `sub` current even before a child writes its own parameters, so
    // switching tabs and copying the URL gives the tab you are looking at.
    useEffect(() => {
        const p = new URLSearchParams(window.location.search);
        p.set('tab', 'epa');
        p.set('sub', subtab);
        window.history.replaceState({ view: 'epa' }, '', `?${p.toString()}`);
    }, [subtab]);

    return (
        <div className="flex flex-col gap-4">
            <div className="admin-subtabs">
                {EPA_SUBTABS.map(t => (
                    <button
                        key={t.id}
                        className={`btn-chart-mode ${subtab === t.id ? 'active' : ''}`}
                        onClick={() => setSubtab(t.id)}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {subtab === 'browse'     && <EpaGuideView subtab={subtab} />}
            {subtab === 'labelstats' && <EpaStatsView subtab={subtab} dataset="guide" />}
            {subtab === 'certstats'  && <EpaStatsView subtab={subtab} dataset="cert" />}
            {subtab === 'curves'     && <EpaCurveExplorer />}
        </div>
    );
}

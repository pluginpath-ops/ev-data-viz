import { useState, useEffect } from 'react';
import EpaGuideView from './guide/EpaGuideView';
import EpaStatsView from './stats/EpaStatsView';

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
export const EPA_SUBTABS = [
    { id: 'browse', label: 'Browse' },
    { id: 'stats',  label: 'Statistics' },
];
export const EPA_SUBTAB_IDS = EPA_SUBTABS.map(t => t.id);
export const DEFAULT_EPA_SUBTAB = 'browse';

export default function EpaSection() {
    const [subtab, setSubtab] = useState(() => {
        const sub = new URLSearchParams(window.location.search).get('sub');
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

            {subtab === 'browse' && <EpaGuideView subtab={subtab} />}
            {subtab === 'stats'  && <EpaStatsView subtab={subtab} />}
        </div>
    );
}

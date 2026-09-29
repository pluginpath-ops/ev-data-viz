import PlatformList from './PlatformList';
import PlatformPage from './PlatformPage';
import ExplainersSection from '../../explainers/ExplainersSection';

/**
 * Reference (#338): what is true of every EV, selected or not.
 *
 *   Platforms    every platform, and a page for each: what it provides, its
 *                notes and the vehicles on it (#354)
 *   Explainers   articles with diagrams (#355). They live in src/explainers,
 *                behind a lint boundary; this mounts them and nothing more
 *
 * The sub-tab strip is App.jsx's, like every section's, and so is the URL:
 * ?tab=reference&sub=explainers(&topic=<slug>), ?tab=reference&pid=12 for a platform.
 */
export const REFERENCE_SUBTABS = [
    { id: 'platforms',  label: 'Platforms',
      description: 'What vehicles are built on, and what each platform provides them.' },
    { id: 'explainers', label: 'Explainers',
      description: 'How things work, with diagrams.' },
];
export const REFERENCE_SUBTAB_IDS = REFERENCE_SUBTABS.map(t => t.id);
export const DEFAULT_REFERENCE_SUBTAB = 'platforms';

export const referenceSubtabFromParam = (raw) =>
    (REFERENCE_SUBTAB_IDS.includes(raw) ? raw : DEFAULT_REFERENCE_SUBTAB);

export default function ReferenceSection({ subtab = DEFAULT_REFERENCE_SUBTAB, platformId = null, topic = null, onBackToPlatforms, onBackToExplainers }) {
    if (subtab === 'explainers') {
        return <ExplainersSection topic={topic} onBack={onBackToExplainers} />;
    }
    if (platformId != null) {
        return <PlatformPage platformId={platformId} onBack={onBackToPlatforms} />;
    }
    return (
        <div>
            <h2 className="page-title mb-4">Platforms</h2>
            <PlatformList />
        </div>
    );
}

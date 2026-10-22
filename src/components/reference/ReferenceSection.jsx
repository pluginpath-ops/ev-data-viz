import PlatformList from './PlatformList';
import PlatformPage from './PlatformPage';
import ExplainersSection from '../../explainers/ExplainersSection';

/**
 * Reference (#338): what is true of every EV, selected or not.
 *
 *   Explainers   articles with diagrams (#355). They live in src/explainers,
 *                behind a lint boundary; this mounts them and nothing more
 *   Platforms    every platform, and a page for each: what it provides, its
 *                notes and the vehicles on it (#354)
 *
 * The sub-tab strip is App.jsx's, like every section's, and so is the URL:
 * ?tab=reference&sub=explainers(&topic=<slug>), ?tab=reference&pid=12 for a
 * platform, ?tab=reference&sub=platforms for the platform list. A bare
 * ?tab=reference is Explainers (#444); Platforms is only ever reached by name.
 */
export const REFERENCE_SUBTABS = [
    { id: 'explainers', label: 'Explainers',
      description: 'How things work, with diagrams.' },
    { id: 'platforms',  label: 'Platforms',
      description: 'What vehicles are built on, and what each platform provides them.' },
];
export const REFERENCE_SUBTAB_IDS = REFERENCE_SUBTABS.map(t => t.id);
/** What a bare ?tab=reference opens (#444). Nothing else may borrow it to mean "Platforms". */
export const DEFAULT_REFERENCE_SUBTAB = 'explainers';

/**
 * The sub-tab a URL (or a history state) names. A platform id with no `sub`
 * is a platform page's link (?tab=reference&pid=12, which predates #444 and
 * stays valid), so it means Platforms; otherwise no `sub` means the default.
 */
export const referenceSubtabFromParam = (raw, platformId = null) => {
    if (REFERENCE_SUBTAB_IDS.includes(raw)) return raw;
    return platformId != null ? 'platforms' : DEFAULT_REFERENCE_SUBTAB;
};

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

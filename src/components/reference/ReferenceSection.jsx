import PlatformList from './PlatformList';
import PlatformPage from './PlatformPage';

/**
 * Reference (#338): what is true of every EV, selected or not.
 *
 *   Platforms    every platform, and a page for each: what it provides, its
 *                notes and the vehicles on it (#354)
 *   Explainers   a notice for now: articles with diagrams come in #355, built
 *                in its own session after the navigation overhaul
 *
 * The sub-tab strip is App.jsx's, like every section's, and so is the URL:
 * ?tab=reference&sub=explainers, ?tab=reference&pid=12 for a platform.
 */
export const REFERENCE_SUBTABS = [
    { id: 'platforms',  label: 'Platforms',
      description: 'What vehicles are built on, and what each platform provides them.' },
    { id: 'explainers', label: 'Explainers',
      description: 'How things work, with diagrams. Coming soon.' },
];
export const REFERENCE_SUBTAB_IDS = REFERENCE_SUBTABS.map(t => t.id);
export const DEFAULT_REFERENCE_SUBTAB = 'platforms';

export const referenceSubtabFromParam = (raw) =>
    (REFERENCE_SUBTAB_IDS.includes(raw) ? raw : DEFAULT_REFERENCE_SUBTAB);

export default function ReferenceSection({ subtab = DEFAULT_REFERENCE_SUBTAB, platformId = null, onBackToPlatforms, onOpenExplainers }) {
    if (subtab === 'explainers') {
        return (
            <div>
                <h2 className="page-title mb-6">Explainers</h2>
                <div className="empty-state">
                    <p>Explainers are coming soon: how things work, with diagrams.</p>
                </div>
            </div>
        );
    }
    if (platformId != null) {
        return <PlatformPage platformId={platformId} onBack={onBackToPlatforms} onOpenExplainers={onOpenExplainers} />;
    }
    return (
        <div>
            <h2 className="page-title mb-4">Platforms</h2>
            <PlatformList />
        </div>
    );
}

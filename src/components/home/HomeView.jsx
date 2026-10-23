import { useEffect, useMemo, useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { useNavigation } from '../../context/NavigationContext';
import { useFeaturedComparisonsContext } from '../../context/FeaturedComparisonsContext';
import { comparisonToShow, liveVehicleIds, replacesSelection, vehiclesInOrder } from '../../utils/featuredComparisons';
import { buildVehicleLabels } from '../../utils/seriesLabel';
import HomeIntro from './HomeIntro';
import ScrollMoreHint from './ScrollMoreHint';
import MarkdownText from '../MarkdownText';
import FeaturedChartPanel from './FeaturedChartPanel';
import ReplaceSelectionDialog from './ReplaceSelectionDialog';
import LoadingSpinner from '../LoadingSpinner';
import { useSiteEvents } from '../../hooks/useSiteEvents';
import { SITE_EVENTS } from '../../utils/siteEvents';
import { chartModeOf } from '../../utils/featuredComparisons';

/**
 * Home (#448): the featured comparison a curator chose, every chart of it drawn
 * at once.
 *
 * Opening a chart makes the live site look like it, and from there the reader's
 * changes are theirs. The reset puts the site back to the comparison's vehicles
 * and correction. Neither can silently throw away a selection worth keeping:
 * with two or more vehicles selected both ask first.
 *
 * `slug` names the comparison to show; without one, Home shows the newest
 * listed. A curator also sees the unlisted ones, to preview before listing.
 */
export default function HomeView({ slug, onSlugChange }) {
    const { vehicles, selectedVehicles } = useAppContext();
    const { openFeaturedChart, resetToComparison } = useNavigation();
    const { comparisons, loading, error, canCurate, openEditor } = useFeaturedComparisonsContext();
    const [pending, setPending] = useState(null);      // { action: 'open' | 'reset', index }
    const [justReset, setJustReset] = useState(false);
    const record = useSiteEvents();

    const shown = useMemo(() => comparisonToShow(comparisons, slug), [comparisons, slug]);
    const shownVehicles = useMemo(
        () => (shown ? vehiclesInOrder(liveVehicleIds(shown, vehicles), vehicles) : []),
        [shown, vehicles],
    );
    const names = useMemo(() => buildVehicleLabels(shownVehicles), [shownVehicles]);

    // Home was opened, once per tab per comparison, once there is something to say it showed.
    const shownSlug = shown?.slug ?? null;
    useEffect(() => {
        if (loading) return;
        record(SITE_EVENTS.HOME_VIEW, { slug: shownSlug, once: true });
    }, [loading, shownSlug, record]);

    useEffect(() => {
        if (!justReset) return undefined;
        const t = setTimeout(() => setJustReset(false), 2500);
        return () => clearTimeout(t);
    }, [justReset]);

    if (loading && comparisons.length === 0) return <div className="home-view"><HomeIntro /><LoadingSpinner /></div>;

    const run = (action, index) => {
        if (action === 'open') {
            record(SITE_EVENTS.FEATURED_OPEN, { slug: shown.slug, detail: { chart: index + 1, mode: chartModeOf(shown.charts[index].params) } });
            openFeaturedChart(shown, index);
        } else {
            record(SITE_EVENTS.FEATURED_RESET, { slug: shown.slug });
            resetToComparison(shown);
            setJustReset(true);
        }
    };
    // Ask first only when it would replace a selection the reader built.
    const attempt = (action, index = 0) => {
        if (replacesSelection(selectedVehicles, shown, vehicles)) setPending({ action, index });
        else run(action, index);
    };

    const curatorBar = canCurate && (
        <div className="home-curator">
            <span className="text-micro">Featured comparisons</span>
            {comparisons.length > 0 && (
                <select
                    className="form-input home-curator-select"
                    value={shown?.slug ?? ''}
                    onChange={e => onSlugChange(e.target.value || null)}
                    aria-label="Featured comparison shown"
                >
                    {comparisons.map(c => (
                        <option key={c.slug} value={c.slug}>{c.title}{c.isListed ? '' : ' (unlisted)'}</option>
                    ))}
                </select>
            )}
            {shown && <button type="button" className="btn btn-secondary" onClick={() => openEditor({ comparison: shown })}>Edit</button>}
            <span className="text-note">
                Make one from any chart: Save as featured comparison.
            </span>
        </div>
    );

    if (!shown) {
        return (
            <div className="home-view">
                <HomeIntro />
                {curatorBar}
                <div className="home-empty">
                    <p className="text-secondary">
                        {error ? 'Featured comparisons could not be loaded.' : 'Nothing is featured right now.'}
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="home-view">
            <HomeIntro />
            <h2 className="home-section-head text-micro">Featured comparison</h2>
            {curatorBar}
            <header className="home-header">
                {/* Title and reset share a row; the blurb and the vehicles run
                    the full width beneath, so they read as belonging to the
                    whole comparison, not to one column of it. */}
                <div className="home-heading">
                    <div className="home-title">
                        <h3 className="section-title">{shown.title}</h3>
                        {!shown.isListed && <span className="badge-default">Unlisted</span>}
                    </div>
                    <div className="home-actions">
                        <button type="button" className="btn btn-secondary" onClick={() => attempt('reset')}
                            title="Select this comparison's vehicles and use its correction. Your other settings go back to the defaults.">
                            {justReset ? '✓ Reset' : 'Reset to this comparison'}
                        </button>
                    </div>
                </div>
                <MarkdownText text={shown.blurb} />
                <ul className="home-vehicles" aria-label="Vehicles in this comparison">
                    {shownVehicles.map(v => (
                        <li key={v.id} className="featured-vehicle-chip" style={{ '--chip-accent': v.color || undefined }}>
                            {names.get(v.id)?.short ?? v.name}
                        </li>
                    ))}
                </ul>
            </header>

            <div className="home-panels">
                {shown.charts.map((chart, i) => (
                    <FeaturedChartPanel
                        key={`${shown.slug}:${i}:${chart.params}`}
                        comparison={shown}
                        index={i}
                        onOpen={() => attempt('open', i)}
                    />
                ))}
            </div>

            <ScrollMoreHint />

            {pending && (
                <ReplaceSelectionDialog
                    count={selectedVehicles.length}
                    incoming={shownVehicles.length}
                    action={pending.action}
                    onCancel={() => setPending(null)}
                    onConfirm={() => { const p = pending; setPending(null); run(p.action, p.index); }}
                />
            )}
        </div>
    );
}

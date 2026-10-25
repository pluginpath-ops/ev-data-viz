import { useState, useMemo, useCallback } from 'react';
import { dataService } from '../../services/DataService';
import { useAsyncResource } from '../../hooks/useAsyncResource';
import { useFeaturedComparisons } from '../../hooks/useFeaturedComparisons';
import StatCell from '../StatCell';
import {
    EVENT_ROW_CAP, MIN_N_TO_RANK, HOME_PAIR_SECONDS,
    headline, comparisonCounts, chartTypeCounts, homeViewsOverTime,
} from '../../utils/siteEventStats';

/** The windows a curator can read, in days; null is everything kept. */
const WINDOWS = [
    { days: 7,    label: '7 days' },
    { days: 30,   label: '30 days' },
    { days: 90,   label: '90 days' },
    { days: null, label: 'Everything kept' },
];
const DEFAULT_WINDOW_DAYS = 30;

const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
const dateText = d => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const shortDate = d => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/** A table's flag on a row too thin to rank on: shown, muted, never dropped. */
function TooFew({ n, what }) {
    return <span className="stats-suppressed-flag" title={`Fewer than ${MIN_N_TO_RANK} ${what}`}>too few ({n})</span>;
}

/**
 * Admin → Site Events (#477): what readers open, counted by browser.
 *
 * Reads a bounded window of the site_events rows (migration 090) through the
 * table's admin-only read policy and counts them here (utils/siteEventStats.js);
 * there is no function in the database for it. Counts only — the rows hold an
 * anonymous browser token, never a user, email or IP.
 *
 * The point is to choose featured comparisons with what readers actually open
 * in view, so every figure carries the n it stands on and a row with too few is
 * marked instead of ranked.
 */
export default function SiteEventsPanel() {
    const [days, setDays] = useState(DEFAULT_WINDOW_DAYS);
    const [grain, setGrain] = useState('day');
    const { comparisons } = useFeaturedComparisons();

    // The window's edges are fixed when it is read, so a re-render does not move them.
    const load = useCallback(async () => {
        const to = new Date();
        const since = days ? new Date(to.getTime() - days * 86400000) : null;
        const result = await dataService.getSiteEvents({ since: since?.toISOString() ?? null, cap: EVENT_ROW_CAP });
        return { ...result, since, to };
    }, [days]);
    const { data, loading, error, reload } = useAsyncResource(load, [load]);

    const rows = useMemo(() => data?.rows ?? [], [data]);
    const total = useMemo(() => headline(rows), [rows]);
    const byComparison = useMemo(() => comparisonCounts(rows, comparisons ?? []), [rows, comparisons]);
    const byChart = useMemo(() => chartTypeCounts(rows), [rows]);
    // With the cap hit the oldest rows are the ones missing, so the window
    // really starts where the rows do.
    const windowStart = data?.truncated ? total.first : (data?.since ?? total.first);
    const series = useMemo(
        () => homeViewsOverTime(rows, grain, { from: windowStart ?? undefined, to: data?.to }),
        [rows, grain, windowStart, data?.to],
    );

    return (
        <div className="events-view">
            <div className="controls-strip">
                <span className="text-meta">Window</span>
                <div className="stats-segmented" role="group" aria-label="Window">
                    {WINDOWS.map(w => (
                        <button key={w.label} type="button" className={days === w.days ? 'active' : ''} onClick={() => setDays(w.days)}>
                            {w.label}
                        </button>
                    ))}
                </div>
                <button type="button" className="btn btn-secondary text-sm" onClick={reload} disabled={loading}>
                    {loading ? 'Loading…' : '↻ Refresh'}
                </button>
            </div>

            {error && <div className="note-panel is-danger">⚠️ Site events could not be read: {error.message}</div>}
            {data?.missing && (
                <div className="note-panel">Migration 090 (site events) has not been applied to this database, so nothing has been recorded.</div>
            )}

            <div className="note-panel is-info">
                <p className="subsection-title">Read these as counts of browsers, not of people</p>
                <ul className="events-caveats">
                    <li>
                        A <strong>browser</strong> is an anonymous token kept in the browser's storage. One person on two browsers
                        counts twice; a browser that clears its storage starts again as a new one. Nothing here knows a user, an email or an address.
                    </li>
                    <li>Curators' own clicks and the pop-out window are not counted, so these are readers' numbers, and a page that only curators open shows nothing.</li>
                    <li>
                        Logging is rate limited to 60 events a minute per browser, and an event that fails to send is dropped without notice.
                        Counts can be low; they are not high by that cause.
                    </li>
                    <li>
                        The log is new, so the window is short at first and a few weeks of it is still a handful of browsers. A row with fewer than {MIN_N_TO_RANK} observations is marked and not ranked.
                    </li>
                </ul>
            </div>

            {!loading && !error && !data?.missing && (
                <>
                    <p className="text-note">
                        {rows.length === 0
                            ? 'No events in this window yet.'
                            : `${plural(total.events, 'event')} from ${plural(total.browsers, 'browser')}, ${dateText(total.first)} to ${dateText(total.last)}.`}
                        {data?.truncated && (
                            <> The window holds more than {EVENT_ROW_CAP.toLocaleString()} events, so only the newest are read and
                            everything older than {dateText(total.first)} is left out.</>
                        )}
                    </p>

                    <div className="stat-grid">
                        <StatCell label="Events" value={total.events.toLocaleString()} />
                        <StatCell label="Browsers" value={total.browsers.toLocaleString()} title="Distinct browser tokens. A browser, not a person." />
                        <StatCell label="Home views" value={total.homeViews.toLocaleString()} title="Home opened, once per browser tab per comparison" />
                        <StatCell label="Opened from Home" value={total.featuredOpens.toLocaleString()} title="A featured chart's Open chart → clicked" />
                        <StatCell label="Resets" value={total.resets.toLocaleString()} title="The reset to a featured comparison used" />
                        <StatCell label="Chart opens" value={total.chartViews.toLocaleString()} title="A chart tab or mode opened, from anywhere" />
                    </div>

                    <section className="card">
                        <h3 className="section-title mb-1">Featured comparisons</h3>
                        <p className="text-note mb-2">
                            Home views is the n for each row: how often the comparison was the one shown. Opens are clicks on its
                            charts' Open chart →. Opens per view is shown only where there are {MIN_N_TO_RANK} or more views.
                        </p>
                        {byComparison.length === 0 ? (
                            <p className="text-note">There are no featured comparisons and no events for one.</p>
                        ) : (
                            <div className="import-table-container">
                                <table className="events-table">
                                    <thead>
                                        <tr>
                                            <th>Comparison</th>
                                            <th className="numeric">Home views</th>
                                            <th className="numeric">Browsers</th>
                                            <th className="numeric">Chart opens</th>
                                            <th className="numeric">Browsers</th>
                                            <th className="numeric">Opens per view</th>
                                            <th className="numeric">Resets</th>
                                            <th>Opens by chart</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {byComparison.map(c => (
                                            <tr key={c.slug} className={c.sparse ? 'is-sparse' : ''}>
                                                <td>
                                                    <span className="events-name">{c.title}</span>
                                                    <span className="text-caption block">
                                                        {c.slug}
                                                        {!c.known && ' · no longer exists'}
                                                        {c.known && !c.isListed && ' · unlisted'}
                                                    </span>
                                                    {c.sparse && <TooFew n={c.views} what="Home views" />}
                                                </td>
                                                <td className="numeric">{c.views}</td>
                                                <td className="numeric">{c.viewers}</td>
                                                <td className="numeric">{c.opens}</td>
                                                <td className="numeric">{c.openers}</td>
                                                <td className="numeric">
                                                    {c.sparse ? `${c.opens} of ${c.views}` : `${Math.round((c.opens / c.views) * 100)}% (${c.opens} of ${c.views})`}
                                                </td>
                                                <td className="numeric">{c.resets}</td>
                                                <td>
                                                    {c.charts.length === 0 ? '—' : (
                                                        <ol className="events-charts">
                                                            {c.charts.map(ch => (
                                                                <li key={ch.number} className={ch.opens === 0 ? 'is-unopened' : ''}>
                                                                    {ch.number}. {ch.title} <span className="text-data">{ch.opens}</span>
                                                                </li>
                                                            ))}
                                                        </ol>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </section>

                    <section className="card">
                        <h3 className="section-title mb-1">Chart types</h3>
                        <p className="text-note mb-2">
                            Every time a chart tab or mode was opened. <strong>From Home</strong> is the opens matched to an Open chart →
                            click by the same browser within {HOME_PAIR_SECONDS} seconds; <strong>other ways</strong> is everything else
                            — the navigation, a shared link, the back button. It is a match, not a record: a click whose chart open was
                            refused or lost is not matched.
                        </p>
                        {byChart.length === 0 ? (
                            <p className="text-note">No chart has been opened in this window.</p>
                        ) : (
                            <div className="import-table-container">
                                <table className="events-table">
                                    <thead>
                                        <tr>
                                            <th>Chart</th>
                                            <th className="numeric">Opens</th>
                                            <th className="numeric">From Home</th>
                                            <th className="numeric">Other ways</th>
                                            <th className="numeric">Browsers</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {byChart.map(c => (
                                            <tr key={c.mode} className={c.sparse ? 'is-sparse' : ''}>
                                                <td>
                                                    <span className="events-name">{c.label}</span>
                                                    <span className="text-caption block">{c.mode}</span>
                                                    {c.sparse && <TooFew n={c.opens} what="opens" />}
                                                </td>
                                                <td className="numeric">{c.opens}</td>
                                                <td className="numeric">{c.fromHome}</td>
                                                <td className="numeric">{c.other}</td>
                                                <td className="numeric">{c.browsers}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </section>

                    <section className="card">
                        <div className="events-section-head">
                            <h3 className="section-title">Home views over time</h3>
                            <div className="stats-segmented" role="group" aria-label="Group by">
                                <button type="button" className={grain === 'day' ? 'active' : ''} onClick={() => setGrain('day')}>By day</button>
                                <button type="button" className={grain === 'week' ? 'active' : ''} onClick={() => setGrain('week')}>By week</button>
                            </div>
                        </div>
                        <p className="text-note mb-2">
                            Days and weeks are in this browser's time zone; a week starts on Monday and the current one is partial.
                            {series.trimmed && ` Only the newest ${series.periods.length} ${grain === 'day' ? 'days' : 'weeks'} are shown.`}
                        </p>
                        <SeriesTable periods={series.periods} grain={grain} />
                    </section>
                </>
            )}
        </div>
    );
}

/** Home views per period as a table with a bar, every period listed, quiet ones at zero. */
function SeriesTable({ periods, grain }) {
    const peak = Math.max(1, ...periods.map(p => p.views));
    // Newest first: the latest period is what a curator opens this to see.
    const newestFirst = [...periods].reverse();
    return (
        <div className="import-table-container">
            <table className="events-table">
                <thead>
                    <tr>
                        <th>{grain === 'day' ? 'Day' : 'Week of'}</th>
                        <th className="numeric">Home views</th>
                        <th className="numeric">Browsers</th>
                        <th className="events-bar-column"><span className="sr-only">Home views, drawn</span></th>
                    </tr>
                </thead>
                <tbody>
                    {newestFirst.map(p => (
                        <tr key={p.key} className={p.views === 0 ? 'is-sparse' : ''}>
                            <td>
                                {grain === 'day'
                                    ? p.start.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
                                    : shortDate(p.start)}
                            </td>
                            <td className="numeric">{p.views}</td>
                            <td className="numeric">{p.browsers}</td>
                            <td className="events-bar-column">
                                <div className="events-bar-track">
                                    <div className="events-bar" style={{ width: `${(p.views / peak) * 100}%` }} />
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

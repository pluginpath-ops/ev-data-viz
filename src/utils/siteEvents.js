/**
 * What the site counts, and when it does not (#448).
 *
 * The Home tab is curated by hand. These events are what a curator can curate
 * from: how often Home is opened, which featured comparison's charts are
 * clicked into, whether the reset is used, which chart tabs are opened at all.
 * Migration 098 (after 090) holds the same list in its CHECK and in log_site_event; the
 * wiring suite keeps the three in step.
 *
 * Pure module — no React, no storage. The caller passes in what it knows.
 */

/** The events, by the name the database stores. */
export const SITE_EVENTS = {
    /** Home was opened, once per browser tab per comparison. slug: the comparison shown. */
    HOME_VIEW:      'home_view',
    /** A chart of a featured comparison was opened from Home. slug; detail { chart: 1-based number, mode }. */
    FEATURED_OPEN:  'featured_open',
    /** The reset to a featured comparison was used. slug. */
    FEATURED_RESET: 'featured_reset',
    /** A chart tab or mode was opened, however the reader got there. detail { mode }. */
    CHART_VIEW:     'chart_view',
    // The setup wizard (migration 098). Never the answers themselves.
    /** The wizard was opened. detail { from: 'home' | 'empty' | 'nav' }. */
    SETUP_OPEN:     'setup_open',
    /** Apply was pressed. detail { goal, cars: a kind key | 'pick' | 'keep', skipped: questions left blank }. */
    SETUP_APPLY:    'setup_apply',
    /** Closed without applying. detail { step }. */
    SETUP_CLOSE:    'setup_close',
    /** The season note's toggle. detail { to: 'summer' | 'winter' }. */
    SEASON_TOGGLE:  'season_toggle',
};

/**
 * Whether an event should be recorded at all. A curator's own clicks are not a
 * reader's, so they are skipped (they would otherwise be most of the numbers on
 * a small site); so is the pop-out window, which is a second view of a click
 * already counted in the main tab.
 */
export function shouldRecord({ role, popout }) {
    if (popout) return false;
    return role !== 'admin' && role !== 'contributor';
}

/** The storage key that says an event was already counted in this tab. */
export const onceKey = (event, slug = null) => `evbench_event:${event}:${slug ?? ''}`;

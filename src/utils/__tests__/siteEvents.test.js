import { describe, it, expect } from 'vitest';
import { SITE_EVENTS, shouldRecord, onceKey } from '../siteEvents';

describe('which clicks are counted', () => {
    it('counts readers, signed in or not', () => {
        expect(shouldRecord({ role: null, popout: false })).toBe(true);
        expect(shouldRecord({ role: 'user', popout: false })).toBe(true);
    });

    it('skips a curator\'s own clicks', () => {
        expect(shouldRecord({ role: 'admin', popout: false })).toBe(false);
        expect(shouldRecord({ role: 'contributor', popout: false })).toBe(false);
    });

    it('skips the pop-out, whoever opened it', () => {
        expect(shouldRecord({ role: null, popout: true })).toBe(false);
    });
});

describe('the events', () => {
    it('are four, named for what they say', () => {
        expect(Object.values(SITE_EVENTS).sort()).toEqual(['chart_view', 'featured_open', 'featured_reset', 'home_view']);
    });

    it('keys a once-per-tab event by the event and the comparison', () => {
        expect(onceKey('home_view', 'ski-trip')).toBe('evbench_event:home_view:ski-trip');
        expect(onceKey('home_view')).toBe('evbench_event:home_view:');
        expect(onceKey('home_view', 'a')).not.toBe(onceKey('home_view', 'b'));
    });
});

import { describe, it, expect, afterEach } from 'vitest';
import { storedTheme, DEFAULT_THEME, THEME_KEY, THEMES } from '../../styles/themeBootstrap';

describe('the stored theme', () => {
    afterEach(() => { delete globalThis.localStorage; });

    const withStored = (value) => {
        globalThis.localStorage = { getItem: (key) => (key === THEME_KEY ? value : null) };
    };

    it('follows the device unless the reader has chosen', () => {
        expect(DEFAULT_THEME).toBe('system');
        withStored(null);
        expect(storedTheme()).toBe('system');
    });

    it('returns each choice it offers', () => {
        for (const choice of THEMES) {
            withStored(choice);
            expect(storedTheme()).toBe(choice);
        }
    });

    it('ignores a value it does not know', () => {
        withStored('sepia');
        expect(storedTheme()).toBe('system');
    });

    it('survives storage that throws, as in a private window', () => {
        globalThis.localStorage = { getItem: () => { throw new Error('blocked'); } };
        expect(storedTheme()).toBe('system');
    });
});

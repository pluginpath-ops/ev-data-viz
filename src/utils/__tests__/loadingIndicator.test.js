import { describe, it, expect } from 'vitest';
import { LOADING_INDICATOR_DELAY_MS, isLoadingIndicatorVisible } from '../loadingIndicator';

describe('isLoadingIndicatorVisible', () => {
    it('never shows when nothing is loading, however long it has been', () => {
        expect(isLoadingIndicatorVisible(false, 0)).toBe(false);
        expect(isLoadingIndicatorVisible(false, 10_000)).toBe(false);
    });

    it('holds back a load that has not yet lasted the delay', () => {
        expect(isLoadingIndicatorVisible(true, 0)).toBe(false);
        expect(isLoadingIndicatorVisible(true, LOADING_INDICATOR_DELAY_MS - 1)).toBe(false);
    });

    it('shows once the load has lasted the delay', () => {
        expect(isLoadingIndicatorVisible(true, LOADING_INDICATOR_DELAY_MS)).toBe(true);
        expect(isLoadingIndicatorVisible(true, LOADING_INDICATOR_DELAY_MS * 10)).toBe(true);
    });

    it('takes its own delay', () => {
        expect(isLoadingIndicatorVisible(true, 99, 100)).toBe(false);
        expect(isLoadingIndicatorVisible(true, 100, 100)).toBe(true);
    });

    it('treats a missing loading flag as not loading', () => {
        expect(isLoadingIndicatorVisible(undefined, 10_000)).toBe(false);
    });

    it('keeps the delay inside the range that spares fast loads without hiding slow ones', () => {
        expect(LOADING_INDICATOR_DELAY_MS).toBeGreaterThanOrEqual(150);
        expect(LOADING_INDICATOR_DELAY_MS).toBeLessThanOrEqual(300);
    });
});

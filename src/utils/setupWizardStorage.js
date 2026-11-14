/**
 * What the setup wizard remembers in this browser, per viewer, not per
 * signed-in user (owner, 2026-11-08):
 *
 *   - the last answers, so reopening starts where the reader left off;
 *   - the review bar — the charts the last Apply chose, and the season shown —
 *     so it survives a reload until closed or replaced by the next Apply.
 *
 * A convenience only: storage can be missing or refuse (a private window,
 * blocked site data), and then the wizard starts from STARTING_ANSWERS and the bar is gone on
 * reload. What is read back is checked, so a removed option or chart reads as
 * nothing.
 */
import { sanitizeAnswers, STARTING_ANSWERS } from './setupWizard';
import { ALL_CHART_MODES } from '../constants/chartNav';

const ANSWERS_KEY = 'evbench.setupWizard.answers';
const REVIEW_KEY = 'evbench.setupWizard.review';

const readJson = (key) => {
    try {
        const raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
};
const writeJson = (key, value) => {
    try {
        if (value == null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, JSON.stringify(value));
    } catch { /* not remembered */ }
};

/** The last answers, or the starting ones when none were saved. */
export const readSetupAnswers = () => {
    const saved = readJson(ANSWERS_KEY);
    return saved ? sanitizeAnswers(saved) : { ...STARTING_ANSWERS };
};
export const writeSetupAnswers = (answers) => writeJson(ANSWERS_KEY, answers);

const isSeason = (s) => s && ['summer', 'winter'].includes(s.season) && Number.isFinite(s.tempF);

/** The review bar as stored: `{ modes, season }`, or null when there is none. */
export function sanitizeReview(raw) {
    const modes = Array.isArray(raw?.modes) ? raw.modes.filter(m => ALL_CHART_MODES.includes(m)) : [];
    if (!modes.length) return null;
    const s = raw.season;
    const season = isSeason(s) && isSeason(s.other) ? { season: s.season, tempF: s.tempF, harder: !!s.harder, other: { season: s.other.season, tempF: s.other.tempF } } : null;
    return { modes, season };
}

export const readSetupReview = () => sanitizeReview(readJson(REVIEW_KEY));
/** Store the bar, or null to forget it. */
export const writeSetupReview = (review) => writeJson(REVIEW_KEY, review);

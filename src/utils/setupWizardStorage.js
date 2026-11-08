/**
 * The setup wizard's last answers, remembered in this browser so reopening it
 * starts where the reader left off. Per viewer, not per signed-in user (owner,
 * 2026-11-08).
 *
 * A convenience only: storage can be missing or refuse (a private window,
 * blocked site data), and then the wizard simply starts empty. What is read
 * back is checked against the current config (sanitizeAnswers), so an option
 * that has since been removed reads as unanswered.
 */
import { sanitizeAnswers } from './setupWizard';

const KEY = 'evbench.setupWizard.answers';

export function readSetupAnswers() {
    try {
        const raw = window.localStorage.getItem(KEY);
        return sanitizeAnswers(raw ? JSON.parse(raw) : null);
    } catch {
        return sanitizeAnswers(null);
    }
}

export function writeSetupAnswers(answers) {
    try { window.localStorage.setItem(KEY, JSON.stringify(answers)); } catch { /* not remembered */ }
}

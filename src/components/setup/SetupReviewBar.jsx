/**
 * The review bar: after the setup wizard's Apply, the charts the reader chose,
 * in order, at the foot of the window — the one on screen marked, any one a
 * click away, and Next to the one after it. It also carries the season line
 * (the harder season, and a toggle to the other), Change answers, and ×.
 *
 * A bar rather than a list inside the modal, because the modal covers the
 * chart the reader is meant to be looking at. Fixed to the foot of the window
 * like the notice bar, so appearing never moves anything under the cursor.
 * The season note lives here rather than in a second notice: it is about the
 * same charts, and two bars at the foot would stack over the page.
 *
 * Every word is constants/setupWizard.js `reviewBar`. App keeps it in browser
 * storage (setupWizardStorage.js) until × or the next Apply.
 *
 *   review         { modes, season } — the charts in order; season may be null
 *   currentMode    the chart mode on screen, or null when no chart is
 *   onOpen(mode, index)
 *   onToggleSeason()
 *   onChangeAnswers()
 *   onClose()
 */
import { SETUP_WIZARD } from '../../constants/setupWizard';
import { chartName, seasonText } from '../../utils/setupWizard';

export default function SetupReviewBar({ review, currentMode, units, onOpen, onToggleSeason, onChangeAnswers, onClose }) {
    const B = SETUP_WIZARD.reviewBar;
    const at = review.modes.indexOf(currentMode);
    const next = at + 1 < review.modes.length ? at + 1 : null;
    const season = review.season ? seasonText(review.season, units) : null;
    return (
        <div className="fixed-action-bar is-info review-bar" role="region" aria-label={B.title}>
            <div className="page-container review-bar-row">
                <span className="text-micro">{B.title}</span>
                <ol className="flex flex-wrap items-center gap-1 list-none m-0 p-0">
                    {review.modes.map((mode, i) => (
                        <li key={mode}>
                            <button
                                type="button"
                                className={`btn btn-toggle${i === at ? ' active' : ''}`}
                                aria-current={i === at ? 'page' : undefined}
                                onClick={() => i !== at && onOpen(mode, i)}
                            >
                                {review.modes.length > 1 ? `${i + 1}. ` : ''}{chartName(mode)}
                            </button>
                        </li>
                    ))}
                </ol>
                {next != null && (
                    <button type="button" className="btn btn-secondary" onClick={() => onOpen(review.modes[next], next)}>{B.next}</button>
                )}
                {season && (
                    <span className="review-bar-season">
                        <span className="text-secondary">{season.line}</span>
                        <button type="button" className="btn btn-secondary" onClick={onToggleSeason}>{season.toggle}</button>
                    </span>
                )}
                <span className="review-bar-end">
                    <button type="button" className="btn btn-secondary" onClick={onChangeAnswers}>{B.change}</button>
                    <button type="button" className="modal-close" onClick={onClose} aria-label={B.close} title={B.close}>&times;</button>
                </span>
            </div>
        </div>
    );
}

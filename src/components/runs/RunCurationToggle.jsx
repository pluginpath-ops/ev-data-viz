/**
 * One of a curator's decisions about a test, as a button that shows where the
 * test stands and flips it on click — Unlist, Exclude, Override checks.
 *
 * It used to be a pair: a badge by the title saying the state, and an item in
 * the More menu doing the action, with nothing tying them together. Here one
 * control does both, so it reads as the action while the test is at the
 * default ("⊘ Unlist") and as the state once it has been changed ("⊘
 * Unlisted"). The vocabulary gives the default no word of its own — counting
 * is what a test does unless excluded — so the default slot says what a click
 * would do rather than inventing one.
 */
export default function RunCurationToggle({ isSet, glyph, action, state, title, onClick }) {
    return (
        <button
            onClick={onClick}
            title={title}
            aria-pressed={isSet}
            className={`btn run-curation-toggle${isSet ? ' is-set' : ''}`}
        >
            {glyph} {isSet ? state : action}
        </button>
    );
}

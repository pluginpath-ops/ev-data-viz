import { useState } from 'react';
import Popover from './Popover';
import {
    OKABE_ITO, OKABE_ITO_NAMES, DEFAULT_RUN_COLOR, seriesColorNote,
} from '../utils/colorUtils';

/**
 * Pick the colour a series is drawn in.
 *
 * ── Why this is not an <input type="color"> ─────────────────────────────────
 *
 * It was, in five places. That control opens an OS dialog: one colour at a
 * time, modal, over the top of the chart, with no view of the set you are
 * picking against — which is the entire problem, because a series colour only
 * means anything RELATIVE to the other series on the same plot. Picking a blue
 * without being able to see the blue already on the chart is guessing.
 *
 * It also could not say the one thing that most needed saying. Auto Color
 * assigns from Okabe-Ito over the top of whatever is stored, so the colour a
 * run HAS and the colour it is DRAWN in come apart routinely, and the old
 * control expressed that as a `title` attribute on one of the five pickers.
 * `seriesColorNote` makes it a sentence, in the peek and in the panel.
 *
 * The palette offered is the one `resolveChartColors` assigns from, so a manual
 * pick and an automatic one draw from a single colourblind-safe set instead of
 * a hand-typed hex landing next to a palette slot it clashes with.
 *
 * ── Draft, then Apply ───────────────────────────────────────────────────────
 *
 * Nothing commits until Apply. Cancel, ×, Escape and a click outside all
 * discard — the policy settled for every popover in #299, and the reason the
 * 400ms commit debounce the old rail picker needed is gone: it existed only
 * because a native picker fires on every pixel of a drag.
 *
 * ── One control, two kinds of colour ────────────────────────────────────────
 *
 * The caller decides what a write MEANS, which is why `onChange` is a plain
 * callback and not a run id. In Tests & Data it writes `runs.color`, durably,
 * for every visitor. In a chart sidebar it sets a session override and touches
 * no database at all. Both are "set this colour"; only the caller knows which,
 * and that distinction is load-bearing (see hooks/useStickyChartColors).
 *
 * @param {string}  value       the colour actually being drawn right now
 * @param {string}  [stored]    the durable preference, when there is one and it
 *                              can differ from `value`. Omit where they cannot
 * @param {(hex: string) => void} onChange   commit. Required
 * @param {() => void} [onReset]  clear back to the palette's choice. Supplying
 *                              it is what puts "Auto" in the panel — omit it
 *                              where a site has nothing to fall back to
 * @param {string}  [label]     what is being coloured, for the header and the
 *                              accessible name
 * @param {string}  [className] classes for the wrapper
 */
export default function SeriesColorPicker({
    value,
    stored = null,
    onChange,
    onReset = null,
    label = '',
    className = '',
}) {
    const plotted = value || DEFAULT_RUN_COLOR;
    const [draft, setDraft] = useState(plotted);

    const note = seriesColorNote(stored, plotted);
    const subject = label || 'this series';

    return (
        <Popover
            className={className}
            title={label ? `Colour — ${label}` : 'Series colour'}
            width="16rem"
            // Opening is what seeds the draft, so a panel reopened after a
            // cancel starts from what is on the chart rather than from the
            // pick that was thrown away.
            onOpenChange={open => { if (open) setDraft(plotted); }}
            peek={
                <>
                    <ColorNote note={note} />
                    <span className="popover-more">Click for the palette</span>
                </>
            }
            trigger={({ onClick, ...props }) => (
                <button
                    {...props}
                    type="button"
                    className="series-swatch--button"
                    style={{ backgroundColor: plotted }}
                    aria-label={`Colour for ${subject} — ${plotted}`}
                    // Three of the five call sites sit inside a <label> that
                    // wraps the row's checkbox, so a click that reaches the
                    // label toggles the run's selection as well as opening
                    // this. The old controls each remembered to stop that
                    // themselves and two of them forgot; a swatch means
                    // "open the colour panel" and never anything an ancestor
                    // has a claim on, so it is stopped here, once.
                    onClick={e => { e.stopPropagation(); onClick(e); }}
                />
            )}
        >
            {({ close }) => (
                <>
                    <div className="color-picker-body">
                        <ColorNote note={note} />
                        <div className="color-slots" role="group" aria-label="Okabe-Ito palette">
                            {OKABE_ITO.map((hex, i) => (
                                <button
                                    key={hex}
                                    type="button"
                                    className={`color-slot${sameHex(hex, draft) ? ' is-current' : ''}`}
                                    style={{ backgroundColor: hex }}
                                    aria-label={OKABE_ITO_NAMES[i]}
                                    aria-pressed={sameHex(hex, draft)}
                                    onClick={() => setDraft(hex)}
                                />
                            ))}
                        </div>
                        {/* The escape hatch, kept deliberately: the palette is
                            seven colours and a chart can hold more series than
                            that. It is the native control because matching a
                            brand colour or an existing screenshot wants a full
                            gamut, which no grid can offer. */}
                        <label className="color-custom">
                            <input
                                type="color"
                                value={draft}
                                onChange={e => setDraft(e.target.value)}
                                aria-label="Custom colour"
                            />
                            <span className="color-custom-hex">{draft.toUpperCase()}</span>
                        </label>
                    </div>
                    <div className="popover-foot">
                        {onReset && (
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => { onReset(); close(); }}
                                title="Hand this series back to the palette"
                            >
                                Auto
                            </button>
                        )}
                        <span className="popover-foot-gap" />
                        <button type="button" className="btn btn-secondary" onClick={close}>
                            Cancel
                        </button>
                        <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => { onChange(draft); close(); }}
                        >
                            Apply
                        </button>
                    </div>
                </>
            )}
        </Popover>
    );
}

/** Hex equality without caring which case either side was written in. */
function sameHex(a, b) {
    return String(a).toLowerCase() === String(b).toLowerCase();
}

/**
 * The stored-versus-plotted sentence. Silent in the one case where there is
 * genuinely nothing to report — a stored colour that is also the drawn one —
 * because a line that always shows up stops being read.
 */
function ColorNote({ note }) {
    if (note.kind === 'saved') return null;
    return (
        <span className="color-note">
            {note.kind === 'auto'
                ? <>No saved colour — drawn <b>{note.plotted.toUpperCase()}</b></>
                : <>Saved <b>{note.stored.toUpperCase()}</b> · drawn <b>{note.plotted.toUpperCase()}</b></>}
        </span>
    );
}

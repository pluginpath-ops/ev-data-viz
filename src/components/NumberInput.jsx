import { useRef, useState } from 'react';
import { parseNumberInput, spinFromPlaceholder, spinnerHit } from '../utils/numberInput';

/**
 * A number field that keeps what is typed and commits only a valid number.
 *
 * A controlled `<input type="number">` that commits on every keystroke has to
 * do SOMETHING with the text in between two numbers, and every field here did
 * something wrong: an emptied box committed `Number('')` (0), or a clamp's
 * floor (Charge Stop's start went to 1), or snapped back to the old value —
 * so backspacing "100" to retype "20" produced 120. Here the box shows the
 * text as typed; while it is not a valid number in [min, max] it is marked
 * invalid and nothing is committed, so every figure keeps following the last
 * valid one. Leaving the field puts the committed value back.
 *
 * `value` and `onChange` speak numbers; `onChange` is called only with a valid
 * one (or null, when `allowEmpty` and the box is cleared). `integer` rounds
 * what is committed; `onStep` (a step size) commits only values on that grid,
 * for settings stored on it. Everything else passes through to the input.
 *
 * An empty box that shows a number as its placeholder spins from THAT number:
 * one click up is placeholder + step, down is placeholder − step. The browser
 * would start from zero, so from `min`, which is not what the box suggests.
 */
export default function NumberInput({
    value, onChange, min, max, integer = false, allowEmpty = false, onStep = null, onBlur, ...rest
}) {
    // null while not being edited: the box shows the committed value.
    const [draft, setDraft] = useState(null);

    // Which arrow the last press hit, so a change with no typing in it can be
    // told from a typed one and its direction known (the browser does not say).
    const pressed = useRef(null);

    const parse = (text) => parseNumberInput(text, { min, max, integer, allowEmpty, onStep });

    const shown = value == null || Number.isNaN(value) ? '' : String(value);
    const text = draft ?? shown;
    const invalid = draft != null && !parse(draft).ok;


    // Commits a value the box did not get from typing (a spinner or arrow key).
    const commit = (n) => {
        setDraft(String(n));
        if (parse(String(n)).ok && n !== value) onChange(n);
    };
    const fromPlaceholder = (dir) => spinFromPlaceholder(rest.placeholder, dir, { min, max, step: rest.step });

    return (
        <input
            type="number"
            min={min}
            max={max}
            {...rest}
            value={text}
            aria-invalid={invalid || undefined}
            onKeyDown={e => {
                rest.onKeyDown?.(e);
                const dir = e.key === 'ArrowUp' ? 'up' : e.key === 'ArrowDown' ? 'down' : null;
                const n = dir && text === '' && !e.defaultPrevented ? fromPlaceholder(dir) : null;
                if (n != null) { e.preventDefault(); commit(n); }
            }}
            onMouseDown={e => {
                rest.onMouseDown?.(e);
                pressed.current = spinnerHit(e.currentTarget.getBoundingClientRect(), e.clientX, e.clientY);
            }}
            onChange={e => {
                // A change that is not typing (no inputType), from an empty
                // box, after a press on an arrow: the spinner.
                const dir = pressed.current;
                pressed.current = null;
                const stepped = dir && text === '' && !e.nativeEvent.inputType ? fromPlaceholder(dir) : null;
                if (stepped != null) { commit(stepped); return; }
                setDraft(e.target.value);
                const { ok, n } = parse(e.target.value);
                if (ok && n !== value) onChange(n);
            }}
            onBlur={e => { setDraft(null); onBlur?.(e); }}
        />
    );
}

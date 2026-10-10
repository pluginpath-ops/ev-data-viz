import { useState } from 'react';
import { parseNumberInput } from '../utils/numberInput';

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
 * what is committed. Everything else passes through to the input.
 */
export default function NumberInput({
    value, onChange, min, max, integer = false, allowEmpty = false, onBlur, ...rest
}) {
    // null while not being edited: the box shows the committed value.
    const [draft, setDraft] = useState(null);

    const parse = (text) => parseNumberInput(text, { min, max, integer, allowEmpty });

    const shown = value == null || Number.isNaN(value) ? '' : String(value);
    const text = draft ?? shown;
    const invalid = draft != null && !parse(draft).ok;

    return (
        <input
            type="number"
            min={min}
            max={max}
            {...rest}
            value={text}
            aria-invalid={invalid || undefined}
            onChange={e => {
                setDraft(e.target.value);
                const { ok, n } = parse(e.target.value);
                if (ok && n !== value) onChange(n);
            }}
            onBlur={e => { setDraft(null); onBlur?.(e); }}
        />
    );
}

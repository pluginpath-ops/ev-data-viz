import { useState } from 'react';

/**
 * "＋ Variant": a new vehicle that inherits everything from this one.
 *
 * Beside Copy on the vehicle card and in Tests & Data, and the difference is
 * the whole point of having both. Copy writes the new vehicle its own
 * duplicates of every value and test, so a later fix to either reaches only
 * that one. A variant owns nothing until the curator sets it: specs, tests,
 * color, photo and tags all come from the source at read time, and a variant
 * is for the same car with a stated difference (battery, weight, wheels).
 *
 * `onCreate` resolves when the variant exists; the caller opens it for editing.
 */
export default function NewVariantButton({ onCreate, disabled = false }) {
    const [creating, setCreating] = useState(false);

    const handleClick = async (e) => {
        e.stopPropagation();
        setCreating(true);
        try {
            await onCreate();
        } finally {
            setCreating(false);
        }
    };

    return (
        <button
            type="button"
            onClick={handleClick}
            disabled={disabled || creating}
            title="A new vehicle that inherits this one's specs, tests, color, photo and tags. Set only what differs."
            className="btn btn-secondary disabled:opacity-50"
        >
            {creating ? <><span className="spinner-inline" />Creating…</> : '＋ Variant'}
        </button>
    );
}

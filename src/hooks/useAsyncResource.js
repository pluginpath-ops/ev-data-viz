import { useState, useEffect, useCallback } from 'react';

/**
 * Load something asynchronous once per key, with cancellation.
 *
 * The shape this replaces appears all over the app: an effect calls a service,
 * a `.then` sets state, and a `cancelled` flag guards the unmount. Written
 * inline it is four pieces of bookkeeping that are easy to get subtly wrong —
 * the common bug being a stale response from a previous key overwriting a newer
 * one, since the flag only guards unmount and not a key change.
 *
 * Returns `{ data, loading, error, reload }`. `error` is the thrown value, not a
 * boolean, so a caller can say what went wrong rather than only that something
 * did.
 *
 * @param {Function} loader  async () => data. Must be stable — wrap in useCallback.
 * @param {Array}    deps    re-run when these change, like an effect's deps.
 */
export function useAsyncResource(loader, deps = []) {
    const [state, setState] = useState({ data: null, loading: true, error: null });
    const [nonce, setNonce] = useState(0);

    /** Re-run the loader, for a caller that knows the source changed. */
    const reload = useCallback(() => setNonce(n => n + 1), []);

    useEffect(() => {
        let cancelled = false;
        setState(prev => ({ ...prev, loading: true, error: null }));
        Promise.resolve()
            .then(loader)
            .then(data => { if (!cancelled) setState({ data, loading: false, error: null }); })
            .catch(error => { if (!cancelled) setState({ data: null, loading: false, error }); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [...deps, nonce]);

    return { ...state, reload };
}

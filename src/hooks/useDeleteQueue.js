import { useState, useEffect, useRef, useCallback } from 'react';

const UNDO_WINDOW_MS = 5000;

/**
 * Two-phase soft-delete queue.
 *
 * Phase 1 — Queue:
 *   Items are flagged with queueDelete(id). No DB write happens yet.
 *   restoreItem(id) or clearQueue() removes items from the queue.
 *
 * Phase 2 — Undo window:
 *   commitDeletes() moves queued ids to committedDeletes (items disappear
 *   from the UI immediately) and starts a 5 s countdown. If undoDelete()
 *   is called before the timer fires, no DB write happens and items
 *   reappear. After 5 s the real onDelete(id) calls are made in batch.
 *
 * On unmount: any committed-but-not-yet-deleted items are deleted
 * immediately so navigating away never silently preserves data.
 *
 * @param {function} onDelete  called with (id) per item after the undo window
 */
export function useDeleteQueue(onDelete) {
    const [pendingDeletes, setPendingDeletes]     = useState(new Set());
    const [committedDeletes, setCommittedDeletes] = useState(new Set());
    const [undoState, setUndoState]               = useState(null); // { count, startTime }
    const [secondsLeft, setSecondsLeft]           = useState(0);

    const deleteTimerRef    = useRef(null);
    const countdownRef      = useRef(null);
    // Ref so the cleanup effect can fire remaining deletes without stale closures
    const pendingCommitRef  = useRef(null); // { toDelete: Set } | null
    const onDeleteRef       = useRef(onDelete);
    useEffect(() => { onDeleteRef.current = onDelete; });

    const stopTimers = useCallback(() => {
        clearTimeout(deleteTimerRef.current);
        clearInterval(countdownRef.current);
    }, []);

    // ── Phase 1 helpers ─────────────────────────────────────────────────────

    const queueDelete = useCallback((id) => {
        setPendingDeletes(prev => new Set([...prev, id]));
    }, []);

    const restoreItem = useCallback((id) => {
        setPendingDeletes(prev => {
            const next = new Set(prev);
            next.delete(id);
            return next;
        });
    }, []);

    const clearQueue = useCallback(() => {
        setPendingDeletes(new Set());
    }, []);

    // ── Phase 2: commit → undo window → actual delete ────────────────────────

    const commitDeletes = useCallback(() => {
        if (pendingDeletes.size === 0) return;

        const toDelete = new Set(pendingDeletes);
        const count    = toDelete.size;

        stopTimers();
        setPendingDeletes(new Set());
        setCommittedDeletes(toDelete);
        setUndoState({ count, startTime: Date.now() });
        setSecondsLeft(5);

        pendingCommitRef.current = { toDelete };

        // Visual countdown (1 s ticks)
        countdownRef.current = setInterval(() => {
            setSecondsLeft(s => Math.max(0, s - 1));
        }, 1000);

        // Actual DB deletes after the window
        deleteTimerRef.current = setTimeout(async () => {
            clearInterval(countdownRef.current);
            pendingCommitRef.current = null;
            for (const id of toDelete) {
                await onDeleteRef.current(id);
            }
            setCommittedDeletes(new Set());
            setUndoState(null);
            setSecondsLeft(0);
        }, UNDO_WINDOW_MS);
    }, [pendingDeletes, stopTimers]);

    const undoDelete = useCallback(() => {
        stopTimers();
        pendingCommitRef.current = null;
        setCommittedDeletes(new Set());
        setUndoState(null);
        setSecondsLeft(0);
    }, [stopTimers]);

    // ── Cleanup on unmount ───────────────────────────────────────────────────

    useEffect(() => {
        return () => {
            stopTimers();
            // Fire any committed-but-not-yet-deleted items immediately so
            // navigating away doesn't silently cancel a user-confirmed delete.
            if (pendingCommitRef.current) {
                for (const id of pendingCommitRef.current.toDelete) {
                    onDeleteRef.current(id);
                }
            }
        };
    }, [stopTimers]);

    return {
        pendingDeletes,
        committedDeletes,
        undoState,
        secondsLeft,
        queueDelete,
        restoreItem,
        clearQueue,
        commitDeletes,
        undoDelete,
    };
}

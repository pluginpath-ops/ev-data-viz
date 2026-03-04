/**
 * Fixed bottom bar with two modes:
 *
 * Queue mode  (pendingCount > 0, no undoState):
 *   Shows how many items are queued, with Clear and Commit buttons.
 *
 * Undo mode   (undoState is set):
 *   Shows a draining CSS progress bar and an Undo button. The actual
 *   DB delete fires after the 5 s window if Undo is not clicked.
 *
 * Returns null when there is nothing to show.
 */
export default function DeleteQueueBar({
    pendingCount,
    onClearQueue,
    onCommit,
    undoState,
    secondsLeft,
    onUndo,
    noun = 'item',
}) {
    const plural = (n) => `${n} ${noun}${n === 1 ? '' : 's'}`;

    // ── Undo toast ────────────────────────────────────────────────────────────
    if (undoState) {
        return (
            <div className="fixed bottom-0 left-0 right-0 z-50 bg-gray-800 text-white shadow-2xl overflow-hidden">
                {/* Draining progress bar — CSS animation restarts on each new undoState */}
                <div
                    key={undoState.startTime}
                    className="h-1 bg-blue-400"
                    style={{ animation: 'drain 5s linear forwards' }}
                />
                <div className="max-w-7xl mx-auto px-6 py-3 flex items-center gap-4">
                    <span className="font-medium flex-1">
                        ✓ {plural(undoState.count)} deleted
                    </span>
                    <span className="text-gray-400 text-sm tabular-nums w-6 text-right">
                        {secondsLeft}s
                    </span>
                    <button onClick={onUndo} className="btn btn-primary text-sm">
                        ↩ Undo
                    </button>
                </div>
            </div>
        );
    }

    // ── Queue bar ─────────────────────────────────────────────────────────────
    if (pendingCount > 0) {
        return (
            <div className="fixed bottom-0 left-0 right-0 z-50 bg-red-50 border-t-2 border-red-200 shadow-2xl">
                <div className="max-w-7xl mx-auto px-6 py-3 flex items-center gap-4">
                    <span className="text-red-700 font-medium flex-1">
                        🗑 {plural(pendingCount)} queued for deletion
                    </span>
                    <button onClick={onClearQueue} className="btn btn-secondary text-sm">
                        Clear queue
                    </button>
                    <button onClick={onCommit} className="btn btn-danger text-sm">
                        Delete {plural(pendingCount)} →
                    </button>
                </div>
            </div>
        );
    }

    return null;
}

/**
 * A spinner and a message. Nothing about where it goes.
 *
 * It used to carry `mb-4`, which is a component reserving space in a layout it
 * cannot see — and it was placed in flow at the top of a chart sidebar, so
 * every control below it moved down 36px while data loaded and back up
 * afterwards. Spacing belongs to the call site; `.chart-loading` is the one
 * that floats it over the plot instead (#304).
 */
export default function LoadingSpinner({ message = 'Loading…', className = '' }) {
    return (
        <div className={`flex items-center gap-2 text-sm text-secondary ${className}`}>
            <span className="inline-block w-4 h-4 border-2 border-[var(--color-border)] border-t-blue-500 rounded-full animate-spin shrink-0" />
            {message}
        </div>
    );
}

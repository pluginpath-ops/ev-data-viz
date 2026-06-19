/**
 * Small inline spinner used at the top of chart control cards while
 * async data is loading. Disappears once loading completes.
 */
export default function LoadingSpinner({ message = 'Loading…', className = '' }) {
    return (
        <div className={`flex items-center gap-2 text-sm text-muted mb-4 ${className}`}>
            <span className="inline-block w-4 h-4 border-2 border-[var(--color-border)] border-t-blue-500 rounded-full animate-spin shrink-0" />
            {message}
        </div>
    );
}

/**
 * Small inline spinner used at the top of chart control cards while
 * async data is loading. Disappears once loading completes.
 */
export default function LoadingSpinner({ message = 'Loading…', className = '' }) {
    return (
        <div className={`flex items-center gap-2 text-sm text-gray-500 dark:text-slate-400 mb-4 ${className}`}>
            <span className="inline-block w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin shrink-0" />
            {message}
        </div>
    );
}

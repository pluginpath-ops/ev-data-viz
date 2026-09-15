/**
 * Admin → Published Results (#327): the batch import and the source list it
 * matches against, together — an import is where a new source first shows up.
 */
import { useCallback, useMemo } from 'react';
import { useAppContext } from '../../context/AppContext';
import { useAsyncResource } from '../../hooks/useAsyncResource';
import { useSources } from '../../hooks/useSources';
import ResultsBatchImport from './ResultsBatchImport';
import SourceList from './SourceList';

export default function PublishedResultsPanel() {
    const { getPerformanceSummaries } = useAppContext();
    const { sources, available, loading, reload: reloadSources } = useSources();

    // Every result, for duplicates and for each source's count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const loadResults = useCallback(() => getPerformanceSummaries(), []);
    const { data: results, reload: reloadResults } = useAsyncResource(loadResults, []);

    const usage = useMemo(() => {
        const counts = new Map();
        for (const r of results ?? []) {
            if (r.source_id != null) counts.set(r.source_id, (counts.get(r.source_id) ?? 0) + 1);
        }
        return counts;
    }, [results]);

    return (
        <div className="flex flex-col gap-6">
            <ResultsBatchImport
                sources={sources}
                sourcesAvailable={available}
                existing={results ?? []}
                onImported={(addedSources) => {
                    reloadResults();
                    if (addedSources) reloadSources();
                }}
            />
            <SourceList
                sources={sources}
                available={available}
                loading={loading}
                usage={usage}
                onChanged={() => {
                    reloadSources();
                    // A rename rewrites source_name on linked results.
                    reloadResults();
                }}
            />
        </div>
    );
}

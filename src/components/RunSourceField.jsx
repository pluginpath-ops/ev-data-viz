/**
 * A test's source on the test form: the one source list, so "OoS" and
 * "Out of Spec" cannot split into two outlets (#426).
 *
 * `legacy` is a name already stored on the test that is not a listed source.
 * It is shown rather than hidden, and `utils/sources.runSourceText` keeps it
 * until a source is chosen to replace it.
 */
import SourcePicker from './SourcePicker';

export default function RunSourceField({ sources, pick, onPick, url, legacy = '' }) {
    const nothingChosen = pick.sourceId == null && pick.newName == null;
    const unlisted = nothingChosen ? legacy.trim() : '';
    return (
        <div>
            <p className="text-xs text-secondary mb-1">Source</p>
            {/* A stored name outranks a guess from the link, so no suggestion while one stands. */}
            <SourcePicker sources={sources} value={pick} onChange={onPick} url={unlisted ? '' : url} />
            {unlisted && (
                <p className="text-xs text-meta mt-1">
                    Stored as “{unlisted}”, which is not a listed source. Pick one to replace it.
                </p>
            )}
        </div>
    );
}

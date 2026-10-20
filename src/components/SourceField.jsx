/**
 * A source on a record's form — a test's, a session's: the one source list, so "OoS" and
 * "Out of Spec" cannot split into two outlets (#426).
 *
 * `pick` is null until the curator touches the picker; the record's stored text
 * (`stored`) then stands in, shown as the listed source it names. A stored name
 * that is not a listed source is shown rather than hidden, and
 * `utils/sources.runSourceText` keeps it until a source is chosen to replace it.
 */
import SourcePicker from './SourcePicker';
import { storedSourcePick } from '../utils/sources';

const NOTHING = { sourceId: null, newName: null };

export default function SourceField({ sources, pick, onPick, url, stored = '' }) {
    const fromStored = pick == null ? storedSourcePick(sources, stored) : null;
    const unlisted = pick == null && !fromStored ? stored.trim() : '';
    return (
        <div>
            <p className="text-xs text-secondary mb-1">Source</p>
            {/* A stored name outranks a guess from the link, so no suggestion while one stands. */}
            <SourcePicker
                sources={sources}
                value={pick ?? fromStored ?? NOTHING}
                onChange={onPick}
                url={unlisted ? '' : url}
            />
            {unlisted && (
                <p className="text-xs text-meta mt-1">
                    Stored as “{unlisted}”, which is not a listed source. Pick one to replace it.
                </p>
            )}
        </div>
    );
}

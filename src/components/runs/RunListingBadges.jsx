import { isUnlisted, isExcluded, poolGateMissing, hasQualityOverride } from '../../utils/runListing';

/**
 * Where a test stands on the two questions a curator answers about it (#394,
 * utils/runListing): whether viewers see it, and whether it counts.
 *
 *   Unlisted — out of viewers' lists and charts; still counts unless excluded.
 *   Excluded — out of the statistics, listed or not.
 *   Not counted: no speed — an unlisted range test that fails the pool's rule.
 *   Checks overridden — a curator counted it past the automatic checks.
 *     Said on the card because nothing else would show it: the test is out of
 *     view AND out of the figures, and the curator thinks it is in the pool.
 */
export default function RunListingBadges({ run, session = null }) {
    const unlisted = isUnlisted(run);
    const excluded = isExcluded(run);
    const missing = excluded ? [] : poolGateMissing(run, session);
    return (
        <>
            {unlisted && (
                <span className="badge-hidden"
                    title="Unlisted: kept out of viewers' lists and charts. It still counts in the statistics (composite curves, test spreads, best charge windows) unless it is excluded.">
                    Unlisted
                </span>
            )}
            {excluded && (
                <span className="badge-status is-danger"
                    title="Excluded: left out of the statistics — composite curves, test spreads and best charge windows.">
                    Excluded
                </span>
            )}
            {hasQualityOverride(run) && (
                <span className="badge-status"
                    title="Quality checks overridden by a curator: this test counts in the range spread even though it saw only part of the pack, and in the pool without its speed or temperature. Missing data and exclusion still apply.">
                    Checks overridden
                </span>
            )}
            {missing.length > 0 && (
                <span className="badge-status is-warning"
                    title="An unlisted range test counts only with its speed and temperature recorded: without them it cannot be corrected to standard conditions, and would widen the test spread for no reason. Record them, or list the test.">
                    Not counted: no {missing.join(' or ')}
                </span>
            )}
        </>
    );
}

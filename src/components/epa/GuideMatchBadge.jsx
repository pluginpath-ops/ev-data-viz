/**
 * How one test vehicle matches a Guide row (utils/guideRowMatches.js), as a
 * badge — shared by a vehicle's EPA Label and the Guide-row link sweep, so the
 * two say the same thing in the same words.
 *
 * The caller chooses the intent: a badge is colored by what the match means
 * where it is shown, not by the match alone.
 */
const MATCH = {
    exact:         { label: 'exact',       title: 'Reproduces the row’s unadjusted kWh/100mi within the precision the Guide printed' },
    near:          { label: 'near',        title: 'Reproduces the row, just past rounding' },
    blend:         { label: 'blend',       title: 'One of the test vehicles the row lies between' },
    alternative:   { label: 'alternative', title: 'Explains the row as well as the test vehicles Tested via named — the row is ambiguous' },
    possible:      { label: 'possible',    title: 'No row names it, but it could be one end of a blend behind this row' },
    'other-label': { label: 'other label', title: 'Another Guide row of the certification names it' },
    'no-match':    { label: 'no match',    title: 'It could not stand behind this row' },
    'no-lab-data': { label: 'no lab data', title: 'Its tests cannot give both city and highway kWh/100mi' },
};

export default function GuideMatchBadge({ match, intent = '' }) {
    const m = MATCH[match];
    if (!m) return null;
    return <span className={`badge-micro ${intent}`} title={m.title}>{m.label}</span>;
}

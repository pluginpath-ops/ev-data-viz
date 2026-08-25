import { useMemo } from 'react';
import {
    highwayUnadjustedMpge, chargeEfficiencyOf, scoreAgainstGuide, defaultMctTest,
} from '../../utils/epaTestSelection';
import { PROC_MCT } from '../../constants/epa';

/**
 * Which multi-cycle test this group's figures come from (#228).
 *
 * A group can hold more than one, and every derived figure on the page depends
 * on which is used. Until now nothing let a curator say: the default takes the
 * most recent, and the warning added in #226 "tells you a choice was made
 * without letting you make it".
 *
 * Linking a guide row settles it automatically where the evidence is strong
 * enough, but the automatic path declines on purpose — one test, two runs too
 * alike, no close match, no published figure. This is what a curator uses when
 * it declines, and what they use to overrule it when they know something the
 * record does not.
 *
 * ── Showing the evidence, not just the options ──────────────────────────────
 *
 * A dropdown of test numbers would be a choice with nothing to make it on. The
 * runs differ in ways that decide the question, so each row carries them: the
 * highway figure our derivation gets from that test, its measured charging
 * efficiency, and — when a guide row is linked — how far that test sits from
 * what EPA published. That last column is the same score the automatic
 * selection uses, so a curator can see why it chose, or why it could not.
 *
 * Nothing here judges. It renders `epaTestSelection` and writes one field.
 */

const pct = (v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`;

export default function PreferredTestPicker({
    tests = [], value = null, publishedHwyMpge = null, canEdit = false, onSave,
}) {
    const mcts = useMemo(
        () => tests.filter(t => Number(t.procedure_code) === PROC_MCT),
        [tests],
    );

    const rows = useMemo(() => mcts.map(t => ({
        test: t,
        mpge: highwayUnadjustedMpge(t),
        eff:  chargeEfficiencyOf(t),
        score: scoreAgainstGuide(t, publishedHwyMpge),
    })), [mcts, publishedHwyMpge]);

    // One test is not a choice, and a control offering it would imply the
    // figures rest on a decision nobody made.
    if (mcts.length < 2) return null;

    const fallback = defaultMctTest(mcts);
    const best = rows.filter(r => r.score != null).sort((a, b) => a.score - b.score)[0];

    return (
        <div className="epa-test-picker">
            <div className="text-caption font-semibold text-secondary mb-1">
                Derive from
            </div>
            <p className="text-caption text-faint mb-2">
                This group holds {mcts.length} multi-cycle tests and every figure above comes from
                one of them. More than one run can be legitimate — the same vehicle is sometimes
                tested at two laboratories — so this is a choice, not a fault, and the others are
                not wrong.
                {publishedHwyMpge == null && ' Link a Fuel Economy Guide row and the published '
                    + 'highway figure identifies the run EPA used.'}
            </p>

            <label className="epa-test-option">
                <input
                    type="radio"
                    name="preferred-test"
                    checked={value == null}
                    disabled={!canEdit}
                    onChange={() => onSave?.(null)}
                />
                <span className="min-w-0">
                    <span className="text-secondary">Automatic</span>
                    <span className="text-caption text-faint block">
                        {/* Named, because "automatic" without saying what it lands on
                            is the same opacity this control exists to remove. */}
                        Most recent — {fallback?.test_number ?? '—'}
                        {fallback?.test_date && `, ${fallback.test_date}`}
                        {best && `. Linking sets this to ${best.test.test_number}.`}
                    </span>
                </span>
            </label>

            {rows.map(({ test, mpge, eff, score }) => (
                <label key={test.test_number ?? test.id} className="epa-test-option">
                    <input
                        type="radio"
                        name="preferred-test"
                        checked={value === test.test_number}
                        disabled={!canEdit || !test.test_number}
                        onChange={() => onSave?.(test.test_number)}
                    />
                    <span className="min-w-0">
                        <span className="text-secondary font-mono">{test.test_number ?? '—'}</span>
                        {test.test_date && <span className="text-faint"> · {test.test_date}</span>}
                        {test.lab_id && <span className="text-faint truncate"> · {test.lab_id}</span>}
                        <span className="text-caption text-faint block">
                            {mpge != null ? `highway ${mpge.toFixed(1)} MPGe` : 'highway not derivable'}
                            {eff != null && ` · charging ${(eff * 100).toFixed(1)}%`}
                            {/* The same score the automatic selection ranks on, so a
                                curator can see what it saw. */}
                            {score != null && (
                                <span style={best?.test === test ? { color: 'var(--color-success)' } : undefined}>
                                    {` · ${pct(score)} from published`}
                                    {best?.test === test && ' — closest'}
                                </span>
                            )}
                        </span>
                    </span>
                </label>
            ))}
        </div>
    );
}

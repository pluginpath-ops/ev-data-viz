/**
 * Whether the battery was preconditioned for this charging test (#352), on the
 * test's add and edit forms. "Not recorded" is its own choice and the default:
 * it is not the same answer as "No" (utils/runPreconditioning.js).
 */
export default function PreconditionedSelect({ value, onChange }) {
    return (
        <select
            value={value ?? ''}
            onChange={e => onChange(e.target.value)}
            className="form-input w-full mt-2"
            aria-label="Battery preconditioned"
            title="Whether the car warmed its battery for this charge. A cold pack charges slowly, so the curve means little without it."
        >
            <option value="">Preconditioned: not recorded</option>
            <option value="yes">Preconditioned: yes</option>
            <option value="no">Preconditioned: no</option>
        </select>
    );
}

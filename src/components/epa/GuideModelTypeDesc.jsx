/**
 * The maker's own description of a Guide row's model type, under its name.
 *
 * EPA's carline column can be the same for two different cars — Audi's 2027
 * Q6 e-tron quattro and Q6 Sportback both read "Q6 e-tron quattro", and the
 * SQ6 rows differ only by wheel — while the maker's description says "Q6
 * e-tron SB quattro 20in". Shown only when it says more than the carline.
 * Shared by the EPA Label and the link sweep.
 */
const squash = (x) => String(x ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export default function GuideModelTypeDesc({ guide }) {
    const desc = guide?.model_type_desc?.trim();
    // Many makers only repeat the carline (Rivian's "R1S PERFORMANCE (20IN
    // AT)"), with or without their name in front; that says nothing new.
    const d = squash(desc);
    if (!d || d === squash(guide.carline) || d === squash(`${guide.division} ${guide.carline}`)) return null;
    return (
        <div className="text-meta" title="The maker’s own description of this model type, from the Fuel Economy Guide">
            {desc}
        </div>
    );
}

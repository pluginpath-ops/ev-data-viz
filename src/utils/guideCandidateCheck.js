/**
 * The EPA tab's Guide checks, run on a Guide row BEFORE it is linked.
 *
 * A suggested link is ranked on its name, and a name is not evidence: the same
 * carline can be several cars (`Ioniq 5` is the RWD, the AWD and the N, 221 and
 * ~300 miles apart), and one exact name can carry very different figures from
 * one year or one Test Group to the next. Once a row is linked, the EPA tab
 * checks the record against it. This asks the same question of every
 * candidate first, so a curator sees which suggestion the lab data agrees with
 * before choosing (owner, #374).
 *
 * The two checks are the ones that depend on the Guide row — the others on
 * the tab judge the record against itself and read the same for every
 * candidate:
 *
 *   mpge        our unadjusted MPGe, derived from the lab phases, against the
 *               row's published unadjusted city and highway figures
 *               (checkUnadjustedMpge — the tab's "Unadjusted MPGe vs EPA")
 *   invariant   a label range above what the lab work can produce — an
 *               impossible label (checkLabelInvariant)
 *
 * The candidate is judged on its OWN figures: values a curator holds by hand
 * are set aside here, since the question is whether this row is right, not
 * whether it agrees with what someone typed.
 *
 * Pure module: no data access.
 */
import { testVehicleView } from './epaCertifications';
import { epaRecordFromTestVehicle, NO_RECORD_REASONS } from './epaRecordFromTestVehicle';
import { buildMethodologyModel } from './epaMethodology';
import { checkUnadjustedMpge, checkLabelInvariant } from './epaDerivationCheck';

/**
 * @param {Object} testVehicle  with coefficient sets and tests with phases
 * @param {Object} guideRow     an epa_fe_guide row (unadjusted MPGe, label range)
 * @returns {{ mpge, invariant, verdict, reason }}
 *   verdict    'agrees' | 'close' | 'disagrees' | 'impossible' | null — the
 *              worst of the two; null when neither could be checked
 *   reason     why not, in the curator's words, when verdict is null
 */
export function checkGuideCandidate(testVehicle, guideRow) {
    const none = { mpge: null, invariant: null, verdict: null, reason: null };
    if (!testVehicle || !guideRow) return none;

    const view = testVehicleView(
        { ...testVehicle, overrides: {} },
        { guideCertification: { guide: guideRow, model_year: Number(guideRow.model_year), fe_guide_row_id: guideRow.id },
          year: testVehicle.model_year },
    );
    const { record, reason } = epaRecordFromTestVehicle(view);
    if (!record) return { ...none, reason: NO_RECORD_REASONS[reason] ?? 'The lab data cannot produce a model.' };

    const model = buildMethodologyModel(record);
    const mpge = checkUnadjustedMpge(model, { city: guideRow.unadj_city_mpge, hwy: guideRow.unadj_hwy_mpge });
    const invariant = checkLabelInvariant(model);

    let verdict = mpge.checked ? mpge.worst : null;
    if (invariant.violated) verdict = 'impossible';
    return {
        mpge, invariant, verdict,
        reason: verdict == null ? 'This Guide row states no unadjusted MPGe to compare against.' : null,
    };
}

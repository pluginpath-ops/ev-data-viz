/**
 * Real cert records, transcribed for #206.
 *
 * Two vehicles, chosen because they exercise the two test methods and because
 * every figure in them was checked against the published label. They are the
 * spec for the methodology model: the tests assert the derivations reproduce
 * these labels, and the diagram is built against them before it is wired to
 * live data.
 *
 * The Lightning is the more useful of the two for early work — an SCT record
 * carries no phase detail, so everything here came out of the certification
 * spreadsheets with no PDF comment-field parsing involved.
 */

/**
 * Rivian R2 — MCT, fixed 0.7 adjustment.
 * Dual Motor, Large Pack, 20" AT, All-Purpose. 8 phases.
 */
export const R2_MCT = {
    vehicleName:     'Rivian R2',
    modelYear:       2027,
    configuration:   'Dual Motor · Large Pack · 20" AT · All-Purpose',
    testMethod:      'mct',
    adjustmentMethod: 'fixed_07',
    labeledRangeMi:  306,
    totalDcWh:       89549.27,
    rechargeAcWh:    104689,
    // Phase order is the procedure's, not sorted by value: the first UDDS is
    // the cold start and costs ~27% more per mile than the warm ones.
    phases: [
        { cycle: 'UDDS', index: 1, whPerMi: 235.86, wh: 1751.46 },
        { cycle: 'HWY',  index: 2, whPerMi: 231.77 },
        { cycle: 'UDDS', index: 3, whPerMi: 189.87 },
        { cycle: 'HWY',  index: 4, whPerMi: 225.00 },
        { cycle: 'UDDS', index: 5, whPerMi: 184.62 },
        { cycle: 'UDDS', index: 7, whPerMi: 183.46 },
    ],
};

/**
 * Ford F-150 Lightning Extended Range — SCT pair, fixed 0.7 adjustment.
 * Cert `NWA00042 / 0`, one bag each.
 *
 * Note the recharge energy is identical in both records to six significant
 * figures. That is replication, not corroboration — do not read cross-record
 * agreement as independent validation, and do not average the pair.
 */
export const LIGHTNING_SCT = {
    vehicleName:     'Ford F-150 Lightning ER',
    modelYear:       2026,
    configuration:   'Extended Range · NWA00042 / 0',
    testMethod:      'sct',
    adjustmentMethod: 'fixed_07',
    labeledRangeMi:  320,
    // No DC-side energy in an SCT record, so vehicle-side efficiency and the
    // charging loss cannot be separated. The diagram must say so rather than
    // impute quietly.
    totalDcWh:       null,
    rechargeAcWh:    152974,
    runs: [
        { cycle: 'UDDS',  procedureCode: 81, rechargeWh: 152974, rangeMi: 504.521 },
        { cycle: 'HWFET', procedureCode: 84, rechargeWh: 152974, rangeMi: 407.934 },
    ],
};

export const METHODOLOGY_FIXTURES = [R2_MCT, LIGHTNING_SCT];

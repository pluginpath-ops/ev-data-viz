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
    vehicleName:     'Rivian R2 Performance',
    modelYear:       2027,
    configuration:   'Dual Motor · Large Pack · 20" AT · All-Purpose',
    testMethod:      'mct',
    // EPA's own MY27 Fuel Economy Guide records this configuration's label as
    // "Electric Vehicle 5-cycle label" — NOT the fixed 0.7 factor originally
    // assumed here. Corrected, and worth the note: #206 models
    // adjustment_method as DETERMINED BY test_method, and this record is a
    // counter-example. It was multi-cycle tested (the CSI PDF this fixture was
    // transcribed from) and 5-cycle labelled. The two axes are more independent
    // than the issue assumes.
    //
    // Nothing downstream changes: applying x0.7 still reproduces the 307 label
    // to 0.3%, because on the 152 five-cycle-labelled EVs in the MY26 guide the
    // effective adjusted/unadjusted ratio has a median of exactly 0.700.
    adjustmentMethod: 'five_cycle_label',
    labeledRangeMi:  307,
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
    // Unconfirmed: the F-150 Lightning appears in neither the MY26 nor the MY27
    // Fuel Economy Guide, so unlike the R2 there is no published statement of
    // which label method it used. Left as originally transcribed.
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

/**
 * Centralized tooltip explainer text for EPA-related concepts.
 *
 * All InfoIcon tooltips in the EPA Curves feature reference this map by key
 * so the text is maintained in one place.
 *
 * Tone: factual, dense, no hedging, no marketing language.
 */

export const EPA_EXPLAINERS = {

    // ── Road-load physics ─────────────────────────────────────────────────────

    roadLoad:
        'Road-load force F = A + B·v + C·v² describes the total resistance the drivetrain must overcome at constant speed. A captures rolling resistance; B·v captures speed-proportional losses (bearing drag, tire flexing); C·v² captures aerodynamic drag. Measured by EPA coast-down testing on a flat road.',

    targetVsSet:
        'Target coefficients are the EPA-certified values used to compute label MPGe. Set coefficients are what was actually programmed on the dynamometer for testing — they usually match the target but may differ slightly. This chart uses set values when available, falling back to target.',

    equivTestWeight:
        'Equivalent Test Weight (ETW) is the vehicle\'s curb weight plus 300 lbs (representing passengers and cargo), rounded to the nearest 125-lb increment. It determines how much inertia the dynamometer simulates during acceleration phases. May differ from the spec sheet curb weight by up to ~60 lbs.',

    steadyStateCurve:
        'This curve is theoretical, not measured. It assumes constant speed on flat ground with no wind, a fixed 0.3 kW accessory load, and a single composite drivetrain efficiency back-solved from the HWFET measurement. It does not capture grade, wind, HVAC transients, or stop-and-go losses.',

    hwfetCalibration:
        'Drivetrain efficiency η is back-solved by finding the value that makes the steady-state formula reproduce the HWFET unadjusted measurement at 48.3 mph average. This ensures the curve is internally consistent with EPA\'s own highway data for each specific vehicle.',

    accessoryLoad:
        'A constant 0.3 kW accessory load (HVAC, lighting, electronics) is added at all speeds. At low speeds this term dominates; at highway speeds it becomes a small fraction of total consumption.',

    // ── Drive cycles ──────────────────────────────────────────────────────────

    hwfetCycle:
        'HWFET (Highway Fuel Economy Test): 765 seconds, 10.26 miles, 48.3 mph average. Steady-speed highway driving with gradual speed changes. The reference vertical line marks this average. This cycle is the basis for the EPA highway label.',

    udssCycle:
        'UDDS (Urban Dynamometer Driving Schedule): city cycle, 1369 seconds, 7.45 miles, 19.6 mph average. Frequent stops and low speeds. Favors EVs due to heavy regenerative braking. Basis for the city label.',

    us06Cycle:
        'US06 (Supplemental FTP): aggressive driving with rapid acceleration and speeds up to 80 mph; 48.4 mph average. Despite the similar average speed to HWFET, US06 is substantially harder — the transients and high-speed portions impose much greater peak power demands. Included in the 5-cycle method.',

    sc03Cycle:
        'SC03: same speed profile as UDDS but run at 95°F ambient temperature with the air conditioning on. Captures the range penalty of cooling. Included in the 5-cycle method.',

    coldFtpCycle:
        'Cold FTP: UDDS drive schedule run at 20°F ambient (engine/battery cold-start). Captures the efficiency penalty of low-temperature battery chemistry and cabin heating. Included in the 5-cycle method.',

    // ── Adjusted vs unadjusted ────────────────────────────────────────────────

    unadjVsAdj:
        'Unadjusted kWh/100mi is the raw dynamometer measurement. Adjusted applies EPA correction factors that account for the gap between lab conditions and real-world driving variability. The label MPGe and label range are derived from the adjusted values.',

    labelMethod:
        '2-cycle: label is computed from UDDS and HWFET only. 5-cycle: adds US06, SC03, and Cold FTP for a more realistic estimate. Vehicle-specific: manufacturer submitted actual 5-cycle test data. MPG-based adjustment: older method using a statistical correction rather than additional test cycles.',

    // ── Mapping confidence ────────────────────────────────────────────────────

    confidenceBadge:
        'Confidence indicates how certain the link between this vehicle and the EPA test group is. Verified: a contributor confirmed the test group ID against the EPA certification document. Likely: matched by make, model, and year with high confidence but not manually verified. Inferred: matched automatically; may not be exact, especially for multi-trim submissions.',

};

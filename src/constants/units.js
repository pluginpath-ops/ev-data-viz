/**
 * Unit-conversion factors — single source of truth.
 *
 * Leaf module: imports nothing from the app, so any module can import it without
 * circular-dependency risk. Edit a factor here and every consumer follows.
 */
export const MI_TO_KM   = 1.60934;   // miles → km
export const IN_TO_MM   = 25.4;      // inches → mm
export const LBS_TO_KG  = 0.453592;  // pounds → kilograms
export const CUFT_TO_L  = 28.3168;   // cubic feet → litres
export const LBFT_TO_NM = 1.35582;   // lb-ft → newton-metres
export const FT_TO_M    = 0.3048;    // feet → metres
export const HP_TO_KW   = 0.7457;    // horsepower → kilowatts

/** kWh per gallon of gasoline-equivalent — the MPGe basis. */
export const MPG_E_CONVERSION = 33.705;

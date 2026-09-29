/**
 * The most power an 800 V pack can take from one charger, by 400 V support
 * method: the steady-state ceiling, not a charging curve. It feeds the Split
 * Pack Lab on 400v-charger-compatibility. Model, not measurement: the cells'
 * own limits (taper, temperature) are left out on purpose, because the lab's
 * point is what the method and the charger allow before the cells have a say.
 *
 *   direct       pack voltage within the charger's range: P = min(P_chg, I_chg × V_pack)
 *   split-pack   halves in parallel at V_pack / 2:          P = min(P_chg, I_chg × V_pack / 2)
 *   dc-booster   the booster draws at its own input voltage, at most the charger's:
 *                P = min(P_chg, I_chg × min(V_chg, V_in), P_booster)
 *                (motor boost is the same arithmetic; conversion loss is left out).
 *                V_in defaults to 450 V: boosters run around 420–450 V in
 *                EVBench's experience (fact booster-input-voltage, observed).
 *
 * `carKw`, when given, is the car's own maximum: no method can pass it.
 *
 * Each result names the limit that binds, so the page can say why.
 */
export const METHODS = ['direct', 'split-pack', 'dc-booster'];

/** A booster's input voltage when none is given (booster-input-voltage). */
export const BOOSTER_INPUT_V = 450;

export function peakOnCharger(method, { chargerV, chargerA, chargerKw }, { packV, boosterKw, boosterInputV = BOOSTER_INPUT_V, carKw = Infinity }) {
    const cap = (kw, limits) => {
        const [limit, value] = Object.entries({ ...limits, car: carKw }).reduce((a, b) => (b[1] < a[1] ? b : a));
        return { kw: Math.round(Math.min(kw, value)), limit, fits: true };
    };
    if (method === 'direct') {
        if (packV > chargerV) return { kw: 0, limit: 'voltage', fits: false };
        return cap(chargerKw, { charger: chargerKw, current: chargerA * packV / 1000 });
    }
    if (method === 'split-pack') {
        const half = packV / 2;
        if (half > chargerV) return { kw: 0, limit: 'voltage', fits: false };
        return cap(chargerKw, { charger: chargerKw, current: chargerA * half / 1000 });
    }
    if (method === 'dc-booster') {
        const inputV = Math.min(chargerV, boosterInputV);
        return { ...cap(chargerKw, { charger: chargerKw, current: chargerA * inputV / 1000, booster: boosterKw }), inputV };
    }
    throw new Error(`unknown method ${method}`);
}

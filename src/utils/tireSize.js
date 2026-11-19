/**
 * A tire size string read for its geometry: overall diameter and tread width,
 * in inches. The Size chart draws the wheels from it (vehicleProfile.js).
 *
 * Reads the forms a spec sheet prints:
 *   metric     255/45R19, P265/70R17, LT275/65R20, 275/40ZR21, 245/45 R 19
 *   flotation  35x12.50R17
 * A staggered setup ("245/35R21 / 265/35R21") reads as its first size.
 *
 * Pure module.
 */

const MM_PER_IN = 25.4;

/**
 * @param {string} text  the spec's tire size
 * @returns {{ diameterIn: number, widthIn: number, rimIn: number } | null}
 *          null when nothing in it reads as a size
 */
export function parseTireSize(text) {
    if (typeof text !== 'string') return null;
    const s = text.toUpperCase();

    const metric = s.match(/(?:^|[^\d])(?:P|LT|ST|T)?\s*(\d{3})\s*\/\s*(\d{2,3})\s*(?:Z\s*)?(?:R|D|B)?\s*F?\s*(\d{2}(?:\.\d)?)/);
    if (metric) {
        const widthMm = Number(metric[1]);
        const aspect = Number(metric[2]) / 100;
        const rimIn = Number(metric[3]);
        if (widthMm < 100 || widthMm > 400 || aspect < 0.2 || aspect > 0.9 || rimIn < 12 || rimIn > 26) return null;
        const sidewallIn = (widthMm * aspect) / MM_PER_IN;
        return { diameterIn: rimIn + 2 * sidewallIn, widthIn: widthMm / MM_PER_IN, rimIn };
    }

    const flotation = s.match(/(\d{2}(?:\.\d+)?)\s*X\s*(\d{1,2}(?:\.\d+)?)\s*(?:R|D)?\s*(\d{2}(?:\.\d)?)/);
    if (flotation) {
        const diameterIn = Number(flotation[1]);
        const widthIn = Number(flotation[2]);
        const rimIn = Number(flotation[3]);
        if (diameterIn <= rimIn || diameterIn > 45) return null;
        return { diameterIn, widthIn, rimIn };
    }
    return null;
}

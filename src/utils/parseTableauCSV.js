import { parseCSV } from './parseCSV';

const TODAY = new Date().toISOString().slice(0, 10);

/**
 * Parse a Tableau-exported charging curve CSV.
 *
 * Expected columns:
 *   "Date of charging test" | "Optimized" | "Vehicle" | "Optimized" (dup) | (blank) | 0 | 1 | … | 100
 *
 * Returns an array of session objects ready for vehicle mapping + import.
 */
export async function parseTableauCSV(file) {
    const results = await parseCSV(file);
    const rows = results.data;
    const headers = results.meta.fields || [];

    // SoC columns: bare integer headers 0–100
    const socHeaders = headers.filter(h => {
        const s = String(h).trim();
        return /^\d+$/.test(s) && +s >= 0 && +s <= 100;
    });

    const sessions = [];

    for (const row of rows) {
        const rawVehicle = String(row['Vehicle'] || '').trim();
        if (!rawVehicle) continue;

        // Parse "YYYY rest of name" → { year, vehicleName }
        const yearMatch = rawVehicle.match(/^(\d{4})\s+(.+)$/);
        const year = yearMatch ? yearMatch[1] : '';
        const vehicleName = yearMatch ? yearMatch[2].trim() : rawVehicle;

        // Date — use today if blank
        const rawDate = String(row['Date of charging test'] || '').trim();
        const date = rawDate || TODAY;

        // Synthetic flag — "Optimized" column contains text when it's a synthetic/aggregate curve
        const optimizedText = String(row['Optimized'] || '').trim();
        const synthetic = optimizedText.length > 0;

        // Run name
        const runName = rawDate
            ? `${vehicleName} ${rawDate}`
            : `${vehicleName} (Synthetic)`;

        // Data points — one per SoC%, skip blanks
        const dataPoints = [];
        for (const h of socHeaders) {
            const val = row[h];
            if (val !== null && val !== undefined && val !== '' && !isNaN(+val)) {
                dataPoints.push({ soc: +h, charge_rate: +val });
            }
        }

        // Skip rows with no data points at all
        if (dataPoints.length === 0) continue;

        sessions.push({
            rawVehicle,   // original string e.g. "2021 Polestar 2 LR"
            year,         // "2021"
            vehicleName,  // "Polestar 2 LR"
            date,
            synthetic,
            runName,
            dataPoints,   // [{ soc: 0, charge_rate: 119.0 }, ...]
        });
    }

    return sessions;
}

/**
 * Score word overlap between two strings (0–1).
 * Used to pre-select the best matching existing vehicle for each CSV vehicle.
 */
export function fuzzyScore(a, b) {
    const wa = new Set(a.toLowerCase().split(/[\s\-_()]+/).filter(Boolean));
    const wb = new Set(b.toLowerCase().split(/[\s\-_()]+/).filter(Boolean));
    const common = [...wa].filter(w => wb.has(w)).length;
    return common / Math.max(wa.size, wb.size, 1);
}

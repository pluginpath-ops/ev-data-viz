import Papa from 'papaparse';

const TODAY = new Date().toISOString().slice(0, 10);

/**
 * Read a file as text with the given encoding.
 */
function readFileAsText(file, encoding = 'UTF-16') {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file, encoding);
    });
}

/**
 * Parse a Tableau-exported charging curve TSV (tab-separated, UTF-16 LE).
 *
 * File structure:
 *   Row 0: blank | blank | blank | blank | "Soc (%)" × 101  ← skip
 *   Row 1: "Date of charging test" | "Optimized" | "Vehicle" | "Optimized" | "" | "0" | "1" … "100"  ← headers
 *   Row 2: all blank  ← skip
 *   Row 3+: data
 *
 * Returns an array of session objects ready for vehicle mapping + import.
 */
export async function parseTableauCSV(file) {
    // Tableau exports UTF-16 LE with BOM — FileReader handles the BOM automatically
    const text = await readFileAsText(file, 'UTF-16');

    // Parse as tab-delimited, no automatic header detection
    const results = Papa.parse(text, {
        delimiter: '\t',
        header: false,
        skipEmptyLines: false,
        dynamicTyping: false,
    });

    const rows = results.data;
    if (rows.length < 4) throw new Error('File too short — expected at least 4 rows (2 header rows, 1 blank, 1+ data).');

    // Row 1 (index 1) contains the actual column headers
    const headerRow = rows[1].map(h => (h || '').trim());

    // Locate key columns by name
    const dateIdx      = headerRow.findIndex(h => h.toLowerCase().includes('date'));
    const vehicleIdx   = headerRow.findIndex(h => h.toLowerCase() === 'vehicle');
    const optimizedIdx = headerRow.findIndex(h => h.toLowerCase() === 'optimized');

    if (vehicleIdx === -1) throw new Error('Could not find a "Vehicle" column in row 2 of the file.');

    // SoC columns: bare integer headers "0" through "100"
    const socCols = [];
    for (let i = 0; i < headerRow.length; i++) {
        const h = headerRow[i];
        if (/^\d+$/.test(h) && +h >= 0 && +h <= 100) {
            socCols.push({ idx: i, soc: +h });
        }
    }
    if (socCols.length === 0) throw new Error('Could not find numeric SoC columns (0–100) in the header row.');

    const sessions = [];

    // Data starts at row index 3 (skip rows 0=super-header, 1=headers, 2=blank)
    for (let r = 3; r < rows.length; r++) {
        const row = rows[r];

        const rawVehicle = ((row[vehicleIdx] || '')).trim();
        if (!rawVehicle) continue; // blank vehicle = truly empty row

        // Parse "YYYY rest of name" → { year, vehicleName }
        const yearMatch = rawVehicle.match(/^(\d{4})\s+(.+)$/);
        const year        = yearMatch ? yearMatch[1] : '';
        const vehicleName = yearMatch ? yearMatch[2].trim() : rawVehicle;

        const rawDate       = dateIdx >= 0 ? ((row[dateIdx] || '')).trim() : '';
        const optimizedText = optimizedIdx >= 0 ? ((row[optimizedIdx] || '')).trim() : '';
        const synthetic     = optimizedText.length > 0;

        const date    = rawDate || TODAY;
        // Date is stored as a separate field — don't include it in the run name
        const runName = synthetic ? `${vehicleName} (Synthetic)` : vehicleName;

        // Build data points — skip blank/non-numeric cells
        const dataPoints = [];
        for (const { idx, soc } of socCols) {
            const raw = ((row[idx] || '')).trim();
            if (raw !== '' && !isNaN(+raw)) {
                dataPoints.push({ soc, charge_rate: +raw });
            }
        }

        if (dataPoints.length === 0) continue; // no charge data at all

        sessions.push({
            rawVehicle,   // e.g. "2021 Polestar 2 LR"
            year,         // "2021"
            vehicleName,  // "Polestar 2 LR"
            date,
            synthetic,
            runName,
            dataPoints,   // [{ soc: 1, charge_rate: 121.0 }, ...]
        });
    }

    return sessions;
}

/**
 * Word-overlap fuzzy score between two strings (0–1).
 * Used to pre-select the best matching existing vehicle for each CSV vehicle.
 */
export function fuzzyScore(a, b) {
    const wa = new Set(a.toLowerCase().split(/[\s\-_().]+/).filter(Boolean));
    const wb = new Set(b.toLowerCase().split(/[\s\-_().]+/).filter(Boolean));
    const common = [...wa].filter(w => wb.has(w)).length;
    return common / Math.max(wa.size, wb.size, 1);
}

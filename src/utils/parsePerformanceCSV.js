import Papa from 'papaparse';

/**
 * Parse a GPS performance-testing CSV export (acceleration / braking runs).
 *
 * File structure — TRANSPOSED relative to most exports: each COLUMN is one run,
 * each ROW is one labelled metric, with the label embedded in every cell:
 *
 *   Insane + Launch Mode,Insane + Launch Mode,Standard,Chill        ← row 0: drive mode
 *   "Test Time: 7/24/2026, 10:48:22 AM (local)",…                   ← row 1+
 *   "Location: North Carolina, United States",…
 *   Distance: 49.372 m ≈ 162.0 ft (161 ft 11.8 in),…
 *   0–60 mph: 3.572 s,…
 *   • 0–10: 0.578 s,…                                               ← split rows
 *
 * Rows are matched by label prefix rather than position, so a source that omits
 * or reorders rows still parses. Unrecognised rows are ignored.
 *
 * Returns a plain object — no Supabase calls, no side effects (same contract as
 * parseTableauCSV.js).
 */

// Sources use an en-dash in "0–60" and a bullet on split rows. Normalise both
// so every downstream regex can assume ASCII "-".
const normaliseDashes = (s) => s.replace(/[‐-―−]/g, '-');
const stripBullet     = (s) => s.replace(/^[\s•*·-]+/, '');

/** First capture group of `re` as a float, or null. */
function num(text, re) {
    const m = re.exec(text);
    if (!m) return null;
    const v = parseFloat(m[1]);
    return Number.isFinite(v) ? v : null;
}

/**
 * Cells are "Label: value". Return the value part when `label` matches the
 * start of the cell (case-insensitive), else null.
 */
function valueFor(cell, label) {
    const text = stripBullet(normaliseDashes(cell || '')).trim();
    const want = normaliseDashes(label).toLowerCase();
    if (!text.toLowerCase().startsWith(want.toLowerCase())) return null;
    return text.slice(want.length).replace(/^\s*:\s*/, '').trim();
}

/** Find the first row whose first non-empty cell starts with `label`. */
function findRow(rows, label) {
    return rows.find(row =>
        row.some(cell => valueFor(cell, label) !== null)
    ) || null;
}

/** Read `label` from column `col`, returning the raw value string or null. */
function cellValue(rows, label, col) {
    const row = findRow(rows, label);
    if (!row) return null;
    return valueFor(row[col], label);
}

/**
 * Split rows look like "• 0-10: 0.578 s" or "• 0-60(1ft): 3.300 s".
 * Returns { speedMph, label, elapsedS } or null.
 */
function parseSplit(cell) {
    const text = stripBullet(normaliseDashes(cell || '')).trim();
    // 0-60(1ft): 3.300 s   |   0-10: 0.578 s
    const m = /^0-(\d+)(\(1ft\))?\s*:\s*([\d.]+)\s*s/i.exec(text);
    if (!m) return null;
    const speedMph = parseInt(m[1], 10);
    const elapsedS = parseFloat(m[3]);
    if (!Number.isFinite(speedMph) || !Number.isFinite(elapsedS)) return null;
    return {
        label: m[2] ? `0-${speedMph}(1ft)` : `0-${speedMph}`,
        speedMph,
        elapsedS,
        rollout: !!m[2],
    };
}

/**
 * Parse "7/24/2026, 10:48:22 AM (local)" into a zone-less wall-clock string
 * ("2026-07-24T10:48:22").
 *
 * Deliberately NOT `new Date(...)`: that resolves the wall clock against the
 * *parsing machine's* timezone, so importing a North Carolina test on a
 * European laptop shifts it by hours and can roll the date over midnight. The
 * source says "(local)" but gives no UTC offset, so the wall clock is all we
 * actually know — stored into a `timestamp` (no time zone) column to match.
 */
function parseTestTime(raw) {
    if (!raw) return null;
    const cleaned = raw.replace(/\s*\(local\)\s*$/i, '').trim();
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?/i.exec(cleaned);
    if (!m) return null;
    const [, mo, d, y, hh, mm, ss, ampm] = m;
    let hour = parseInt(hh, 10);
    if (ampm) {
        const pm = ampm.toUpperCase() === 'PM';
        if (pm && hour !== 12) hour += 12;
        if (!pm && hour === 12) hour = 0;
    }
    const p = (n, w = 2) => String(n).padStart(w, '0');
    return `${y}-${p(mo)}-${p(d)}T${p(hour)}:${mm}:${ss}`;
}

/**
 * Build one run object from column `col`.
 * Session-level fields (weather, location) are read here too; the caller
 * hoists them since they repeat identically across columns.
 */
function parseColumn(rows, col, splitRows) {
    const raw = (label) => cellValue(rows, label, col);

    // "Distance: 49.372 m ≈ 162.0 ft (161 ft 11.8 in)" → prefer the ft figure
    const distanceCell = raw('Distance') || '';
    const distanceFt = num(distanceCell, /≈\s*([\d.]+)\s*ft/)
        ?? num(distanceCell, /([\d.]+)\s*ft/);

    // "Temperature: 24.07 °C ≈ 75 °F" → we store °F
    const tempCell = raw('Temperature') || '';
    const temperatureF = num(tempCell, /≈\s*([\d.-]+)\s*°?\s*F/i);

    // "Wind: 4.34 m/s ≈ 9.71 mph coming from 71° (ENE)"
    // NOTE: 71° is a METEOROLOGICAL bearing (where wind comes FROM) — not the
    // travel-relative convention used by runs.wind_direction_deg. Stored as
    // performance_sessions.wind_bearing_deg to keep the two from being confused.
    const windCell = raw('Wind') || '';
    const windSpeedMph  = num(windCell, /≈\s*([\d.]+)\s*mph/);
    const windBearingDeg = num(windCell, /coming from\s*([\d.]+)\s*°/i);

    // "Pressure: 1021 hPa ≈ 30.15 inHg"
    const pressureCell = raw('Pressure') || '';
    const pressureInHg = num(pressureCell, /≈\s*([\d.]+)\s*inHg/i);

    // "Visibility: 10 km ≈ 6.2 miles"
    const visCell = raw('Visibility') || '';
    const visibilityMi = num(visCell, /≈\s*([\d.]+)\s*mile/i);

    // "Clouds: overcast clouds (100 %)"
    const cloudsCell = raw('Clouds') || '';
    const cloudCoverPct = num(cloudsCell, /\(\s*([\d.]+)\s*%/);

    // Lat/long appear twice: in "Run Location: … (36.4757,-77.57971)" and in
    // dedicated rows. Prefer the dedicated rows — they carry full precision and
    // the source notes sign corrections there.
    const latitude  = num(raw('Latitude')  || '', /(-?[\d.]+)/);
    const longitude = num(raw('Longitude') || '', /(-?[\d.]+)/);

    // "Slope: ~0.07 % incline (slightly uphill)." — sign carries uphill/downhill
    const slopePct = num(raw('Slope') || '', /~?\s*(-?[\d.]+)\s*%/);

    // ROLLOUT: "0-60 mph:" is the no-rollout figure; the "0-60(1ft)" split is
    // the 1ft-rollout one. They differ by ~0.3s — see migration 037.
    const zeroTo60Sec = num(raw('0-60 mph') || '', /([\d.]+)\s*s/);

    const splits = [];
    let zeroTo60RolloutSec = null;
    for (const row of splitRows) {
        const s = parseSplit(row[col]);
        if (!s) continue;
        splits.push({ label: s.label, speedMph: s.speedMph, elapsedS: s.elapsedS });
        if (s.rollout && s.speedMph === 60) zeroTo60RolloutSec = s.elapsedS;
    }

    return {
        driveMode: null, // filled by caller from the header row
        runAt: parseTestTime(raw('Test Time')),

        altitudeFt:        num(raw('Altitude') || '', /(-?[\d.]+)\s*ft/),
        densityAltitudeFt: num(raw('Density Altitude (DA)') || '', /(-?[\d.]+)\s*ft/),
        slopePct,
        distanceRunFt: distanceFt,

        maxGForce:  num(raw('Max G-Force Achieved (gMax)') || '', /([\d.]+)\s*g/),
        zeroTo60Sec,
        zeroTo60RolloutSec,

        splits,

        // Session-scoped values, hoisted by the caller
        _session: {
            locationName: raw('Location'),
            latitude,
            longitude,
            temperatureF,
            humidityPct: num(raw('Humidity') || '', /([\d.]+)\s*%/),
            pressureInHg,
            windSpeedMph,
            windBearingDeg,
            cloudCoverPct,
            visibilityMi,
        },
    };
}

/**
 * Parse performance CSV text.
 *
 * @param {string} text     raw CSV text
 * @param {object} [opts]
 * @param {'accel'|'braking'} [opts.testType='accel']
 * @returns {{ session: object, runs: object[], warnings: string[] }}
 */
export function parsePerformanceCSVText(text, { testType = 'accel' } = {}) {
    const results = Papa.parse(text, {
        header: false,
        skipEmptyLines: true,
        dynamicTyping: false,
    });

    const rows = results.data.filter(r => Array.isArray(r) && r.some(c => (c || '').trim()));
    if (rows.length < 2) {
        throw new Error('File too short — expected a drive-mode header row plus metric rows.');
    }

    const warnings = [];

    // Row 0 is the drive-mode header; its width defines the run count.
    const header = rows[0].map(c => (c || '').trim());
    const colCount = header.filter(Boolean).length;
    if (colCount === 0) throw new Error('No drive-mode names found in the first row.');

    const splitRows = rows.filter(row => row.some(cell => parseSplit(cell)));

    const runs = [];
    let session = null;

    for (let col = 0; col < colCount; col++) {
        const parsed = parseColumn(rows, col, splitRows);
        const { _session, ...run } = parsed;

        // The same drive mode is typically run several times in a row. Keep every
        // run and let `sequence` disambiguate — same approach as suffixing repeated
        // EPA Vehicle IDs with a configuration index.
        run.driveMode = header[col] || null;
        run.sequence  = col;

        if (run.zeroTo60Sec == null && run.splits.length === 0) {
            warnings.push(`Column ${col + 1} ("${run.driveMode ?? 'unnamed'}") has no timing data — skipped.`);
            continue;
        }
        runs.push(run);

        // Weather/location repeat across columns; take the first populated set.
        if (!session) session = _session;
    }

    if (runs.length === 0) throw new Error('No runs with timing data found in the file.');

    // Test time of the first run stands in for the session time.
    const testedAt = runs.find(r => r.runAt)?.runAt ?? null;

    return {
        session: { ...session, testType, testedAt },
        runs,
        warnings,
    };
}

/** File wrapper — reads as UTF-8 text, then delegates. */
export async function parsePerformanceCSV(file, opts) {
    const text = await file.text();
    return parsePerformanceCSVText(text, opts);
}

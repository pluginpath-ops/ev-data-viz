/**
 * What the vehicle table remembers between visits, in browser storage.
 *
 * Columns and sort are kept across visits (the reasoning is at
 * vehicleTableStartSearch). Storage can be missing or refuse a write (a private
 * window, blocked site data), and the table must still work, so every touch is
 * guarded and a failure just means no memory. Filters are not the table's to
 * remember since #338: they are Vehicles & Specs', held by App.
 *
 * Its own module since #450: the table reads it for its columns, and App reads
 * it for the assumptions the table and the spec chart share.
 */
const VIEW_KEY = 'evbench.vehicleTable.view';

export function readMemory() {
    try { return { view: window.localStorage.getItem(VIEW_KEY) ?? '' }; } catch { return { view: '' }; }
}

export function writeMemory({ view }) {
    try { if (view) window.localStorage.setItem(VIEW_KEY, view); else window.localStorage.removeItem(VIEW_KEY); } catch { /* no memory, no harm */ }
}

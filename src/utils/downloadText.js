/**
 * Save text as a file from the browser — an import template, an export.
 * Shared by the vehicle and published-results importers.
 */
export function downloadText(filename, text, mime) {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

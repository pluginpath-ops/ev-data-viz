/**
 * Extract the ordered text items from a PDF File/Blob using pdf.js.
 *
 * pdf.js is dynamically imported so it lands in its own lazy chunk (it's only
 * needed when a curator imports a PDF — never in the main bundle). Returns the
 * text strings in content-stream order, which is what parseEpaCsiText expects.
 */
export async function extractPdfText(file) {
    const pdfjsLib = await import('pdfjs-dist');
    // Vite resolves the `?url` suffix to the worker asset URL.
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

    const data = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data });
    const pdf = await loadingTask.promise;

    const items = [];
    try {
        for (let p = 1; p <= pdf.numPages; p++) {
            const page = await pdf.getPage(p);
            const content = await page.getTextContent();
            for (const it of content.items) {
                if (typeof it.str === 'string') items.push(it.str);
            }
            if (typeof page.cleanup === 'function') page.cleanup();
        }
    } finally {
        // pdf.js v6: destroy the loading task (the document proxy has no destroy()).
        try { await loadingTask.destroy(); } catch { /* best-effort cleanup */ }
    }
    return items;
}

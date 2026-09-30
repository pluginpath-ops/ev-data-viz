/**
 * Extract the ordered text items from a PDF File/Blob using pdf.js.
 *
 * pdf.js is dynamically imported so it lands in its own lazy chunk (it's only
 * needed when a curator imports a PDF — never in the main bundle). Returns the
 * text strings in content-stream order, which is what parseEpaCsiText expects.
 *
 * ONE worker serves every file. A bulk drop is ~100 PDFs; getDocument() with no
 * worker builds and tears down a fresh one per file, so the worker script is
 * fetched ~100 times, and one failed fetch ("Setting up fake worker failed" —
 * an expired preview-deployment session, a redeploy mid-run) killed every file
 * after it. Shared, it is fetched once, and a failure is retried once with a
 * cache-busting query before the file is reported as failed.
 */
let sharedWorker = null;
let loadCount = 0;

async function loadPdfjs(bustCache) {
    const pdfjsLib = await import('pdfjs-dist');
    // Vite resolves the `?url` suffix to the worker asset URL.
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    // A failed dynamic import can be remembered for that exact URL; a query
    // string is a different URL and gets a fresh attempt.
    pdfjsLib.GlobalWorkerOptions.workerSrc = bustCache ? `${workerUrl}?retry=${++loadCount}` : workerUrl;
    return pdfjsLib;
}

async function readItems(pdfjsLib, data) {
    sharedWorker ||= new pdfjsLib.PDFWorker();
    const loadingTask = pdfjsLib.getDocument({ data, worker: sharedWorker });
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
        // A worker passed in is not destroyed with it, which is the point.
        try { await loadingTask.destroy(); } catch { /* best-effort cleanup */ }
    }
    return items;
}

export async function extractPdfText(file) {
    const data = await file.arrayBuffer();
    try {
        return await readItems(await loadPdfjs(false), data);
    } catch (e) {
        if (!/worker/i.test(String(e?.message))) throw e;
        // The worker could not be set up: drop it and try once more, fresh.
        try { sharedWorker?.destroy(); } catch { /* already gone */ }
        sharedWorker = null;
        return readItems(await loadPdfjs(true), data);
    }
}

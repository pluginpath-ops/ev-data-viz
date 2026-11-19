/**
 * An on-screen SVG drawn onto a canvas, for the PNG export (chartUtils.js
 * `chartToPngDataUrl` reads a chart's `canvas`). The Size chart is the one
 * chart drawn in SVG rather than Chart.js.
 *
 * An SVG loaded as an image sees none of the page's CSS, so every element's
 * computed paint is written onto a copy first — which is also what resolves
 * the theme's tokens and each vehicle's `--series` color. Likewise an
 * `<image>` (a size photo) is inlined as a data URL, since an SVG drawn as an
 * image may not load anything outside itself.
 */

const PAINT = [
    'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray',
    'stroke-linejoin', 'stroke-linecap', 'opacity', 'font-family', 'font-size', 'font-weight', 'font-variant-numeric',
];

/** A URL's bytes as a data URL; the photo's host must allow the fetch (Storage's public bucket does). */
async function dataUrlOf(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status}`);
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/**
 * @param {SVGSVGElement} svg  on screen, laid out
 * @returns {Promise<HTMLCanvasElement|null>} at the device's pixel ratio, its
 *          `clientWidth` set to the SVG's CSS width so the export scales its
 *          caption to match
 */
export async function svgToCanvas(svg) {
    if (!svg) return null;
    const width = svg.width.baseVal.value;
    const height = svg.height.baseVal.value;
    if (!width || !height) return null;

    const copy = svg.cloneNode(true);
    const from = [svg, ...svg.querySelectorAll('*')];
    const to = [copy, ...copy.querySelectorAll('*')];
    from.forEach((el, i) => {
        const cs = getComputedStyle(el);
        const style = PAINT.map(p => `${p}:${cs.getPropertyValue(p)}`).join(';');
        to[i].setAttribute('style', style);
        to[i].removeAttribute('class');
    });
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    await Promise.all([...copy.querySelectorAll('image')].map(async (el) => {
        const href = el.getAttribute('href');
        if (!href || href.startsWith('data:')) return;
        // A photo that can't be fetched is left out of the image, not the whole export.
        try { el.setAttribute('href', await dataUrlOf(href)); } catch { el.remove(); }
    }));

    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`;
    const img = new Image();
    await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = url;
    });

    const dpr = window.devicePixelRatio || 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    Object.defineProperty(canvas, 'clientWidth', { value: width });
    return canvas;
}

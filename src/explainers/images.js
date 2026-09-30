/**
 * Pictures a page can place with `::: image <file>`: every file in images/,
 * bundled by Vite, looked up by file name. A file here is available to every
 * page; nothing else registers one.
 *
 * Prefer a drawn SVG (a lab, a preview) where the picture is data EVBench has,
 * because it follows the theme. An image is for what can't be redrawn, or
 * isn't worth it yet, like a source's own chart. Credit it with `source=`.
 */
const files = import.meta.glob('./images/*.{png,jpg,jpeg,gif,svg,webp}', { eager: true, import: 'default', query: '?url' });

export const IMAGES = new Map(Object.entries(files).map(([path, url]) => [path.replace(/^.*\//, ''), url]));

export const imageUrl = (name) => IMAGES.get(name) ?? null;

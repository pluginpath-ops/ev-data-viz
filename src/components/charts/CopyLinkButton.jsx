import { useState } from 'react';
import { chartShortLink } from '../../utils/chartUrlState';
import { SHORT_LINK_PARAM } from '../../utils/shortLink';

/**
 * The toolbar's URL button: copies the chart's short link (#476), `?k=1.…`.
 *
 * The address bar keeps the readable chart link; this copies the same state
 * packed into one parameter (utils/shortLink.js), with every default written
 * out so it opens the same chart after a default changes. It replaced nine
 * copies of the same inline button, each copying `window.location.href`.
 *
 * @param {(search: URLSearchParams) => void} [withExtra]  adds what the view
 *   keeps outside App's state to the query before it is packed (Road Trip's
 *   `rt_r`; the Performance views' tab and mode)
 * @param {string} [title]
 * @param {string} [label]      the button's text; "URL" on a chart's toolbar
 * @param {string} [className]  a page button's classes in place of the toolbar's
 *   (Cost & Time's settings: `btn btn-secondary`)
 */
export default function CopyLinkButton({ withExtra, title = 'Copy a short link to this chart view', label = 'URL', className = null }) {
    const [copied, setCopied] = useState(false);
    const copy = () => {
        const p = new URLSearchParams(window.location.search);
        withExtra?.(p);
        const url = `${window.location.origin}${window.location.pathname}?${SHORT_LINK_PARAM}=${chartShortLink(p.toString())}`;
        navigator.clipboard?.writeText(url).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }).catch(() => {});
    };
    return (
        <button type="button" onClick={copy} title={title}
                className={className ?? `chart-copy-btn ${copied ? 'chart-copy-btn-active' : ''}`}>
            {copied ? '✓ Copied' : label}
        </button>
    );
}

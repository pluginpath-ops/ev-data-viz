import { useEffect, useState } from 'react';

/**
 * A page's contents, wiki-style: its sections, then Notes, Where this fits and
 * Sources. It sits top right beside the article on a wide screen and follows
 * the reader down; on a narrow one it sits above the article. A reader can
 * hide it, and that choice is remembered in this browser (a per-viewer
 * convenience, so a blocked storage just means it opens every time).
 *
 * Links scroll in place rather than set a hash: a hash change would reach
 * App's popstate handler as a history entry with no state.
 */
const STORAGE_KEY = 'evbench.explainerToc.open';

function readOpen() {
    try { return localStorage.getItem(STORAGE_KEY) !== 'false'; } catch { return true; }
}

export default function ExplainerToc({ items }) {
    const [open, setOpen] = useState(readOpen);
    const [active, setActive] = useState(items[0]?.id ?? null);

    useEffect(() => {
        const targets = items.map(i => document.getElementById(i.id)).filter(Boolean);
        if (targets.length === 0 || typeof IntersectionObserver === 'undefined') return undefined;
        // The section being read is the last heading that has scrolled past
        // the upper third of the viewport.
        const observer = new IntersectionObserver(() => {
            const line = window.innerHeight / 3;
            const passed = targets.filter(t => t.getBoundingClientRect().top <= line);
            setActive((passed[passed.length - 1] ?? targets[0]).id);
        }, { rootMargin: '0px 0px -60% 0px', threshold: [0, 1] });
        targets.forEach(t => observer.observe(t));
        return () => observer.disconnect();
    }, [items]);

    const toggle = () => {
        setOpen(o => {
            try { localStorage.setItem(STORAGE_KEY, String(!o)); } catch { /* per-viewer only */ }
            return !o;
        });
    };

    if (items.length < 2) return null;

    return (
        <nav className={`explainer-toc${open ? '' : ' is-closed'}`} aria-label="Contents">
            <div className="explainer-toc-head">
                <span className="text-micro">Contents</span>
                <button type="button" className="explainer-toc-toggle" onClick={toggle} aria-expanded={open}>
                    {open ? 'Hide' : 'Show'}
                </button>
            </div>
            {open && (
                <ol className="explainer-toc-list">
                    {items.map(item => (
                        <li key={item.id} className={`is-level-${item.level}${item.id === active ? ' is-active' : ''}`}>
                            <a href={`#${item.id}`} onClick={(e) => {
                                e.preventDefault();
                                document.getElementById(item.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                setActive(item.id);
                            }}>
                                {item.text}
                            </a>
                        </li>
                    ))}
                </ol>
            )}
        </nav>
    );
}

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAnchoredPosition } from '../hooks/useAnchoredPosition';
import { useLightDismiss } from '../hooks/useLightDismiss';
import { useIsCompact } from '../hooks/useIsCompact';

/**
 * A ⓘ glyph that explains the thing beside it — as a hover gloss, or as a
 * panel you can pin and read.
 *
 * ── Three states ────────────────────────────────────────────────────────────
 *
 *   rest    the glyph alone, no layout cost
 *   peek    hover or keyboard focus. Pointer-transparent, closes on scroll
 *   pinned  click. Fixed, selectable, scrollable, dismissable, one at a time
 *
 * ── The tier comes from the content, not the call site ──────────────────────
 *
 * `children` means there is structure worth pinning — a reference table, a set
 * of defined terms — so the glyph becomes a button that opens a titled panel,
 * and `text` is the gloss its peek shows. `text` alone is an explainer: a
 * paragraph, peek only, with nothing in it to interact with.
 *
 * A caller therefore never picks a tier, which is what stopped the old
 * component from drifting: placement and width used to be per-call-site props,
 * and eight tooltips in one 320px column had five widths between them.
 *
 * ── Why it is portalled and fixed ───────────────────────────────────────────
 *
 * The chart sidebar scrolls, so it clips on both axes, and the stylesheet had
 * ~90 lines of workaround for that — the anchor moved off the glyph onto its
 * row, a width forced from the rail's padding variables, a 40vh cap that then
 * needed `pointer-events: auto` to stay scrollable. A portalled fixed panel is
 * not clipped by any of it, and all of that is gone.
 *
 * ── Narrow screens ──────────────────────────────────────────────────────────
 *
 * Below the one breakpoint the chrome already collapses at, there is no peek:
 * a tap opens a bottom sheet directly. Reproducing a hover tier for touch would
 * mean a panel that opens on the tap that was meant to dismiss it. Explainers
 * become tappable there too — a peek-only tier has no trigger on touch, so
 * without this their copy would be unreachable.
 *
 * Props:
 *   text     {string}  the gloss. Alone: the whole explainer. With children:
 *                      what the peek shows before the panel is pinned
 *   title    {string}  header for the pinned panel. Defaults to "Reference"
 *   children {node}    the pinned body — a table, sections, defined terms
 *   className {string} extra classes on the wrapper
 */
export default function InfoIcon({ text, title, children, className = '' }) {
    const isCompact = useIsCompact();
    // On touch the sheet is the only surface, so everything opens; on a pointer
    // screen only content with somewhere to go earns a pin.
    const canPin = Boolean(children) || isCompact;

    const [state, setState] = useState('rest');
    const close = () => setState('rest');

    const panelId = useId();
    const isPinned = state === 'pinned';
    const isSheet = isPinned && isCompact;

    // The sheet is not anchored to anything — it is pinned to the viewport's
    // bottom edge — so it neither measures nor places.
    const { anchorRef, measureRef, style, placed } = useAnchoredPosition(
        isSheet ? null : (state === 'rest' ? null : state),
        state === 'peek' ? close : undefined,
    );

    const dismissRef = useLightDismiss(isPinned, close, anchorRef);
    const restoreFocus = useRef(false);

    // STABLE, and it has to be. An inline `ref={el => …}` is a new function
    // every render, so React detaches and re-attaches the node each time — and
    // since attaching measures and measuring sets state, that is an infinite
    // loop: setPos → render → detach(null) → setPos(null) → render → attach →
    // setPos → … It renders about a hundred times and React kills the subtree.
    // Identity changes only with `measureRef`, i.e. only when the tier does,
    // which is exactly when a re-measure is wanted.
    const setPanel = useCallback((el) => {
        dismissRef.current = el;
        measureRef(el);
    }, [measureRef, dismissRef]);

    // Focus moves INTO a pinned panel and returns to the glyph on close, so a
    // keyboard reader is not dropped at the top of the document. Not a focus
    // trap: there is nothing to commit here, and trapping a panel you can read
    // past would take Tab away from the page for no gain. The editor tier that
    // does need one is #301.
    //
    // Gated on `placed`, and it has to be. On the first commit after pinning
    // the panel is still `visibility: hidden` waiting to be measured, and
    // focusing a hidden element does nothing AND throws nothing — so without
    // this the call ran, silently failed, and never came back once the panel
    // was visible. A sheet is never measured, so it is placed by definition.
    const ready = isPinned && (placed || isSheet);
    useEffect(() => {
        if (ready) {
            restoreFocus.current = true;
            dismissRef.current?.focus();
        } else if (!isPinned && restoreFocus.current) {
            restoreFocus.current = false;
            anchorRef.current?.focus();
        }
    }, [ready, isPinned, dismissRef, anchorRef]);

    const peekBody = (
        <>
            {text}
            {canPin && !isCompact && (
                <span className="popover-more">Click ⓘ for the full panel</span>
            )}
        </>
    );

    const panel = state === 'rest' ? null : createPortal(
        <div
            ref={setPanel}
            id={panelId}
            role={isPinned ? 'dialog' : 'tooltip'}
            aria-label={isPinned ? (title || 'Reference') : undefined}
            tabIndex={isPinned ? -1 : undefined}
            className={`popover ${isSheet ? 'popover--sheet' : 'popover--anchored'} `
                + `${isPinned ? 'popover--pinned' : 'popover--peek'}`}
            style={isSheet ? undefined : style}
        >
            {isSheet && <span className="popover-grabber" aria-hidden="true" />}
            {isPinned && (
                <div className="popover-head">
                    <span className="popover-title">{title || 'Reference'}</span>
                    <button type="button" className="popover-close" onClick={close} aria-label="Close">×</button>
                </div>
            )}
            {isPinned ? (children ?? <p>{text}</p>) : peekBody}
        </div>,
        document.body,
    );

    return (
        <span className={`info-icon ${className}`}>
            <button
                ref={anchorRef}
                type="button"
                className="info-icon-glyph"
                aria-label={title ? `More information: ${title}` : 'More information'}
                aria-describedby={state !== 'rest' ? panelId : undefined}
                aria-expanded={canPin ? isPinned : undefined}
                onPointerEnter={() => { if (!isCompact && !isPinned) setState('peek'); }}
                onPointerLeave={() => setState(s => (s === 'peek' ? 'rest' : s))}
                onFocus={() => { if (!isCompact && !isPinned) setState('peek'); }}
                onBlur={() => setState(s => (s === 'peek' ? 'rest' : s))}
                onClick={() => {
                    if (!canPin) return;
                    setState(s => (s === 'pinned' ? 'rest' : 'pinned'));
                }}
            >
                ⓘ
            </button>
            {panel}
        </span>
    );
}

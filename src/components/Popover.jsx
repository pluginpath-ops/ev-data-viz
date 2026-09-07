import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAnchoredPosition } from '../hooks/useAnchoredPosition';
import { useLightDismiss } from '../hooks/useLightDismiss';
import { useIsCompact } from '../hooks/useIsCompact';

/**
 * A floating panel and the thing that opens it.
 *
 * The mechanism only: measuring, placing, dismissing, focus, and the sheet it
 * becomes on a narrow screen. It has no opinion about what opens it or what is
 * inside — `InfoIcon` is one caller, the colour control (#299) will be another,
 * and they share nothing but this.
 *
 * ── Three states ────────────────────────────────────────────────────────────
 *
 *   rest    nothing rendered, no layout cost
 *   peek    hover or keyboard focus, if `peek` was given. Pointer-transparent,
 *           closes on scroll. Never interactive — see below
 *   open    click. Fixed, selectable, scrollable, dismissable, one at a time.
 *           A bottom sheet instead, below the compact breakpoint
 *
 * A peek is pointer-transparent by design, so it can never eat a click on what
 * it explains — which also means nothing in one can be operated. Interactive
 * content belongs in the panel, and the panel is what a click opens.
 *
 * ── Talking to the caller ───────────────────────────────────────────────────
 *
 * Three seams, because a panel that cannot be closed by its own content, or
 * whose owner cannot tell it is showing, is only good for prose:
 *
 *   children as a function   receives `{ close }`, so an Apply or Done button
 *                            inside the panel can dismiss it
 *   onOpenChange             fires on every open and close, so the owning
 *                            section can mark the row being edited
 *   open                     pass it and the component is CONTROLLED — the
 *                            owner decides, which is what lets one panel be
 *                            retargeted from row to row without closing
 *
 * Only the open state is controllable. A peek is a hover, and an owner has no
 * business knowing about hovers.
 *
 * @param {(props: object) => React.ReactNode} trigger
 *        Renders whatever opens this. Receives one object to spread — handlers,
 *        aria wiring and `ref` (a plain prop in React 19), so the caller keeps
 *        full control of the element and its classes.
 * @param {React.ReactNode} [peek]   hover gloss. Omit for click-only.
 * @param {string}  [title]          panel header. Omit for a header-less panel.
 * @param {string}  [width]          CSS length, overriding the tier default.
 * @param {boolean} [open]           pass to control the panel from outside.
 * @param {(open: boolean) => void} [onOpenChange]
 * @param {React.ReactNode | ({close}) => React.ReactNode} [children]
 * @param {string}  [className]      classes for the wrapper around the trigger.
 */
export default function Popover({
    trigger,
    peek = null,
    title,
    width,
    open,
    onOpenChange,
    children,
    className = '',
}) {
    const isCompact = useIsCompact();
    const panelId = useId();

    // Controlled when `open` is supplied. The uncontrolled copy is kept in step
    // either way so a caller can start uncontrolled and adopt control later
    // without the panel jumping.
    const controlled = open !== undefined;
    const [selfOpen, setSelfOpen] = useState(false);
    const isOpen = controlled ? open : selfOpen;

    const [peeking, setPeeking] = useState(false);

    const setOpen = useCallback((next) => {
        if (!controlled) setSelfOpen(next);
        onOpenChange?.(next);
    }, [controlled, onOpenChange]);

    const close = useCallback(() => setOpen(false), [setOpen]);
    const stopPeek = useCallback(() => setPeeking(false), []);

    // What the panel shows. On a narrow screen a caller that only supplied a
    // peek still needs its content reachable — there is no hover to peek with
    // on touch — so the sheet falls back to it.
    const body = children ?? peek;
    const canOpen = Boolean(children) || (isCompact && peek != null);

    const isSheet = isOpen && isCompact;
    const showing = isOpen || (peeking && !isCompact && peek != null);

    // Changing the key re-measures, which is how a 276px peek becomes a wider
    // panel on click without a second hook.
    const { anchorRef, measureRef, style, placed } = useAnchoredPosition(
        !showing || isSheet ? null : (isOpen ? 'open' : 'peek'),
        !isOpen && peeking ? stopPeek : undefined,
    );

    const dismissRef = useLightDismiss(isOpen, close, anchorRef);
    const restoreFocus = useRef(false);

    // STABLE, and it has to be. An inline `ref={el => …}` is a new function
    // every render, so React detaches and re-attaches the node each time — and
    // since attaching measures and measuring sets state, that is an infinite
    // loop: setPos → render → detach(null) → setPos(null) → render → attach →
    // setPos → … It renders about a hundred times and React kills the subtree.
    const setPanel = useCallback((el) => {
        dismissRef.current = el;
        measureRef(el);
    }, [measureRef, dismissRef]);

    // Focus moves INTO an open panel and returns to the trigger on close, so a
    // keyboard reader is not dropped at the top of the document. Deliberately
    // not a focus trap: nothing here commits, and trapping a panel you can read
    // past would take Tab away from the page for no gain. The editor tier that
    // does need one is #301.
    //
    // Gated on `placed`. On the first commit the panel is still
    // `visibility: hidden` waiting to be measured, and focusing a hidden
    // element does nothing AND throws nothing — so without this the call ran,
    // silently failed, and never came back once the panel was visible. A sheet
    // is never measured, so it is placed by definition.
    const ready = isOpen && (placed || isSheet);
    useEffect(() => {
        if (ready) {
            restoreFocus.current = true;
            dismissRef.current?.focus();
        } else if (!isOpen && restoreFocus.current) {
            restoreFocus.current = false;
            anchorRef.current?.focus();
        }
    }, [ready, isOpen, dismissRef, anchorRef]);

    const panel = !showing ? null : createPortal(
        <div
            ref={setPanel}
            id={panelId}
            role={isOpen ? 'dialog' : 'tooltip'}
            aria-label={isOpen ? (title || undefined) : undefined}
            tabIndex={isOpen ? -1 : undefined}
            className={`popover ${isSheet ? 'popover--sheet' : 'popover--anchored'} `
                + `${isOpen ? 'popover--pinned' : 'popover--peek'}`}
            style={{ ...(isSheet ? {} : style), ...(width ? { '--popover-w': width } : {}) }}
        >
            {isSheet && <span className="popover-grabber" aria-hidden="true" />}
            {isOpen && title && (
                <div className="popover-head">
                    <span className="popover-title">{title}</span>
                    <button type="button" className="popover-close" onClick={close} aria-label="Close">×</button>
                </div>
            )}
            {isOpen ? (typeof body === 'function' ? body({ close }) : body) : peek}
        </div>,
        document.body,
    );

    return (
        <span className={`popover-anchor ${className}`.trim()}>
            {trigger({
                ref: anchorRef,
                'aria-describedby': showing ? panelId : undefined,
                'aria-expanded': canOpen ? isOpen : undefined,
                'aria-haspopup': canOpen ? 'dialog' : undefined,
                onPointerEnter: () => { if (!isCompact && !isOpen) setPeeking(true); },
                onPointerLeave: stopPeek,
                onFocus: () => { if (!isCompact && !isOpen) setPeeking(true); },
                onBlur: stopPeek,
                onClick: () => {
                    if (!canOpen) return;
                    setPeeking(false);
                    setOpen(!isOpen);
                },
            })}
            {panel}
        </span>
    );
}

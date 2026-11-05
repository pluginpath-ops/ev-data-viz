import { useLayoutEffect, useState } from 'react';

/**
 * Whether the chips row's actions (Clear, ＋ Add) should stack.
 *
 * Side by side while the chips fit on one line; stacked once they wrap, when
 * the row is two chips tall anyway and a column of two buttons costs no
 * height.
 *
 * Decided from what the chips WOULD need beside the side-by-side actions, not
 * from whether the scroller has wrapped right now. Stacking narrows the
 * actions and hands the chips that width back, so "has it wrapped?" flips the
 * moment it is answered — the chips fit, the actions unstack, the chips wrap,
 * and round again. The buttons are the same width in either layout, so the
 * side-by-side width can be computed from them while they are stacked.
 *
 * @param {React.RefObject<HTMLElement>} rowRef      `.selected-strip-row`
 * @param {React.RefObject<HTMLElement>} scrollerRef `.selected-chip-scroll`, or empty
 * @param {React.RefObject<HTMLElement>} actionsRef  `.selected-strip-actions`
 * @param {unknown} chipsKey  changes whenever the chips do
 */
export function useStackedStripActions(rowRef, scrollerRef, actionsRef, chipsKey) {
    const [stacked, setStacked] = useState(false);

    useLayoutEffect(() => {
        const row = rowRef.current;
        const actions = actionsRef.current;
        if (!row || !actions) return undefined;

        const measure = () => {
            const scroller = scrollerRef.current;
            if (!scroller) { setStacked(false); return; }
            const gapOf = (el) => parseFloat(getComputedStyle(el).columnGap) || 0;
            const chips = [...scroller.children];
            const chipsWidth = chips.reduce((sum, c) => sum + c.offsetWidth, 0)
                + gapOf(scroller) * Math.max(0, chips.length - 1);
            const buttons = [...actions.children];
            const actionsWidth = buttons.reduce((sum, b) => sum + b.offsetWidth, 0)
                + gapOf(actions) * Math.max(0, buttons.length - 1);
            // Everything on the row but the scroller and the actions: the label.
            const others = [...row.children]
                .filter(c => c !== scroller && c !== actions)
                .reduce((sum, c) => sum + c.offsetWidth, 0);
            const gaps = gapOf(row) * Math.max(0, row.children.length - 1);
            setStacked(chipsWidth > row.clientWidth - others - gaps - actionsWidth);
        };

        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(row);
        return () => observer.disconnect();
    }, [rowRef, scrollerRef, actionsRef, chipsKey]);

    return stacked;
}

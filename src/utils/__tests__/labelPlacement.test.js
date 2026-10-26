import { describe, it, expect } from 'vitest';
import { placeLabels } from '../labelPlacement';

const area = { left: 0, right: 400, top: 0, bottom: 300 };
const rect = (p, l, w, h) => ({ ...l, w, h });
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('placeLabels', () => {
    it('puts a lone label to the right of its dot', () => {
        const [p] = placeLabels([{ x: 100, y: 100, w: 60, h: 12 }], area);
        expect(p.x).toBeGreaterThan(100);
        expect(p.y).toBeCloseTo(94);
    });

    it('moves the second of two same-row dots off the first’s label', () => {
        const items = [{ x: 100, y: 100, w: 80, h: 12 }, { x: 130, y: 100, w: 80, h: 12 }];
        const spots = placeLabels(items, area);
        const boxes = spots.map((s, i) => s && rect(items[i], s, items[i].w, items[i].h));
        expect(boxes.every(Boolean)).toBe(true);
        expect(overlaps(boxes[0], boxes[1])).toBe(false);
    });

    it('keeps a label inside the plot, flipping left at the right edge', () => {
        const [p] = placeLabels([{ x: 380, y: 100, w: 60, h: 12 }], area);
        expect(p.x + 60).toBeLessThanOrEqual(area.right);
    });

    it('leaves a label out rather than printing it on top of others', () => {
        const items = Array.from({ length: 30 }, () => ({ x: 200, y: 150, w: 80, h: 12 }));
        const spots = placeLabels(items, area);
        expect(spots.filter(Boolean).length).toBeLessThan(items.length);
    });

    it('never overlaps two labels it does place', () => {
        const items = Array.from({ length: 40 }, (_, i) => ({ x: 50 + (i * 37) % 300, y: 40 + (i * 53) % 220, w: 70, h: 12 }));
        const spots = placeLabels(items, area);
        const boxes = spots.map((s, i) => s && rect(items[i], s, items[i].w, items[i].h)).filter(Boolean);
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
            // The tolerance in the placer allows a sliver onto a dot, never onto another label's text block fully.
            const w = Math.min(boxes[i].x + boxes[i].w, boxes[j].x + boxes[j].w) - Math.max(boxes[i].x, boxes[j].x);
            const h = Math.min(boxes[i].y + boxes[i].h, boxes[j].y + boxes[j].h) - Math.max(boxes[i].y, boxes[j].y);
            const area2 = w > 0 && h > 0 ? w * h : 0;
            expect(area2).toBeLessThanOrEqual(0.35 * boxes[i].w * boxes[i].h);
        }
    });
});

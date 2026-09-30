import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..', '..', '..');
import { parseExplainer, parseInline, isTopicHref } from '../parseExplainer';
import { peakOnCharger } from '../peakOnCharger';
import { TOPICS, FACTS } from '../topics';
import { PRESET_FACTS } from '../labs/SplitPackLab';
import { flattenOutline, hubOf } from '../outline';
import { chargingTestsHref, modeledEfficiencyHref } from '../evbenchLinks';
import driveCycles from '../data/driveCycles.json';
import { IMAGES } from '../images';
import { ROUTE_FACTS, MCT_STEADY_MI, CITY_TO_EMPTY_MI, HWY_TO_EMPTY_MI, STEADY_MPH } from '../labs/TestRoutesLab';
import { axisPoints, niceScale, PREVIEW_AXES } from '../previewAxes';

describe('parseExplainer', () => {
    const doc = parseExplainer(`---
title: A page
related: [a, b]
status: DRAFT
---

## Heading

One line
and its continuation [[fact:x]], again [[fact:x]] then [[fact:y]].

::: engineers
- item one
  continued
- item two
:::

| A | B |
|---|---|
| 1 | **2** |

::: lab split-pack
::: figure overlay Waiting on data.
::: tests 23,81 x=time Two tests.
::: modeled 69 y=mi_kwh On the curve.
::: image epa.png source=https://example.gov/a?b=c A caption.

[^1]: *Where it breaks:* a note
that wraps.
`);

    it('reads frontmatter, including lists', () => {
        expect(doc.meta).toEqual({ title: 'A page', related: ['a', 'b'], status: 'DRAFT' });
    });

    it('joins a paragraph and numbers citations by first use', () => {
        expect(doc.blocks[1].type).toBe('para');
        expect(doc.citations).toEqual(['x', 'y']);
    });

    it('nests a block inside a container, continuing list items', () => {
        const c = doc.blocks[2];
        expect(c).toMatchObject({ type: 'container', name: 'engineers' });
        expect(c.blocks[0].items).toEqual([['item one continued'], ['item two']]);
    });

    it('drops the table separator row, and parses cells inline', () => {
        const t = doc.blocks[3];
        expect(t.head).toEqual([['A'], ['B']]);
        expect(t.rows).toEqual([[['1'], [{ t: 'b', c: ['2'] }]]]);
    });

    it('places labs and figures as one-line directives', () => {
        expect(doc.blocks[4]).toEqual({ type: 'directive', name: 'lab', id: 'split-pack', caption: '' });
        expect(doc.blocks[5]).toEqual({ type: 'directive', name: 'figure', id: 'overlay', caption: 'Waiting on data.' });
        expect(doc.blocks[6]).toEqual({ type: 'directive', name: 'tests', id: '23,81', caption: 'Two tests.', options: { x: 'time' } });
        expect(doc.blocks[7]).toEqual({ type: 'directive', name: 'modeled', id: '69', caption: 'On the curve.', options: { y: 'mi_kwh' } });
        // An option value keeps everything after its first '=', so a URL survives.
        expect(doc.blocks[8]).toEqual({ type: 'directive', name: 'image', id: 'epa.png', caption: 'A caption.', options: { source: 'https://example.gov/a?b=c' } });
    });

    it('collects a footnote with its continuation', () => {
        expect(doc.footnotes['1']).toEqual([{ t: 'i', c: ['Where it breaks:'] }, ' a note that wraps.']);
    });

    it('tells a topic slug from a URL', () => {
        expect(isTopicHref('400v-vs-800v')).toBe(true);
        expect(isTopicHref('https://example.org')).toBe(false);
        expect(parseInline('[x](400v-vs-800v)')).toEqual([{ t: 'link', href: '400v-vs-800v', c: ['x'] }]);
    });
});

describe('peakOnCharger', () => {
    const c500 = { chargerV: 500, chargerA: 500, chargerKw: 250 };

    it('cannot charge a pack above the charger’s voltage directly', () => {
        expect(peakOnCharger('direct', c500, { packV: 700 })).toMatchObject({ kw: 0, fits: false, limit: 'voltage' });
    });

    it('caps a split pack at current × half-pack voltage', () => {
        // 500 A × 350 V = 175 kW, under the charger's 250 kW.
        expect(peakOnCharger('split-pack', c500, { packV: 700 })).toEqual({ kw: 175, limit: 'current', fits: true });
    });

    it('draws a booster at 450 V at most, up to its own rating', () => {
        // 500 A × 450 V = 225 kW: the cable's current binds before the charger's 250 kW.
        expect(peakOnCharger('dc-booster', c500, { packV: 700, boosterKw: 300 })).toMatchObject({ kw: 225, limit: 'current', inputV: 450 });
        expect(peakOnCharger('dc-booster', c500, { packV: 700, boosterKw: 150 })).toMatchObject({ kw: 150, limit: 'booster' });
        // Never above what the charger can output.
        expect(peakOnCharger('dc-booster', { ...c500, chargerV: 400 }, { packV: 700, boosterKw: 300 })).toMatchObject({ kw: 200, inputV: 400 });
    });

    it('never passes the car’s own maximum', () => {
        const c1000 = { chargerV: 1000, chargerA: 615, chargerKw: 500 };
        expect(peakOnCharger('direct', c1000, { packV: 600, carKw: 350 })).toMatchObject({ kw: 350, limit: 'car' });
    });

    it('charges directly when the charger reaches the pack', () => {
        const c1000 = { chargerV: 1000, chargerA: 615, chargerKw: 500 };
        expect(peakOnCharger('direct', c1000, { packV: 700 })).toMatchObject({ kw: 431, limit: 'current' });
    });
});

describe('topics', () => {
    it('reads every content file, and each has a title', () => {
        expect(TOPICS.map(t => t.slug).sort()).toEqual(['400v-charger-compatibility', '400v-vs-800v',
            'epa-battery-figures', 'epa-drive-cycles', 'epa-test-procedures', 'epa-vs-real-world', 'reading-modeled-efficiency']);
        for (const t of TOPICS) expect(t.title).not.toBe(t.slug);
    });

    it('lets only a draft cite an unverified fact', () => {
        for (const t of TOPICS.filter(t => !t.isDraft)) expect(t.unverified, t.slug).toEqual([]);
    });
});

describe('outline', () => {
    const nodes = flattenOutline();

    it('names each topic once', () => {
        const slugs = nodes.map(n => n.slug);
        expect(new Set(slugs).size).toBe(slugs.length);
    });

    it('has a place for every written page, so none is unreachable', () => {
        for (const t of TOPICS) expect(nodes.some(n => n.slug === t.slug), t.slug).toBe(true);
    });

    it('finds a topic\'s hub through its ancestors', () => {
        expect(hubOf('400v-charger-compatibility').slug).toBe('pack-architecture');
        expect(hubOf('charging-speed').slug).toBe('charging-speed');
        expect(hubOf('road-load-and-efficiency').slug).toBe('epa-ratings');
    });
});

describe('lab presets', () => {
    it('rest on verified facts, or flag the unsourced one on screen', () => {
        for (const p of PRESET_FACTS) {
            for (const id of p.facts) expect(FACTS.get(id)?.status, `${p.id}: ${id}`).toBe('verified');
            for (const id of p.flagged) {
                expect(['accepted', 'observed'], `${p.id}: ${id}`).toContain(FACTS.get(id)?.status);
                expect(p.caveat, `${p.id} flags ${id} but shows no caveat`).toBeTruthy();
            }
        }
    });
});

describe('chargingTestsHref', () => {
    it('builds the link from the runs, their vehicles and the axes', () => {
        expect(chargingTestsHref({ runIds: [23, 81], vehicleIds: [19, 19] }))
            .toBe('?tab=efficiency&r=23%2C81&v=19&x=soc&y=chargeRate');
        expect(chargingTestsHref({ runIds: [45], x: 'time' })).toBe('?tab=efficiency&r=45&x=time&y=chargeRate');
    });
});

describe('modeledEfficiencyHref', () => {
    it('opens the chart on the links, their vehicles and the axis, with the tests overlaid', () => {
        expect(modeledEfficiencyHref({ mappingIds: [69], vehicleIds: [28, 28] }))
            .toBe('?tab=epatested&m=epacurves&v=28&epa_m=69&epa_ya=mi_kwh&epa_ov=corrected');
        expect(modeledEfficiencyHref({ mappingIds: [69, 70], y: 'kwh100mi', overlay: null }))
            .toBe('?tab=epatested&m=epacurves&epa_m=69%2C70&epa_ya=kwh100mi');
    });
});

describe('previewAxes', () => {
    const pts = [
        { soc: 10, chargeRate: 200, time: 0, range: 30, temperature: 70 },
        { soc: 50, chargeRate: null, time: 10, range: 150, temperature: 72 },
        { soc: 80, chargeRate: 150, time: 20, range: 240, temperature: 75 },
    ];

    it('reads two axes, skipping points missing either', () => {
        expect(axisPoints(pts, 'soc', 'chargeRate')).toEqual([[10, 200], [80, 150]]);
    });

    it('measures an added axis from the run’s first reading', () => {
        expect(axisPoints(pts, 'time', 'deltaSoc')).toEqual([[0, 0], [10, 40], [20, 70]]);
        expect(axisPoints(pts, 'time', 'deltaRange')).toEqual([[0, 0], [10, 120], [20, 210]]);
    });

    it('rounds an axis up to a readable top and step', () => {
        expect(niceScale(418)).toEqual({ max: 500, step: 100 });
        expect(niceScale(210)).toEqual({ max: 250, step: 50 });
        expect(niceScale(28.6)).toEqual({ max: 30, step: 10 });
    });

    it('keys its axes as Charging Curves does', () => {
        const chartView = readFileSync(join(ROOT, 'src', 'components', 'ChargingView.jsx'), 'utf8');
        for (const key of Object.keys(PREVIEW_AXES)) expect(chartView, key).toMatch(new RegExp(`value: '${key}'`));
    });
});

describe('drive cycle data', () => {
    const cycles = Object.fromEntries(driveCycles.cycles.map(c => [c.id, c]));
    const miles = (mph) => mph.slice(1).reduce((sum, v, s) => sum + (mph[s] + v) / 2 / 3600, 0);

    it('holds one speed per second, and reproduces the ledger\'s distances and averages', () => {
        const ledger = { udds: 'epa-cycle-udds', hwfet: 'epa-cycle-hwfet', us06: 'epa-cycle-us06', sc03: 'epa-cycle-sc03' };
        for (const [id, factId] of Object.entries(ledger)) {
            const fact = FACTS.get(factId);
            const c = cycles[id];
            expect(c.mph.length - 1, id).toBe(fact.value.s);
            expect(miles(c.mph), id).toBeCloseTo(fact.value.mi, 1);
            expect(Math.max(...c.mph), id).toBeCloseTo(fact.value.top_mph, 0);
        }
    });
});

describe('images', () => {
    it('places a picture only from images/, and every page names one that exists', () => {
        for (const t of TOPICS) {
            const walk = (blocks) => blocks.flatMap(b => [b, ...(b.blocks ? walk(b.blocks) : [])]);
            for (const b of walk(t.doc.blocks).filter(b => b.type === 'directive' && b.name === 'image')) {
                expect(IMAGES.has(b.id), `${t.slug} places ${b.id}, which is not in images/`).toBe(true);
            }
        }
    });
});

describe('Test Routes Lab', () => {
    it('draws the distances and steady speed the ledger holds', () => {
        for (const id of ROUTE_FACTS) expect(FACTS.has(id), id).toBe(true);
        const phases = FACTS.get('evbench-mct-phase-lengths').value;
        expect(MCT_STEADY_MI).toEqual({ mid: phases.mid_ss_mi_median, end: phases.end_ss_mi_median });
        const single = FACTS.get('evbench-same-car-to-empty').value;
        expect([CITY_TO_EMPTY_MI, HWY_TO_EMPTY_MI]).toEqual([single.city_mi_median, single.hwy_mi_median]);
        expect(STEADY_MPH).toBe(FACTS.get('j1634-css-65mph').value.mph);
    });
});

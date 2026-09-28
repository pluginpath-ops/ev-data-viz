/**
 * The explainers' topic tree (plan §1): where every page sits, written or
 * not. The one home for structure: a page's parent is its place here, never
 * its frontmatter. Titles here are for topics not yet written; a written
 * page's own title wins (topics.js).
 *
 * The two roots are hubs: pages that summarise the ones under them, written
 * last (build step 6). "Hub" is a word for code and these notes only; the
 * page shows a hub by its title.
 */
export const OUTLINE = [
    {
        slug: 'charging-speed',
        title: 'What decides how fast an EV charges?',
        blurb: 'Peak kW, the taper, and which limit is in charge at each point of a session.',
        glyph: 'curve',
        children: [
            { slug: 'charging-curve-basics', title: 'Reading a charging curve',
              blurb: 'kW against SoC, the taper, and why 10–80 % is the number to compare.' },
            { slug: 'what-limits-charging', title: 'The five limits on charging speed',
              blurb: 'The charger, the cable, the car’s wiring, the cells’ chemistry, and heat.',
              children: [
                  { slug: 'cell-chemistry-limits', title: 'What the cells allow',
                    blurb: 'Lithium plating, SoC and temperature windows, LFP against NMC.' },
                  { slug: 'heat-generation', title: 'Where the heat comes from',
                    blurb: 'I²R, internal resistance, and why heat shapes the taper.' },
                  { slug: 'heat-rejection', title: 'Getting the heat out',
                    blurb: 'Cooling plates, cell formats, and the paths heat takes.' },
              ] },
            { slug: 'voltage-vs-charge-time', title: 'Does 800 V charge faster?',
              blurb: 'Voltage raises the peak, and not necessarily the average.' },
        ],
    },
    {
        slug: 'pack-architecture',
        title: 'How a battery pack is built',
        blurb: 'From single cells to a pack: its voltage, its capacity, and how it is put together.',
        glyph: 'cells',
        children: [
            { slug: 'series-and-parallel', title: 'Series and parallel',
              blurb: 'How cells add up to a pack’s voltage and its capacity.' },
            { slug: 'modules-vs-cell-to-pack', title: 'Modules, cell-to-pack and cell-to-body',
              blurb: 'Three ways to package cells, and what each one trades away.' },
            { slug: '400v-vs-800v', title: '400 V and 800 V packs',
              blurb: 'What a higher pack voltage changes, and what it leaves alone.',
              children: [
                  { slug: '400v-charger-compatibility', title: 'How 800 V cars use 400 V chargers',
                    blurb: 'Native, DC booster, motor boost and split pack, and where each runs out.' },
              ] },
        ],
    },
];

/** Every node, depth-first, with its path of ancestors (hub first). */
export function flattenOutline(nodes = OUTLINE, path = []) {
    return nodes.flatMap(n => [
        { ...n, path },
        ...flattenOutline(n.children ?? [], [...path, n]),
    ]);
}

export const outlineNode = (slug) => flattenOutline().find(n => n.slug === slug) ?? null;

/** The hub a topic sits under (itself, for a hub). */
export const hubOf = (slug) => {
    const node = outlineNode(slug);
    return node ? (node.path[0] ?? node) : null;
};

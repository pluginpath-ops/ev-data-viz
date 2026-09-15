import { describe, it, expect } from 'vitest';
import {
    splitBatchText, readBatch, matchVehicle, findDuplicate, rolloutBasisFor, planRow, rowWrite,
    buildResultsCsvTemplate, buildResultsJsonTemplate, BATCH_EXAMPLE, TABLE_COLUMNS,
} from '../publishedResultsBatch';

const SOURCES = [
    { id: 1, name: 'Car and Driver', aliases: ['C&D'], domains: ['caranddriver.com'], default_rollout_basis: 'rollout' },
    { id: 2, name: 'Out of Spec', aliases: ['OoS'], domains: [], default_rollout_basis: 'none' },
];
const VEHICLES = [
    { id: 10, name: 'Macan 4S', make: 'Porsche', model: 'Macan', trim: '4S', year: 2026 },
    { id: 11, name: 'R1S', make: 'Rivian', model: 'R1S', trim: 'Quad', year: 2025 },
    { id: 12, name: 'Model Y', make: 'Tesla', model: 'Model Y', trim: 'LR', year: 2026 },
    { id: 13, name: 'Model Y', make: 'Tesla', model: 'Model Y', trim: 'Performance', year: 2026 },
];

const context = (over = {}) => ({ vehicles: VEHICLES, sources: SOURCES, existing: [], ...over });
const [macan] = readBatch(BATCH_EXAMPLE).items;

describe('reading a batch', () => {
    it('splits blocks by their header lines', () => {
        const { blocks, stray } = splitBatchText(`stray\n## Macan 4S | C&D | https://x.test/a | Turbo\n60 mph: 4.0 sec\n\n## R1S\n60 mph: 2.9 sec`);
        expect(stray).toEqual(['stray']);
        expect(blocks.map(b => [b.vehicleText, b.sourceText, b.sourceUrl, b.trimLabel, b.body])).toEqual([
            ['Macan 4S', 'C&D', 'https://x.test/a', 'Turbo', '60 mph: 4.0 sec'],
            ['R1S', '', '', '', '60 mph: 2.9 sec'],
        ]);
    });

    it('explains a paste with no headers rather than guessing', () => {
        const out = readBatch('60 mph: 4.0 sec\n1/4-Mile: 12.4 sec @ 110 mph');
        expect(out.format).toBe('blocks');
        expect(out.items).toEqual([]);
        expect(out.issues[0]).toMatch(/No "##" header/);
    });

    it('reads CSV, including a block line that holds a comma', () => {
        const out = readBatch('vehicle,source,zero_to_60_rollout_sec,colour\nMacan 4S,Car and Driver,4.0,red\n');
        expect(out.format).toBe('csv');
        expect(out.items[0]).toMatchObject({ kind: 'table', line: 2, vehicleText: 'Macan 4S', tableFields: { zero_to_60_rollout_sec: 4 } });
        expect(out.issues[0]).toMatch(/Ignored column: colour/);
        expect(readBatch('## R1S\nRolling Start, 5-60 mph: 3.1 sec').format).toBe('blocks');
    });

    it('reads JSON, and says when it is not', () => {
        expect(readBatch('[{"vehicle":"R1S","quarter_mile_sec":10.9}]').items[0].tableFields).toEqual({ quarter_mile_sec: 10.9 });
        expect(readBatch('[{"vehicle":').issues[0]).toMatch(/Not valid JSON/);
    });

    it('offers templates carrying every column', () => {
        expect(buildResultsCsvTemplate().split('\n')[0].split(',')).toEqual(TABLE_COLUMNS);
        expect(Object.keys(JSON.parse(buildResultsJsonTemplate())[0])).toEqual(TABLE_COLUMNS);
    });
});

describe('matchVehicle', () => {
    it('matches the usual spellings of one vehicle', () => {
        for (const t of ['Macan 4S', '2026 Porsche Macan 4S', 'Porsche Macan 4S', '2026 Macan 4S']) {
            expect(matchVehicle(t, VEHICLES).vehicle?.id, t).toBe(10);
        }
    });

    it('takes an id, and reports a missing one', () => {
        expect(matchVehicle('#11', VEHICLES).vehicle.id).toBe(11);
        expect(matchVehicle('', VEHICLES, 99).problem).toMatch(/No vehicle has id 99/);
    });

    it('reports several matches instead of picking one', () => {
        const m = matchVehicle('2026 Tesla Model Y', VEHICLES);
        expect(m.vehicle).toBeNull();
        expect(m.problem).toMatch(/2 vehicles match/);
        expect(matchVehicle('2026 Tesla Model Y Performance', VEHICLES).vehicle.id).toBe(13);
    });
});

describe('rolloutBasisFor', () => {
    it('prefers the curator, then the footnote, then the source, then the rollout convention', () => {
        const omit = { rollout: { stated: 'omit' } };
        expect(rolloutBasisFor({ chosen: 'none', parsed: omit, source: SOURCES[0] })).toEqual({ basis: 'none', from: 'chosen' });
        expect(rolloutBasisFor({ parsed: omit, source: SOURCES[1] })).toEqual({ basis: 'rollout', from: 'footnote' });
        expect(rolloutBasisFor({ parsed: { rollout: null }, source: SOURCES[1] })).toEqual({ basis: 'none', from: 'source' });
        expect(rolloutBasisFor({})).toEqual({ basis: 'rollout', from: 'default' });
    });
});

describe('planRow', () => {
    it('plans a block: vehicle, source by name, footnote basis, figures', () => {
        const row = planRow(macan, context());
        expect(row).toMatchObject({ vehicle: { id: 10 }, source: { id: 1 }, sourceBy: 'name', action: 'create', problems: [] });
        expect(row.rollout).toEqual({ basis: 'rollout', from: 'footnote' });
        expect(row.fields.zero_to_60_rollout_sec).toBe(4.0);
        expect(row.intervals.map(i => i.kind)).toEqual(['braking']);
    });

    it('files a block with no footnote by its source’s default', () => {
        const [, r1s] = readBatch(BATCH_EXAMPLE).items;
        const row = planRow(r1s, context());
        expect(row.rollout).toEqual({ basis: 'none', from: 'source' });
        expect(row.fields.zero_to_60_sec).toBe(2.9);
    });

    it('applies the curator’s choices', () => {
        const row = planRow(macan, context({ chosen: { vehicleId: 11, sourceId: 2, basis: 'none' } }));
        expect(row).toMatchObject({ vehicle: { id: 11 }, source: { id: 2 }, sourceBy: 'chosen', rollout: { basis: 'none', from: 'chosen' } });
        expect(row.fields.zero_to_60_sec).toBe(4.0);
    });

    it('keeps a new source name to create, instead of dropping it', () => {
        const [item] = readBatch('## Macan 4S | Edmunds\n60 mph: 4.1 sec').items;
        expect(planRow(item, context())).toMatchObject({ source: null, newSourceName: 'Edmunds', action: 'create' });
    });

    it('blocks a row with no vehicle or no figures', () => {
        const [lost] = readBatch('## Cybertruck\n60 mph: 4.1 sec').items;
        expect(planRow(lost, context())).toMatchObject({ action: 'blocked', problems: [expect.stringMatching(/No vehicle matches/)] });
        const [empty] = readBatch('## Macan 4S\nnothing here').items;
        expect(planRow(empty, context()).problems).toContain('No figures read.');
    });

    it('skips a duplicate by default, updates it when asked, and never updates what does not exist', () => {
        const existing = [{ id: 500, vehicle_id: 10, source_id: 1, source_name: 'Car and Driver', source_url: 'caranddriver.com/…/' }];
        const dup = planRow(macan, context({ existing }));
        expect(dup).toMatchObject({ action: 'skip', duplicate: { id: 500 } });
        expect(planRow(macan, context({ existing, chosen: { action: 'update' } })).action).toBe('update');
        expect(planRow(macan, context({ chosen: { action: 'update' } })).action).toBe('create');
        expect(planRow(macan, context({ existing, chosen: { action: 'create' } })).action).toBe('skip');
    });
});

describe('findDuplicate', () => {
    it('compares vehicle, source and page, ignoring protocol, www and a trailing slash', () => {
        const existing = [{ id: 1, vehicle_id: 10, source_id: null, source_name: 'car and driver', source_url: 'http://www.caranddriver.com/a/' }];
        expect(findDuplicate(existing, { vehicleId: 10, sourceName: 'Car and Driver', sourceUrl: 'https://caranddriver.com/a' })?.id).toBe(1);
        expect(findDuplicate(existing, { vehicleId: 10, sourceName: 'Car and Driver', sourceUrl: 'https://caranddriver.com/b' })).toBeNull();
        expect(findDuplicate(existing, { vehicleId: 11, sourceName: 'Car and Driver', sourceUrl: 'https://caranddriver.com/a' })).toBeNull();
    });
});

describe('rowWrite', () => {
    it('writes the canonical source name beside its id', () => {
        const row = planRow({ ...macan, sourceText: 'C&D' }, context());
        expect(rowWrite(row).fields).toMatchObject({ vehicle_id: 10, source_id: 1, source_name: 'Car and Driver' });
        const fresh = planRow({ ...macan, sourceText: 'Edmunds', sourceUrl: '' }, context());
        expect(rowWrite(fresh, 77).fields).toMatchObject({ source_id: 77, source_name: 'Edmunds', source_url: null });
    });

    it('sends no source_id without a source, and clears stale figures when replacing', () => {
        const row = planRow({ ...macan, sourceText: '', sourceUrl: '' }, context());
        expect('source_id' in rowWrite(row).fields).toBe(false);
        const replaced = rowWrite(row, null, { replacing: true }).fields;
        expect(replaced.skidpad_g).toBeNull();
        expect(replaced.zero_to_60_rollout_sec).toBe(4.0);
    });
});

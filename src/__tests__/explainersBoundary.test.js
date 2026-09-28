/**
 * The explainers boundary (src/explainers/CLAUDE.md), and the ledger it rests on.
 *
 * The lint rule is only worth having if it still fires. A pattern that stops
 * matching fails silently: every import passes and the boundary blurs with
 * no one noticing. So these lint sample imports as if they sat at the real
 * paths, in both directions and at both depths.
 *
 * The ledger half checks that every [[fact:id]] a draft cites exists, so a
 * typo cannot hide an unverified claim.
 */
import { describe, it, expect } from 'vitest';
import { ESLint } from 'eslint';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..', '..');
const eslint = new ESLint({ cwd: ROOT });

async function restricted(code, filePath) {
    const [result] = await eslint.lintText(code, { filePath: join(ROOT, filePath) });
    return result.messages.filter(m => m.ruleId === 'no-restricted-imports').length > 0;
}

describe('explainers boundary', () => {
    it('lets EVBench import ExplainerLink and nothing else from explainers', async () => {
        expect(await restricted("import ExplainerLink from './explainers/ExplainerLink';", 'src/App.jsx')).toBe(false);
        expect(await restricted("import ExplainerLink from '../explainers/ExplainerLink.jsx';", 'src/components/Foo.jsx')).toBe(false);
        expect(await restricted("import ExplainersSection from '../../explainers/ExplainersSection';", 'src/components/reference/Foo.jsx')).toBe(false);
        expect(await restricted("import X from './explainers/ExplainerPage';", 'src/App.jsx')).toBe(true);
        expect(await restricted("import facts from '../../explainers/facts.json';", 'src/components/reference/Foo.jsx')).toBe(true);
    });

    it('lets an explainer at the top level import only the allowed EVBench modules', async () => {
        expect(await restricted("import { platformHref } from '../utils/platforms';", 'src/explainers/Foo.jsx')).toBe(false);
        expect(await restricted("import Popover from '../components/Popover.jsx';", 'src/explainers/Foo.jsx')).toBe(false);
        expect(await restricted("import { useApp } from '../context/AppContext';", 'src/explainers/Foo.jsx')).toBe(true);
        expect(await restricted("import X from '../utils/chargeStop';", 'src/explainers/Foo.jsx')).toBe(true);
    });

    it('does the same one folder down, and leaves imports inside explainers alone', async () => {
        expect(await restricted("import { platformHref } from '../../utils/platforms.js';", 'src/explainers/pages/Foo.jsx')).toBe(false);
        expect(await restricted("import DataService from '../../services/DataService';", 'src/explainers/pages/Foo.jsx')).toBe(true);
        expect(await restricted("import Footnote from '../components/Footnote';", 'src/explainers/pages/Foo.jsx')).toBe(false);
        expect(await restricted("import sim from './chargeSim';", 'src/explainers/Foo.jsx')).toBe(false);
    });
});

describe('facts ledger', () => {
    const ledger = JSON.parse(readFileSync(join(ROOT, 'src', 'explainers', 'facts.json'), 'utf8'));
    const ids = new Set(ledger.facts.map(f => f.id));

    it('gives every fact a known status, and an unsourced one its reason', () => {
        for (const f of ledger.facts) {
            expect(['verified', 'accepted', 'observed', 'unverified'], f.id).toContain(f.status);
            if (f.status === 'accepted' || f.status === 'observed') expect(f.rationale?.trim().length, `${f.id} needs a rationale`).toBeGreaterThan(20);
        }
    });

    it('has unique ids, and every verified fact carries a dated source', () => {
        expect(ids.size).toBe(ledger.facts.length);
        for (const f of ledger.facts.filter(f => f.status === 'verified')) {
            expect(f.sources.length, f.id).toBeGreaterThan(0);
            for (const s of f.sources) expect(s.accessed, f.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
    });

    it('knows every fact a draft cites', () => {
        const dir = join(ROOT, 'src', 'explainers', 'content');
        for (const file of readdirSync(dir).filter(f => f.endsWith('.md'))) {
            const text = readFileSync(join(dir, file), 'utf8');
            for (const [, id] of text.matchAll(/\[\[fact:([a-z0-9-]+)\]\]/g)) {
                expect(ids.has(id), `${file} cites ${id}`).toBe(true);
            }
        }
    });
});

describe('explainers.css', () => {
    const css = readFileSync(join(ROOT, 'src', 'explainers', 'explainers.css'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '');

    it('paints only with tokens', () => {
        expect(css.match(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/gi)).toBeNull();
    });

    it('sizes type from --fs-body, except inside SVG (diagrams, previews), where px are viewBox units', () => {
        const offScale = css.split('\n')
            .filter(l => /font-size:\s*\d/.test(l) && !/explainer-(diagram|preview)/.test(l));
        expect(offScale).toEqual([]);
    });
});

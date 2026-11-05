import { describe, it, expect } from 'vitest';
import { parseMarkdown, parseInline, safeHref, isExternalHref } from '../miniMarkdown';

const a = (href, c = [href]) => ({ t: 'a', href, c });

describe('links', () => {
    it('allows http, https, mailto and addresses inside the site', () => {
        for (const ok of ['https://evbench.example/x?y=1', 'http://a.b', 'mailto:me@example.com', '?tab=efficiency&m=range', '/path', '#top']) {
            expect(safeHref(ok), ok).toBe(ok);
        }
    });

    it('refuses anything that could run or leave without saying so', () => {
        for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<b>', '//evil.example', 'ftp://x', 'word', '', null, 'https://has space']) {
            expect(safeHref(bad), String(bad)).toBeNull();
        }
    });

    it('knows which links leave the site', () => {
        expect(isExternalHref('https://a.b')).toBe(true);
        expect(isExternalHref('mailto:a@b.c')).toBe(true);
        expect(isExternalHref('?tab=home')).toBe(false);
    });
});

describe('inline', () => {
    it('reads bold and italics, both spellings of italics', () => {
        expect(parseInline('a **b** c')).toEqual(['a ', { t: 'b', c: ['b'] }, ' c']);
        expect(parseInline('*i*')).toEqual([{ t: 'i', c: ['i'] }]);
        expect(parseInline('_i_')).toEqual([{ t: 'i', c: ['i'] }]);
    });

    it('nests italics in bold and a link in either', () => {
        expect(parseInline('**a *b* c**')).toEqual([{ t: 'b', c: ['a ', { t: 'i', c: ['b'] }, ' c'] }]);
        expect(parseInline('**[x](https://a.b)**')).toEqual([{ t: 'b', c: [a('https://a.b', ['x'])] }]);
    });

    it('turns [text](url) into a link, and leaves a link it will not allow as written', () => {
        expect(parseInline('see [the chart](?tab=efficiency&m=range).')).toEqual(['see ', a('?tab=efficiency&m=range', ['the chart']), '.']);
        expect(parseInline('[x](javascript:alert(1))')).toEqual(['[x](javascript:alert(1))']);
    });

    it('links a bare address, without the punctuation that ends the sentence', () => {
        expect(parseInline('Go to https://evbench.example/a.')).toEqual(['Go to ', a('https://evbench.example/a'), '.']);
        expect(parseInline('(see https://x.org/y)')).toEqual(['(see ', a('https://x.org/y'), ')']);
        expect(parseInline('https://x.org/wiki_(page)')).toEqual([a('https://x.org/wiki_(page)')]);
    });

    it('does not link an address that is already inside a link', () => {
        expect(parseInline('[https://a.b](https://a.b)')).toEqual([a('https://a.b', ['https://a.b'])]);
    });

    it('leaves snake_case, a lone star and a sum of stars alone', () => {
        expect(parseInline('max_dc_kw and peak_kw')).toEqual(['max_dc_kw and peak_kw']);
        expect(parseInline('2 * 3 * 4')).toEqual(['2 * 3 * 4']);
        expect(parseInline('a * b')).toEqual(['a * b']);
    });

    it('shows a tag as the text it is', () => {
        expect(parseInline('<script>alert(1)</script> <b>x</b>')).toEqual(['<script>alert(1)</script> <b>x</b>']);
    });
});

describe('blocks', () => {
    it('is empty for nothing', () => {
        expect(parseMarkdown('')).toEqual([]);
        expect(parseMarkdown('  \n \n')).toEqual([]);
        expect(parseMarkdown(null)).toEqual([]);
    });

    it('makes a single Enter a line break and a blank line a new paragraph', () => {
        const [p1, p2] = parseMarkdown('one\ntwo\n\nthree');
        expect(p1).toEqual({ t: 'p', lines: [['one'], ['two']] });
        expect(p2).toEqual({ t: 'p', lines: [['three']] });
    });

    it('reads headings of any level as one kind', () => {
        expect(parseMarkdown('# A\n## B\n###### C').map(b => b.t)).toEqual(['h', 'h', 'h']);
        expect(parseMarkdown('## Title ##')[0]).toEqual({ t: 'h', c: ['Title'] });
        expect(parseMarkdown('#nospace')[0].t).toBe('p');
    });

    it('reads bullets, with either marker, and ends the list at a blank line or text', () => {
        expect(parseMarkdown('- a\n* b')).toEqual([{ t: 'ul', items: [['a'], ['b']] }]);
        const blocks = parseMarkdown('- a\n\n- b\ntext');
        expect(blocks.map(b => b.t)).toEqual(['ul', 'ul', 'p']);
    });

    it('lets a heading or a list follow a paragraph without a blank line', () => {
        expect(parseMarkdown('intro\n# H\n- x').map(b => b.t)).toEqual(['p', 'h', 'ul']);
    });

    it('takes Windows line endings', () => {
        expect(parseMarkdown('a\r\nb')).toEqual([{ t: 'p', lines: [['a'], ['b']] }]);
    });

    it('does not read a table, an image or a code fence as anything but text', () => {
        expect(parseMarkdown('| a | b |')[0].t).toBe('p');
        expect(parseMarkdown('![alt](https://a.b/i.png)')[0].lines[0]).toEqual(['!', a('https://a.b/i.png', ['alt'])]);
        expect(parseMarkdown('```\ncode\n```')[0].t).toBe('p');
    });
});

import { describe, it, expect } from 'vitest';
import { vehicleSetKey, picksFor, withPicks, encodeColorMap, decodeColorMap, NO_PICKS } from '../colorPicks';

describe('hand-set picks are kept per chart and vehicle set', () => {
    it('a set is a set: order does not change it', () => {
        expect(vehicleSetKey([4, 3])).toBe(vehicleSetKey([3, 4]));
    });

    it('a pick counts only while its vehicle set is selected', () => {
        const all = withPicks(undefined, 'range', '3,4', () => ({ 11: '#aabbcc' }));
        expect(picksFor(all, 'range', '3,4')).toEqual({ 11: '#aabbcc' });
        expect(picksFor(all, 'range', '3')).toBe(NO_PICKS);
        expect(picksFor(all, 'charging', '3,4')).toBe(NO_PICKS);
    });

    it('a write for a new vehicle set starts from nothing', () => {
        const all = withPicks(undefined, 'range', '3', () => ({ 11: '#aabbcc' }));
        const next = withPicks(all, 'range', '3,4', base => ({ ...base, 12: '#000000' }));
        expect(next.range).toEqual({ key: '3,4', map: { 12: '#000000' } });
    });

    it('returns the same object when nothing changes', () => {
        const all = withPicks(undefined, 'range', '3', () => ({ 11: '#aabbcc' }));
        expect(withPicks(all, 'range', '3', base => base)).toBe(all);
    });
});

describe('a color map in a link', () => {
    it('round-trips pair keys and inherited test ids', () => {
        const map = { '434::351': '#aabbcc', inherited_127_539: '#123456' };
        expect(decodeColorMap(encodeColorMap(map))).toEqual(map);
    });

    it('writes only the ids asked for', () => {
        expect(encodeColorMap({ 3: '#112233', 9: '#445566' }, [3])).toBe('3:112233');
    });

    it('drops anything that is not a hex color', () => {
        expect(decodeColorMap('3:red,4:,:112233,5:12345g,6:abc')).toEqual({ 6: '#abc' });
    });
});

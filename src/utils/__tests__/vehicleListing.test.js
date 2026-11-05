import { describe, it, expect } from 'vitest';
import { isListedVehicle, listedFor } from '../vehicleListing';

describe('vehicle listing', () => {
    const listed = { id: 1, visibility: 'public', user_id: 'a' };
    const unlisted = { id: 2, visibility: 'private', user_id: 'a' };

    it("reads 'public' as listed and 'private' as unlisted", () => {
        expect(isListedVehicle(listed)).toBe(true);
        expect(isListedVehicle(unlisted)).toBe(false);
        expect(isListedVehicle({ id: 3 })).toBe(true);   // no flag: listed
    });

    it('lists an unlisted vehicle for curators and its creator only', () => {
        expect(listedFor(unlisted)).toBe(false);
        expect(listedFor(unlisted, { userId: 'b' })).toBe(false);
        expect(listedFor(unlisted, { userId: 'a' })).toBe(true);
        expect(listedFor(unlisted, { isContributor: true })).toBe(true);
        expect(listedFor(listed)).toBe(true);
    });
});

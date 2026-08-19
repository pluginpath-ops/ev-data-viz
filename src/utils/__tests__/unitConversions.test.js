import { describe, it, expect } from 'vitest';
import { fmtDistance, fmtSpeed, fmtTemp, fmtPower } from '../unitConversions';

/**
 * The imperial branches used to interpolate the stored number raw, which was
 * safe only while every value was one a human had typed. Inherited runs broke
 * that: an inherited distance is `stored × scaling_factor`, and 62.83 × 0.94
 * renders as 59.060199999999995.
 *
 * The metric branches were never exposed to this — a unit conversion produces a
 * long float on its own, so they had always rounded.
 */
describe('imperial formatting clamps computed values', () => {
    it('rounds a scaled distance to one decimal', () => {
        expect(fmtDistance(62.83 * 0.94, 'imperial')).toBe('59.1 mi');
    });

    it('rounds across the other imperial formatters too', () => {
        expect(fmtSpeed(70.00000000000001, 'imperial')).toBe('70 mph');
        expect(fmtTemp(71.68999999999998, 'imperial')).toBe('71.7°F');
        expect(fmtPower(670.0000000000001, 'imperial')).toBe('670 hp');
    });

    // r1 only ever changes a value carrying more than one decimal, so nothing a
    // curator actually entered is altered by the clamp.
    it('leaves entered values untouched', () => {
        expect(fmtDistance(59.1, 'imperial')).toBe('59.1 mi');
        expect(fmtDistance(300,  'imperial')).toBe('300 mi');
        expect(fmtSpeed(70,      'imperial')).toBe('70 mph');
    });

    it('still rounds the metric conversions it always did', () => {
        expect(fmtDistance(100, 'metric')).toBe('160.9 km');
        expect(fmtTemp(32,      'metric')).toBe('0°C');
    });
});

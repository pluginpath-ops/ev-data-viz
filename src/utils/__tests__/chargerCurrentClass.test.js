import { describe, it, expect } from 'vitest';
import {
    CHARGER_CURRENT_CLASSES, DEFAULT_CHARGER_CURRENT_A, toChargerCurrent, chargerCurrentFormValue,
    chargerCurrentText, chargerCurrentFact, currentClassOf,
} from '../chargerCurrentClass';

describe('chargerCurrentClass', () => {
    it('knows 350, 500, 600 and 700, and reads a blank as 500', () => {
        expect(CHARGER_CURRENT_CLASSES).toEqual([350, 500, 600, 700]);
        expect(DEFAULT_CHARGER_CURRENT_A).toBe(500);
        expect(currentClassOf({})).toBe(500);
        expect(currentClassOf({ charger_current_class_a: null })).toBe(500);
        expect(currentClassOf({ charger_current_class_a: '' })).toBe(500);
        expect(currentClassOf(null)).toBe(500);
        expect(currentClassOf({ charger_current_class_a: 600 })).toBe(600);
    });

    it('does not move a hand-edited class to another one', () => {
        expect(currentClassOf({ charger_current_class_a: 800 })).toBe(800);
    });

    it('holds a form value to the list, and never stores the default', () => {
        expect(toChargerCurrent('600')).toBe(600);
        expect(toChargerCurrent(500)).toBe(500);
        for (const bad of ['', null, undefined, 'abc', '450', 0]) expect(toChargerCurrent(bad)).toBeNull();
        expect(chargerCurrentFormValue(null)).toBe('');
        expect(chargerCurrentFormValue(700)).toBe('700');
    });

    it('writes a class as amps, the top one with a plus', () => {
        expect(chargerCurrentText(500)).toBe('500 A');
        expect(chargerCurrentText(700)).toBe('700 A+');
        expect(chargerCurrentFact(null)).toBeNull();
        expect(chargerCurrentFact(600)).toBe('600 A class');
    });
});

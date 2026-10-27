import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
const expect = (actual) => ({
  toBe: (expected) => assert.equal(actual, expected),
  toEqual: (expected) => assert.deepEqual(actual, expected),
  toBeNull: () => assert.equal(actual, null),
  not: { toBe: (expected) => assert.notEqual(actual, expected) },
});
import { nextMode, normalizeSettings } from '../src/engine/settings.ts';
import { characterForKey } from '../src/engine/keyboard.ts';

const ids = ['float', 'tumble', 'train'];
describe('saved parent preferences', () => {
  it('recovers from invalid and obsolete data with at least one available mode', () => {
    const settings = normalizeSettings(
      {
        includedModes: ['deleted-mode'],
        volume: 400,
        letterSize: -1,
        interval: 2,
        muted: 'yes',
      },
      ids,
    );
    expect(settings.includedModes).toEqual(ids);
    expect(settings.volume).toBe(100);
    expect(settings.letterSize).toBe(48);
    expect(settings.interval).toBe(45);
    expect(settings.muted).toBe(false);
  });
  it('honors system reduced motion for new visitors and an explicit saved preference', () => {
    expect(normalizeSettings(null, ids, true).reducedMotion).toBe(true);
    expect(
      normalizeSettings({ reducedMotion: false }, ids, true).reducedMotion,
    ).toBe(false);
  });
});
describe('world rotation', () => {
  it('cycles only included modes and wraps around', () => {
    expect(nextMode('float', ['float', 'train'], false)).toBe('train');
    expect(nextMode('train', ['float', 'train'], false)).toBe('float');
  });
});
describe('keyboard play', () => {
  it('accepts printable Unicode and gives nonprinting play keys a visible shape', () => {
    expect(characterForKey('é')).toBe('é');
    expect(characterForKey('🙂')).toBe('🙂');
    expect(characterForKey(' ')).toBe('·');
    expect(characterForKey('Enter')).toBe('↵');
    expect(characterForKey('Backspace')).toBe('⌫');
  });
  it('leaves navigation and modifier-only keys alone', () => {
    for (const key of ['Tab', 'Escape', 'Meta', 'Shift', 'Control', 'F5'])
      expect(characterForKey(key)).toBeNull();
  });
});

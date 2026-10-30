import assert from 'node:assert/strict';
import { test } from 'node:test';
import { forwardedPlayKey } from '../src/engine/keyboard.ts';

const key = (value, flags = {}) => ({ key: value, ...flags });
test('forwards play keys when the host page has focus', () => {
  for (const value of ['b', '🦋', ' ', 'Enter', 'Backspace', 'Escape']) {
    assert.equal(forwardedPlayKey(key(value), false), value);
  }
});
test('typing into the editor and browser shortcuts never reach the mode', () => {
  assert.equal(forwardedPlayKey(key('b'), true), null);
  for (const flag of [
    'ctrlKey',
    'metaKey',
    'altKey',
    'isComposing',
    'defaultPrevented',
  ]) {
    assert.equal(forwardedPlayKey(key('b', { [flag]: true }), false), null);
  }
  for (const value of ['Tab', 'Shift', 'F5']) {
    assert.equal(forwardedPlayKey(key(value), false), null);
  }
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LetterLifetimes, LETTER_LIFESPAN } from '../src/engine/lifetimes.ts';
import { floatMode } from '../src/modes/float.ts';

function fakeLetter(size = 84) {
  const letter = {
    alpha: 1,
    destroyed: false,
    x: 0,
    y: 0,
    rotation: 0,
    width: size * 0.6,
    height: size,
    destroy() {
      this.destroyed = true;
    },
    scale: {
      set() {
        assert.equal(letter.destroyed, false);
      },
    },
    position: {
      set(x, y) {
        assert.equal(
          letter.destroyed,
          false,
          'expired letters must leave mode state',
        );
        letter.x = x;
        letter.y = y;
      },
    },
  };
  return letter;
}

describe('individual letter lifespans', () => {
  it('keeps persistent story letters visible without blocking continued typing', () => {
    const lifetimes = new LetterLifetimes();
    const letters = Array.from({ length: 300 }, () => fakeLetter());
    let cleanups = 0;
    for (const letter of letters)
      lifetimes.track(letter, () => cleanups++, null);
    lifetimes.update(1000);
    assert.equal(
      letters.every((letter) => !letter.destroyed && letter.alpha === 1),
      true,
    );
    assert.equal(lifetimes.size, 0);
    assert.equal(cleanups, 0);
    const temporary = fakeLetter();
    lifetimes.track(temporary);
    lifetimes.update(LETTER_LIFESPAN);
    assert.equal(temporary.destroyed, true);
  });
  it('expires without any subsequent typing and fades during the last two seconds', () => {
    const lifetimes = new LetterLifetimes();
    const letter = fakeLetter();
    let cleanups = 0;
    lifetimes.track(letter, () => cleanups++);
    lifetimes.update(LETTER_LIFESPAN - 2);
    assert.equal(letter.alpha, 1);
    lifetimes.update(1);
    assert.equal(letter.alpha, 0.5);
    assert.equal(letter.destroyed, false);
    lifetimes.update(1);
    assert.equal(letter.destroyed, true);
    assert.equal(lifetimes.size, 0);
    lifetimes.update(10);
    assert.equal(cleanups, 1);
  });

  it('does not reset or shorten existing lifespans when a new letter arrives', () => {
    const lifetimes = new LetterLifetimes();
    const first = fakeLetter();
    const second = fakeLetter();
    lifetimes.track(first);
    lifetimes.update(10);
    lifetimes.track(second);
    assert.equal(first.destroyed, false);
    lifetimes.update(5);
    assert.equal(first.destroyed, true);
    assert.equal(second.destroyed, false);
    assert.equal(second.alpha, 1);
    lifetimes.update(10);
    assert.equal(second.destroyed, true);
  });
});

it('Float retains old letters when typing and releases expired mode state', () => {
  const lifetimes = new LetterLifetimes();
  const created = [];
  const mode = floatMode.create({
    bounds: { width: 1000, height: 800 },
    letterSize: 84,
    reducedMotion: false,
    sound() {},
    createLetter(character, size, onExpire) {
      const letter = fakeLetter(size);
      created.push(letter);
      lifetimes.track(letter, onExpire);
      return letter;
    },
  });
  for (let i = 0; i < 100; i++) mode.onKey('a');
  assert.equal(
    created.some((letter) => letter.destroyed),
    false,
  );
  // No further input is needed for all existing letters to expire.
  lifetimes.update(LETTER_LIFESPAN);
  assert.equal(
    created.every((letter) => letter.destroyed),
    true,
  );
  assert.doesNotThrow(() => mode.update(1 / 60));
  mode.onKey('b');
  assert.doesNotThrow(() => mode.update(1 / 60));
  assert.equal(created.at(-1).destroyed, false);
  mode.dispose();
  lifetimes.clear();
});

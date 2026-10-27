import { it } from 'node:test';
import assert from 'node:assert/strict';
import { trainMode } from '../src/modes/train.ts';

function setup(reducedMotion = false) {
  const letters = [];
  const context = {
    bounds: { width: 800, height: 600 },
    letterSize: 80,
    reducedMotion,
    sound() {},
    createLetter(character) {
      const text = {
        width: { W: 76, i: 18, M: 70 }[character] ?? 48,
        rotation: 0,
        position: {
          set(x, y) {
            text.x = x;
            text.y = y;
          },
        },
      };
      letters.push(text);
      return text;
    },
  };
  return { mode: trainMode.create(context), letters };
}

const close = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} ≠ ${expected}`);

it('gives each letter a push that tapers smoothly back to normal speed', (t) => {
  t.mock.method(Math, 'random', () => 0.5);
  for (const reduced of [false, true]) {
    const { mode, letters } = setup(reduced);
    mode.onKey('a');
    const { x: startX, y: startY } = letters[0];
    const speed = reduced ? 54 : 120;
    const travel = () => startX - letters[0].x + letters[0].y - startY;
    const minimumPush = reduced ? 1.3 : 1.9;
    assert.ok(startX > 60 && startX < 740);
    assert.ok(startY > 60 && startY < 450);
    mode.update(0.1);
    const firstX = letters[0].x;
    const initialSpeed = (startX - firstX) / 0.1;
    mode.update(0.1);
    const nextSpeed = (firstX - letters[0].x) / 0.1;
    assert.ok(initialSpeed > speed * minimumPush);
    assert.ok(initialSpeed > nextSpeed && nextSpeed > speed);
    const singleFrame = setup(reduced);
    singleFrame.mode.onKey('a');
    singleFrame.mode.update(0.2);
    close(singleFrame.letters[0].x, letters[0].x);
    mode.update(2.3);
    const settledDistance = travel();
    mode.update(0.1);
    assert.ok(
      Math.abs((travel() - settledDistance) / 0.1 - speed) < speed * 0.01,
    );
    mode.onKey('b');
    const pushedDistance = travel();
    mode.update(0.1);
    assert.ok((travel() - pushedDistance) / 0.1 > speed * minimumPush);
  }
});

it('spaces mixed-width letters at the tail and rotates each at the same corner', (t) => {
  t.mock.method(Math, 'random', () => 0.5);
  const { mode, letters } = setup();
  mode.onKey('W');
  const { x: startX, y: startY } = letters[0];
  mode.onKey('i');
  mode.onKey('M');
  close(letters[0].x, startX);
  close(letters[1].x - letters[0].x, 63);
  close(letters[2].x - letters[1].x, 60);
  for (const letter of letters) close(Math.abs(letter.rotation), Math.PI);
  mode.update(1);
  close(letters[0].x, startX - 220);
  assert.ok(letters[0].y > startY && letters[0].y < startY + 63);
  close(letters[1].x - letters[0].x + letters[0].y - startY, 63);
  close(letters[1].y, startY);
  close(letters[0].rotation, Math.PI / 2);
  close(Math.abs(letters[1].rotation), Math.PI);
  mode.onKey('d');
  close(letters[3].x - letters[2].x, 75);
  close(letters[3].y, startY);
  mode.update(0.6);
  close(letters[1].x, letters[0].x);
  close(letters[0].y - letters[1].y, 63);
  close(letters[1].rotation, letters[0].rotation);
});

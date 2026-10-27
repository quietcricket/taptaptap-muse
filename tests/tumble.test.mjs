import { it, mock } from 'node:test';
import assert from 'node:assert/strict';
import Matter from 'matter-js';
import { tumbleMode } from '../src/modes/tumble.ts';
import { LetterLifetimes } from '../src/engine/lifetimes.ts';

it('removes expired physics bodies and lets sleeping letters fall into the gap', () => {
  let engine;
  const createEngine = Matter.Engine.create;
  const engineMock = mock.method(Matter.Engine, 'create', (options) => {
    engine = createEngine(options);
    return engine;
  });
  const randomMock = mock.method(Math, 'random', () => 0.5);
  const lifetimes = new LetterLifetimes();
  const visuals = [];
  let mode;
  try {
    mode = tumbleMode.create({
      bounds: { width: 640, height: 800 },
      letterSize: 84,
      reducedMotion: true,
      sound() {},
      createLetter(character, size, onExpire) {
        const text = {
          x: 0,
          y: 0,
          alpha: 1,
          rotation: 0,
          destroyed: false,
          width: size * 0.6,
          height: size,
          destroy() {
            this.destroyed = true;
          },
          position: {
            set(x, y) {
              text.x = x;
              text.y = y;
            },
          },
        };
        visuals.push(text);
        lifetimes.track(text, onExpire);
        return text;
      },
    });
    function advance(seconds) {
      for (let frame = 0; frame < Math.round(seconds * 60); frame++) {
        mode.update(1 / 60);
        lifetimes.update(1 / 60);
      }
    }
    const bodies = () =>
      Matter.Composite.allBodies(engine.world).filter((body) => !body.isStatic);
    mode.onKey('a');
    advance(8);
    const support = bodies()[0];
    mode.onKey('b');
    advance(6.5);
    const upper = bodies().find((body) => body !== support);
    assert.equal(
      upper.isSleeping,
      true,
      'stack should be at rest before expiry',
    );
    const previousY = upper.position.y;
    advance(0.6);
    assert.equal(visuals[0].destroyed, true);
    assert.equal(
      bodies().includes(support),
      false,
      'expired support must leave the physics world',
    );
    assert.equal(bodies().length, 1);
    advance(1);
    assert.ok(
      upper.position.y > previousY + 15,
      'surviving letter should fall rather than hover on an invisible support',
    );
    advance(10);
    assert.equal(
      bodies().length,
      0,
      'all expired letters must release their collision bodies',
    );
    assert.equal(lifetimes.size, 0);
  } finally {
    mode?.dispose();
    lifetimes.clear();
    engineMock.mock.restore();
    randomMock.mock.restore();
  }
});

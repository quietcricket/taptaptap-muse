import type { Text } from 'pixi.js';
import type { ModeDefinition } from '../engine/types';

export const floatMode: ModeDefinition = {
  id: 'float',
  name: 'Float',
  symbol: '◌',
  description: 'Letters, lighter than air.',
  create(ctx) {
    const letters: {
      text: Text;
      vx: number;
      vy: number;
      phase: number;
      age: number;
      size: number;
    }[] = [];
    let time = 0;
    return {
      onKey(character) {
        const size = Math.min(
          ctx.letterSize * (0.4 + Math.random() * 1.9),
          ctx.bounds.width * 0.45,
          ctx.bounds.height * 0.32,
        );
        const text = ctx.createLetter(character, size, (expired) => {
          const index = letters.findIndex((letter) => letter.text === expired);
          if (index !== -1) letters.splice(index, 1);
        });
        text.position.set(
          size + Math.random() * Math.max(1, ctx.bounds.width - size * 2),
          Math.max(150, ctx.bounds.height * (0.4 + Math.random() * 0.3)),
        );
        text.rotation = (Math.random() - 0.5) * 0.3;
        letters.push({
          text,
          vx: (Math.random() - 0.5) * 25,
          vy: -(18 + Math.random() * 32),
          phase: Math.random() * Math.PI * 2,
          age: 0,
          size,
        });
      },
      update(delta) {
        time += delta;
        for (let i = letters.length - 1; i >= 0; i--) {
          const letter = letters[i];
          letter.age += delta;
          const speed = ctx.reducedMotion ? 0.2 : 1;
          letter.text.x +=
            (letter.vx + Math.sin(time + letter.phase) * 18) * delta * speed;
          letter.text.y += letter.vy * delta * speed;
          letter.text.rotation +=
            Math.sin(time * 0.7 + letter.phase) * delta * 0.07 * speed;
          const entry = Math.min(1, letter.age / 0.2);
          letter.text.scale.set(
            ctx.reducedMotion
              ? 1
              : 0.7 + 0.3 * entry + Math.sin(entry * Math.PI) * 0.12,
          );
          letter.text.alpha = entry;
          if (
            letter.text.x < letter.size / 2 ||
            letter.text.x > ctx.bounds.width - letter.size / 2
          )
            letter.vx *= -1;
          letter.text.x = Math.max(
            letter.size / 2,
            Math.min(ctx.bounds.width - letter.size / 2, letter.text.x),
          );
        }
      },
      resize() {
        for (const letter of letters)
          letter.text.x = Math.min(letter.text.x, ctx.bounds.width - 30);
      },
      dispose() {
        letters.length = 0;
      },
    };
  },
};

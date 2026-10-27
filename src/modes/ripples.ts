import { Graphics, type Text } from 'pixi.js';
import type { ModeDefinition } from '../engine/types';

export const ripplesMode: ModeDefinition = {
  id: 'ripples',
  name: 'Ripples',
  symbol: '◎',
  description: 'A little ripple becomes a big hello.',
  create(ctx) {
    const water = new Graphics();
    ctx.stage.addChild(water);
    const letters: {
      text: Text;
      x: number;
      y: number;
      age: number;
      size: number;
    }[] = [];
    let time = 0;
    return {
      onKey(character) {
        const size = Math.min(
          ctx.letterSize * (0.4 + Math.random() * 1.65),
          ctx.bounds.width * 0.45,
          ctx.bounds.height * 0.32,
        );
        const text = ctx.createLetter(character, size, (expired) => {
          const index = letters.findIndex((letter) => letter.text === expired);
          if (index !== -1) letters.splice(index, 1);
        });
        const margin = Math.min(size, ctx.bounds.width / 4);
        const x =
          margin + Math.random() * Math.max(1, ctx.bounds.width - margin * 2);
        const top = Math.min(160, ctx.bounds.height / 3);
        const y =
          top + Math.random() * Math.max(1, ctx.bounds.height - top - 180);
        text.position.set(x, y);
        letters.push({ text, x, y, age: 0, size });
        ctx.sound('pop', 0.4);
      },
      update(delta) {
        time += delta;
        water.clear();
        for (const letter of letters) {
          letter.age += delta;
          const rippleLife = ctx.reducedMotion ? 1.6 : 3.2;
          const progress = letter.age / rippleLife;
          if (progress < 1) {
            for (let ring = 0; ring < 3; ring++) {
              const phase = progress - ring * 0.12;
              if (phase < 0) continue;
              const radius =
                letter.size * 0.3 + phase * (ctx.reducedMotion ? 40 : 190);
              water
                .ellipse(
                  letter.x,
                  letter.y + letter.size * 0.35,
                  radius,
                  radius * 0.38,
                )
                .stroke({
                  width: 1.2,
                  color: '#778c9b',
                  alpha: (1 - progress) * 0.3,
                });
            }
          }
          let displacement = 0;
          if (!ctx.reducedMotion) {
            for (const source of letters) {
              if (source === letter || source.age > 3.2) continue;
              const distance = Math.hypot(
                source.x - letter.x,
                (source.y - letter.y) * 2,
              );
              const wave = distance - source.age * 70;
              displacement +=
                Math.sin(wave * 0.06) *
                Math.exp(-Math.abs(wave) / 70) *
                5 *
                (1 - source.age / 3.2);
            }
          }
          letter.text.y =
            letter.y +
            displacement +
            Math.sin(time * 1.2 + letter.x) * (ctx.reducedMotion ? 0 : 2);
          letter.text.scale.set(
            ctx.reducedMotion
              ? 1
              : 1 + Math.sin(Math.min(1, letter.age / 0.3) * Math.PI) * 0.12,
          );
        }
      },
      resize() {
        for (const letter of letters) {
          letter.x = Math.max(30, Math.min(ctx.bounds.width - 30, letter.x));
          letter.y = Math.min(Math.max(100, ctx.bounds.height - 170), letter.y);
          letter.text.position.set(letter.x, letter.y);
        }
      },
      dispose() {
        letters.length = 0;
      },
    };
  },
};

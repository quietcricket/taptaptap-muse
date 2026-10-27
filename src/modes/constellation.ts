import { Graphics, type Text } from 'pixi.js';
import type { ModeDefinition } from '../engine/types';

export const constellationMode: ModeDefinition = {
  id: 'constellation',
  name: 'Stars',
  symbol: '✧',
  description: 'A sky full of your own constellations.',
  create(ctx) {
    const sky = new Graphics();
    ctx.stage.addChild(sky);
    type Star = {
      text: Text;
      x: number;
      y: number;
      phase: number;
      links: Star[];
    };
    const stars: Star[] = [];
    let time = 0;
    return {
      onKey(character) {
        const text = ctx.createLetter(
          character,
          Math.min(
            ctx.letterSize * (0.25 + Math.random() * 1.1),
            ctx.bounds.width * 0.45,
            ctx.bounds.height * 0.32,
          ),
          (expired) => {
            const index = stars.findIndex((star) => star.text === expired);
            if (index !== -1) stars.splice(index, 1);
            for (const star of stars)
              star.links = star.links.filter((other) => other.text !== expired);
          },
        );
        const margin = Math.max(30, text.width / 2 + 10);
        const x =
          margin + Math.random() * Math.max(1, ctx.bounds.width - margin * 2);
        const top = Math.min(160, ctx.bounds.height / 3);
        const y =
          top + Math.random() * Math.max(1, ctx.bounds.height - top - 180);
        text.position.set(x, y);
        const reach = Math.min(260, ctx.bounds.width * 0.38);
        const links = stars
          .map((other) => ({
            other,
            distance: Math.hypot(x - other.x, y - other.y),
          }))
          .filter((pair) => pair.distance < reach)
          .sort((a, b) => a.distance - b.distance)
          .slice(0, 2)
          .map((pair) => pair.other);
        stars.push({ text, x, y, phase: Math.random() * Math.PI * 2, links });
        ctx.sound('clink', 0.22);
      },
      update(delta) {
        time += delta;
        sky.clear();
        const reach = Math.min(260, ctx.bounds.width * 0.38);
        for (let i = 0; i < stars.length; i++) {
          const star = stars[i];
          star.text.position.set(
            star.x +
              (ctx.reducedMotion ? 0 : Math.sin(time * 0.3 + star.phase) * 5),
            star.y +
              (ctx.reducedMotion ? 0 : Math.cos(time * 0.4 + star.phase) * 5),
          );
          // Connections are chosen on arrival, not sorted again on every frame.
          for (const other of star.links) {
            const distance = Math.hypot(star.x - other.x, star.y - other.y);
            sky
              .moveTo(star.text.x, star.text.y)
              .lineTo(other.text.x, other.text.y)
              .stroke({
                width: 1,
                color: '#8b9a78',
                alpha:
                  Math.min(star.text.alpha, other.text.alpha) *
                  Math.max(0, 1 - distance / reach) *
                  0.4,
              });
          }
          const radius =
            2 + (ctx.reducedMotion ? 0 : Math.sin(time + star.phase) * 0.5);
          sky
            .circle(star.text.x, star.text.y + star.text.height * 0.6, radius)
            .fill({ color: '#d2ad54', alpha: star.text.alpha * 0.8 });
        }
      },
      resize() {
        for (const star of stars) {
          star.x = Math.max(30, Math.min(ctx.bounds.width - 30, star.x));
          star.y = Math.min(Math.max(100, ctx.bounds.height - 170), star.y);
        }
      },
      dispose() {
        stars.length = 0;
      },
    };
  },
};

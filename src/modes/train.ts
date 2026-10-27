import type { Text } from 'pixi.js';
import type { ModeDefinition } from '../engine/types';

type TrackPoint = { x: number; y: number; distance: number };
const directions = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];

export const trainMode: ModeDefinition = {
  id: 'train',
  name: 'Train',
  symbol: '≈',
  description: 'All aboard a little letter train.',
  create(ctx) {
    const carriages: { text: Text; width: number; distance: number }[] = [];
    const track: TrackPoint[] = [];
    const gap = ctx.letterSize * 0.85 + 12;
    const speed = ctx.reducedMotion ? 54 : 120;
    const pushStrength = ctx.reducedMotion ? 0.45 : 1.2;
    const pushDecay = 0.45;
    let boost = 0;
    let headDistance = 0;
    let forward = 0;
    let backward = 2;
    let whistleCooldown = 0;

    function bounds() {
      const { width, height } = ctx.bounds;
      const left = Math.min(ctx.letterSize * 0.6 + 12, width / 4);
      const top = Math.min(ctx.letterSize * 0.6 + 12, height / 4);
      return {
        left,
        top,
        right: Math.max(left + 1, width - left),
        bottom: Math.max(top + 1, height - Math.min(150, height / 4)),
      };
    }

    function resetTrack(position?: TrackPoint) {
      const { left, top, right, bottom } = bounds();
      track.length = 0;
      track.push({
        x: position
          ? Math.max(left, Math.min(right, position.x))
          : left + Math.random() * (right - left),
        y: position
          ? Math.max(top, Math.min(bottom, position.y))
          : top + Math.random() * (bottom - top),
        distance: headDistance,
      });
      forward = Math.floor(Math.random() * 4);
      backward = (forward + 2) % 4;
    }

    function room(point: TrackPoint, direction: number) {
      const { left, top, right, bottom } = bounds();
      return [right - point.x, bottom - point.y, point.x - left, point.y - top][
        direction
      ];
    }

    function turn(point: TrackPoint, direction: number) {
      const choices = [(direction + 1) % 4, (direction + 3) % 4].filter(
        (candidate) => room(point, candidate) > 0.001,
      );
      return choices[Math.floor(Math.random() * choices.length)];
    }

    function extend(ahead: boolean) {
      const point = ahead ? track.at(-1)! : track[0];
      let direction = ahead ? forward : backward;
      if (room(point, direction) <= 0.001) direction = turn(point, direction);
      const length = Math.min(
        gap * (1.5 + Math.random() * 2.5),
        room(point, direction),
      );
      const next = {
        x: point.x + directions[direction].x * length,
        y: point.y + directions[direction].y * length,
        distance: point.distance + (ahead ? length : -length),
      };
      if (ahead) {
        track.push(next);
        forward = turn(next, direction);
      } else {
        track.unshift(next);
        backward = turn(next, direction);
      }
    }

    function place(carriage: (typeof carriages)[number]) {
      while (track[0].distance > carriage.distance) extend(false);
      while (track.at(-1)!.distance <= carriage.distance) extend(true);
      // Sample the recorded route so every carriage takes the same corners.
      let low = 0;
      let high = track.length - 1;
      while (high - low > 1) {
        const middle = Math.floor((low + high) / 2);
        if (track[middle].distance <= carriage.distance) low = middle;
        else high = middle;
      }
      const from = track[low];
      const to = track[high];
      const fraction =
        high === low
          ? 0
          : (carriage.distance - from.distance) / (to.distance - from.distance);
      carriage.text.position.set(
        from.x + (to.x - from.x) * fraction,
        from.y + (to.y - from.y) * fraction,
      );
      carriage.text.rotation = Math.atan2(to.y - from.y, to.x - from.x);
    }

    return {
      onKey(character) {
        const last = carriages.at(-1);
        if (!last) {
          resetTrack();
          boost = 0;
        }
        const text = ctx.createLetter(
          character,
          ctx.letterSize * 0.85,
          (expired) => {
            const index = carriages.findIndex(
              (carriage) => carriage.text === expired,
            );
            if (index !== -1) carriages.splice(index, 1);
          },
        );
        // Measure before rotation: Text.width changes with its displayed angle.
        const width = text.width;
        const carriage = {
          text,
          width,
          distance: last
            ? last.distance - (last.width + width) / 2 - 16
            : headDistance,
        };
        carriages.push(carriage);
        place(carriage);
        boost = Math.min(
          speed * pushStrength * 2,
          boost + speed * pushStrength,
        );
        if (whistleCooldown <= 0) {
          ctx.sound('choo', 0.3);
          whistleCooldown = 1.2;
        }
      },
      update(delta) {
        whistleCooldown = Math.max(0, whistleCooldown - delta);
        if (!carriages.length) return;
        // Integrate the fading push so travel is independent of frame rate.
        const decay = Math.exp(-delta / pushDecay);
        const distance = speed * delta + boost * pushDecay * (1 - decay);
        boost *= decay;
        headDistance += distance;
        for (const carriage of carriages) {
          carriage.distance += distance;
          place(carriage);
        }
        const tailDistance = carriages.at(-1)!.distance - gap;
        while (track.length > 2 && track[1].distance < tailDistance)
          track.shift();
      },
      resize() {
        if (!carriages.length) return;
        // Rebuild inside the new play area, preserving distance between carriages.
        const head = carriages[0];
        headDistance = head.distance;
        resetTrack({ x: head.text.x, y: head.text.y, distance: headDistance });
        for (const carriage of carriages) place(carriage);
      },
      dispose() {
        carriages.length = 0;
        track.length = 0;
      },
    };
  },
};

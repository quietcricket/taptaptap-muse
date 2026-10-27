import Matter from 'matter-js';
import type { Text } from 'pixi.js';
import type { ModeDefinition } from '../engine/types';

export const tumbleMode: ModeDefinition = {
  id: 'tumble',
  name: 'Tumble',
  symbol: '▧',
  description: 'A satisfying little pile of letters.',
  create(ctx) {
    const world = Matter.Engine.create({ enableSleeping: true });
    world.gravity.y = ctx.reducedMotion ? 0.35 : 0.85;
    const letters: { body: Matter.Body; text: Text }[] = [];
    let walls: Matter.Body[] = [];
    let accumulator = 0;
    let wakePile = false;
    const floor = () => Math.max(160, ctx.bounds.height - 145);
    function resize() {
      Matter.Composite.remove(world.world, walls);
      walls = [
        Matter.Bodies.rectangle(
          ctx.bounds.width / 2,
          floor() + 35,
          ctx.bounds.width + 200,
          70,
          { isStatic: true },
        ),
        Matter.Bodies.rectangle(
          -35,
          ctx.bounds.height / 2,
          70,
          ctx.bounds.height * 3,
          { isStatic: true },
        ),
        Matter.Bodies.rectangle(
          ctx.bounds.width + 35,
          ctx.bounds.height / 2,
          70,
          ctx.bounds.height * 3,
          { isStatic: true },
        ),
      ];
      Matter.Composite.add(world.world, walls);
      for (const { body } of letters) {
        Matter.Body.setPosition(body, {
          x: Math.max(35, Math.min(ctx.bounds.width - 35, body.position.x)),
          y: Math.min(floor() - 60, body.position.y),
        });
        Matter.Sleeping.set(body, false);
      }
    }
    resize();
    const collision = (event: Matter.IEventCollision<Matter.Engine>) => {
      let impact = 0;
      for (const pair of event.pairs)
        impact = Math.max(
          impact,
          Math.hypot(
            pair.bodyA.velocity.x - pair.bodyB.velocity.x,
            pair.bodyA.velocity.y - pair.bodyB.velocity.y,
          ),
        );
      if (impact > 1.4)
        ctx.sound(impact > 5 ? 'thud' : 'clink', Math.min(0.6, impact / 16));
    };
    Matter.Events.on(world, 'collisionStart', collision);
    return {
      onKey(character) {
        const text = ctx.createLetter(
          character,
          Math.min(
            ctx.letterSize * (0.45 + Math.random() * 1.55),
            ctx.bounds.width * 0.45,
            ctx.bounds.height * 0.32,
          ),
          (expired) => {
            const index = letters.findIndex(
              (letter) => letter.text === expired,
            );
            if (index !== -1) {
              Matter.Composite.remove(world.world, letters[index].body);
              letters.splice(index, 1);
              wakePile = true;
            }
          },
        );
        // Rounded boxes approximate the glyphs and keep collision handling inexpensive.
        const width = Math.max(22, text.width * 0.82);
        const height = Math.max(25, text.height * 0.7);
        const x =
          width / 2 +
          18 +
          Math.random() * Math.max(1, ctx.bounds.width - width - 36);
        const body = Matter.Bodies.rectangle(
          x,
          Math.min(150, floor() - height),
          width,
          height,
          {
            chamfer: { radius: Math.min(10, width / 4) },
            restitution: 0.45,
            friction: 0.4,
            frictionAir: 0.005,
            angle: (Math.random() - 0.5) * 0.5,
          },
        );
        Matter.Body.setVelocity(body, {
          x: (Math.random() - 0.5) * (ctx.reducedMotion ? 0.5 : 3),
          y: 0,
        });
        Matter.Composite.add(world.world, body);
        text.position.set(body.position.x, body.position.y);
        letters.push({ body, text });
      },
      update(delta) {
        // Removing a support does not wake Matter's sleeping bodies automatically.
        // Wake once per frame so the remaining letters fall into newly opened gaps.
        if (wakePile) {
          for (const { body } of letters) Matter.Sleeping.set(body, false);
          wakePile = false;
        }
        accumulator += delta;
        let steps = 0;
        while (accumulator >= 1 / 60 && steps++ < 4) {
          Matter.Engine.update(world, 1000 / 60);
          accumulator -= 1 / 60;
        }
        if (steps >= 4) accumulator = 0;
        for (const { body, text } of letters) {
          text.position.set(body.position.x, body.position.y);
          text.rotation = body.angle;
        }
      },
      resize,
      dispose() {
        Matter.Events.off(world, 'collisionStart', collision);
        Matter.Composite.clear(world.world, false);
        Matter.Engine.clear(world);
        letters.length = 0;
      },
    };
  },
};

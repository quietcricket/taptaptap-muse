# Contributing

The easiest contribution is a new world. Keep its behaviour self-contained so another parent—or their coding agent—can understand it without reading the entire application.

## Add a mode

1. Create `src/modes/your-mode.ts`, exporting a `ModeDefinition`.
2. Register it in `src/modes/index.ts`. The controls and rotation settings discover registered modes automatically.
3. Run `pnpm dev` and select the world in the dock.
4. Run checks appropriate to your change. Use a targeted test file for a focused fix, `pnpm check` for TypeScript validation, and the full suite before merging to `main`.

```ts
import type { ModeDefinition } from '../engine/types';

export const exampleMode: ModeDefinition = {
  id: 'example',
  name: 'Example',
  symbol: '○',
  description: 'A small experiment.',
  create(ctx) {
    return {
      onKey(character) {
        const letter = ctx.createLetter(character);
        letter.position.set(ctx.bounds.width / 2, ctx.bounds.height / 2);
        ctx.sound('pop', 0.3);
      },
      update(delta) {
        /* Animate using seconds, not frame count. */
      },
      resize() {
        /* Read ctx.bounds and adjust objects. */
      },
      dispose() {
        /* Release resources outside ctx.stage. */
      },
    };
  },
};
```

## Existing examples

`float.ts` demonstrates independent animation, `tumble.ts` adds physics, and `train.ts` links moving objects. `ripples.ts` and `constellation.ts` combine letters with mode-owned graphics. Story and Typewriter share their layout and cursor code under `src/modes/shared/`; original passages and the input-independent Story stream live there too. `ctx.storyText` contains the optional local parent passage.

## Engine contract

`create` receives a fresh container and the current size/motion preferences. `onKey` receives printable characters or mapped symbols for Space, Enter, Backspace, Delete, and arrow keys. The engine already plays the keypress sound. `update` receives a capped time delta in seconds. `resize` runs after viewport changes. `dispose` runs when the world exits, is cleared, or its size/motion preferences change.

By default, every letter created with `ctx.createLetter` has its own 15-second lifespan, fading during the last two seconds. A mode can set `letterLifespan: null` on its definition to keep text until the scene is cleared or exited; Story uses this option. Persistent letters do not count toward the timed-letter safety ceiling. New input must never evict an existing letter. Pass a third argument, `onExpire(letter)`, to remove references from your mode's arrays and remove any associated physics body. The engine destroys the expired display object after this callback. The safety ceiling pauses new letter creation at 256 active letters without removing existing ones.

The engine destroys the mode container and its display objects. Dispose your own physics bodies, event listeners, timers, and external textures. Use the shared animation loop and sound service rather than adding global listeners, animation loops, or audio contexts.

Keep objects bounded in number, avoid flashing effects, and honor `ctx.reducedMotion`. Call `ctx.sound` sparingly for collisions; strength is a value from 0 to 1. Avoid remote assets and analytics. New sounds should stay short and quiet.

## Review and manual checks

Do not run the full suite or production build after every edit. Documentation-only changes need no tests; simple visual changes usually need a visual check. For a focused mode fix, run its relevant test file, such as `node --experimental-strip-types --test tests/tumble.test.mjs`. Run `pnpm test` for changes spanning modes or shared engine behavior, before merging, or when requested. Run `pnpm build` for build, dependency, deployment, or asset changes. Repeat checks only when new changes, failures, or unresolved concerns justify it.

Use two-space indentation and Prettier. Prefer small TypeScript modules and descriptive names. Use concise imperative commit subjects. Pull requests should explain the behaviour and validation, with a screenshot or short recording for visible changes.

Check rapid typing and held keys, repeated mode switching and clearing, window resizing, sound/mute, gentler motion, background/resume, keyboard access to controls, and at least five minutes of continuous play. Test at narrow widths as well as on desktop. Include tests when changing shared input, settings, rotation, or session timing. Session limits use persisted wall-clock deadlines in `src/engine/session-timer.ts`; all modes must obey the engine pause during a break.

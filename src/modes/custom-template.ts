import type { ModeContext, PlayMode } from '../engine/types';

/** Starting point copied to mode.ts for a new studio mode. */
export default class CustomMode implements PlayMode {
  static readonly label = 'Your mode';
  static readonly symbol = '✦';
  static readonly description = 'Make a little keyboard magic.';
  private context: ModeContext;

  constructor(context: ModeContext) {
    this.context = context;
  }

  onKey(character: string): void {
    const letter = this.context.createLetter(character);
    letter.position.set(
      Math.random() * this.context.bounds.width,
      Math.random() * this.context.bounds.height,
    );
    this.context.sound('pop', 0.4);
  }

  update(_delta: number): void {}
  resize(): void {}
  dispose(): void {}
}

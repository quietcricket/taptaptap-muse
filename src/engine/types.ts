import type { Container, Text } from 'pixi.js';

export type SoundKind = 'tap' | 'pop' | 'clink' | 'thud' | 'choo';
export interface Bounds {
  width: number;
  height: number;
}
export interface ModeContext {
  /** A mode owns this container and its children. The engine destroys it on exit. */
  stage: Container;
  bounds: Bounds;
  letterSize: number;
  reducedMotion: boolean;
  /** Optional parent-provided passage, stored only in this browser. */
  storyText: string;
  /** Letters use the mode lifespan (15 seconds by default). Use onExpire to release mode-owned references. */
  createLetter(
    character: string,
    size?: number,
    onExpire?: (letter: Text) => void,
  ): Text;
  sound(kind: SoundKind, strength?: number): void;
}
export interface PlayMode {
  onKey(character: string): void;
  /** Delta is seconds, capped by the engine after stalls. */
  update(delta: number): void;
  resize(): void;
  /** Release physics worlds, listeners, and resources owned by the mode. */
  dispose(): void;
}
export interface ModeDefinition {
  id: string;
  name: string;
  symbol: string;
  description: string;
  /** Defaults to 15 seconds. null keeps letters until the mode is cleared or left. */
  letterLifespan?: number | null;
  create(context: ModeContext): PlayMode;
}

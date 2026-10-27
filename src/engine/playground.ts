import { Application, Container, Text } from 'pixi.js';
import { SoundEngine } from './audio';
import { LetterLifetimes } from './lifetimes';
import { nextMode, type Settings } from './settings';
import type { ModeContext, ModeDefinition, PlayMode } from './types';

const palette = ['#2c302b', '#e56b43', '#8b9a78', '#d2ad54', '#778c9b'];
interface Scene {
  stage: Container;
  context: ModeContext;
  mode: PlayMode;
  lifetimes: LetterLifetimes<Text>;
}
export class Playground {
  private app = new Application();
  private audio: SoundEngine;
  private scene?: Scene;
  private outgoing?: Scene;
  private transition = 1;
  private elapsed = 0;
  private lastReport = -1;
  private color = 0;
  private currentId: string;
  private destroyed = false;
  private paused = false;
  private initialized = false;
  onModeChange?: (id: string) => void;
  onCountdown?: (seconds: number | null) => void;
  private host: HTMLElement;
  private definitions: ModeDefinition[];
  private settings: Settings;
  constructor(
    host: HTMLElement,
    definitions: ModeDefinition[],
    settings: Settings,
  ) {
    this.host = host;
    this.definitions = definitions;
    this.settings = settings;
    this.currentId = definitions[0].id;
    this.audio = new SoundEngine(settings);
  }
  async init(): Promise<void> {
    await this.app.init({
      resizeTo: this.host,
      backgroundAlpha: 0,
      antialias: true,
      resolution: Math.min(devicePixelRatio || 1, 2),
      autoDensity: true,
      preference: 'webgl',
    });
    this.app.canvas.setAttribute('aria-hidden', 'true');
    this.host.append(this.app.canvas);
    this.initialized = true;
    this.switchMode(this.currentId);
    this.app.ticker.add(this.tick);
    window.addEventListener('resize', this.resize);
    document.addEventListener('visibilitychange', this.visibility);
    this.visibility();
  }
  unlockSound(): void {
    if (this.paused) return;
    try {
      this.audio.unlock();
    } catch {
      /* Play remains available without audio support. */
    }
  }
  key(character: string): void {
    if (this.paused) return;
    this.unlockSound();
    this.audio.play('tap');
    // At the safety ceiling, keep existing letters until their own expiry.
    // New input never evicts an older letter.
    if (this.scene && this.scene.lifetimes.size < 256)
      this.scene.mode.onKey(character);
  }
  configure(settings: Settings): void {
    const reset =
      this.settings.letterSize !== settings.letterSize ||
      this.settings.reducedMotion !== settings.reducedMotion ||
      (this.currentId === 'story' &&
        this.settings.storyText !== settings.storyText);
    this.settings = settings;
    this.audio.configure(settings);
    this.elapsed = 0;
    this.lastReport = -1;
    if (reset) this.switchMode(this.currentId);
  }
  switchMode(id: string): void {
    const definition = this.definitions.find((mode) => mode.id === id);
    if (!definition) return;
    if (this.outgoing) this.destroyScene(this.outgoing);
    this.outgoing = this.scene;
    this.currentId = id;
    const stage = new Container();
    this.app.stage.addChild(stage);
    const lifetimes = new LetterLifetimes<Text>();
    const context: ModeContext = {
      stage,
      bounds: { width: this.host.clientWidth, height: this.host.clientHeight },
      letterSize: this.settings.letterSize,
      reducedMotion: this.settings.reducedMotion,
      storyText: this.settings.storyText,
      createLetter: (character, size = this.settings.letterSize, onExpire) => {
        const text = new Text({
          text: character,
          style: {
            fontFamily: 'Fredoka Variable',
            fontWeight: '500',
            fontSize: size,
            fill: palette[this.color++ % palette.length],
          },
          resolution: Math.min(devicePixelRatio || 1, 2),
        });
        text.anchor.set(0.5);
        stage.addChild(text);
        lifetimes.track(text, onExpire, definition.letterLifespan);
        return text;
      },
      sound: (kind, strength) => this.audio.play(kind, strength),
    };
    this.scene = {
      stage,
      context,
      mode: definition.create(context),
      lifetimes,
    };
    this.transition = 0;
    this.elapsed = 0;
    this.lastReport = -1;
    this.onModeChange?.(id);
  }
  clear(): void {
    this.switchMode(this.currentId);
  }
  private tick = (): void => {
    if (document.hidden || this.destroyed || this.paused) return;
    const delta = Math.min(this.app.ticker.deltaMS / 1000, 0.05);
    this.scene?.mode.update(delta);
    this.scene?.lifetimes.update(delta);
    this.transition = Math.min(
      1,
      this.transition + delta / (this.settings.reducedMotion ? 0.12 : 0.45),
    );
    if (this.scene) this.scene.stage.alpha = this.transition;
    if (this.outgoing) {
      this.outgoing.stage.alpha = 1 - this.transition;
      if (this.transition >= 1) {
        this.destroyScene(this.outgoing);
        this.outgoing = undefined;
      }
    }
    const rotating =
      this.settings.autoRotate && this.settings.includedModes.length > 1;
    if (rotating) {
      this.elapsed += delta;
      if (this.elapsed >= this.settings.interval)
        this.switchMode(
          nextMode(
            this.currentId,
            this.settings.includedModes,
            this.settings.shuffle,
          ),
        );
    }
    const remaining = rotating
      ? Math.ceil(this.settings.interval - this.elapsed)
      : 0;
    if (remaining !== this.lastReport) {
      this.lastReport = remaining;
      this.onCountdown?.(rotating ? remaining : null);
    }
  };
  private resize = (): void => {
    // resizeTo is handled by Pixi; contexts read layout dimensions directly.
    for (const scene of [this.scene, this.outgoing])
      if (scene) {
        scene.context.bounds.width = this.host.clientWidth;
        scene.context.bounds.height = this.host.clientHeight;
        scene.mode.resize();
      }
  };
  setPaused(paused: boolean): void {
    this.paused = paused;
    if (this.initialized) this.visibility();
  }
  private visibility = (): void => {
    if (document.hidden || this.paused) {
      this.audio.suspend();
      this.app.stop();
    } else this.app.start();
  };
  private destroyScene(scene: Scene): void {
    scene.mode.dispose();
    scene.lifetimes.clear();
    scene.stage.destroy({ children: true });
  }
  dispose(): void {
    this.destroyed = true;
    window.removeEventListener('resize', this.resize);
    document.removeEventListener('visibilitychange', this.visibility);
    if (this.scene) this.destroyScene(this.scene);
    if (this.outgoing) this.destroyScene(this.outgoing);
    this.audio.dispose();
    this.app.destroy(true);
  }
}

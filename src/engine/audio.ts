import type { Settings } from './settings';
import type { SoundKind } from './types';

/** Short procedural sounds: no network, sample licensing, or media downloads. */
export class SoundEngine {
  private context?: AudioContext;
  private master?: GainNode;
  private compressor?: DynamicsCompressorNode;
  private active = 0;
  private lastSound = new Map<SoundKind, number>();
  private settings: Settings;
  constructor(settings: Settings) {
    this.settings = settings;
  }
  unlock(): void {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.compressor = this.context.createDynamicsCompressor();
      this.compressor.threshold.value = -16;
      this.compressor.ratio.value = 8;
      this.master.connect(this.compressor).connect(this.context.destination);
    }
    this.configure(this.settings);
    if (this.context.state === 'suspended')
      void this.context.resume().catch(() => {});
  }
  configure(settings: Settings): void {
    this.settings = settings;
    if (this.context && this.master)
      this.master.gain.setTargetAtTime(
        settings.muted ? 0 : (settings.volume / 100) * 0.36,
        this.context.currentTime,
        0.025,
      );
  }
  play(kind: SoundKind, strength = 1): void {
    const ctx = this.context;
    if (
      !ctx ||
      ctx.state !== 'running' ||
      this.settings.muted ||
      this.settings.volume === 0 ||
      (kind === 'tap' && !this.settings.keySounds)
    )
      return;
    const now = ctx.currentTime;
    if (
      this.active >= 10 ||
      now - (this.lastSound.get(kind) ?? -1) < (kind === 'choo' ? 1.2 : 0.035)
    )
      return;
    this.lastSound.set(kind, now);
    this.active++;
    const oscillator = ctx.createOscillator();
    const envelope = ctx.createGain();
    const frequency =
      { tap: 180, pop: 620, clink: 1350, thud: 100, choo: 440 }[kind] *
      (0.9 + Math.random() * 0.2);
    const duration = kind === 'choo' ? 0.55 : kind === 'clink' ? 0.12 : 0.075;
    oscillator.type = kind === 'tap' ? 'triangle' : 'sine';
    oscillator.frequency.setValueAtTime(frequency, now);
    if (kind === 'choo') {
      // Two soft whistle bursts, separated by a short breath.
      oscillator.frequency.linearRampToValueAtTime(
        frequency * 1.08,
        now + 0.08,
      );
      oscillator.frequency.setValueAtTime(frequency, now + 0.25);
      oscillator.frequency.linearRampToValueAtTime(
        frequency * 0.92,
        now + duration,
      );
      const peak = Math.min(1, Math.max(0.1, strength)) * 0.5;
      envelope.gain.setValueAtTime(0.001, now);
      envelope.gain.linearRampToValueAtTime(peak, now + 0.035);
      envelope.gain.exponentialRampToValueAtTime(0.001, now + 0.19);
      envelope.gain.setValueAtTime(0.001, now + 0.25);
      envelope.gain.linearRampToValueAtTime(peak, now + 0.285);
      envelope.gain.exponentialRampToValueAtTime(0.001, now + duration);
    } else {
      oscillator.frequency.exponentialRampToValueAtTime(
        kind === 'pop' ? frequency * 0.28 : frequency * 0.65,
        now + duration,
      );
      envelope.gain.setValueAtTime(0.001, now);
      envelope.gain.linearRampToValueAtTime(
        Math.min(1, Math.max(0.1, strength)) * (kind === 'clink' ? 0.32 : 0.7),
        now + 0.003,
      );
      envelope.gain.exponentialRampToValueAtTime(0.001, now + duration);
    }
    oscillator.connect(envelope).connect(this.master!);
    oscillator.onended = () => {
      oscillator.disconnect();
      envelope.disconnect();
      this.active--;
    };
    oscillator.start(now);
    oscillator.stop(now + duration + 0.01);
  }
  suspend(): void {
    if (this.context?.state === 'running')
      void this.context.suspend().catch(() => {});
  }
  dispose(): void {
    if (this.context) void this.context.close();
  }
}

/** Each letter lives for this many seconds of foreground play, including its fade. */
export const LETTER_LIFESPAN = 15;
export const LETTER_FADE_DURATION = 2;

interface ExpiringLetter {
  alpha: number;
  destroyed: boolean;
  destroy(): void;
}

/** Shared by every mode so expiry never depends on another keypress. */
export class LetterLifetimes<T extends ExpiringLetter> {
  private entries = new Map<
    T,
    { age: number; lifespan: number; onExpire?: (letter: T) => void }
  >();

  get size(): number {
    return this.entries.size;
  }

  track(
    letter: T,
    onExpire?: (letter: T) => void,
    lifespan: number | null = LETTER_LIFESPAN,
  ): void {
    // Persistent modes remain owned by their scene, without consuming the timed-letter cap.
    if (lifespan === null) return;
    this.entries.set(letter, { age: 0, lifespan, onExpire });
  }

  update(delta: number): void {
    for (const [letter, entry] of this.entries) {
      entry.age += delta;
      if (letter.destroyed || entry.age >= entry.lifespan) {
        this.entries.delete(letter);
        try {
          entry.onExpire?.(letter);
        } finally {
          if (!letter.destroyed) letter.destroy();
        }
      } else {
        const opacity = Math.min(
          1,
          (entry.lifespan - entry.age) / LETTER_FADE_DURATION,
        );
        letter.alpha = Math.min(letter.alpha, opacity);
      }
    }
  }

  /** Scene teardown destroys all display objects separately. */
  clear(): void {
    this.entries.clear();
  }
}

export const SESSION_KEY = 'taptaptap.session.v1';
export const BREAK_DURATION = 5 * 60_000;

interface TimerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
interface MathChallenge {
  left: number;
  right: number;
  adjustment: number;
}
interface Session {
  challenge: MathChallenge;
  startedAt: number;
  playUntil: number;
  breakUntil: number;
}
export interface SessionStatus {
  phase: 'ready' | 'playing' | 'break';
  remaining: number;
}

/** Persist deadlines, not a countdown: reloads and background tabs cannot restart it. */
export class SessionTimer {
  private storage: TimerStorage;
  private now: () => number;
  private random: () => number;
  private fallback: Session | null = null;

  constructor(
    storage: TimerStorage,
    now: () => number = Date.now,
    random: () => number = Math.random,
  ) {
    this.storage = storage;
    this.now = now;
    this.random = random;
  }

  private read(): Session | null {
    try {
      const raw = JSON.parse(this.storage.getItem(SESSION_KEY) ?? 'null');
      if (
        raw &&
        [raw.startedAt, raw.playUntil, raw.breakUntil].every(
          Number.isSafeInteger,
        ) &&
        raw.startedAt >= 0 &&
        raw.playUntil >= raw.startedAt &&
        raw.breakUntil === raw.playUntil + BREAK_DURATION
      ) {
        const challenge = raw.challenge;
        if (
          !challenge ||
          !Number.isInteger(challenge.left) ||
          challenge.left < 31 ||
          challenge.left > 89 ||
          !Number.isInteger(challenge.right) ||
          challenge.right < 12 ||
          challenge.right > 29 ||
          !Number.isInteger(challenge.adjustment) ||
          challenge.adjustment < 41 ||
          challenge.adjustment > 199
        ) {
          // Upgrade existing sessions once; refreshes reuse the saved question.
          raw.challenge = this.createChallenge();
          this.save(raw);
        }
        this.fallback = raw;
        return raw;
      }
      this.fallback = null;
      return null;
    } catch {
      return this.fallback;
    }
  }

  private save(session: Session | null): boolean {
    try {
      if (session) this.storage.setItem(SESSION_KEY, JSON.stringify(session));
      else this.storage.removeItem(SESSION_KEY);
      this.fallback = session;
      return true;
    } catch {
      return false;
    }
  }

  status(): SessionStatus {
    const session = this.read();
    const now = this.now();
    if (!session || now >= session.breakUntil)
      return { phase: 'ready', remaining: 0 };
    if (now >= session.playUntil)
      return {
        phase: 'break',
        remaining: Math.max(0, session.breakUntil - now),
      };
    return { phase: 'playing', remaining: session.playUntil - now };
  }

  private createChallenge(): MathChallenge {
    return {
      left: 31 + Math.floor(this.random() * 59),
      right: 12 + Math.floor(this.random() * 18),
      adjustment: 41 + Math.floor(this.random() * 159),
    };
  }

  question(): string | null {
    const status = this.status();
    if (status.phase !== 'break') return null;
    const challenge = this.read()?.challenge;
    return challenge
      ? `(${challenge.left} × ${challenge.right}) + ${challenge.adjustment} = ?`
      : null;
  }

  unlock(answer: string): 'unlocked' | 'incorrect' | 'waiting' | 'unavailable' {
    const status = this.status();
    if (status.phase !== 'break') return 'waiting';
    const challenge = this.read()?.challenge;
    const normalized = answer.trim();
    if (
      !challenge ||
      !/^\d{1,6}$/.test(normalized) ||
      Number(normalized) !==
        challenge.left * challenge.right + challenge.adjustment
    )
      return 'incorrect';
    return this.save(null) ? 'unlocked' : 'unavailable';
  }

  /** Repeated keypresses and reloads preserve an existing session or break. */
  begin(minutes: number): boolean {
    if (this.status().phase !== 'ready' || minutes === 0) return true;
    const startedAt = this.now();
    const playUntil = startedAt + minutes * 60_000;
    return this.save({
      startedAt,
      playUntil,
      challenge: this.createChallenge(),
      breakUntil: playUntil + BREAK_DURATION,
    });
  }

  /** Parent changes apply to the current session, but never cancel an active break. */
  configure(minutes: number): boolean {
    if (this.status().phase === 'break') return true;
    if (minutes === 0) return this.read() ? this.save(null) : true;
    const session = this.read();
    if (!session || this.status().phase === 'ready') return true;
    const playUntil = Math.max(
      this.now(),
      session.startedAt + minutes * 60_000,
    );
    return this.save({
      ...session,
      playUntil,
      breakUntil: playUntil + BREAK_DURATION,
    });
  }
}

export function formatTimer(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

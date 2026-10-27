export interface Settings {
  autoRotate: boolean;
  interval: number;
  shuffle: boolean;
  includedModes: string[];
  letterSize: number;
  volume: number;
  muted: boolean;
  keySounds: boolean;
  reducedMotion: boolean;
  storyText: string;
  playLimitMinutes: number;
}
export const SETTINGS_KEY = 'taptaptap.settings.v3';
export function normalizeSettings(
  raw: unknown,
  modeIds: string[],
  reducedMotion = false,
): Settings {
  const input =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const bool = (key: string, fallback: boolean) =>
    typeof input[key] === 'boolean' ? (input[key] as boolean) : fallback;
  const number = (key: string, fallback: number, min: number, max: number) =>
    typeof input[key] === 'number' && Number.isFinite(input[key])
      ? Math.min(max, Math.max(min, input[key] as number))
      : fallback;
  const included = Array.isArray(input.includedModes)
    ? modeIds.filter((id) => (input.includedModes as unknown[]).includes(id))
    : modeIds;
  return {
    autoRotate: bool('autoRotate', true),
    playLimitMinutes: [0, 5, 10, 15, 20, 30].includes(
      input.playLimitMinutes as number,
    )
      ? (input.playLimitMinutes as number)
      : 0,
    interval: [20, 45, 90, 180].includes(input.interval as number)
      ? (input.interval as number)
      : 45,
    shuffle: bool('shuffle', false),
    includedModes: included.length ? included : [...modeIds],
    letterSize: number('letterSize', 84, 48, 132),
    volume: number('volume', 28, 0, 100),
    muted: bool('muted', false),
    keySounds: bool('keySounds', true),
    reducedMotion: bool('reducedMotion', reducedMotion),
    storyText:
      typeof input.storyText === 'string'
        ? Array.from(input.storyText)
            .slice(0, 2000)
            .join('')
            .replace(/\r\n?/g, '\n')
        : '',
  };
}
export function nextMode(
  current: string,
  included: string[],
  shuffle: boolean,
  random = Math.random,
): string {
  const alternatives = included.filter((id) => id !== current);
  if (!alternatives.length) return included[0] ?? current;
  if (shuffle)
    return alternatives[
      Math.min(
        alternatives.length - 1,
        Math.floor(random() * alternatives.length),
      )
    ];
  return included[(included.indexOf(current) + 1) % included.length];
}

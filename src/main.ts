import './style.css';
import { Playground } from './engine/playground';
import { characterForKey } from './engine/keyboard';
import {
  SessionTimer,
  SESSION_KEY,
  formatTimer,
  type SessionStatus,
} from './engine/session-timer';
import {
  normalizeSettings,
  SETTINGS_KEY,
  type Settings,
} from './engine/settings';
import { modes } from './modes';

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const host = $('playground');
const panel = $('settings');
const toggle = $<HTMLButtonElement>('settings-toggle');
let stored: unknown;
try {
  const saved = localStorage.getItem(SETTINGS_KEY);
  stored = JSON.parse(
    saved ??
      localStorage.getItem('taptaptap.settings.v2') ??
      localStorage.getItem('taptaptap.settings.v1') ??
      'null',
  );
  // Preserve other preferences while enabling rotation once for older installations.
  if (!saved && stored && typeof stored === 'object') {
    stored = { ...stored, autoRotate: true };
  }
} catch {
  /* Storage is optional. */
}
let settings = normalizeSettings(
  stored,
  modes.map((mode) => mode.id),
  matchMedia('(prefers-reduced-motion: reduce)').matches,
);
try {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
} catch {
  /* Storage is optional. */
}
const playground = new Playground(host, modes, settings);
const sessionTimer = new SessionTimer({
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
  removeItem: (key) => localStorage.removeItem(key),
});
let onBreak = false;
const playSurfaces = document.querySelectorAll<HTMLElement>(
  '#playground, .masthead, #welcome, .bottom-bar, #settings',
);
let started = false;
let ready = false;
const pendingKeys: string[] = [];
const modeButtons = new Map<string, HTMLButtonElement>();
const includedInputs = new Map<string, HTMLInputElement>();
const UI_IDLE_DELAY = 3_000;
const chromeSelector = '.masthead, .bottom-bar, #settings';
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let keyboardNavigation = false;
const idleEvents = new AbortController();

function revealControls(): void {
  clearTimeout(idleTimer);
  if (onBreak) return;
  document.body.classList.remove('ui-idle');
  if (!started || !panel.hidden) return;
  idleTimer = setTimeout(() => {
    // Keep focused controls visible when a parent is navigating with Tab.
    if (keyboardNavigation && document.activeElement?.closest(chromeSelector))
      return;
    document.body.classList.add('ui-idle');
  }, UI_IDLE_DELAY);
}

window.addEventListener('pointermove', revealControls, {
  signal: idleEvents.signal,
  passive: true,
});
window.addEventListener(
  'pointerdown',
  () => {
    keyboardNavigation = false;
    revealControls();
  },
  { signal: idleEvents.signal, passive: true },
);
document.addEventListener('focusout', () => queueMicrotask(revealControls), {
  signal: idleEvents.signal,
});

function refreshSession(): SessionStatus {
  const status = sessionTimer.status();
  const locked = status.phase === 'break';
  if (locked !== onBreak) {
    onBreak = locked;
    document.body.classList.toggle('on-break', locked);
    $('break-screen').hidden = !locked;
    for (const surface of playSurfaces) surface.inert = locked;
    playground.setPaused(locked);
    if (locked) {
      clearTimeout(idleTimer);
      document.body.classList.remove('ui-idle');
      panel.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Open parent settings');
      pendingKeys.length = 0;
      $<HTMLInputElement>('break-answer').value = '';
      $('break-feedback').textContent = '';
      $('break-screen').focus({ preventScroll: true });
      $('announcement').textContent =
        'Take a five-minute break. A grown-up can optionally skip the wait.';
    } else {
      $('announcement').textContent = 'Your break is over. You can play again.';
      revealControls();
      focusPlay();
    }
  }
  if (locked) {
    $('break-countdown').hidden = false;
    $('break-countdown').textContent = formatTimer(status.remaining);
    $('break-unlock').hidden = false;
    $('break-question').textContent = sessionTimer.question();
  } else {
    $('break-unlock').hidden = true;
  }
  const sessionStatus = $('session-status');
  sessionStatus.hidden = status.phase !== 'playing';
  if (status.phase === 'playing')
    sessionStatus.textContent = `BREAK IN ${formatTimer(status.remaining)}`;
  return status;
}

function start(): boolean {
  if (!sessionTimer.begin(settings.playLimitMinutes)) {
    $('timer-error').hidden = false;
    return false;
  }
  if (refreshSession().phase === 'break') return false;
  $('timer-error').hidden = true;
  if (!started) {
    started = true;
    $('welcome').hidden = true;
    revealControls();
  }
  playground.unlockSound();
  return true;
}
function focusPlay(): void {
  (onBreak ? $('break-screen') : host).focus({ preventScroll: true });
}
function showSettings(open: boolean): void {
  if (onBreak) return;
  panel.hidden = !open;
  revealControls();
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute(
    'aria-label',
    open ? 'Close parent settings' : 'Open parent settings',
  );
  if (open) $('settings-close').focus();
  else focusPlay();
}
function apply(next: Partial<Settings>): void {
  if (refreshSession().phase === 'break') return;
  const candidate = normalizeSettings(
    { ...settings, ...next },
    modes.map((mode) => mode.id),
  );
  if (candidate.playLimitMinutes !== settings.playLimitMinutes) {
    if (
      !sessionTimer.configure(candidate.playLimitMinutes) ||
      (started && !sessionTimer.begin(candidate.playLimitMinutes))
    ) {
      $('timer-error').hidden = false;
      syncControls();
      return;
    }
    $('timer-error').hidden = true;
  }
  settings = candidate;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* Private or restricted storage is fine. */
  }
  playground.configure(settings);
  refreshSession();
  syncControls();
}
function syncControls(): void {
  $<HTMLSelectElement>('play-limit').value = String(settings.playLimitMinutes);
  $<HTMLInputElement>('auto-rotate').checked = settings.autoRotate;
  $<HTMLSelectElement>('interval').value = String(settings.interval);
  $<HTMLInputElement>('shuffle').checked = settings.shuffle;
  $<HTMLInputElement>('letter-size').value = String(settings.letterSize);
  $<HTMLInputElement>('volume').value = String(settings.volume);
  $<HTMLInputElement>('key-sounds').checked = settings.keySounds;
  $<HTMLInputElement>('reduced-motion').checked = settings.reducedMotion;
  $<HTMLTextAreaElement>('story-text').value = settings.storyText;
  for (const [id, input] of includedInputs)
    input.checked = settings.includedModes.includes(id);
  const sound = $<HTMLButtonElement>('sound');
  sound.setAttribute('aria-pressed', String(settings.muted));
  sound.setAttribute(
    'aria-label',
    settings.muted ? 'Unmute sound' : 'Mute sound',
  );
  sound.title = settings.muted ? 'Unmute sound' : 'Mute sound';
  sound.innerHTML = `<span aria-hidden="true">${settings.muted ? '♪̸' : '♫'}</span>`;
}
for (const mode of modes) {
  const button = document.createElement('button');
  button.className = 'mode-button';
  button.type = 'button';
  const symbol = document.createElement('span');
  symbol.className = 'mode-symbol';
  symbol.textContent = mode.symbol;
  symbol.setAttribute('aria-hidden', 'true');
  button.append(symbol, mode.name);
  button.setAttribute('aria-pressed', 'false');
  button.addEventListener('click', () => {
    if (!ready) return;
    if (!start()) return;
    playground.switchMode(mode.id);
    focusPlay();
  });
  $('mode-buttons').append(button);
  modeButtons.set(mode.id, button);
  const label = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.value = mode.id;
  input.addEventListener('change', () => {
    const included = [...includedInputs]
      .filter(([, item]) => item.checked)
      .map(([id]) => id);
    if (!included.length) {
      input.checked = true;
      $('announcement').textContent = 'Keep at least one world in rotation.';
      return;
    }
    apply({ includedModes: included });
  });
  label.append(input, mode.name);
  $('included-modes').append(label);
  includedInputs.set(mode.id, input);
}
playground.onModeChange = (id) => {
  for (const [modeId, button] of modeButtons)
    button.setAttribute('aria-pressed', String(modeId === id));
  modeButtons.get(id)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const index = modes.findIndex((mode) => mode.id === id);
  $('announcement').textContent = `${modes[index].name} world`;
};
playground.onCountdown = (seconds) => {
  const status = $('rotation-status');
  status.hidden = seconds === null;
  status.textContent = seconds === null ? '' : `NEXT WORLD IN ${seconds}s`;
};

$('start').addEventListener('click', () => {
  if (!start()) return;
  focusPlay();
});
host.addEventListener('pointerdown', () => {
  if (!start()) return;
  focusPlay();
  if (!panel.hidden) showSettings(false);
});
window.addEventListener('keydown', (event) => {
  if (refreshSession().phase === 'break') {
    // The rest of the page remains inert; allow typing and Tab within the parent form.
    if (
      (event.target as HTMLElement)?.closest('#break-unlock') &&
      !$('break-unlock').hidden
    )
      return;
    if (!event.ctrlKey && !event.metaKey) event.preventDefault();
    return;
  }
  if (event.key === 'Tab') {
    keyboardNavigation = true;
    revealControls();
  }
  if (event.key === 'Escape') {
    showSettings(panel.hidden);
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing)
    return;
  if (
    (event.target as HTMLElement)?.closest(
      'input, select, textarea, button, a, [contenteditable="true"]',
    )
  )
    return;
  const character = characterForKey(event.key);
  if (!character) return;
  event.preventDefault();
  if (!start()) return;
  if (ready) playground.key(character);
  else if (pendingKeys.length < 20) pendingKeys.push(character);
});
toggle.addEventListener('click', () => showSettings(panel.hidden));
$('settings-close').addEventListener('click', () => showSettings(false));
$('sound').addEventListener('click', () => {
  playground.unlockSound();
  apply({ muted: !settings.muted });
  focusPlay();
});
$('clear').addEventListener('click', () => {
  if (ready) playground.clear();
  focusPlay();
});
$('fullscreen').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    $('announcement').textContent =
      'Fullscreen is not available in this browser.';
  }
  focusPlay();
});
document.addEventListener('fullscreenchange', () => {
  const button = $('fullscreen');
  const label = document.fullscreenElement
    ? 'Exit fullscreen'
    : 'Enter fullscreen';
  button.setAttribute('aria-label', label);
  button.title = label;
});
for (const [id, key] of [
  ['auto-rotate', 'autoRotate'],
  ['shuffle', 'shuffle'],
  ['key-sounds', 'keySounds'],
  ['reduced-motion', 'reducedMotion'],
] as const) {
  $<HTMLInputElement>(id).addEventListener('change', (event) =>
    apply({ [key]: (event.target as HTMLInputElement).checked }),
  );
}
$('break-unlock').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = $<HTMLInputElement>('break-answer');
  const result = sessionTimer.unlock(input.value);
  if (result === 'unlocked') {
    input.value = '';
    $('break-feedback').textContent = '';
    $('break-unlock').hidden = true;
    refreshSession();
    if (start()) focusPlay();
  } else {
    $('break-feedback').textContent =
      result === 'incorrect'
        ? 'That answer isn’t quite right. Try again.'
        : result === 'waiting'
          ? 'The break has ended. You can play again.'
          : 'The unlock could not be saved. Please try again.';
    input.select();
    refreshSession();
  }
});
$('play-limit').addEventListener('change', (event) =>
  apply({
    playLimitMinutes: Number((event.target as HTMLSelectElement).value),
  }),
);
$('interval').addEventListener('change', (event) =>
  apply({ interval: Number((event.target as HTMLSelectElement).value) }),
);
$('letter-size').addEventListener('change', (event) =>
  apply({ letterSize: Number((event.target as HTMLInputElement).value) }),
);
$('volume').addEventListener('input', (event) =>
  apply({ volume: Number((event.target as HTMLInputElement).value) }),
);
$('story-text').addEventListener('change', (event) =>
  apply({ storyText: (event.target as HTMLTextAreaElement).value }),
);
syncControls();
refreshSession();
const sessionPoll = setInterval(refreshSession, 1000);
window.addEventListener(
  'storage',
  (event) => {
    if (event.key === SESSION_KEY || event.key === null) refreshSession();
  },
  { signal: idleEvents.signal },
);
document.addEventListener('visibilitychange', refreshSession, {
  signal: idleEvents.signal,
});
async function init(): Promise<void> {
  try {
    await document.fonts.load('500 84px "Fredoka Variable"');
    await playground.init();
    ready = true;
    if (refreshSession().phase !== 'break')
      for (const character of pendingKeys) playground.key(character);
    pendingKeys.length = 0;
  } catch (error) {
    $('error').hidden = false;
    $('error').textContent =
      'The playground couldn’t start. Please try a browser with WebGL enabled, then reload the page.';
    console.error(error);
  }
}
void init();
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    clearTimeout(idleTimer);
    clearInterval(sessionPoll);
    idleEvents.abort();
    document.body.classList.remove('ui-idle');
    playground.dispose();
  });

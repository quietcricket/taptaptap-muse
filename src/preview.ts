import * as pixi from 'pixi.js';
import 'pixi.js/unsafe-eval';
import Matter from 'matter-js';
import { mountPlayground } from './game';
import type { ModeContext, PlayMode } from './engine/types';

interface CustomModeClass {
  new (context: ModeContext): PlayMode;
  label?: string;
  symbol?: string;
  description?: string;
  letterLifespan?: number | null;
}

// This entry runs only inside the studio's opaque-origin sandbox. Generated
// modules reference these already-bundled libraries instead of rebuilding them.
Object.assign(globalThis, { __taptaptap: { pixi, matter: Matter } });
const pending: string[] = [];
let mounted = false;
function key(key: string): void {
  document
    .getElementById('playground')!
    .dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
}
window.addEventListener('message', (event) => {
  if (
    event.source !== parent ||
    event.data?.type !== 'taptaptap-key' ||
    typeof event.data.key !== 'string' ||
    event.data.key.length > 32
  )
    return;
  if (mounted) key(event.data.key);
  else if (pending.length < 20) pending.push(event.data.key);
});
async function preview(): Promise<void> {
  const encoded = JSON.parse(
    document.getElementById('mode-code')!.textContent!,
  );
  const { default: CustomMode } = (await import(
    /* @vite-ignore */ `data:text/javascript;base64,${encoded}`
  )) as { default: CustomModeClass };
  mountPlayground([
    {
      id: 'custom',
      name: CustomMode.label || 'Your mode',
      symbol: CustomMode.symbol || '✦',
      description: CustomMode.description || 'Your own keyboard world.',
      letterLifespan: CustomMode.letterLifespan,
      create: (context) => new CustomMode(context),
    },
  ]);
  document.querySelector('.contribute-button')?.remove();
  document.querySelector('.wordmark')?.removeAttribute('href');
  mounted = true;
  for (const value of pending) key(value);
  pending.length = 0;
  parent.postMessage({ type: 'taptaptap-ready' }, '*');
}
void preview().catch(() => {
  document.getElementById('error')!.hidden = false;
  document.getElementById('error')!.textContent =
    'This mode could not start. Ask Meta Muse to fix it.';
  parent.postMessage({ type: 'taptaptap-error' }, '*');
});

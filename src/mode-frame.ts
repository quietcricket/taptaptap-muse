import { forwardedPlayKey } from './engine/keyboard';

let runtime: Promise<{ html: string }> | undefined;
export async function modeDocument(javascript: string): Promise<string> {
  runtime ??= fetch('/mode-runtime.json')
    .then((response) => {
      if (!response.ok)
        throw new Error('The player could not load. Please retry.');
      return response.json();
    })
    .catch((error) => {
      runtime = undefined;
      throw error;
    });
  const shell = await runtime;
  const encoded = btoa(
    Array.from(new TextEncoder().encode(javascript), (byte) =>
      String.fromCharCode(byte),
    ).join(''),
  );
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline' data:; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'">${shell.html.replace('"__MODE_CODE__"', () => JSON.stringify(encoded))}`;
}

/** Keyboard events in the host page do not bubble into a sandboxed frame. */
export function connectModeKeyboard(frame: HTMLIFrameElement): void {
  window.addEventListener('keydown', (event) => {
    if (frame.hidden || !frame.srcdoc || event.defaultPrevented) return;
    const target = event.target;
    const editing =
      target instanceof Element &&
      Boolean(
        target.closest(
          'input, textarea, select, button, a, [contenteditable="true"]',
        ),
      );
    const key = forwardedPlayKey(event, editing);
    if (!key) return;
    event.preventDefault();
    frame.contentWindow?.postMessage({ type: 'taptaptap-key', key }, '*');
  });
}

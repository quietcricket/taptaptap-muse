import './player.css';
import { connectModeKeyboard, modeDocument } from './mode-frame';

const frame = document.getElementById('mode-player') as HTMLIFrameElement;
const status = document.getElementById('player-status')!;
const edit = document.getElementById('edit-mode') as HTMLAnchorElement;
const id = new URLSearchParams(location.search).get('mode');
connectModeKeyboard(frame);
window.addEventListener('message', (event) => {
  if (event.source !== frame.contentWindow) return;
  if (event.data?.type === 'taptaptap-ready') status.hidden = true;
  if (event.data?.type === 'taptaptap-error') {
    status.hidden = false;
    status.textContent =
      'This mode could not start. Open the studio to fix it.';
  }
});
async function play(): Promise<void> {
  if (!id) throw new Error('Choose a saved mode in the studio first.');
  edit.href = `/studio.html?project=${encodeURIComponent(id)}`;
  const response = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
    credentials: 'same-origin',
  });
  if (response.status === 401) {
    location.replace(`/studio.html?project=${encodeURIComponent(id)}&play=1`);
    return;
  }
  if (!response.ok)
    throw new Error('This mode is unavailable for your account.');
  const project = await response.json();
  if (!project.javascript)
    throw new Error(
      'This mode has no playable class yet. Open it in the studio to create one.',
    );
  document.title = `${project.name} · taptaptap`;
  frame.title = project.name;
  frame.srcdoc = await modeDocument(project.javascript);
  frame.hidden = false;
}
void play().catch((error) => {
  status.hidden = false;
  status.textContent = error.message;
});

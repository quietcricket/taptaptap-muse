import './studio.css';
import { connectModeKeyboard, modeDocument } from './mode-frame';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}
interface Project {
  id: string;
  name: string;
  html: string;
  source: string;
  javascript: string;
  messages: ChatMessage[];
}
const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
let active: Project | null = null;
let agentConfigured = false;
let sending = false;
let selection = 0;
let loginToken = new URLSearchParams(location.hash.slice(1)).get('token');
if (location.hash)
  history.replaceState(null, '', location.pathname + location.search);

class ApiError extends Error {
  constructor(
    message: string,
    readonly retryAfter: number,
  ) {
    super(message);
  }
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    if (response.status === 401) showSignedOut();
    throw new ApiError(
      typeof error.detail === 'string'
        ? error.detail
        : `Request failed (${response.status}).`,
      Number(response.headers.get('Retry-After')) || 0,
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
function notify(message: string): void {
  $('notice').textContent = message;
}
function showGeneration(projectId: string): (success: boolean) => void {
  const panel = $('generation-progress');
  const label = $('generation-status');
  const list = $('generation-events');
  const started = Date.now();
  let stopped = false;
  let poll: ReturnType<typeof setTimeout> | undefined;
  panel.hidden = false;
  panel.setAttribute('aria-busy', 'true');
  label.textContent = 'Calling Meta Muse…';
  list.replaceChildren();
  const first = document.createElement('li');
  first.textContent = 'Sending your idea to Meta Muse.';
  list.append(first);
  $('generation-elapsed').textContent = '0s';
  const timer = setInterval(() => {
    $('generation-elapsed').textContent =
      `${Math.floor((Date.now() - started) / 1000)}s`;
  }, 1000);
  async function update(): Promise<void> {
    try {
      const activity = await api<{
        state: string;
        events: { message: string; seconds: number }[];
      }>(`/projects/${projectId}/progress`);
      if (stopped) return;
      if (activity.state === 'running' && activity.events.length) {
        list.replaceChildren();
        for (const event of activity.events) {
          const entry = document.createElement('li');
          entry.textContent = `${event.seconds}s · ${event.message}`;
          list.append(entry);
        }
        label.textContent = activity.events.at(-1)!.message;
      }
    } catch {
      // The generation request owns errors; transient polling failures don't
      // replace its status or interrupt the user's model call.
    }
    if (!stopped) poll = setTimeout(update, 1000);
  }
  void update();
  return (success) => {
    stopped = true;
    clearInterval(timer);
    clearTimeout(poll);
    panel.removeAttribute('aria-busy');
    label.textContent = success
      ? 'Your mode is ready to play.'
      : 'Meta Muse could not complete this request.';
  };
}
function showSignedOut(): void {
  selection++;
  active = null;
  $('workspace').hidden = true;
  $('sign-in').hidden = false;
  $('messages').replaceChildren();
  $('projects').replaceChildren();
  $<HTMLIFrameElement>('preview').srcdoc = '';
}
function renderMessages(): void {
  $('messages').replaceChildren();
  for (const message of active?.messages ?? []) {
    const entry = document.createElement('p');
    const author = document.createElement('strong');
    author.textContent = message.role === 'user' ? 'You' : 'Meta Muse';
    const text = document.createElement('span');
    text.textContent = message.content;
    entry.append(author, text);
    $('messages').append(entry);
  }
  $('messages').scrollTop = $('messages').scrollHeight;
}
connectModeKeyboard($<HTMLIFrameElement>('preview'));
async function renderPreview(): Promise<void> {
  const frame = $<HTMLIFrameElement>('preview');
  const project = active;
  const hasPreview = Boolean(project?.html || project?.javascript);
  frame.hidden = !hasPreview;
  $('preview-hint').hidden = hasPreview;
  $<HTMLButtonElement>('restart').disabled = !hasPreview;
  frame.srcdoc = '';
  if (project?.javascript) {
    try {
      const html = await modeDocument(project.javascript);
      if (active !== project) return;
      frame.srcdoc = html;
    } catch (error) {
      if (active === project) notify((error as Error).message);
    }
    return;
  }
  // The frame gets an opaque origin, no parent DOM access or session storage,
  // and a policy that blocks external scripts, fetches, assets, and forms.
  frame.srcdoc = active?.html
    ? `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'">${active.html}`
    : '';
}
async function openProject(id: string): Promise<void> {
  if (sending) return;
  const ticket = ++selection;
  const project = await api<Project>(`/projects/${id}`);
  if (ticket !== selection) return;
  active = project;
  $('generation-progress').hidden = true;
  const url = new URL(location.href);
  url.searchParams.set('project', id);
  history.replaceState(null, '', url);
  $('project-title').textContent = project.name;
  const playLink = $<HTMLAnchorElement>('play-mode');
  playLink.href = `/play.html?mode=${encodeURIComponent(id)}`;
  playLink.hidden = !project.javascript;
  $('empty-state').hidden = true;
  $('project-editor').hidden = false;
  $<HTMLTextAreaElement>('prompt').value = '';
  renderMessages();
  void renderPreview();
}
async function refreshProjects(): Promise<Pick<Project, 'id' | 'name'>[]> {
  const projects = await api<Pick<Project, 'id' | 'name'>[]>('/projects');
  $('projects').replaceChildren();
  for (const project of projects) {
    const button = document.createElement('button');
    button.className = 'project-button quiet';
    button.textContent = project.name;
    button.disabled = sending;
    button.addEventListener('click', () => {
      void openProject(project.id).catch((error) => notify(error.message));
    });
    $('projects').append(button);
  }
  return projects;
}
async function signIn(): Promise<void> {
  const user = await api<{ email: string }>('/auth/me');
  $('account-email').textContent = user.email;
  $('sign-in').hidden = true;
  $('workspace').hidden = false;
  $('project-editor').hidden = true;
  $('empty-state').hidden = false;
  const status = await api<{ agent_configured: boolean }>('/studio/status');
  agentConfigured = status.agent_configured;
  $('agent-status').textContent = agentConfigured
    ? 'Meta Muse will build a private preview from your ideas. A turn can take a few minutes.'
    : 'Meta Muse is currently unavailable. Please try again later.';
  $<HTMLButtonElement>('send').disabled = !agentConfigured;
  const projects = await refreshProjects();
  const requested = new URLSearchParams(location.search).get('project');
  if (requested && new URLSearchParams(location.search).get('play') === '1') {
    location.replace(`/play.html?mode=${encodeURIComponent(requested)}`);
    return;
  }
  if (requested) await openProject(requested);
  else if (projects.length) await openProject(projects[0].id);
}

const loginButton = $('login-form').querySelector('button')!;
const cooldownKey = 'taptaptap.emailCooldownUntil';
let loginSending = false;
let cooldownUntil = 0;
let cooldownTimer: ReturnType<typeof setInterval> | undefined;
function readEmailCooldown(): void {
  try {
    const stored = Number(localStorage.getItem(cooldownKey));
    cooldownUntil = Number.isFinite(stored) ? stored : 0;
  } catch {
    // The server still enforces the cooldown when storage is unavailable.
  }
}
function renderEmailCooldown(): void {
  const remaining = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
  loginButton.disabled = loginSending || remaining > 0;
  loginButton.textContent = loginSending
    ? 'Sending…'
    : remaining > 0
      ? `Resend in ${remaining}s`
      : 'Send sign-in link';
  if (remaining > 0 && cooldownTimer === undefined) {
    cooldownTimer = setInterval(renderEmailCooldown, 250);
  } else if (!remaining && cooldownTimer !== undefined) {
    clearInterval(cooldownTimer);
    cooldownTimer = undefined;
  }
}
function startEmailCooldown(seconds: number): void {
  cooldownUntil = Date.now() + seconds * 1000;
  try {
    localStorage.setItem(cooldownKey, String(cooldownUntil));
  } catch {
    // Keep the countdown in memory if browser storage is blocked.
  }
  renderEmailCooldown();
}
readEmailCooldown();
renderEmailCooldown();
window.addEventListener('storage', (event) => {
  if (event.key === cooldownKey || event.key === null) {
    readEmailCooldown();
    renderEmailCooldown();
  }
});
$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (loginSending || Date.now() < cooldownUntil) return;
  loginSending = true;
  renderEmailCooldown();
  try {
    const result = await api<{ retry_after: number }>('/auth/request-link', {
      email: $<HTMLInputElement>('email').value,
    });
    startEmailCooldown(result.retry_after);
    notify(
      'Check your email. Your sign-in link works once and expires in 15 minutes.',
    );
  } catch (error) {
    if (error instanceof ApiError && error.retryAfter > 0) {
      startEmailCooldown(error.retryAfter);
    }
    notify((error as Error).message);
  } finally {
    loginSending = false;
    renderEmailCooldown();
  }
});
if (loginToken) {
  $('login-form').hidden = true;
  $('verify').hidden = false;
  notify('Confirm below to finish signing in.');
} else {
  void signIn().catch((error) => {
    // A first visit is normally signed out; surface network and server failures.
    if (error.message !== 'Sign in to continue') notify(error.message);
  });
}
$('verify').addEventListener('click', async () => {
  const button = $<HTMLButtonElement>('verify');
  button.disabled = true;
  try {
    await api('/auth/verify', { token: loginToken });
    loginToken = null;
    await signIn();
    notify('You’re signed in. Let’s make a world.');
  } catch (error) {
    notify((error as Error).message);
    $('login-form').hidden = false;
    button.hidden = true;
  } finally {
    button.disabled = false;
  }
});
$('logout').addEventListener('click', async () => {
  try {
    await api('/auth/logout', {});
    showSignedOut();
    $('login-form').hidden = false;
    $('verify').hidden = true;
    notify('You’re signed out.');
  } catch (error) {
    notify((error as Error).message);
  }
});
$('project-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (sending) return;
  const button = $('project-form').querySelector('button')!;
  button.disabled = true;
  try {
    const project = await api<Project>('/projects', {
      name: $<HTMLInputElement>('project-name').value,
    });
    $<HTMLInputElement>('project-name').value = '';
    await refreshProjects();
    await openProject(project.id);
    notify('Describe your idea to Meta Muse.');
  } catch (error) {
    notify((error as Error).message);
  } finally {
    button.disabled = false;
  }
});
$('chat-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!active || sending || !agentConfigured) return;
  const content = $<HTMLTextAreaElement>('prompt').value.trim();
  if (!content) return;
  const project = active;
  sending = true;
  const sendButton = $<HTMLButtonElement>('send');
  sendButton.disabled = true;
  sendButton.textContent = 'Calling Meta Muse…';
  $<HTMLTextAreaElement>('prompt').disabled = true;
  const finishProgress = showGeneration(project.id);
  let completed = false;
  $('chat-form').setAttribute('aria-busy', 'true');
  document
    .querySelectorAll<HTMLButtonElement>(
      '#projects button, #project-form button',
    )
    .forEach((button) => {
      button.disabled = true;
    });
  notify('Meta Muse is creating your world…');
  try {
    const result = await api<{
      reply: string;
      html: string;
      source: string;
      javascript: string;
    }>(`/projects/${project.id}/messages`, { content });
    if (active === project) {
      project.messages.push(
        { role: 'user', content },
        { role: 'assistant', content: result.reply },
      );
      project.html = result.html;
      project.source = result.source;
      project.javascript = result.javascript;
      $<HTMLAnchorElement>('play-mode').hidden = !project.javascript;
      $<HTMLTextAreaElement>('prompt').value = '';
      renderMessages();
      void renderPreview();
      notify('Your mode is saved. Click the preview, then type to try it.');
      completed = true;
    }
  } catch (error) {
    notify((error as Error).message);
  } finally {
    sending = false;
    finishProgress(completed);
    sendButton.textContent = 'Send to Meta Muse';
    $<HTMLTextAreaElement>('prompt').disabled = false;
    $<HTMLButtonElement>('send').disabled = !agentConfigured;
    $('chat-form').removeAttribute('aria-busy');
    document
      .querySelectorAll<HTMLButtonElement>(
        '#projects button, #project-form button',
      )
      .forEach((button) => {
        button.disabled = false;
      });
  }
});
$('restart').addEventListener('click', renderPreview);

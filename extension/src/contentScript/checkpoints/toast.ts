import type { ToastKind } from '../../checkpoints/messages.js';

const HOST_ID = 'respawn-toast-host';
const VISIBLE_MS = 2400;

const STYLE = `
:host { all: initial; }
.toast {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translate(-50%, 8px);
  z-index: 2147483647;
  max-width: min(480px, calc(100vw - 32px));
  padding: 8px 14px 8px 11px;
  border-radius: 999px;
  display: flex;
  align-items: center;
  gap: 8px;
  font: 500 13px/1.35 system-ui, -apple-system, 'Segoe UI', sans-serif;
  color: #fafafa;
  background: #18181b;
  border: 1px solid #27272a;
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.2);
  opacity: 0;
  transition: opacity 140ms ease, transform 140ms ease;
  pointer-events: none;
}
.toast.visible { opacity: 1; transform: translate(-50%, 0); }
.message { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
svg { flex: none; display: block; }
.success svg { color: #4ade80; }
.info svg { color: #60a5fa; }
.error svg { color: #f87171; }
`;

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
// Feather icons (MIT).
const ICONS: Record<ToastKind, string> = {
  success: svg('<path d="M20 6 9 17l-5-5"/>'),
  info: svg('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>'),
  error: svg('<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>'),
};

let hideTimer: ReturnType<typeof setTimeout> | undefined;

function ensureToast(): HTMLDivElement {
  let host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = HOST_ID;
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    root.append(style, toast);
    document.documentElement.append(host);
  }
  return host.shadowRoot!.querySelector('.toast') as HTMLDivElement;
}

export function showToast(text: string, kind: ToastKind = 'info') {
  const toast = ensureToast();
  const message = document.createElement('span');
  message.className = 'message';
  message.textContent = text;
  toast.innerHTML = ICONS[kind];
  toast.append(message);
  toast.className = `toast ${kind}`;
  // Force a reflow so re-showing restarts the transition.
  void toast.offsetWidth;
  toast.classList.add('visible');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(
    () => toast.classList.remove('visible'),
    kind === 'error' ? VISIBLE_MS * 2 : VISIBLE_MS,
  );
}

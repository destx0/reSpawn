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
  padding: 9px 14px 9px 12px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  font: 500 13px/1.35 system-ui, -apple-system, 'Segoe UI', sans-serif;
  color: #f8fafc;
  background: #1e293b;
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.25);
  opacity: 0;
  transition: opacity 140ms ease, transform 140ms ease;
  pointer-events: none;
}
.toast.visible { opacity: 1; transform: translate(-50%, 0); }
.dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.success .dot { background: #34d399; }
.info .dot { background: #60a5fa; }
.error .dot { background: #f87171; }
.label { opacity: 0.6; font-weight: 600; letter-spacing: 0.02em; }
`;

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
  const dot = document.createElement('span');
  dot.className = 'dot';
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = 'reSpawn';
  const message = document.createElement('span');
  message.textContent = text;
  toast.replaceChildren(dot, label, message);
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

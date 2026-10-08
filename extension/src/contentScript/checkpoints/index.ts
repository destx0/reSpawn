import type { PageContext, PageRequest } from '../../checkpoints/messages.js';
import { requestCheckpoints } from '../../checkpoints/messages.js';
import { goToRoute } from './navigation.js';
import { palette } from './palette.js';
import { showToast } from './toast.js';

interface CheckpointsOptions {
  /** Whether this frame has a store talking to Redux DevTools. */
  readonly isStoreConnected: () => boolean;
}

function pageContext(): PageContext {
  return {
    url: location.href,
    origin: location.origin,
    route: `${location.pathname}${location.search}${location.hash}`,
  };
}

/** The inspector-ng Angular overlay has its own Alt+S / Alt+P handlers. */
function hasInspectorOverlay() {
  return !!document.querySelector('inspector-overlay');
}

function isHotkey(event: KeyboardEvent, code: 'KeyS' | 'KeyP') {
  // `code`, not `key`: on macOS Option+S types "ß".
  return (
    event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    event.code === code
  );
}

function isEditable(target: EventTarget | null) {
  const element = target instanceof Element ? target : null;
  return (
    !!element &&
    (element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      (element as HTMLElement).isContentEditable)
  );
}

/** macOS Option+S types "ß"; let such characters through in text fields. */
function typesText(event: KeyboardEvent) {
  return (
    isEditable(event.composedPath()[0] ?? event.target) &&
    event.key.length === 1 &&
    event.key.toLowerCase() !== event.code.slice(-1).toLowerCase()
  );
}

async function save() {
  const response = await requestCheckpoints({ type: 'RESPAWN/SAVE' });
  // Success toasts come from the background so panel actions show them too.
  if (!response.ok) showToast(response.error, 'error');
}

export function initCheckpoints({ isStoreConnected }: CheckpointsOptions) {
  chrome.runtime.onMessage.addListener(
    (message: PageRequest, _sender, sendResponse) => {
      switch (message?.type) {
        case 'RESPAWN/PAGE_CONTEXT':
          sendResponse(pageContext());
          return false;
        case 'RESPAWN/PAGE_GO':
          void goToRoute(message.route).then(sendResponse);
          return true;
        case 'RESPAWN/PAGE_TOAST':
          if (window === window.top) showToast(message.text, message.kind);
          return false;
        default:
          return false;
      }
    },
  );

  // Hotkeys live in the top frame only, and only on pages with a store.
  if (window !== window.top) return;
  window.addEventListener(
    'keydown',
    (event) => {
      const saveKey = isHotkey(event, 'KeyS');
      const paletteKey = isHotkey(event, 'KeyP');
      if (!saveKey && !paletteKey) return;
      // Pages must not be able to trigger saves with synthetic events.
      if (!event.isTrusted || event.isComposing || typesText(event)) return;
      if (!isStoreConnected() || hasInspectorOverlay()) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      if (saveKey) void save();
      else palette.toggle();
    },
    true,
  );
}

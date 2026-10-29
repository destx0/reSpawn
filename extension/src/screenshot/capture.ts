import { getAnnotations } from '../annotate/index.js';
import { showToast } from '../contentScript/checkpoints/toast.js';
import { getInspector } from '../contentScript/inspector/index.js';
import { openScreenshotEditor } from './editor.js';
import { requestCapture } from './messages.js';

const HOST_ID = 'respawn-screenshot-region-host';
const TOAST_HOST_ID = 'respawn-toast-host';
const INSPECTOR_HOST_ID = 'respawn-inspector-host';

const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; }
.backdrop {
  position: fixed; inset: 0;
  z-index: 1;
  cursor: crosshair;
  font-family: 'Source Sans 3', 'Source Sans Pro', 'Segoe UI', system-ui, sans-serif;
}
.selection {
  position: fixed;
  border: 1px dashed rgba(255, 255, 255, 0.92);
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.38);
  pointer-events: none;
}
.size {
  position: fixed;
  padding: 3px 6px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 4px;
  background: #1b1b1b;
  color: #fafafa;
  font-family: 'Source Code Pro', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}
.hint {
  position: fixed; top: 18px; left: 50%;
  z-index: 2;
  transform: translateX(-50%);
  padding: 7px 11px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 999px;
  background: rgba(20, 20, 20, 0.9);
  color: #e8e8e8;
  font-size: 12px;
  white-space: nowrap;
  pointer-events: none;
}
.hint kbd {
  padding: 2px 4px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 4px;
  font-family: 'Source Code Pro', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
}
`;

type Rect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

const waitForPaint = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

class RegionOverlay {
  private host: HTMLDivElement | null = null;
  private selection: HTMLDivElement | null = null;
  private label: HTMLDivElement | null = null;
  private start: { x: number; y: number } | null = null;
  private current: Rect | null = null;
  private busy = false;
  private restoreNodes: Array<{
    node: HTMLElement;
    visibility: string;
    priority: string;
  }> = [];

  async run() {
    this.mount();
    await new Promise<void>((resolve) => {
      this.resolve = resolve;
    });
  }

  private resolve: (() => void) | null = null;

  private mount() {
    const host = document.createElement('div');
    host.id = HOST_ID;
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLE;

    const backdrop = document.createElement('div');
    backdrop.className = 'backdrop';
    backdrop.addEventListener('pointerdown', this.onPointerDown);
    backdrop.addEventListener('pointermove', this.onPointerMove);
    backdrop.addEventListener('pointerup', this.onPointerUp);
    backdrop.addEventListener('pointercancel', this.cancel);

    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.innerHTML =
      'Drag a region · <kbd>Esc</kbd> to cancel';

    this.selection = document.createElement('div');
    this.selection.className = 'selection';
    this.selection.hidden = true;

    this.label = document.createElement('div');
    this.label.className = 'size';
    this.label.hidden = true;

    backdrop.append(this.selection, this.label);
    root.append(style, hint, backdrop);
    document.documentElement.append(host);
    this.host = host;
    window.addEventListener('keydown', this.onKeyDown, true);
    this.suppressInspector();
    getAnnotations().prepareForCapture();
  }

  private onPointerDown = (event: PointerEvent) => {
    if (this.busy || event.button !== 0) return;
    event.preventDefault();
    this.start = { x: event.clientX, y: event.clientY };
    this.current = { x: event.clientX, y: event.clientY, w: 0, h: 0 };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    if (this.selection) this.selection.hidden = false;
    if (this.label) this.label.hidden = false;
    this.paint();
  };

  private onPointerMove = (event: PointerEvent) => {
    if (!this.start || this.busy) return;
    const x = Math.min(this.start.x, event.clientX);
    const y = Math.min(this.start.y, event.clientY);
    this.current = {
      x,
      y,
      w: Math.abs(event.clientX - this.start.x),
      h: Math.abs(event.clientY - this.start.y),
    };
    this.paint();
  };

  private onPointerUp = (event: PointerEvent) => {
    if (!this.start || !this.current || this.busy) return;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
    const rect = this.current;
    this.start = null;
    if (rect.w < 4 || rect.h < 4) {
      this.cancel();
      return;
    }
    void this.capture(rect);
  };

  private paint() {
    if (!this.current || !this.selection || !this.label) return;
    const { x, y, w, h } = this.current;
    this.selection.style.left = `${x}px`;
    this.selection.style.top = `${y}px`;
    this.selection.style.width = `${w}px`;
    this.selection.style.height = `${h}px`;
    this.label.textContent = `${Math.round(w)} × ${Math.round(h)}`;
    const labelTop = y > 30 ? y - 26 : y + h + 6;
    this.label.style.left = `${x}px`;
    this.label.style.top = `${labelTop}px`;
  }

  private async capture(rect: Rect) {
    this.busy = true;
    if (this.host) this.host.style.visibility = 'hidden';
    try {
      await waitForPaint();
      const response = await requestCapture();
      this.restoreAll();
      if (!response.ok) {
        getAnnotations().setSuppressed(false);
        showToast(response.error, 'error');
        return;
      }
      const blob = await crop(response.dataUrl, rect);
      openScreenshotEditor(blob);
    } catch (error) {
      this.restoreAll();
      getAnnotations().setSuppressed(false);
      showToast(
        error instanceof Error ? error.message : 'Screenshot failed.',
        'error',
      );
    } finally {
      this.cleanup();
    }
  }

  private suppressInspector() {
    getInspector()?.setSuppressed(true);
    for (const id of [TOAST_HOST_ID, INSPECTOR_HOST_ID]) {
      const node = document.getElementById(id);
      if (!node) continue;
      this.restoreNodes.push({
        node,
        visibility: node.style.getPropertyValue('visibility'),
        priority: node.style.getPropertyPriority('visibility'),
      });
      node.style.setProperty('visibility', 'hidden', 'important');
    }
  }

  private restoreAll() {
    for (const { node, visibility, priority } of this.restoreNodes) {
      if (visibility) node.style.setProperty('visibility', visibility, priority);
      else node.style.removeProperty('visibility');
    }
    this.restoreNodes = [];
    getInspector()?.setSuppressed(getAnnotations().isActive);
  }

  private cleanup() {
    window.removeEventListener('keydown', this.onKeyDown, true);
    if (this.host) {
      this.host.remove();
      this.host = null;
    }
    this.resolve?.();
    this.resolve = null;
  }

  private cancel = () => {
    if (this.busy) return;
    this.restoreAll();
    getAnnotations().setSuppressed(false);
    this.cleanup();
  };

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.cancel();
  };
}

async function crop(dataUrl: string, rect: Rect) {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Could not read the screenshot.'));
    image.src = dataUrl;
  });
  const scale = image.naturalWidth / window.innerWidth;
  const sx = Math.round(rect.x * scale);
  const sy = Math.round(rect.y * scale);
  const sw = Math.max(1, Math.round(rect.w * scale));
  const sh = Math.max(1, Math.round(rect.h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not crop the screenshot.');
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png'),
  );
  if (!blob) throw new Error('Could not encode the screenshot.');
  return blob;
}

export async function captureRegion() {
  if (document.getElementById(HOST_ID)) return;
  const overlay = new RegionOverlay();
  await overlay.run();
}

import { getAnnotations } from '../annotate/index.js';
import { AnnotationStore } from '../annotate/store.js';
import { ANNOTATE_STYLE, EDITOR_STYLE } from '../annotate/styles.js';
import { AnnotationSurface } from '../annotate/surface.js';
import {
  AnnotationToolbar,
  type ToolbarAction,
} from '../annotate/toolbar.js';
import { renderAnnotations } from '../annotate/render.js';
import type { Style, Tool } from '../annotate/types.js';
import { showToast } from '../contentScript/checkpoints/toast.js';
import { getInspector } from '../contentScript/inspector/index.js';

const HOST_ID = 'respawn-screenshot-host';
const COLORS = ['#ff5a1f', '#fafafa', '#0d99ff', '#22c55e', '#111111'];
const WIDTHS = [2, 4, 8];
const FONT_SIZES = [14, 18, 24];

type ImageRect = {
  left: number;
  top: number;
  width: number;
  height: number;
  scale: number;
};

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable);

class ScreenshotEditor {
  private host: HTMLDivElement;
  private readonly image: HTMLImageElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly toolbar: AnnotationToolbar;
  private readonly store = new AnnotationStore();
  private readonly surface: AnnotationSurface;
  private readonly url: string;
  private rect: ImageRect = { left: 0, top: 0, width: 0, height: 0, scale: 1 };
  private tool: Tool = 'select';
  private colorIndex = 0;
  private widthIndex = 1;
  private closed = false;

  constructor(blob: Blob) {
    this.url = URL.createObjectURL(blob);
    this.host = document.createElement('div');
    this.host.id = HOST_ID;
    this.host.style.position = 'fixed';
    this.host.style.inset = '0';
    this.host.style.zIndex = '2147483646';
    const root = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `${ANNOTATE_STYLE}\n${EDITOR_STYLE}`;

    const backdrop = document.createElement('div');
    backdrop.className = 'shot-backdrop';

    this.image = document.createElement('img');
    this.image.className = 'shot-image';
    this.image.alt = 'Screenshot';
    this.image.src = this.url;

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'annotate-canvas';
    this.canvas.style.pointerEvents = 'auto';

    this.toolbar = new AnnotationToolbar({
      style: this.style,
      extras: ['copy', 'download'],
      onAction: (action) => this.run(action),
    });

    root.append(style, backdrop, this.image, this.canvas, this.toolbar.element);
    document.documentElement.append(this.host);

    this.surface = new AnnotationSurface({
      canvas: this.canvas,
      layer: root,
      store: this.store,
      toWorld: (clientX, clientY) => {
        const scale = this.rect.scale || 1;
        return {
          x: (clientX - this.rect.left) / scale,
          y: (clientY - this.rect.top) / scale,
        };
      },
      toScreen: (point) => ({
        x: this.rect.left + point.x * this.rect.scale,
        y: this.rect.top + point.y * this.rect.scale,
      }),
      scale: () => this.rect.scale || 1,
      limit: () => ({
        x: 0,
        y: 0,
        w: this.image.naturalWidth,
        h: this.image.naturalHeight,
      }),
    });
    this.store.onChange = () => {
      this.toolbar.setHistory(this.store.canUndo, this.store.canRedo);
      this.surface.requestRender();
    };
    this.surface.setActive(true);
    this.toolbar.setTool(this.tool);
    this.toolbar.setHistory(false, false);
    this.surface.setStyle(this.style);

    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('resize', this.onResize);
    getAnnotations().setSuppressed(true);
    getInspector()?.setSuppressed(true);
  }

  async open() {
    try {
      await this.image.decode();
    } catch {
      showToast('Could not load the screenshot.', 'error');
      this.close();
      return;
    }
    this.layout();
  }

  private get style(): Style {
    return {
      color: COLORS[this.colorIndex],
      width: WIDTHS[this.widthIndex],
      fontSize: FONT_SIZES[this.widthIndex],
    };
  }

  private layout() {
    const pad = 24;
    const toolbarSpace = 86;
    const availableWidth = Math.max(1, window.innerWidth - pad * 2);
    const availableHeight = Math.max(
      1,
      window.innerHeight - pad - toolbarSpace,
    );
    const naturalWidth = this.image.naturalWidth || 1;
    const naturalHeight = this.image.naturalHeight || 1;
    const scale = Math.min(
      1,
      availableWidth / naturalWidth,
      availableHeight / naturalHeight,
    );
    const width = naturalWidth * scale;
    const height = naturalHeight * scale;
    const left = (window.innerWidth - width) / 2;
    const top =
      pad + Math.max(0, (availableHeight - height) / 2);
    this.rect = { left, top, width, height, scale };
    this.image.style.left = `${left}px`;
    this.image.style.top = `${top}px`;
    this.image.style.width = `${width}px`;
    this.image.style.height = `${height}px`;
    this.surface.render();
  }

  private run(action: ToolbarAction) {
    switch (action) {
      case 'select':
      case 'rect':
      case 'arrow':
      case 'pen':
      case 'text':
        this.tool = action;
        this.toolbar.setTool(action);
        this.surface.cancel();
        this.surface.setTool(action);
        return;
      case 'color':
        this.colorIndex = (this.colorIndex + 1) % COLORS.length;
        this.applyStyle();
        return;
      case 'width':
        this.widthIndex = (this.widthIndex + 1) % WIDTHS.length;
        this.applyStyle();
        return;
      case 'undo':
        this.store.undo();
        return;
      case 'redo':
        this.store.redo();
        return;
      case 'clear':
        this.store.clear();
        return;
      case 'copy':
        void this.copy();
        return;
      case 'download':
        void this.download();
        return;
      case 'close':
        this.close();
        return;
    }
  }

  private applyStyle() {
    this.surface.setStyle(this.style);
    this.toolbar.setStyle(this.style);
  }

  private async renderToBlob() {
    const canvas = document.createElement('canvas');
    canvas.width = this.image.naturalWidth;
    canvas.height = this.image.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not render the screenshot.');
    ctx.drawImage(this.image, 0, 0);
    renderAnnotations(ctx, this.store.annotations, (point) => point, 1, null);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png'),
    );
    if (!blob) throw new Error('Could not encode the screenshot.');
    return blob;
  }

  private async copy() {
    try {
      const blob = await this.renderToBlob();
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob }),
      ]);
      showToast('Screenshot copied', 'success');
    } catch {
      try {
        const blob = await this.renderToBlob();
        downloadBlob(blob);
        showToast('Copy unavailable — downloaded instead', 'info');
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : 'Could not copy.',
          'error',
        );
      }
    }
  }

  private async download() {
    try {
      downloadBlob(await this.renderToBlob());
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Could not download.',
        'error',
      );
    }
  }

  private close() {
    if (this.closed) return;
    this.closed = true;
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('resize', this.onResize);
    this.host.remove();
    URL.revokeObjectURL(this.url);
    getAnnotations().setSuppressed(false);
    getInspector()?.setSuppressed(getAnnotations().isActive);
  }

  private onResize = () => {
    this.layout();
  };

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing || isEditable(event.composedPath()[0] ?? event.target)) {
      return;
    }
    const key = event.key.toLowerCase();
    const command = event.ctrlKey || event.metaKey;
    if (command && key === 'z') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.shiftKey) this.store.redo();
      else this.store.undo();
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (this.store.selectedId) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.store.remove(this.store.selectedId);
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.close();
      return;
    }
    if (command || event.altKey || event.repeat) return;
    const tools: Record<string, Tool> = {
      v: 'select',
      r: 'rect',
      a: 'arrow',
      p: 'pen',
      t: 'text',
    };
    const tool = tools[key];
    if (tool) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.tool = tool;
      this.toolbar.setTool(tool);
      this.surface.setTool(tool);
    }
  };
}

function downloadBlob(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  anchor.download = `respawn-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.png`;
  anchor.href = url;
  anchor.rel = 'noopener';
  anchor.style.position = 'fixed';
  anchor.style.left = '-9999px';
  document.documentElement.append(anchor);
  anchor.click();
  setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 1000);
}

export function openScreenshotEditor(blob: Blob) {
  if (document.getElementById(HOST_ID)) return;
  const editor = new ScreenshotEditor(blob);
  void editor.open();
}

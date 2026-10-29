import { OVERLAY_HOST_ID } from '../inspector/constants.js';
import { getInspector } from '../contentScript/inspector/index.js';
import { AnnotationStore } from './store.js';
import { AnnotationSurface } from './surface.js';
import { ANNOTATE_STYLE } from './styles.js';
import {
  AnnotationToolbar,
  type ToolbarAction,
} from './toolbar.js';
import type { Style, Tool } from './types.js';

const COLORS = ['#ff5a1f', '#fafafa', '#0d99ff', '#22c55e', '#111111'];
const WIDTHS = [2, 4, 8];
const FONT_SIZES = [14, 18, 24];

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable);

class PageAnnotations {
  private host: HTMLDivElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private toolbar: AnnotationToolbar | null = null;
  private surface: AnnotationSurface | null = null;
  private readonly store = new AnnotationStore();
  private tool: Tool = 'select';
  private colorIndex = 0;
  private widthIndex = 1;
  private active = false;
  private suppressed = false;
  private inspectorHost: HTMLElement | null = null;
  private inspectorVisibility = '';

  get isActive() {
    return this.active;
  }

  toggle() {
    if (this.active) this.close();
    else this.open();
  }

  open() {
    if (!this.host) this.mount();
    if (!this.host || !this.toolbar || !this.canvas || !this.surface) return;
    this.active = true;
    this.suppressed = false;
    this.toolbar.element.hidden = false;
    this.canvas.style.pointerEvents = 'auto';
    this.surface.setActive(true);
    this.surface.setTool(this.tool);
    this.suppressInspector();
    this.surface.requestRender();
  }

  close() {
    if (!this.host) return;
    this.active = false;
    this.suppressed = false;
    if (this.toolbar) this.toolbar.element.hidden = true;
    if (this.canvas) this.canvas.style.pointerEvents = 'none';
    this.surface?.setActive(false);
    this.restoreInspector();
  }

  setSuppressed(suppressed: boolean) {
    this.suppressed = suppressed;
    if (this.toolbar) {
      this.toolbar.element.hidden = suppressed || !this.active;
    }
  }

  /** Hide the bar and drop the selection outline before a page capture. */
  prepareForCapture() {
    this.store.select(null);
    this.surface?.requestRender();
    this.setSuppressed(true);
  }

  private get style(): Style {
    return {
      color: COLORS[this.colorIndex],
      width: WIDTHS[this.widthIndex],
      fontSize: FONT_SIZES[this.widthIndex],
    };
  }

  private mount() {
    this.host = document.createElement('div');
    this.host.id = 'respawn-annotate-host';
    this.host.style.position = 'fixed';
    this.host.style.inset = '0';
    this.host.style.zIndex = '2147483645';
    this.host.style.pointerEvents = 'none';
    const root = this.host.attachShadow({ mode: 'open' });
    const styleElement = document.createElement('style');
    styleElement.textContent = ANNOTATE_STYLE;

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'annotate-canvas';

    this.toolbar = new AnnotationToolbar({
      style: this.style,
      extras: [],
      onAction: (action) => this.run(action),
    });
    this.toolbar.element.hidden = true;

    root.append(styleElement, this.canvas, this.toolbar.element);
    document.documentElement.append(this.host);

    this.surface = new AnnotationSurface({
      canvas: this.canvas,
      layer: root,
      store: this.store,
      toWorld: (clientX, clientY) => ({
        x: clientX + window.scrollX,
        y: clientY + window.scrollY,
      }),
      toScreen: (point) => ({
        x: point.x - window.scrollX,
        y: point.y - window.scrollY,
      }),
      scale: () => 1,
    });
    this.store.onChange = () => {
      this.toolbar?.setHistory(this.store.canUndo, this.store.canRedo);
      this.surface?.requestRender();
    };
    this.toolbar.setHistory(this.store.canUndo, this.store.canRedo);
    this.toolbar.setTool(this.tool);
    this.surface.setStyle(this.style);
    this.surface.setTool(this.tool);

    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('scroll', this.onScroll, true);
    window.addEventListener('resize', this.onResize);
    this.surface.requestRender();
  }

  private run(action: ToolbarAction) {
    switch (action) {
      case 'select':
      case 'rect':
      case 'arrow':
      case 'pen':
      case 'text':
        this.tool = action;
        this.toolbar?.setTool(action);
        this.surface?.cancel();
        this.surface?.setTool(action);
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
      case 'close':
        this.close();
        return;
      case 'copy':
      case 'download':
        return;
    }
  }

  private applyStyle() {
    const style = this.style;
    this.surface?.setStyle(style);
    this.toolbar?.setStyle(style);
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (
      !this.active ||
      this.suppressed ||
      event.isComposing ||
      isEditable(event.composedPath()[0] ?? event.target)
    ) {
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
      this.toolbar?.setTool(tool);
      this.surface?.setTool(tool);
    }
  };

  private onScroll = () => {
    if (this.active || this.store.annotations.length) {
      this.surface?.requestRender();
    }
  };

  private onResize = () => {
    this.surface?.render();
  };

  private suppressInspector() {
    getInspector()?.setSuppressed(true);
    const host = document.getElementById(OVERLAY_HOST_ID);
    if (!host) return;
    this.inspectorHost = host;
    this.inspectorVisibility = host.style.visibility;
    host.style.visibility = 'hidden';
  }

  private restoreInspector() {
    if (this.inspectorHost) {
      this.inspectorHost.style.visibility = this.inspectorVisibility;
      this.inspectorHost = null;
    }
    getInspector()?.setSuppressed(false);
  }
}

let instance: PageAnnotations | null = null;

export function getAnnotations() {
  instance ??= new PageAnnotations();
  return instance;
}

export function toggleAnnotations() {
  getAnnotations().toggle();
}

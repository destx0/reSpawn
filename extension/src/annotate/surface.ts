import {
  clampPoint,
  cloneAnnotation,
  distanceBetween,
  hitTest,
  moveAnnotation,
  normalizeRect,
} from './geometry.js';
import { drawAnnotation, renderAnnotations } from './render.js';
import type { AnnotationStore } from './store.js';
import type { Annotation, Bounds, Point, Style, Tool } from './types.js';

let counter = 0;

function nextId() {
  counter += 1;
  return `ann-${Date.now().toString(36)}-${counter.toString(36)}`;
}

export type SurfaceOptions = {
  readonly canvas: HTMLCanvasElement;
  readonly layer: ShadowRoot;
  readonly store: AnnotationStore;
  readonly toWorld: (clientX: number, clientY: number) => Point;
  readonly toScreen: (point: Point) => Point;
  readonly scale: () => number;
  readonly limit?: () => Bounds | null;
};

/**
 * Canvas-based annotation surface shared by the page overlay and the
 * screenshot editor. World coordinates come from the owner, so the same
 * drawing code works over the live page and over a captured image.
 */
export class AnnotationSurface {
  private tool: Tool = 'select';
  private style: Style = {
    color: '#ff5a1f',
    width: 4,
    fontSize: 18,
  };
  private active = false;
  private draft: Annotation | null = null;
  private dragState: {
    readonly id: string;
    readonly origin: Annotation;
    readonly start: Point;
    moved: boolean;
  } | null = null;
  private textEditor: HTMLTextAreaElement | null = null;
  private textOrigin: Point | null = null;
  private frame = 0;

  constructor(private readonly options: SurfaceOptions) {
    this.bind();
    this.setTool('select');
  }

  get currentTool() {
    return this.tool;
  }

  get currentStyle() {
    return this.style;
  }

  setActive(active: boolean) {
    this.active = active;
    this.options.canvas.style.pointerEvents = active ? 'auto' : 'none';
    if (!active) this.cancel();
    this.updateCursor();
  }

  setTool(tool: Tool) {
    this.tool = tool;
    this.updateCursor();
  }

  setStyle(style: Style) {
    this.style = style;
  }

  requestRender() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  render() {
    const canvas = this.options.canvas;
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    const baseRatio = Math.min(window.devicePixelRatio || 1, 2);
    const maxRatio = Math.min(2, Math.max(1, 32767 / Math.max(width, height)));
    const ratio = Math.min(baseRatio, maxRatio);
    const pixelWidth = Math.max(1, Math.round(width * ratio));
    const pixelHeight = Math.max(1, Math.round(height * ratio));
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const scale = this.options.scale();
    renderAnnotations(
      ctx,
      this.options.store.annotations,
      this.options.toScreen,
      scale,
      this.options.store.selectedId,
    );
    if (this.draft) {
      drawAnnotation(ctx, this.draft, this.options.toScreen, scale);
    }
  }

  cancel() {
    this.closeTextEditor();
    this.draft = null;
    this.dragState = null;
    this.requestRender();
  }

  private bind() {
    const canvas = this.options.canvas;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
  }

  private world(event: PointerEvent) {
    const point = this.options.toWorld(event.clientX, event.clientY);
    return clampPoint(point, this.options.limit?.() ?? null);
  }

  private onPointerDown = (event: PointerEvent) => {
    if (!this.active || event.button !== 0) return;
    event.preventDefault();
    const point = this.world(event);
    this.options.canvas.setPointerCapture(event.pointerId);

    if (this.tool === 'text') {
      this.openTextEditor(point);
      return;
    }

    if (this.tool === 'select') {
      const scale = this.options.scale();
      const annotations = this.options.store.annotations;
      let hit: Annotation | null = null;
      for (let index = annotations.length - 1; index >= 0; index--) {
        if (hitTest(annotations[index], point, 6 / Math.max(scale, 0.001))) {
          hit = annotations[index];
          break;
        }
      }
      this.options.store.select(hit?.id ?? null);
      if (hit) {
        this.dragState = {
          id: hit.id,
          origin: cloneAnnotation(hit),
          start: point,
          moved: false,
        };
      }
      return;
    }

    if (this.tool === 'rect') {
      this.draft = {
        id: nextId(),
        type: 'rect',
        color: this.style.color,
        width: this.style.width,
        x: point.x,
        y: point.y,
        w: 0,
        h: 0,
      };
    } else if (this.tool === 'arrow') {
      this.draft = {
        id: nextId(),
        type: 'arrow',
        color: this.style.color,
        width: this.style.width,
        x1: point.x,
        y1: point.y,
        x2: point.x,
        y2: point.y,
      };
    } else {
      this.draft = {
        id: nextId(),
        type: 'pen',
        color: this.style.color,
        width: this.style.width,
        points: [point],
      };
    }
    this.requestRender();
  };

  private onPointerMove = (event: PointerEvent) => {
    if (!this.active) return;
    const point = this.world(event);

    if (this.dragState) {
      const dx = point.x - this.dragState.start.x;
      const dy = point.y - this.dragState.start.y;
      if (!this.dragState.moved) {
        if (Math.hypot(dx, dy) < 2 / Math.max(this.options.scale(), 0.001)) {
          return;
        }
        this.options.store.commit();
        this.dragState.moved = true;
      }
      this.options.store.replace(
        this.dragState.id,
        moveAnnotation(this.dragState.origin, dx, dy),
      );
      return;
    }

    if (!this.draft) return;
    if (this.draft.type === 'rect') {
      const rect = normalizeRect(
        { x: this.draft.x, y: this.draft.y },
        point,
      );
      this.draft = {
        ...this.draft,
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
      };
    } else if (this.draft.type === 'arrow') {
      this.draft = { ...this.draft, x2: point.x, y2: point.y };
    } else if (this.draft.type === 'pen') {
      const last = this.draft.points[this.draft.points.length - 1];
      if (
        distanceBetween(last, point) >
        1.5 / Math.max(this.options.scale(), 0.001)
      ) {
        this.draft = { ...this.draft, points: [...this.draft.points, point] };
      }
    }
    this.requestRender();
  };

  private onPointerUp = (event: PointerEvent) => {
    if (!this.active) return;
    if (this.options.canvas.hasPointerCapture(event.pointerId)) {
      this.options.canvas.releasePointerCapture(event.pointerId);
    }

    if (this.dragState) {
      this.dragState = null;
      return;
    }

    if (!this.draft) return;
    const draft = this.draft;
    this.draft = null;
    const scale = Math.max(this.options.scale(), 0.001);
    if (draft.type === 'rect') {
      if (draft.w * scale < 3 || draft.h * scale < 3) {
        this.requestRender();
        return;
      }
    } else if (draft.type === 'arrow') {
      if (
        distanceBetween(
          { x: draft.x1, y: draft.y1 },
          { x: draft.x2, y: draft.y2 },
        ) *
          scale <
        4
      ) {
        this.requestRender();
        return;
      }
    } else if (draft.type === 'pen' && draft.points.length < 2) {
      this.requestRender();
      return;
    }
    this.options.store.add(draft);
  };

  private openTextEditor(origin: Point) {
    this.closeTextEditor();
    const scale = Math.max(this.options.scale(), 0.001);
    const screen = this.options.toScreen(origin);
    const canvasRect = this.options.canvas.getBoundingClientRect();
    const editor = document.createElement('textarea');
    editor.className = 'text-editor';
    editor.rows = 1;
    editor.spellcheck = false;
    editor.style.left = `${canvasRect.left + screen.x}px`;
    editor.style.top = `${canvasRect.top + screen.y}px`;
    editor.style.fontSize = `${Math.max(10, this.style.fontSize * scale)}px`;
    editor.style.width = '220px';
    editor.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (!event.isTrusted || event.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        this.closeTextEditor();
      } else if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        this.commitTextEditor();
      }
    });
    editor.addEventListener('input', () => {
      editor.style.height = 'auto';
      editor.style.height = `${editor.scrollHeight}px`;
    });
    editor.addEventListener('blur', () => this.commitTextEditor());
    this.options.layer.append(editor);
    this.textEditor = editor;
    this.textOrigin = origin;
    editor.focus();
  }

  private commitTextEditor() {
    const editor = this.textEditor;
    const origin = this.textOrigin;
    if (!editor || !origin) return;
    this.textEditor = null;
    this.textOrigin = null;
    const text = editor.value.trim();
    editor.remove();
    if (!text) {
      this.requestRender();
      return;
    }
    this.options.store.add({
      id: nextId(),
      type: 'text',
      color: this.style.color,
      width: this.style.width,
      x: origin.x,
      y: origin.y,
      text,
      fontSize: this.style.fontSize,
    });
  }

  private closeTextEditor() {
    const editor = this.textEditor;
    this.textEditor = null;
    this.textOrigin = null;
    editor?.remove();
  }

  private updateCursor() {
    const canvas = this.options.canvas;
    if (!this.active) {
      canvas.style.cursor = 'default';
      return;
    }
    canvas.style.cursor =
      this.tool === 'select'
        ? 'default'
        : this.tool === 'text'
          ? 'text'
          : 'crosshair';
  }
}

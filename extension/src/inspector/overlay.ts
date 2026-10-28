import {
  GAP_COLOR,
  GUIDE_COLOR,
  HIGHLIGHT_COLOR,
  MARGIN_COLOR,
  OVERLAY_HOST_ID,
  OVERLAY_Z_INDEX,
  PADDING_COLOR,
  TEXT_BLOCK_LIMIT,
} from './constants.js';
import { getDistanceOverlay } from './distances.js';
import { getInspectMeasurement, getRectFromDom, getVisibleTextBlocks } from './dom.js';
import { formatEdges, formatGap, formatMeasurement, getBandStrips } from './format.js';
import { clamp, getViewportSize, rectsEqual } from './geometry.js';
import {
  createGuide,
  findGuideAtPoint,
  getGuideDistances,
  snapGuidePosition,
} from './guides.js';
import { getMinimumCommonParent, getTargetElement } from './selection.js';
import { OVERLAY_STYLE } from './styles.js';
import type {
  DistanceOverlay,
  Guide,
  GuideOrientation,
  InspectMeasurement,
  Point,
  Rect,
  TextBlockAnnotation,
  ToolMode,
} from './types.js';

export type InspectorState = {
  readonly mode: ToolMode;
  readonly orientation: GuideOrientation;
  readonly typography: boolean;
  readonly guideCount: number;
};

export type InspectorOverlayOptions = {
  readonly document: Document;
  readonly window: Window;
  readonly highlightColor?: string;
  readonly guideColor?: string;
  readonly hoverHighlightEnabled?: boolean;
  readonly onStateChange?: (state: InspectorState) => void;
};

type LayerName = 'hover' | 'selection' | 'distance' | 'guides' | 'typography';

const LAYER_NAMES: readonly LayerName[] = [
  'hover',
  'selection',
  'distance',
  'guides',
  'typography',
];

const isEditable = (target: EventTarget | null) => {
  const element = target instanceof Element ? target : null;
  return Boolean(
    element &&
      (element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        (element as HTMLElement).isContentEditable),
  );
};

/** macOS turns Option+I into `ˆ`; let text fields keep their characters. */
const typesText = (event: KeyboardEvent) =>
  isEditable(event.composedPath()[0] ?? event.target) &&
  event.key.length === 1 &&
  event.key.toLowerCase() !== event.code.slice(-1).toLowerCase();

const isAltChord = (event: KeyboardEvent, code: string) =>
  event.altKey &&
  !event.ctrlKey &&
  !event.metaKey &&
  !event.shiftKey &&
  event.code === code;

/**
 * The element inspector: one shadow host with five layers (hover, selection,
 * distance, guides, typography). While a mode is active it consumes pointer
 * events, like DevTools' own element picker, so inspecting a button does not
 * press it.
 */
export class InspectorOverlay {
  private readonly doc: Document;
  private readonly win: Window;
  private readonly highlightColor: string;
  private readonly guideColor: string;
  private readonly hoverHighlightEnabled: boolean;
  private readonly onStateChange?: (state: InspectorState) => void;

  private host: HTMLDivElement | null = null;
  private root: HTMLDivElement | null = null;
  private readonly layers = new Map<LayerName, HTMLDivElement>();
  private observer: MutationObserver | null = null;
  private cursorBefore: string | null = null;

  private mode: ToolMode = 'none';
  private orientation: GuideOrientation = 'vertical';
  private guides: Guide[] = [];
  private preview: Guide | null = null;
  private draggingGuideId: string | null = null;
  private selected: InspectMeasurement | null = null;
  private selectedElement: Element | null = null;
  private hoverRect: Rect | null = null;
  private hoverElement: Element | null = null;
  private distance: DistanceOverlay | null = null;
  private altPressed = false;
  private typography = false;
  private textBlocks: TextBlockAnnotation[] = [];
  private suppressed = false;

  private lastPoint: Point | null = null;
  private pointerFrame = 0;
  private typographyTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly disposers: Array<() => void> = [];

  constructor(options: InspectorOverlayOptions) {
    this.doc = options.document;
    this.win = options.window;
    this.highlightColor = options.highlightColor ?? HIGHLIGHT_COLOR;
    this.guideColor = options.guideColor ?? GUIDE_COLOR;
    this.hoverHighlightEnabled = options.hoverHighlightEnabled ?? true;
    this.onStateChange = options.onStateChange;
  }

  get state(): InspectorState {
    return {
      mode: this.mode,
      orientation: this.orientation,
      typography: this.typography,
      guideCount: this.guides.length,
    };
  }

  mount() {
    if (this.host || !this.doc.documentElement) return;

    const host = this.doc.createElement('div');
    host.id = OVERLAY_HOST_ID;
    host.setAttribute('data-respawn-inspector', '');
    this.lockHostStyles(host);

    const shadow = host.attachShadow({ mode: 'open' });
    const style = this.doc.createElement('style');
    style.textContent = OVERLAY_STYLE;
    const root = this.doc.createElement('div');
    root.className = 'root';
    root.style.setProperty('--accent', this.highlightColor);
    root.style.setProperty('--guide', this.guideColor);
    root.style.setProperty('--margin', MARGIN_COLOR);
    root.style.setProperty('--padding', PADDING_COLOR);
    root.style.setProperty('--gap', GAP_COLOR);

    for (const name of LAYER_NAMES) {
      const layer = this.doc.createElement('div');
      layer.className = `layer layer--${name}`;
      layer.dataset.layer = name;
      this.layers.set(name, layer);
      root.append(layer);
    }

    shadow.append(style, root);
    this.host = host;
    this.root = root;
    this.doc.documentElement.append(host);

    this.observeHost();
    this.bindEvents();
    this.renderAll();
  }

  destroy() {
    for (const dispose of this.disposers.splice(0)) dispose();
    if (this.pointerFrame) this.win.cancelAnimationFrame(this.pointerFrame);
    if (this.typographyTimer) clearTimeout(this.typographyTimer);
    this.observer?.disconnect();
    this.observer = null;
    this.restoreCursor();
    this.host?.remove();
    this.host = null;
    this.root = null;
    this.layers.clear();
  }

  /** The palette covers the page; while it is open the inspector steps aside. */
  setSuppressed(suppressed: boolean) {
    this.suppressed = suppressed;
    if (suppressed) this.clearHover();
  }

  toggleMode(mode: Exclude<ToolMode, 'none'>) {
    this.setMode(this.mode === mode ? 'none' : mode);
  }

  setMode(mode: ToolMode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.preview = null;
    this.draggingGuideId = null;
    this.clearHover();
    this.applyCursor();
    this.renderSelection();
    this.renderGuides();
    this.notify();
  }

  setOrientation(orientation: GuideOrientation) {
    this.orientation = orientation;
    this.preview = null;
    if (this.mode !== 'guides') this.setMode('guides');
    else this.renderGuides();
    this.notify();
  }

  toggleTypography() {
    this.typography = !this.typography;
    this.refreshTypography();
    this.notify();
  }

  clear() {
    this.selected = null;
    this.selectedElement = null;
    this.distance = null;
    this.guides = [];
    this.preview = null;
    this.draggingGuideId = null;
    this.altPressed = false;
    this.clearHover();
    this.renderSelection();
    this.renderDistance();
    this.renderGuides();
    this.notify();
  }

  // ── host ────────────────────────────────────────────────────────────

  private lockHostStyles(host: HTMLElement) {
    const styles: ReadonlyArray<readonly [string, string]> = [
      ['all', 'initial'],
      ['display', 'block'],
      ['position', 'fixed'],
      ['inset', '0px'],
      ['width', '100vw'],
      ['height', '100vh'],
      ['margin', '0px'],
      ['padding', '0px'],
      ['border', '0px'],
      ['overflow', 'visible'],
      ['opacity', '1'],
      ['visibility', 'visible'],
      ['pointer-events', 'none'],
      ['z-index', OVERLAY_Z_INDEX],
      ['isolation', 'isolate'],
      ['transform', 'none'],
      ['filter', 'none'],
      ['background', 'transparent'],
    ];
    for (const [property, value] of styles) {
      host.style.setProperty(property, value, 'important');
    }
  }

  private observeHost() {
    const observer = new MutationObserver(() => {
      const host = this.host;
      if (!host || !this.doc.documentElement) return;
      if (!host.isConnected) this.doc.documentElement.append(host);
    });
    observer.observe(this.doc.documentElement, { childList: true });
    this.observer = observer;
  }

  // ── events ──────────────────────────────────────────────────────────

  private bindEvents() {
    const { win, doc } = this;
    win.addEventListener('keydown', this.onKeyDown, true);
    win.addEventListener('keyup', this.onKeyUp, true);
    win.addEventListener('pointerdown', this.onPointerDown, true);
    win.addEventListener('pointermove', this.onPointerMove, true);
    win.addEventListener('pointerup', this.onPointerUp, true);
    win.addEventListener('click', this.onClick, true);
    doc.addEventListener('scroll', this.onViewportChange, true);
    win.addEventListener('resize', this.onViewportChange);

    this.disposers.push(
      () => win.removeEventListener('keydown', this.onKeyDown, true),
      () => win.removeEventListener('keyup', this.onKeyUp, true),
      () => win.removeEventListener('pointerdown', this.onPointerDown, true),
      () => win.removeEventListener('pointermove', this.onPointerMove, true),
      () => win.removeEventListener('pointerup', this.onPointerUp, true),
      () => win.removeEventListener('click', this.onClick, true),
      () => doc.removeEventListener('scroll', this.onViewportChange, true),
      () => win.removeEventListener('resize', this.onViewportChange),
    );
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (this.suppressed || event.isComposing) return;

    if (
      !event.repeat &&
      isAltChord(event, 'KeyI') &&
      !typesText(event)
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.toggleMode('select');
      return;
    }

    if (event.key === 'Alt' && this.mode === 'select') {
      if (!this.altPressed) {
        this.altPressed = true;
        this.updateDistance();
      }
      return;
    }

    if (event.key === 'Escape' && this.mode !== 'none') {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.clear();
      this.setMode('none');
    }
  };

  private onKeyUp = (event: KeyboardEvent) => {
    if (event.key !== 'Alt' || !this.altPressed) return;
    this.altPressed = false;
    this.distance = null;
    this.renderDistance();
  };

  private onPointerDown = (event: PointerEvent) => {
    if (this.suppressed || this.mode === 'none') return;
    event.preventDefault();
    event.stopImmediatePropagation();

    const point = { x: event.clientX, y: event.clientY };
    this.lastPoint = point;

    if (this.mode === 'guides') {
      const existing = findGuideAtPoint(this.guides, point);
      if (existing) {
        this.draggingGuideId = existing.id;
      } else {
        const position = snapGuidePosition({
          orientation: this.orientation,
          position:
            this.orientation === 'vertical' ? point.x : point.y,
          guides: this.guides,
          ownerWindow: this.win,
        });
        const guide = createGuide(this.orientation, position);
        this.guides = [...this.guides, guide];
        this.draggingGuideId = guide.id;
      }
      this.preview = null;
      this.renderGuides();
      this.notify();
      return;
    }

    this.selectAtPoint(point, event.ctrlKey || event.metaKey);
  };

  private onPointerMove = (event: PointerEvent) => {
    if (this.suppressed || this.mode === 'none') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.lastPoint = { x: event.clientX, y: event.clientY };
    this.schedulePointerUpdate();
  };

  private onPointerUp = (event: PointerEvent) => {
    if (this.suppressed || this.mode === 'none') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!this.draggingGuideId) return;
    this.draggingGuideId = null;
    this.renderGuides();
    this.notify();
  };

  private onClick = (event: MouseEvent) => {
    if (this.suppressed || this.mode === 'none') return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  private onViewportChange = () => {
    if (this.selectedElement) {
      if (this.selectedElement.isConnected) {
        this.selected = getInspectMeasurement(this.selectedElement, this.win);
      } else {
        this.selected = null;
        this.selectedElement = null;
      }
    }
    this.renderSelection();
    this.scheduleTypographyRefresh();
    if (this.lastPoint && this.mode !== 'none') {
      this.schedulePointerUpdate();
    }
  };

  // ── updates ─────────────────────────────────────────────────────────

  private schedulePointerUpdate() {
    if (this.pointerFrame) return;
    this.pointerFrame = this.win.requestAnimationFrame(() => {
      this.pointerFrame = 0;
      const point = this.lastPoint;
      if (!point || this.mode === 'none') return;
      if (this.mode === 'select') this.updateHover(point);
      else this.updateGuidePreview(point);
    });
  }

  private updateHover(point: Point) {
    const target = getTargetElement(point, this.host, this.doc);
    this.hoverElement = target;
    const rect = target ? getRectFromDom(target) : null;

    if (!this.hoverHighlightEnabled && !this.altPressed) {
      if (this.hoverRect) {
        this.hoverRect = null;
        this.renderHover();
      }
    } else if (!rectsEqual(rect, this.hoverRect)) {
      this.hoverRect = rect;
      this.renderHover();
    }

    this.updateDistance();
  }

  private updateDistance() {
    if (
      !this.altPressed ||
      !this.selectedElement ||
      !this.hoverElement ||
      this.selectedElement === this.hoverElement
    ) {
      if (this.distance) {
        this.distance = null;
        this.renderDistance();
      }
      return;
    }

    const relation = this.hoverElement.contains(this.selectedElement)
      ? 'a-inside-b'
      : this.selectedElement.contains(this.hoverElement)
        ? 'b-inside-a'
        : undefined;

    this.distance = getDistanceOverlay(
      getRectFromDom(this.selectedElement),
      getRectFromDom(this.hoverElement),
      relation,
      this.win,
    );
    this.renderDistance();
  }

  private updateGuidePreview(point: Point) {
    if (this.draggingGuideId) {
      const dragging = this.guides.find(
        (guide) => guide.id === this.draggingGuideId,
      );
      if (!dragging) return;
      const position = snapGuidePosition({
        orientation: dragging.orientation,
        position: dragging.orientation === 'vertical' ? point.x : point.y,
        guides: this.guides,
        draggingGuideId: this.draggingGuideId,
        ownerWindow: this.win,
      });
      this.guides = this.guides.map((guide) =>
        guide.id === dragging.id ? { ...guide, position } : guide,
      );
      this.renderGuides();
      return;
    }

    const position = snapGuidePosition({
      orientation: this.orientation,
      position: this.orientation === 'vertical' ? point.x : point.y,
      guides: this.guides,
      ownerWindow: this.win,
    });
    this.preview = { id: 'preview', orientation: this.orientation, position };
    this.renderGuides();
  }

  private selectAtPoint(point: Point, useCommonParent: boolean) {
    const target = getTargetElement(point, this.host, this.doc);
    if (!target) {
      this.selected = null;
      this.selectedElement = null;
      this.distance = null;
      this.renderSelection();
      this.renderDistance();
      return;
    }

    let element: Element = target;
    if (useCommonParent && this.selectedElement && this.selectedElement !== target) {
      const common = getMinimumCommonParent(this.selectedElement, target);
      if (
        common &&
        common !== this.doc.body &&
        common !== this.doc.documentElement
      ) {
        element = common;
      }
    }

    this.selectedElement = element;
    this.selected = getInspectMeasurement(element, this.win);
    this.distance = null;
    this.renderSelection();
    this.renderDistance();
  }

  private clearHover() {
    this.hoverRect = null;
    this.hoverElement = null;
    this.distance = null;
    this.renderHover();
    this.renderDistance();
  }

  private scheduleTypographyRefresh() {
    if (!this.typography) return;
    if (this.typographyTimer) clearTimeout(this.typographyTimer);
    this.typographyTimer = setTimeout(() => {
      this.typographyTimer = null;
      this.refreshTypography();
    }, 120);
  }

  private refreshTypography() {
    if (!this.typography) {
      this.textBlocks = [];
      this.renderTypography();
      return;
    }

    const viewport = getViewportSize(this.win);
    this.textBlocks = getVisibleTextBlocks(
      this.doc,
      this.win,
      this.root,
      TEXT_BLOCK_LIMIT,
    ).filter(
      (block) =>
        block.rect.top >= 0 &&
        block.rect.top <= viewport.height &&
        block.rect.left >= 0 &&
        block.rect.left <= viewport.width,
    );
    this.renderTypography();
  }

  private applyCursor() {
    const html = this.doc.documentElement;
    if (this.mode === 'none') {
      this.restoreCursor();
      return;
    }
    if (this.cursorBefore === null) this.cursorBefore = html.style.cursor;
    html.style.setProperty('cursor', 'crosshair', 'important');
  }

  private restoreCursor() {
    if (this.cursorBefore === null) return;
    const html = this.doc.documentElement;
    if (this.cursorBefore) html.style.cursor = this.cursorBefore;
    else html.style.removeProperty('cursor');
    this.cursorBefore = null;
  }

  private notify() {
    this.onStateChange?.(this.state);
  }

  // ── rendering ───────────────────────────────────────────────────────

  private renderAll() {
    this.renderHover();
    this.renderSelection();
    this.renderDistance();
    this.renderGuides();
    this.renderTypography();
  }

  private layer(name: LayerName) {
    return this.layers.get(name) ?? null;
  }

  private element<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
  ): HTMLElementTagNameMap[K] {
    const element = this.doc.createElement(tag);
    if (className) element.className = className;
    return element;
  }

  private place(element: HTMLElement, rect: Rect) {
    element.style.left = `${rect.left}px`;
    element.style.top = `${rect.top}px`;
    element.style.width = `${rect.width}px`;
    element.style.height = `${rect.height}px`;
  }

  /** Above the box when there is room, inside it when the box is near the top. */
  private placeLabel(element: HTMLElement, rect: Rect) {
    const viewport = getViewportSize(this.win);
    const above = rect.top >= 24;
    element.style.left = `${clamp(rect.left, 4, Math.max(4, viewport.width - 12))}px`;
    element.style.top = above ? `${rect.top - 6}px` : `${rect.top + 4}px`;
    element.style.transform = above ? 'translateY(-100%)' : 'none';
  }

  private appendBands(
    layer: HTMLDivElement,
    outer: Rect,
    inner: Rect,
    className: string,
  ) {
    for (const strip of getBandStrips(outer, inner)) {
      const band = this.element('div', `band ${className}`);
      this.place(band, strip);
      layer.append(band);
    }
  }

  private renderHover() {
    const layer = this.layer('hover');
    if (!layer) return;
    layer.replaceChildren();
    if (this.mode !== 'select' || !this.hoverRect) return;
    if (!this.hoverHighlightEnabled && !this.altPressed) return;

    const box = this.element('div', 'box box--hover');
    this.place(box, this.hoverRect);
    layer.append(box);
  }

  private renderSelection() {
    const layer = this.layer('selection');
    if (!layer) return;
    layer.replaceChildren();

    const selected = this.selected;
    if (!selected || this.mode !== 'select') return;

    if (selected.gap && selected.parentRect) {
      const gapBox = this.element('div', 'box box--gap');
      this.place(gapBox, selected.parentRect);
      layer.append(gapBox);

      const gapTag = this.element('div', 'tag');
      gapTag.append(
        this.text('span', 'tag__gap', 'G'),
        this.text('span', '', formatGap(selected)),
      );
      gapTag.style.left = `${clamp(selected.parentRect.left, 4, this.win.innerWidth - 12)}px`;
      gapTag.style.top = `${Math.max(4, selected.parentRect.top - 4)}px`;
      gapTag.style.transform = 'translateY(-100%)';
      layer.append(gapTag);
    }

    this.appendBands(layer, selected.marginRect, selected.rect, 'band--margin');
    this.appendBands(layer, selected.rect, selected.contentRect, 'band--padding');

    const outline = this.element('div', 'box box--outline');
    this.place(outline, selected.rect);
    layer.append(outline);

    const content = this.element('div', 'box box--content');
    this.place(content, selected.contentRect);
    layer.append(content);

    const label = this.element('div', 'label');
    label.textContent = formatMeasurement(selected);
    this.placeLabel(label, selected.rect);
    layer.append(label);

    const spacing = this.element('div', 'tag');
    spacing.append(
      this.text('span', 'tag__margin', 'M'),
      this.text('span', '', formatEdges(selected.margin)),
      this.text('span', 'tag__separator', '·'),
      this.text('span', 'tag__padding', 'P'),
      this.text('span', '', formatEdges(selected.padding)),
    );
    const below = selected.rect.top + selected.rect.height + 6;
    const fits = below + 18 <= this.win.innerHeight;
    spacing.style.left = `${clamp(selected.rect.left, 4, this.win.innerWidth - 12)}px`;
    spacing.style.top = fits ? `${below}px` : `${Math.max(4, selected.rect.top - 6)}px`;
    if (!fits) spacing.style.transform = 'translateY(-100%)';
    layer.append(spacing);
  }

  private renderDistance() {
    const layer = this.layer('distance');
    if (!layer) return;
    layer.replaceChildren();

    const distance = this.distance;
    if (!distance) return;

    for (const rect of [distance.rectA, distance.rectB]) {
      const box = this.element('div', 'box box--distance');
      this.place(box, rect);
      layer.append(box);
    }

    for (const connector of distance.connectors) {
      const vertical = connector.x1 === connector.x2;
      const element = this.element(
        'div',
        `connector connector--${vertical ? 'vertical' : 'horizontal'}`,
      );
      element.style.left = `${Math.min(connector.x1, connector.x2)}px`;
      element.style.top = `${Math.min(connector.y1, connector.y2)}px`;
      element.style.width = `${Math.max(1, Math.abs(connector.x2 - connector.x1))}px`;
      element.style.height = `${Math.max(1, Math.abs(connector.y2 - connector.y1))}px`;
      layer.append(element);
    }

    for (const horizontal of distance.horizontalDistances) {
      if (horizontal.value <= 0.5) continue;
      const x1 = horizontal.x1 ?? 0;
      const x2 = horizontal.x2 ?? 0;
      const y = horizontal.y ?? 0;

      const line = this.element(
        'div',
        'distance-line distance-line--horizontal',
      );
      line.style.left = `${Math.min(x1, x2)}px`;
      line.style.top = `${y}px`;
      line.style.width = `${Math.abs(x2 - x1)}px`;
      layer.append(line);

      const tag = this.element('div', 'distance-tag');
      tag.textContent = `${Math.round(horizontal.value)}`;
      tag.style.left = `${(x1 + x2) / 2}px`;
      tag.style.top = `${y}px`;
      layer.append(tag);
    }

    for (const vertical of distance.verticalDistances) {
      if (vertical.value <= 0.5) continue;
      const y1 = vertical.y1 ?? 0;
      const y2 = vertical.y2 ?? 0;
      const x = vertical.x ?? 0;

      const line = this.element('div', 'distance-line distance-line--vertical');
      line.style.left = `${x}px`;
      line.style.top = `${Math.min(y1, y2)}px`;
      line.style.height = `${Math.abs(y2 - y1)}px`;
      layer.append(line);

      const tag = this.element('div', 'distance-tag');
      tag.textContent = `${Math.round(vertical.value)}`;
      tag.style.left = `${x}px`;
      tag.style.top = `${(y1 + y2) / 2}px`;
      layer.append(tag);
    }
  }

  private renderGuides() {
    const layer = this.layer('guides');
    if (!layer) return;
    layer.replaceChildren();
    if (this.mode !== 'guides') return;

    if (this.preview) {
      layer.append(this.guideElement(this.preview, 'guide--preview'));
    }

    for (const guide of this.guides) {
      layer.append(
        this.guideElement(
          guide,
          guide.id === this.draggingGuideId ? 'guide--dragging' : '',
        ),
      );
    }

    for (const distance of getGuideDistances(this.guides, this.preview)) {
      const vertical = distance.orientation === 'vertical';
      const element = this.element(
        'div',
        `guide-distance guide-distance--${vertical ? 'vertical' : 'horizontal'}`,
      );
      if (vertical) {
        element.style.left = `${distance.start}px`;
        element.style.width = `${distance.value}px`;
      } else {
        element.style.top = `${distance.start}px`;
        element.style.height = `${distance.value}px`;
      }

      const line = this.element('span', 'guide-distance__line');
      const tag = this.element('span', 'guide-distance__tag');
      tag.textContent = `${Math.round(distance.value)} px`;
      element.append(line, tag);
      layer.append(element);
    }
  }

  private guideElement(guide: Guide, modifier: string) {
    const element = this.element(
      'div',
      `guide guide--${guide.orientation}${modifier ? ` ${modifier}` : ''}`,
    );
    if (guide.orientation === 'vertical') {
      element.style.left = `${guide.position}px`;
    } else {
      element.style.top = `${guide.position}px`;
    }
    return element;
  }

  private renderTypography() {
    const layer = this.layer('typography');
    if (!layer) return;
    layer.replaceChildren();
    if (!this.typography) return;

    const viewport = getViewportSize(this.win);
    for (const block of this.textBlocks) {
      const chip = this.element('div', 'chip');

      const swatch = this.element('span', 'chip__swatch');
      swatch.style.background = block.styles.color;
      chip.append(
        swatch,
        this.text('span', '', block.styles.fontSize),
        this.text('span', 'chip__muted', block.styles.lineHeight),
        this.text('span', 'chip__muted', block.styles.color),
      );
      layer.append(chip);

      // Chips sit just right of the block, or inside its right edge when the
      // block reaches the viewport. Measuring the chip keeps stacked lines from
      // stacking their chips on top of each other.
      const width = chip.offsetWidth;
      const height = chip.offsetHeight;
      let left = block.rect.left + block.rect.width + 6;
      if (left + width > viewport.width - 4) {
        left = Math.max(4, block.rect.left + block.rect.width - width - 2);
      }
      const top = clamp(
        block.rect.top + (block.rect.height - height) / 2,
        2,
        Math.max(2, viewport.height - height - 2),
      );
      chip.style.left = `${left}px`;
      chip.style.top = `${top}px`;
    }
  }

  private text(tag: 'span', className: string, value: string) {
    const element = this.element(tag, className);
    element.textContent = value;
    return element;
  }
}

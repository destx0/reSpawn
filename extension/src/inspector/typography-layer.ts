// The typography mode's DOM: a hover card, pinned cards, their outlines, drag
// handling and pin history. The computed values come from `typography.ts`.
// Cards live in the inspector's shadow root so page CSS cannot restyle them.

import { clamp } from './geometry.js';
import type { Point } from './types.js';
import {
  hasDirectRenderableText,
  TypographyInspector,
  type TypographyInfo,
} from './typography.js';

const SKIP_TAGS = new Set([
  'HTML',
  'BODY',
  'SCRIPT',
  'STYLE',
  'META',
  'LINK',
  'NOSCRIPT',
  'IMG',
  'VIDEO',
  'AUDIO',
  'IFRAME',
  'CANVAS',
  'INPUT',
  'TEXTAREA',
  'SELECT',
  'OPTION',
  'BR',
]);

/** The extension's own chrome; the inspector must never inspect it. */
const CHROME_SELECTOR =
  '#respawn-palette-host, #respawn-toast-host, [data-respawn-inspector]';

const DRAG_SLOP = 4;

type PinSnapshot = {
  readonly sourceEl: HTMLElement;
  readonly left: number;
  readonly top: number;
  readonly userPlaced: boolean;
};

type Pin = {
  readonly sourceEl: HTMLElement;
  readonly box: HTMLDivElement;
  readonly card: HTMLDivElement;
  userPlaced: boolean;
  detach: () => void;
};

export type TypographyLayerOptions = {
  readonly document: Document;
  readonly window: Window;
  readonly host: HTMLElement;
  readonly layer: HTMLElement;
};

export class TypographyLayer {
  private readonly doc: Document;
  private readonly win: Window;
  private readonly host: HTMLElement;
  private readonly layer: HTMLElement;
  private readonly typography: TypographyInspector;
  private readonly pins: Pin[] = [];
  private readonly history: PinSnapshot[][] = [];
  private readonly future: PinSnapshot[][] = [];
  private readonly disposers: Array<() => void> = [];

  private enabled = false;
  private paused = false;
  private hoveredEl: HTMLElement | null = null;
  private hoverBox: HTMLDivElement | null = null;
  private hoverCard: HTMLDivElement | null = null;
  private idleId: number | null = null;
  private idleIsCallback = false;
  private dragging = false;
  private swallowNextClick = false;
  private swallowClick: ((event: Event) => void) | null = null;
  private swallowTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: TypographyLayerOptions) {
    this.doc = options.document;
    this.win = options.window;
    this.host = options.host;
    this.layer = options.layer;
    this.typography = new TypographyInspector(this.doc, this.win);

    // Card interactions must not reach the page's own handlers.
    const stop = (event: Event) => event.stopPropagation();
    for (const type of [
      'pointerdown',
      'pointerup',
      'mousedown',
      'mouseup',
      'click',
    ] as const) {
      this.layer.addEventListener(type, stop);
      this.disposers.push(() => this.layer.removeEventListener(type, stop));
    }
    const context = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    this.layer.addEventListener('contextmenu', context);
    this.disposers.push(() =>
      this.layer.removeEventListener('contextmenu', context),
    );
  }

  enable() {
    if (this.enabled) return;
    this.enabled = true;
    this.paused = false;
    this.typography.invalidate();
  }

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    this.paused = false;
    this.reset();
    this.removeHoverNodes();
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    if (paused) this.hideHover();
  }

  /** Called from the overlay's pointer frame while the mode is active. */
  hoverAt(point: Point) {
    if (!this.enabled || this.paused) return;
    if (this.isOwnPoint(point)) {
      this.hideHover();
      return;
    }
    const element = this.targetAt(point);
    if (!element || this.pins.some((pin) => pin.sourceEl === element)) {
      this.hideHover();
      return;
    }
    if (element !== this.hoveredEl) this.inspect(element);
    else this.positionHover(element);
  }

  /** Pins the text element under the point; returns false when there is none. */
  pinAt(point: Point) {
    if (!this.enabled || this.paused || this.isOwnPoint(point)) return false;
    const element = this.targetAt(point);
    if (!element) return false;
    if (this.pins.some((pin) => pin.sourceEl === element)) return false;
    this.createPin(element);
    this.hideHover();
    return true;
  }

  /** Escape clears pins first and leaves the mode on. */
  clearPins(record = true) {
    if (!this.pins.length) return false;
    if (record) this.record();
    for (const pin of this.pins.splice(0)) {
      pin.detach();
      pin.box.remove();
      pin.card.remove();
    }
    return true;
  }

  undo() {
    const previous = this.history.pop();
    if (!previous) return false;
    this.future.push(this.snapshot());
    this.restore(previous);
    return true;
  }

  redo() {
    const next = this.future.pop();
    if (!next) return false;
    this.history.push(this.snapshot());
    this.restore(next);
    return true;
  }

  /** True for events that belong to a card (close button, drag, click). */
  isOwnEvent(event: Event) {
    if (this.swallowNextClick || this.dragging) return true;
    return event.composedPath().some((node) => {
      if (!(node instanceof Element)) return false;
      return node === this.host || node.classList.contains('ti-card');
    });
  }

  /** Follows scroll/resize and drops pins whose source left the document. */
  sync() {
    if (!this.enabled) return;
    for (const pin of [...this.pins]) {
      if (!pin.sourceEl.isConnected) {
        this.removePin(pin, false);
        continue;
      }
      const rect = pin.sourceEl.getBoundingClientRect();
      this.positionBox(pin.box, rect);
      if (!pin.userPlaced) this.positionCard(pin.card, rect);
      const visible =
        rect.bottom >= 0 &&
        rect.right >= 0 &&
        rect.left <= this.win.innerWidth &&
        rect.top <= this.win.innerHeight;
      pin.box.dataset.state = visible ? 'visible' : 'hidden';
      pin.card.dataset.state = visible ? 'visible' : 'hidden';
      pin.card.style.pointerEvents = visible ? 'auto' : 'none';
    }
    if (this.hoveredEl) {
      if (!this.hoveredEl.isConnected) this.hideHover();
      else this.positionHover(this.hoveredEl);
    }
  }

  /** Removes pins and history without touching the enabled flag. */
  reset() {
    this.cancelEnrichment();
    this.hideHover();
    for (const pin of this.pins.splice(0)) {
      pin.detach();
      pin.box.remove();
      pin.card.remove();
    }
    this.history.length = 0;
    this.future.length = 0;
    this.dragging = false;
    this.clearSwallow();
  }

  destroy() {
    this.disable();
    this.cancelEnrichment();
    this.removeHoverNodes();
    for (const dispose of this.disposers.splice(0)) dispose();
    this.clearSwallow();
  }

  // ── hover ───────────────────────────────────────────────────────────

  private inspect(element: HTMLElement) {
    this.ensureHover();
    this.hoveredEl = element;
    const info = this.typography.getFast(element);
    this.populate(this.hoverCard!, info);
    this.positionHover(element);
    this.show(this.hoverBox!);
    this.show(this.hoverCard!);
    this.scheduleEnrichment(element);
  }

  private positionHover(element: HTMLElement) {
    const rect = element.getBoundingClientRect();
    if (this.hoverBox) this.positionBox(this.hoverBox, rect);
    if (this.hoverCard) this.positionCard(this.hoverCard, rect);
  }

  private hideHover() {
    this.cancelEnrichment();
    this.hoveredEl = null;
    if (this.hoverBox) this.hide(this.hoverBox);
    if (this.hoverCard) this.hide(this.hoverCard);
  }

  private ensureHover() {
    if (!this.hoverBox) {
      this.hoverBox = this.doc.createElement('div');
      this.hoverBox.className = 'ti-box';
      this.hoverBox.dataset.state = 'hidden';
      this.layer.append(this.hoverBox);
    }
    if (!this.hoverCard) {
      this.hoverCard = this.makeCard(false);
      this.layer.append(this.hoverCard);
    }
  }

  private removeHoverNodes() {
    this.hoverBox?.remove();
    this.hoverCard?.remove();
    this.hoverBox = null;
    this.hoverCard = null;
  }

  private scheduleEnrichment(element: HTMLElement) {
    this.cancelEnrichment();
    const win = this.win as Window & {
      requestIdleCallback?: (
        callback: () => void,
        options?: { timeout: number },
      ) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof win.requestIdleCallback === 'function') {
      this.idleIsCallback = true;
      this.idleId = win.requestIdleCallback(
        () => {
          this.idleId = null;
          this.enrich(element);
        },
        { timeout: 250 },
      );
    } else {
      this.idleIsCallback = false;
      this.idleId = this.win.setTimeout(() => {
        this.idleId = null;
        this.enrich(element);
      }, 40);
    }
  }

  private enrich(element: HTMLElement) {
    if (!this.enabled || this.paused || this.hoveredEl !== element) return;
    const full = this.typography.getFull(element);
    if (this.hoveredEl !== element || !this.hoverCard) return;
    this.populate(this.hoverCard, full);
    this.positionHover(element);
  }

  private cancelEnrichment() {
    if (this.idleId === null) return;
    if (this.idleIsCallback) {
      (
        this.win as Window & {
          cancelIdleCallback?: (id: number) => void;
        }
      ).cancelIdleCallback?.(this.idleId);
    } else {
      this.win.clearTimeout(this.idleId);
    }
    this.idleId = null;
  }

  // ── pins ────────────────────────────────────────────────────────────

  private createPin(element: HTMLElement, state?: PinSnapshot, record = true) {
    const box = this.doc.createElement('div');
    box.className = 'ti-box ti-box--pinned';
    box.dataset.state = 'hidden';
    const card = this.makeCard(true);
    this.populate(card, this.typography.getFull(element));
    this.layer.append(box, card);

    const pin: Pin = {
      sourceEl: element,
      box,
      card,
      userPlaced: state?.userPlaced ?? false,
      detach: () => undefined,
    };
    if (record) this.record();
    this.pins.push(pin);

    const rect = element.getBoundingClientRect();
    this.positionBox(box, rect);
    if (state?.userPlaced) {
      card.style.left = `${state.left}px`;
      card.style.top = `${state.top}px`;
    } else {
      this.positionCard(card, rect);
    }
    this.show(box);
    this.show(card);

    card
      .querySelector<HTMLButtonElement>('.ti-close')
      ?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.removePin(pin);
      });
    pin.detach = this.attachDrag(pin);
  }

  private removePin(pin: Pin, record = true) {
    const index = this.pins.indexOf(pin);
    if (index === -1) return;
    if (record) this.record();
    this.pins.splice(index, 1);
    pin.detach();
    pin.box.remove();
    pin.card.remove();
  }

  private snapshot(): PinSnapshot[] {
    return this.pins.map((pin) => {
      const rect = pin.card.getBoundingClientRect();
      return {
        sourceEl: pin.sourceEl,
        left: rect.left,
        top: rect.top,
        userPlaced: pin.userPlaced,
      };
    });
  }

  private record() {
    this.history.push(this.snapshot());
    this.future.length = 0;
  }

  private restore(states: readonly PinSnapshot[]) {
    this.clearPins(false);
    for (const state of states) {
      if (state.sourceEl.isConnected)
        this.createPin(state.sourceEl, state, false);
    }
  }

  private attachDrag(pin: Pin): () => void {
    let pointerId = -1;
    let startX = 0;
    let startY = 0;
    let originLeft = 0;
    let originTop = 0;
    let active = false;
    let dragged = false;
    let recorded = false;

    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (!active) {
        active = Math.abs(dx) > DRAG_SLOP || Math.abs(dy) > DRAG_SLOP;
      }
      if (!active) return;
      if (!recorded) {
        this.record();
        recorded = true;
      }
      dragged = true;
      const rect = pin.card.getBoundingClientRect();
      const left = clamp(
        originLeft + dx,
        4,
        Math.max(4, this.win.innerWidth - rect.width - 4),
      );
      const top = clamp(
        originTop + dy,
        4,
        Math.max(4, this.win.innerHeight - rect.height - 4),
      );
      pin.card.style.left = `${left}px`;
      pin.card.style.top = `${top}px`;
      pin.userPlaced = true;
    };

    const onEnd = (event: PointerEvent) => {
      if (pointerId !== -1 && event.pointerId !== pointerId) return;
      if (pointerId !== -1) {
        try {
          pin.card.releasePointerCapture(pointerId);
        } catch {
          // The card may already be gone.
        }
      }
      this.win.removeEventListener('pointermove', onMove);
      this.win.removeEventListener('pointerup', onEnd);
      this.win.removeEventListener('pointercancel', onEnd);
      pointerId = -1;
      active = false;
      this.dragging = false;
      if (dragged) this.suppressClick();
      dragged = false;
      recorded = false;
    };

    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if ((event.target as Element | null)?.closest('.ti-close')) return;
      const rect = pin.card.getBoundingClientRect();
      originLeft = rect.left;
      originTop = rect.top;
      startX = event.clientX;
      startY = event.clientY;
      pointerId = event.pointerId;
      active = false;
      dragged = false;
      recorded = false;
      this.dragging = true;
      try {
        pin.card.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is best-effort; window listeners still work.
      }
      this.win.addEventListener('pointermove', onMove);
      this.win.addEventListener('pointerup', onEnd);
      this.win.addEventListener('pointercancel', onEnd);
    };

    pin.card.addEventListener('pointerdown', onDown);
    return () => {
      pin.card.removeEventListener('pointerdown', onDown);
      this.win.removeEventListener('pointermove', onMove);
      this.win.removeEventListener('pointerup', onEnd);
      this.win.removeEventListener('pointercancel', onEnd);
      if (pointerId !== -1) this.dragging = false;
    };
  }

  private suppressClick() {
    this.clearSwallow();
    this.swallowNextClick = true;
    this.swallowTimer = setTimeout(() => this.clearSwallow(), 50);

    const swallow = (click: Event) => {
      click.preventDefault();
      click.stopImmediatePropagation();
      this.clearSwallow();
    };
    this.swallowClick = swallow;
    this.win.addEventListener('click', swallow, true);
  }

  private clearSwallow() {
    if (this.swallowClick) {
      this.win.removeEventListener('click', this.swallowClick, true);
      this.swallowClick = null;
    }
    if (this.swallowTimer) {
      clearTimeout(this.swallowTimer);
      this.swallowTimer = null;
    }
    this.swallowNextClick = false;
  }

  // ── hit testing ─────────────────────────────────────────────────────

  private isOwnPoint(point: Point) {
    return this.doc
      .elementsFromPoint(point.x, point.y)
      .some(
        (element) =>
          element === this.host || element.closest(CHROME_SELECTOR) !== null,
      );
  }

  /**
   * Page elements under the point in paint order, descending open shadow roots.
   * Chrome hosts are skipped with their whole subtree.
   */
  private elementsAt(point: Point): Element[] {
    const collect = (root: Document | ShadowRoot): Element[] => {
      const stack =
        typeof root.elementsFromPoint === 'function'
          ? root.elementsFromPoint(point.x, point.y)
          : [];
      const result: Element[] = [];
      for (const element of stack) {
        if (this.isChrome(element)) continue;
        if (element.shadowRoot) result.push(...collect(element.shadowRoot));
        result.push(element);
      }
      return result;
    };
    return collect(this.doc);
  }

  private isChrome(element: Element) {
    return element === this.host || element.closest(CHROME_SELECTOR) !== null;
  }

  private targetAt(point: Point): HTMLElement | null {
    for (const element of this.elementsAt(point)) {
      if (this.isTextElement(element)) return element;
    }
    return null;
  }

  private isTextElement(element: Element): element is HTMLElement {
    if (!(element instanceof HTMLElement)) return false;
    if (SKIP_TAGS.has(element.tagName)) return false;
    if (!hasDirectRenderableText(element)) return false;
    const style = this.win.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (Number.parseFloat(style.opacity || '1') === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  // ── cards ───────────────────────────────────────────────────────────

  private makeCard(pinned: boolean): HTMLDivElement {
    const card = this.doc.createElement('div');
    card.className = `ti-card${pinned ? ' ti-card--pinned' : ''}`;
    card.dataset.state = 'hidden';
    card.setAttribute('role', pinned ? 'group' : 'tooltip');
    if (pinned) card.setAttribute('aria-label', 'Pinned typography');
    const rows = this.doc.createElement('div');
    rows.className = 'ti-rows';
    card.append(rows);
    if (pinned) {
      const close = this.doc.createElement('button');
      close.type = 'button';
      close.className = 'ti-close';
      close.setAttribute('aria-label', 'Close typography card');
      close.textContent = '×';
      card.append(close);
    }
    return card;
  }

  private populate(card: HTMLDivElement, info: TypographyInfo) {
    const rows = card.querySelector('.ti-rows');
    if (!rows) return;
    rows.replaceChildren();
    for (const row of info.rows) {
      const label = this.doc.createElement('span');
      label.className = 'ti-label';
      label.textContent = row.label;

      const value = this.doc.createElement('span');
      value.className = 'ti-value';
      value.textContent = row.value || '—';
      if (row.varName) {
        const separator = this.doc.createElement('span');
        separator.className = 'ti-sep';
        separator.textContent = ' · ';
        const token = this.doc.createElement('span');
        token.className = 'ti-var';
        token.textContent = `var(${row.varName})`;
        value.append(separator, token);
      }
      rows.append(label, value);
    }
  }

  private positionBox(box: HTMLElement, rect: DOMRect) {
    box.style.left = `${rect.left}px`;
    box.style.top = `${rect.top}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
  }

  /** Below the element, flipped above when there is no room, kept on screen. */
  private positionCard(card: HTMLElement, rect: DOMRect) {
    const size = card.getBoundingClientRect();
    const width = size.width || 220;
    const height = size.height || 72;
    const left = clamp(
      rect.left,
      8,
      Math.max(8, this.win.innerWidth - width - 8),
    );
    let top = rect.bottom + 6;
    if (top + height > this.win.innerHeight - 8) {
      top = rect.top - height - 6;
    }
    card.style.left = `${left}px`;
    card.style.top = `${clamp(
      top,
      8,
      Math.max(8, this.win.innerHeight - height - 8),
    )}px`;
  }

  private show(element: HTMLElement) {
    element.dataset.state = 'visible';
  }

  private hide(element: HTMLElement) {
    element.dataset.state = 'hidden';
  }
}

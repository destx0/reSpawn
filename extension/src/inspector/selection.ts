import { MIN_TARGET_SIZE } from './constants.js';
import type { Point } from './types.js';

/**
 * Run a hit test with the overlay's own nodes out of the way. Elements inside a
 * shadow root are not returned by `elementsFromPoint` (only their host is), but
 * a host with `pointer-events: auto` would still swallow the point, so the
 * helper clears any node marked as a blocker for the duration of the read.
 */
export const withOverlayHitTesting = <T>(
  overlayHost: HTMLElement | null,
  read: () => T,
): T => {
  if (!overlayHost) return read();

  const blockers = Array.from(
    overlayHost.shadowRoot?.querySelectorAll<HTMLElement>(
      '[data-hit-blocker]',
    ) ?? [],
  );
  const previous = blockers.map((element) => element.style.pointerEvents);
  for (const element of blockers) element.style.pointerEvents = 'none';

  try {
    return read();
  } finally {
    blockers.forEach((element, index) => {
      element.style.pointerEvents = previous[index] ?? '';
    });
  }
};

/**
 * The element actually painted at the point: descend into open shadow roots,
 * which `elementsFromPoint` reports as their host only.
 */
const getDeepestElementAt = (element: Element, point: Point): Element => {
  let current = element;
  const seen = new Set<Element>();

  while (!seen.has(current)) {
    seen.add(current);
    if (current.shadowRoot) {
      const nested = current.shadowRoot.elementFromPoint(point.x, point.y);
      if (nested && nested !== current) {
        current = nested;
        continue;
      }
    }
    break;
  }

  return current;
};

const isOverlayNode = (element: Element, overlayHost: HTMLElement | null) =>
  Boolean(
    overlayHost &&
      (element === overlayHost || overlayHost.contains(element)),
  );

const isSelectable = (
  element: Element,
  overlayHost: HTMLElement | null,
  ownerDocument: Document,
) => {
  if (isOverlayNode(element, overlayHost)) return false;
  if (element === ownerDocument.body || element === ownerDocument.documentElement) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  if (rect.width <= MIN_TARGET_SIZE || rect.height <= MIN_TARGET_SIZE) {
    return false;
  }
  const style = ownerDocument.defaultView?.getComputedStyle(element);
  return style?.pointerEvents !== 'none';
};

/**
 * The element under the pointer, skipping the overlay, `body`/`html`, elements
 * too small to see, and elements the page itself made unclickable.
 */
export const getTargetElement = (
  point: Point,
  overlayHost: HTMLElement | null,
  ownerDocument: Document = document,
): Element | null =>
  withOverlayHitTesting(overlayHost, () => {
    for (const raw of ownerDocument.elementsFromPoint(point.x, point.y)) {
      const element = getDeepestElementAt(raw, point);
      if (!isSelectable(element, overlayHost, ownerDocument)) continue;
      return element;
    }
    return null;
  });

/**
 * The minimum common parent of two elements: the deepest element that contains
 * both. `body`/`html` are ignored by the caller.
 */
export const getMinimumCommonParent = (
  elementA: Element,
  elementB: Element,
): Element | null => {
  const ancestors = new Set<Element>();
  for (let current: Element | null = elementA; current; current = current.parentElement) {
    ancestors.add(current);
  }
  for (let current: Element | null = elementB; current; current = current.parentElement) {
    if (ancestors.has(current)) return current;
  }
  return null;
};

import type { Rect } from './types.js';

export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export const getViewportSize = (ownerWindow?: Window) => ({
  width:
    ownerWindow?.innerWidth ||
    (typeof window === 'undefined' ? 1 : window.innerWidth) ||
    1,
  height:
    ownerWindow?.innerHeight ||
    (typeof window === 'undefined' ? 1 : window.innerHeight) ||
    1,
});

export const rectContainsRect = (outer: Rect, inner: Rect) =>
  inner.left >= outer.left &&
  inner.top >= outer.top &&
  inner.left + inner.width <= outer.left + outer.width &&
  inner.top + inner.height <= outer.top + outer.height;

/** True when two rects are the same box, within `epsilon` pixels. */
export const rectsEqual = (
  a: Rect | null,
  b: Rect | null,
  epsilon = 0.5,
) => {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    Math.abs(a.left - b.left) < epsilon &&
    Math.abs(a.top - b.top) < epsilon &&
    Math.abs(a.width - b.width) < epsilon &&
    Math.abs(a.height - b.height) < epsilon
  );
};

/** Grow a rect by the given edges, never going below a zero size. */
export const growRect = (
  rect: Rect,
  edges: { top: number; right: number; bottom: number; left: number },
): Rect => ({
  left: rect.left - edges.left,
  top: rect.top - edges.top,
  width: Math.max(0, rect.width + edges.left + edges.right),
  height: Math.max(0, rect.height + edges.top + edges.bottom),
});

/** Shrink a rect by the given edges, never going below a zero size. */
export const shrinkRect = (
  rect: Rect,
  edges: { top: number; right: number; bottom: number; left: number },
): Rect => ({
  left: rect.left + edges.left,
  top: rect.top + edges.top,
  width: Math.max(0, rect.width - edges.left - edges.right),
  height: Math.max(0, rect.height - edges.top - edges.bottom),
});

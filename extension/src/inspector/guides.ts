import { GUIDE_HITBOX_SIZE, GUIDE_SNAP_DISTANCE } from './constants.js';
import { clamp, getViewportSize } from './geometry.js';
import type { Guide, GuideOrientation, Point } from './types.js';

export type GuideDistance = {
  readonly orientation: GuideOrientation;
  readonly start: number;
  readonly end: number;
  readonly value: number;
};

const createGuideId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `guide-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export const createGuide = (
  orientation: GuideOrientation,
  position: number,
): Guide => ({
  id: createGuideId(),
  orientation,
  position,
});

/** Distance from a point to a guide, in the axis the guide measures. */
export const getGuideDistance = (guide: Guide, point: Point) =>
  guide.orientation === 'vertical'
    ? Math.abs(guide.position - point.x)
    : Math.abs(guide.position - point.y);

/** The guide within grabbing distance of the point, if any. */
export const findGuideAtPoint = (
  guides: readonly Guide[],
  point: Point,
  hitbox = GUIDE_HITBOX_SIZE,
): Guide | null => {
  let closest: Guide | null = null;
  let closestDistance = hitbox;
  for (const guide of guides) {
    const distance = getGuideDistance(guide, point);
    if (distance <= closestDistance) {
      closest = guide;
      closestDistance = distance;
    }
  }
  return closest;
};

/**
 * Snap a guide to the nearest existing guide of the same orientation. The guide
 * being dragged is skipped so it does not snap to itself.
 */
export const snapGuidePosition = (params: {
  readonly orientation: GuideOrientation;
  readonly position: number;
  readonly guides: readonly Guide[];
  readonly draggingGuideId?: string | null;
  readonly ownerWindow?: Window;
}): number => {
  const { orientation, guides, draggingGuideId } = params;
  const viewport = getViewportSize(params.ownerWindow);
  const limit = orientation === 'vertical' ? viewport.width : viewport.height;
  const raw = clamp(params.position, 0, limit);

  let best = raw;
  let bestDistance = GUIDE_SNAP_DISTANCE;
  for (const guide of guides) {
    if (guide.orientation !== orientation) continue;
    if (guide.id === draggingGuideId) continue;
    const distance = Math.abs(guide.position - raw);
    if (distance <= bestDistance) {
      best = guide.position;
      bestDistance = distance;
    }
  }
  return best;
};

/**
 * Distances between adjacent guides of the same orientation, which the overlay
 * labels. A preview guide (the one following the pointer) is included so the
 * measurement updates before the guide is placed.
 */
export const getGuideDistances = (
  guides: readonly Guide[],
  preview: Guide | null = null,
): GuideDistance[] => {
  const distances: GuideDistance[] = [];
  const visible = preview ? [...guides, preview] : guides;

  for (const orientation of ['vertical', 'horizontal'] as const) {
    const positions = visible
      .filter((guide) => guide.orientation === orientation)
      .map((guide) => guide.position)
      .filter(
        (position, index, all) => all.indexOf(position) === index,
      )
      .sort((a, b) => a - b);

    for (let index = 1; index < positions.length; index += 1) {
      const start = positions[index - 1];
      const end = positions[index];
      const value = end - start;
      if (value > 0.5) distances.push({ orientation, start, end, value });
    }
  }

  return distances;
};

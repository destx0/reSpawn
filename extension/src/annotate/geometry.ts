import type { Annotation, Bounds, Point } from './types.js';

export function normalizeRect(a: Point, b: Point): Bounds {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

export function boundsOf(annotation: Annotation): Bounds {
  switch (annotation.type) {
    case 'rect':
      return normalizeRect(
        { x: annotation.x, y: annotation.y },
        { x: annotation.x + annotation.w, y: annotation.y + annotation.h },
      );
    case 'arrow':
      return normalizeRect(
        { x: annotation.x1, y: annotation.y1 },
        { x: annotation.x2, y: annotation.y2 },
      );
    case 'pen': {
      if (!annotation.points.length) return { x: 0, y: 0, w: 0, h: 0 };
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const point of annotation.points) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
      }
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    case 'text': {
      const lines = annotation.text.split('\n');
      const width =
        Math.max(...lines.map((line) => line.length), 0) *
        annotation.fontSize *
        0.56;
      const height = Math.max(lines.length, 1) * annotation.fontSize * 1.28;
      return { x: annotation.x, y: annotation.y, w: width, h: height };
    }
  }
}

const clonePoints = (points: readonly Point[]) =>
  points.map((point) => ({ x: point.x, y: point.y }));

export function cloneAnnotation(annotation: Annotation): Annotation {
  switch (annotation.type) {
    case 'rect':
    case 'arrow':
    case 'text':
      return { ...annotation };
    case 'pen':
      return { ...annotation, points: clonePoints(annotation.points) };
  }
}

export function moveAnnotation(
  annotation: Annotation,
  dx: number,
  dy: number,
): Annotation {
  switch (annotation.type) {
    case 'rect':
      return { ...annotation, x: annotation.x + dx, y: annotation.y + dy };
    case 'arrow':
      return {
        ...annotation,
        x1: annotation.x1 + dx,
        y1: annotation.y1 + dy,
        x2: annotation.x2 + dx,
        y2: annotation.y2 + dy,
      };
    case 'pen':
      return {
        ...annotation,
        points: annotation.points.map((point) => ({
          x: point.x + dx,
          y: point.y + dy,
        })),
      };
    case 'text':
      return { ...annotation, x: annotation.x + dx, y: annotation.y + dy };
  }
}

export function distanceBetween(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function distanceToSegment(point: Point, a: Point, b: Point) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distanceBetween(point, a);
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared,
    ),
  );
  return distanceBetween(point, { x: a.x + t * dx, y: a.y + t * dy });
}

export function hitTest(
  annotation: Annotation,
  point: Point,
  tolerance: number,
) {
  const bounds = boundsOf(annotation);
  const outside =
    point.x < bounds.x - tolerance ||
    point.x > bounds.x + bounds.w + tolerance ||
    point.y < bounds.y - tolerance ||
    point.y > bounds.y + bounds.h + tolerance;
  if (outside) return false;

  const reach = tolerance + annotation.width / 2;
  switch (annotation.type) {
    case 'rect':
      return true;
    case 'arrow':
      return (
        distanceToSegment(
          point,
          { x: annotation.x1, y: annotation.y1 },
          { x: annotation.x2, y: annotation.y2 },
        ) <= reach
      );
    case 'pen':
      for (let index = 1; index < annotation.points.length; index++) {
        if (
          distanceToSegment(
            point,
            annotation.points[index - 1],
            annotation.points[index],
          ) <= reach
        ) {
          return true;
        }
      }
      return annotation.points.length === 1
        ? distanceBetween(point, annotation.points[0]) <= reach
        : false;
    case 'text':
      return true;
  }
}

export function clampPoint(point: Point, bounds: Bounds | null): Point {
  if (!bounds) return point;
  return {
    x: Math.min(bounds.x + bounds.w, Math.max(bounds.x, point.x)),
    y: Math.min(bounds.y + bounds.h, Math.max(bounds.y, point.y)),
  };
}

export function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

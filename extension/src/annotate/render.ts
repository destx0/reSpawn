import { boundsOf } from './geometry.js';
import type { Annotation, Point } from './types.js';

const FONT =
  "'Source Sans 3', 'Source Sans Pro', 'Segoe UI', system-ui, sans-serif";

export type ScreenPoint = (point: Point) => Point;

export function renderAnnotations(
  ctx: CanvasRenderingContext2D,
  annotations: readonly Annotation[],
  toScreen: ScreenPoint,
  scale: number,
  selectedId: string | null,
) {
  for (const annotation of annotations) {
    drawAnnotation(ctx, annotation, toScreen, scale);
  }
  const selected = annotations.find((item) => item.id === selectedId);
  if (selected) drawSelection(ctx, selected, toScreen);
}

export function drawAnnotation(
  ctx: CanvasRenderingContext2D,
  annotation: Annotation,
  toScreen: ScreenPoint,
  scale: number,
) {
  ctx.save();
  ctx.strokeStyle = annotation.color;
  ctx.fillStyle = annotation.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1, annotation.width * scale);

  switch (annotation.type) {
    case 'rect': {
      const a = toScreen({ x: annotation.x, y: annotation.y });
      const b = toScreen({
        x: annotation.x + annotation.w,
        y: annotation.y + annotation.h,
      });
      ctx.strokeRect(
        Math.min(a.x, b.x),
        Math.min(a.y, b.y),
        Math.abs(b.x - a.x),
        Math.abs(b.y - a.y),
      );
      break;
    }
    case 'arrow': {
      const a = toScreen({ x: annotation.x1, y: annotation.y1 });
      const b = toScreen({ x: annotation.x2, y: annotation.y2 });
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const head = Math.max(9 * scale, ctx.lineWidth * 3.2);
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(
        b.x - head * Math.cos(angle - Math.PI / 7),
        b.y - head * Math.sin(angle - Math.PI / 7),
      );
      ctx.lineTo(
        b.x - head * Math.cos(angle + Math.PI / 7),
        b.y - head * Math.sin(angle + Math.PI / 7),
      );
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'pen': {
      if (!annotation.points.length) break;
      const first = toScreen(annotation.points[0]);
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      for (let index = 1; index < annotation.points.length; index++) {
        const point = toScreen(annotation.points[index]);
        ctx.lineTo(point.x, point.y);
      }
      if (annotation.points.length === 1) {
        ctx.lineTo(first.x + 0.01, first.y);
      }
      ctx.stroke();
      break;
    }
    case 'text': {
      const origin = toScreen({ x: annotation.x, y: annotation.y });
      const size = Math.max(8, annotation.fontSize * scale);
      ctx.font = `600 ${size}px ${FONT}`;
      ctx.textBaseline = 'top';
      const lines = annotation.text.split('\n');
      const lineHeight = size * 1.28;
      lines.forEach((line, index) => {
        ctx.fillText(line, origin.x, origin.y + index * lineHeight);
      });
      break;
    }
  }
  ctx.restore();
}

function drawSelection(
  ctx: CanvasRenderingContext2D,
  annotation: Annotation,
  toScreen: ScreenPoint,
) {
  const bounds = boundsOf(annotation);
  const a = toScreen({ x: bounds.x, y: bounds.y });
  const b = toScreen({ x: bounds.x + bounds.w, y: bounds.y + bounds.h });
  const x = Math.min(a.x, b.x) - 3;
  const y = Math.min(a.y, b.y) - 3;
  const w = Math.abs(b.x - a.x) + 6;
  const h = Math.abs(b.y - a.y) + 6;
  ctx.save();
  ctx.setLineDash([]);
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

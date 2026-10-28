import type { BoxEdges, InspectMeasurement, Rect } from './types.js';

export const formatValue = (value: number) => Math.round(value);

/** CSS shorthand for four edges: `8`, `8 16`, `8 16 4`, `8 16 4 12`. */
export const formatEdges = (edges: BoxEdges) => {
  const top = String(formatValue(edges.top));
  const right = String(formatValue(edges.right));
  const bottom = String(formatValue(edges.bottom));
  const left = String(formatValue(edges.left));
  if (top === right && top === bottom && top === left) return top;
  if (top === bottom && right === left) return `${top} ${right}`;
  if (right === left) return `${top} ${right} ${bottom}`;
  return `${top} ${right} ${bottom} ${left}`;
};

export const formatGap = (measurement: InspectMeasurement) =>
  measurement.gap
    ? `${formatValue(measurement.gap.row)} / ${formatValue(measurement.gap.column)}`
    : '';

/** `label · 120 x 40 · 14px / 20px / #1f2937` */
export const formatMeasurement = (measurement: InspectMeasurement) =>
  `${measurement.label} · ${formatValue(measurement.rect.width)} x ${formatValue(
    measurement.rect.height,
  )} · ${measurement.styles.fontSize} / ${measurement.styles.lineHeight} / ${
    measurement.styles.color
  }`;

/**
 * The band between `outer` and `inner`, as up to four strips. Drawing strips
 * instead of two translucent boxes keeps margin and padding colours from
 * blending where they overlap.
 */
export const getBandStrips = (outer: Rect, inner: Rect) => {
  const strips: Rect[] = [];
  const top = inner.top - outer.top;
  const bottom = outer.top + outer.height - (inner.top + inner.height);
  const left = inner.left - outer.left;
  const right = outer.left + outer.width - (inner.left + inner.width);
  if (top > 0.5) {
    strips.push({
      left: outer.left,
      top: outer.top,
      width: outer.width,
      height: top,
    });
  }
  if (bottom > 0.5) {
    strips.push({
      left: outer.left,
      top: inner.top + inner.height,
      width: outer.width,
      height: bottom,
    });
  }
  if (left > 0.5) {
    strips.push({
      left: outer.left,
      top: inner.top,
      width: left,
      height: inner.height,
    });
  }
  if (right > 0.5) {
    strips.push({
      left: inner.left + inner.width,
      top: inner.top,
      width: right,
      height: inner.height,
    });
  }
  return strips;
};

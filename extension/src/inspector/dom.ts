import { growRect, shrinkRect } from './geometry.js';
import type {
  BoxEdges,
  InspectMeasurement,
  Rect,
  TextInspection,
} from './types.js';

export const getRectFromDom = (element: Element): Rect => {
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
};

/** `button#save.primary` — the first class is enough to recognise an element. */
export const getElementLabel = (element: Element) => {
  const tag = element.tagName.toLowerCase();
  const id = element.id ? `#${element.id}` : '';
  const className = element.getAttribute('class')?.trim().split(/\s+/)[0];
  return `${tag}${id}${className ? `.${className}` : ''}`;
};

const toHex = (value: number) =>
  Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, '0');

const RGB_COLOR =
  /^rgba?\(\s*([0-9.]+)\s*[,\s]\s*([0-9.]+)\s*[,\s]\s*([0-9.]+)(?:\s*[,/]\s*[0-9.]+%?\s*)?\)$/;

/** Computed colours come back as `rgb()`/`rgba()`; the overlay shows hex. */
export const normalizeColorToHex = (color: string) => {
  const trimmed = color.trim().toLowerCase();
  if (trimmed.startsWith('#')) {
    if (trimmed.length === 4) {
      return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
    }
    return trimmed;
  }

  const match = RGB_COLOR.exec(trimmed);
  if (!match) return color;

  return `#${toHex(Number(match[1]))}${toHex(Number(match[2]))}${toHex(Number(match[3]))}`;
};

const parseEdge = (value: string | undefined) => Number.parseFloat(value ?? '') || 0;

const readSpacingEdges = (
  style: CSSStyleDeclaration,
  prefix: 'padding' | 'margin',
): BoxEdges => ({
  top: parseEdge(style.getPropertyValue(`${prefix}-top`)),
  right: parseEdge(style.getPropertyValue(`${prefix}-right`)),
  bottom: parseEdge(style.getPropertyValue(`${prefix}-bottom`)),
  left: parseEdge(style.getPropertyValue(`${prefix}-left`)),
});

const readBorderEdges = (style: CSSStyleDeclaration): BoxEdges => ({
  top: parseEdge(style.borderTopWidth),
  right: parseEdge(style.borderRightWidth),
  bottom: parseEdge(style.borderBottomWidth),
  left: parseEdge(style.borderLeftWidth),
});

const isLayoutContainer = (display: string) =>
  display.includes('flex') || display.includes('grid');

const readLayoutGap = (style: CSSStyleDeclaration) => {
  if (!isLayoutContainer(style.display)) return null;
  const row = parseEdge(style.rowGap);
  const column = parseEdge(style.columnGap);
  return row > 0 || column > 0 ? { row, column } : null;
};

export const getTextInspection = (
  element: Element,
  ownerWindow: Window,
): TextInspection => {
  const style = ownerWindow.getComputedStyle(element);
  return {
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
    color: normalizeColorToHex(style.color),
    textAlign: style.textAlign,
  };
};

export const getInspectMeasurement = (
  element: Element,
  ownerWindow: Window,
): InspectMeasurement => {
  const rect = getRectFromDom(element);
  const style = ownerWindow.getComputedStyle(element);
  const padding = readSpacingEdges(style, 'padding');
  const margin = readSpacingEdges(style, 'margin');
  const border = readBorderEdges(style);
  const paddingRect = shrinkRect(rect, border);
  const contentRect = shrinkRect(paddingRect, padding);

  const parent = element.parentElement;
  const parentStyle = parent ? ownerWindow.getComputedStyle(parent) : null;
  const gap = parentStyle ? readLayoutGap(parentStyle) : null;

  return {
    rect,
    contentRect,
    marginRect: growRect(rect, margin),
    padding,
    margin,
    gap,
    parentRect: gap && parent ? getRectFromDom(parent) : null,
    label: getElementLabel(element),
    styles: getTextInspection(element, ownerWindow),
  };
};

import { getDistanceOverlay } from '../../../src/inspector/distances.js';
import { getElementLabel, getInspectMeasurement, normalizeColorToHex } from '../../../src/inspector/dom.js';
import { formatEdges, getBandStrips } from '../../../src/inspector/format.js';
import { rectContainsRect, rectsEqual, shrinkRect } from '../../../src/inspector/geometry.js';
import {
  createGuide,
  findGuideAtPoint,
  getGuideDistances,
  snapGuidePosition,
} from '../../../src/inspector/guides.js';
import { getMinimumCommonParent } from '../../../src/inspector/selection.js';

const rect = (left, top, width, height) => ({ left, top, width, height });

const mockRect = (element, value) => {
  element.getBoundingClientRect = () => ({
    ...value,
    right: value.left + value.width,
    bottom: value.top + value.height,
    x: value.left,
    y: value.top,
    toJSON: () => value,
  });
  return element;
};

describe('geometry', () => {
  it('compares rects with an epsilon', () => {
    expect(rectsEqual(rect(0, 0, 10, 10), rect(0.2, 0.2, 10.2, 10.2))).toBe(true);
    expect(rectsEqual(rect(0, 0, 10, 10), rect(2, 0, 10, 10))).toBe(false);
    expect(rectsEqual(null, rect(0, 0, 1, 1))).toBe(false);
  });

  it('shrinks without going negative', () => {
    expect(shrinkRect(rect(0, 0, 10, 10), { top: 2, right: 2, bottom: 2, left: 2 })).toEqual(
      rect(2, 2, 6, 6),
    );
    expect(shrinkRect(rect(0, 0, 4, 4), { top: 3, right: 3, bottom: 3, left: 3 })).toEqual(
      rect(3, 3, 0, 0),
    );
  });

  it('knows when a rect contains another', () => {
    expect(rectContainsRect(rect(0, 0, 100, 100), rect(10, 10, 20, 20))).toBe(true);
    expect(rectContainsRect(rect(0, 0, 100, 100), rect(90, 90, 20, 20))).toBe(false);
  });
});

describe('format', () => {
  it('collapses box edges like CSS shorthand', () => {
    expect(formatEdges({ top: 8, right: 8, bottom: 8, left: 8 })).toBe('8');
    expect(formatEdges({ top: 8, right: 16, bottom: 8, left: 16 })).toBe('8 16');
    expect(formatEdges({ top: 8, right: 16, bottom: 4, left: 16 })).toBe('8 16 4');
    expect(formatEdges({ top: 8, right: 16, bottom: 4, left: 12 })).toBe('8 16 4 12');
  });

  it('draws a band as strips instead of overlapping boxes', () => {
    const strips = getBandStrips(rect(0, 0, 100, 100), rect(10, 10, 80, 80));
    expect(strips).toHaveLength(4);
    expect(strips[0]).toEqual(rect(0, 0, 100, 10));
    expect(strips[1]).toEqual(rect(0, 90, 100, 10));
    expect(strips[2]).toEqual(rect(0, 10, 10, 80));
    expect(strips[3]).toEqual(rect(90, 10, 10, 80));
  });
});

describe('normalizeColorToHex', () => {
  it('normalizes rgb and rgba', () => {
    expect(normalizeColorToHex('rgb(31, 41, 55)')).toBe('#1f2937');
    expect(normalizeColorToHex('rgba(31, 41, 55, 0.5)')).toBe('#1f2937');
    expect(normalizeColorToHex('rgb(31 41 55 / 50%)')).toBe('#1f2937');
  });

  it('expands short hex and keeps named colors', () => {
    expect(normalizeColorToHex('#abc')).toBe('#aabbcc');
    expect(normalizeColorToHex('CanvasText')).toBe('CanvasText');
  });
});

describe('getElementLabel', () => {
  it('uses the first class only', () => {
    const element = document.createElement('button');
    element.id = 'save';
    element.className = 'primary large';
    expect(getElementLabel(element)).toBe('button#save.primary');
  });

  it('works without id and class', () => {
    expect(getElementLabel(document.createElement('div'))).toBe('div');
  });
});

describe('getInspectMeasurement', () => {
  it('reads the box model from computed styles', () => {
    const parent = document.createElement('div');
    const element = document.createElement('span');
    element.style.padding = '8px 16px';
    element.style.margin = '4px';
    element.style.border = '1px solid';
    element.style.color = 'rgb(31, 41, 55)';
    parent.append(element);
    document.body.append(parent);
    mockRect(element, rect(100, 50, 200, 100));

    const measurement = getInspectMeasurement(element, window);

    expect(measurement.rect).toEqual(rect(100, 50, 200, 100));
    expect(measurement.padding).toEqual({ top: 8, right: 16, bottom: 8, left: 16 });
    expect(measurement.margin).toEqual({ top: 4, right: 4, bottom: 4, left: 4 });
    // Border (1px) then padding (8/16) are removed from the content box.
    expect(measurement.contentRect).toEqual(rect(117, 59, 166, 82));
    expect(measurement.marginRect).toEqual(rect(96, 46, 208, 108));
    expect(measurement.styles.color).toBe('#1f2937');

    element.remove();
    parent.remove();
  });

  it('reports a flex parent gap', () => {
    const parent = document.createElement('div');
    parent.style.display = 'flex';
    parent.style.rowGap = '12px';
    parent.style.columnGap = '12px';
    const element = document.createElement('span');
    parent.append(element);
    document.body.append(parent);
    mockRect(element, rect(0, 0, 10, 10));
    mockRect(parent, rect(0, 0, 100, 10));

    const measurement = getInspectMeasurement(element, window);

    expect(measurement.gap).toEqual({ row: 12, column: 12 });
    expect(measurement.parentRect).toEqual(rect(0, 0, 100, 10));

    element.remove();
    parent.remove();
  });
});

describe('getDistanceOverlay', () => {
  it('measures a horizontal gap', () => {
    const overlay = getDistanceOverlay(rect(0, 0, 100, 50), rect(140, 20, 60, 50), undefined, window);

    // The line sits in the middle of the shared rows (20..50).
    expect(overlay.horizontal).toEqual({ x1: 100, x2: 140, y: 35, value: 40 });
    expect(overlay.vertical).toBeNull();
    expect(overlay.connectors).toEqual([]);
  });

  it('connects the gap when the rects are diagonal', () => {
    const overlay = getDistanceOverlay(rect(0, 0, 100, 20), rect(140, 40, 60, 20), undefined, window);

    expect(overlay.horizontal).toEqual({ x1: 100, x2: 140, y: 10, value: 40 });
    expect(overlay.vertical).toEqual({ y1: 20, y2: 40, x: 50, value: 20 });
    expect(overlay.connectors).toEqual([
      { x1: 140, y1: 10, x2: 140, y2: 40 },
      { x1: 50, y1: 40, x2: 140, y2: 40 },
    ]);
  });

  it('measures a vertical gap', () => {
    const overlay = getDistanceOverlay(rect(0, 0, 100, 50), rect(20, 80, 60, 40), undefined, window);

    expect(overlay.horizontal).toBeNull();
    expect(overlay.vertical).toEqual({ y1: 50, y2: 80, x: 50, value: 30 });
  });

  it('measures all four sides of a nested rect', () => {
    const overlay = getDistanceOverlay(
      rect(0, 0, 200, 200),
      rect(20, 30, 100, 100),
      'b-inside-a',
      window,
    );

    expect(overlay.horizontalDistances).toEqual([
      { x1: 0, x2: 20, y: 80, value: 20 },
      { x1: 120, x2: 200, y: 80, value: 80 },
    ]);
    expect(overlay.verticalDistances).toEqual([
      { y1: 0, y2: 30, x: 70, value: 30 },
      { y1: 130, y2: 200, x: 70, value: 70 },
    ]);
    // The nearest boundary is the one the overlay labels.
    expect(overlay.horizontal).toEqual({ x1: 0, x2: 20, y: 80, value: 20 });
    expect(overlay.vertical).toEqual({ y1: 0, y2: 30, x: 70, value: 30 });
  });

  it('ignores overlapping rects', () => {
    const overlay = getDistanceOverlay(rect(0, 0, 100, 100), rect(50, 50, 100, 100), undefined, window);
    expect(overlay.horizontal).toBeNull();
    expect(overlay.vertical).toBeNull();
  });
});

describe('guides', () => {
  const vertical = (position, id = `v${position}`) => ({
    id,
    orientation: 'vertical',
    position,
  });

  it('snaps to a nearby guide of the same orientation', () => {
    expect(
      snapGuidePosition({
        orientation: 'vertical',
        position: 104,
        guides: [vertical(100)],
      }),
    ).toBe(100);
  });

  it('does not snap beyond the snap distance', () => {
    expect(
      snapGuidePosition({
        orientation: 'vertical',
        position: 120,
        guides: [vertical(100)],
      }),
    ).toBe(120);
  });

  it('does not snap a guide to itself', () => {
    expect(
      snapGuidePosition({
        orientation: 'vertical',
        position: 104,
        guides: [vertical(100)],
        draggingGuideId: 'v100',
      }),
    ).toBe(104);
  });

  it('finds the guide under the pointer within the hitbox', () => {
    expect(findGuideAtPoint([vertical(100)], { x: 110, y: 0 })?.id).toBe('v100');
    expect(findGuideAtPoint([vertical(100)], { x: 120, y: 0 })).toBeNull();
  });

  it('reports distances between adjacent guides only', () => {
    const distances = getGuideDistances([
      vertical(100),
      vertical(40),
      { id: 'h10', orientation: 'horizontal', position: 10 },
      { id: 'h70', orientation: 'horizontal', position: 70 },
    ]);

    expect(distances).toEqual([
      { orientation: 'vertical', start: 40, end: 100, value: 60 },
      { orientation: 'horizontal', start: 10, end: 70, value: 60 },
    ]);
  });

  it('includes the preview guide while placing one', () => {
    const distances = getGuideDistances(
      [vertical(100)],
      { id: 'preview', orientation: 'vertical', position: 130 },
    );
    expect(distances).toEqual([
      { orientation: 'vertical', start: 100, end: 130, value: 30 },
    ]);
  });

  it('creates unique guides', () => {
    expect(createGuide('vertical', 10).id).not.toBe(createGuide('vertical', 10).id);
  });
});

describe('getMinimumCommonParent', () => {
  it('returns the deepest shared ancestor', () => {
    document.body.innerHTML = '<div id="a"><span id="a1"></span></div><div id="b"><span id="b1"></span></div>';
    const a1 = document.getElementById('a1');
    const b1 = document.getElementById('b1');
    expect(getMinimumCommonParent(a1, b1)).toBe(document.body);
    expect(getMinimumCommonParent(a1, a1.parentElement)).toBe(document.getElementById('a'));
    document.body.innerHTML = '';
  });
});

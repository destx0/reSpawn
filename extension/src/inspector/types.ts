// Types shared by the inspector overlay. Ported from inspector-ng
// (`projects/inspector-ng/src/lib/types.ts`) and trimmed to what the overlay
// renders. All rects are viewport coordinates (what `getBoundingClientRect`
// returns), so the overlay can position everything with `position: fixed`.

export type Point = {
  readonly x: number;
  readonly y: number;
};

export type Rect = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

export type BoxEdges = {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
};

export type GuideOrientation = 'vertical' | 'horizontal';

export type Guide = {
  readonly id: string;
  readonly orientation: GuideOrientation;
  readonly position: number;
};

/** `none` leaves the page alone; the other two take over pointer events. */
export type ToolMode = 'none' | 'select' | 'guides';

export type TextInspection = {
  readonly fontFamily: string;
  readonly fontSize: string;
  readonly fontWeight: string;
  readonly lineHeight: string;
  readonly letterSpacing: string;
  readonly color: string;
  readonly textAlign: string;
};

export type InspectMeasurement = {
  /** The border box, as returned by `getBoundingClientRect`. */
  readonly rect: Rect;
  /** The content box: the border box inset by border and padding. */
  readonly contentRect: Rect;
  /** The border box grown by the element's margin. */
  readonly marginRect: Rect;
  readonly padding: BoxEdges;
  readonly margin: BoxEdges;
  /** Row/column gap of a flex/grid parent, when it has one. */
  readonly gap: {
    readonly row: number;
    readonly column: number;
  } | null;
  /** The parent's border box when `gap` is set, to show where the gap lives. */
  readonly parentRect: Rect | null;
  readonly label: string;
  readonly styles: TextInspection;
};

export type TextBlockAnnotation = {
  readonly id: string;
  readonly rect: Rect;
  readonly text: string;
  readonly styles: TextInspection;
};

export type DistanceAxis = {
  readonly x1?: number;
  readonly x2?: number;
  readonly y1?: number;
  readonly y2?: number;
  readonly x?: number;
  readonly y?: number;
  readonly value: number;
};

export type DistanceRelation = 'a-inside-b' | 'b-inside-a';

export type DistanceOverlay = {
  readonly rectA: Rect;
  readonly rectB: Rect;
  readonly horizontal: DistanceAxis | null;
  readonly vertical: DistanceAxis | null;
  /** All horizontal gaps worth labelling (nested rects have two). */
  readonly horizontalDistances: readonly DistanceAxis[];
  /** All vertical gaps worth labelling (nested rects have two). */
  readonly verticalDistances: readonly DistanceAxis[];
  readonly connectors: readonly {
    readonly x1: number;
    readonly y1: number;
    readonly x2: number;
    readonly y2: number;
  }[];
};

export type Point = {
  readonly x: number;
  readonly y: number;
};

export type Bounds = {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
};

export type Tool = 'select' | 'rect' | 'arrow' | 'pen' | 'text';

interface Base {
  readonly id: string;
  readonly color: string;
  readonly width: number;
}

export type RectAnnotation = Base & {
  readonly type: 'rect';
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
};

export type ArrowAnnotation = Base & {
  readonly type: 'arrow';
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
};

export type PenAnnotation = Base & {
  readonly type: 'pen';
  readonly points: readonly Point[];
};

export type TextAnnotation = Base & {
  readonly type: 'text';
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly fontSize: number;
};

export type Annotation =
  | RectAnnotation
  | ArrowAnnotation
  | PenAnnotation
  | TextAnnotation;

export type Style = {
  readonly color: string;
  readonly width: number;
  readonly fontSize: number;
};

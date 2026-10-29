import type { Style, Tool } from './types.js';

export type ToolbarAction =
  | Tool
  | 'undo'
  | 'redo'
  | 'clear'
  | 'close'
  | 'color'
  | 'width'
  | 'copy'
  | 'download';

const svg = (body: string, strokeWidth = 2) =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const ICONS = {
  select: svg('<path d="m3 3 7.07 17 2.51-7.39L20 10.07z"/>'),
  rect: svg('<rect x="4" y="4" width="16" height="16" rx="2"/>'),
  arrow: svg('<path d="M5 19 19 5M9 5h10v10"/>'),
  pen: svg(
    '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  ),
  text: svg('<path d="M4 7V4h16v3M9 20h6M12 4v16"/>'),
  undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'),
  redo: svg('<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>'),
  trash: svg(
    '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  ),
  close: svg('<path d="m6 6 12 12M18 6 6 18"/>'),
  copy: svg(
    '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  ),
  download: svg(
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  ),
  grip:
    '<svg viewBox="0 0 12 20" width="10" height="18" fill="currentColor" aria-hidden="true">' +
    '<circle cx="4" cy="5" r="1.2"/><circle cx="8" cy="5" r="1.2"/>' +
    '<circle cx="4" cy="10" r="1.2"/><circle cx="8" cy="10" r="1.2"/>' +
    '<circle cx="4" cy="15" r="1.2"/><circle cx="8" cy="15" r="1.2"/></svg>',
};

const TOOL_ORDER: ReadonlyArray<{ tool: Tool; label: string; icon: string }> = [
  { tool: 'select', label: 'Select', icon: ICONS.select },
  { tool: 'rect', label: 'Rectangle', icon: ICONS.rect },
  { tool: 'arrow', label: 'Arrow', icon: ICONS.arrow },
  { tool: 'pen', label: 'Pen', icon: ICONS.pen },
  { tool: 'text', label: 'Text', icon: ICONS.text },
];

export class AnnotationToolbar {
  readonly element: HTMLDivElement;
  private readonly toolButtons = new Map<Tool, HTMLButtonElement>();
  private readonly undoButton: HTMLButtonElement;
  private readonly redoButton: HTMLButtonElement;
  private readonly swatch: HTMLSpanElement;
  private readonly widthIcon: HTMLSpanElement;
  private style: Style;
  private dragState: {
    readonly pointerId: number;
    readonly offsetX: number;
    readonly offsetY: number;
  } | null = null;

  constructor(options: {
    style: Style;
    extras: ReadonlyArray<'copy' | 'download'>;
    onAction: (action: ToolbarAction) => void;
  }) {
    this.style = options.style;
    this.element = document.createElement('div');
    this.element.className = 'annotate-toolbar';
    this.element.setAttribute('role', 'toolbar');
    this.element.setAttribute('aria-label', 'Annotation tools');

    const grip = document.createElement('span');
    grip.className = 'grip';
    grip.title = 'Drag toolbar';
    grip.innerHTML = ICONS.grip;
    grip.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = this.element.getBoundingClientRect();
      this.element.style.left = `${rect.left}px`;
      this.element.style.top = `${rect.top}px`;
      this.element.style.right = 'auto';
      this.element.style.bottom = 'auto';
      this.element.style.transform = 'none';
      this.dragState = {
        pointerId: event.pointerId,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
      };
      grip.setPointerCapture(event.pointerId);
    });
    grip.addEventListener('pointermove', (event) => {
      if (!this.dragState || event.pointerId !== this.dragState.pointerId) {
        return;
      }
      const rect = this.element.getBoundingClientRect();
      const maxX = Math.max(8, window.innerWidth - rect.width - 8);
      const maxY = Math.max(8, window.innerHeight - rect.height - 8);
      const left = Math.min(
        maxX,
        Math.max(8, event.clientX - this.dragState.offsetX),
      );
      const top = Math.min(
        maxY,
        Math.max(8, event.clientY - this.dragState.offsetY),
      );
      this.element.style.left = `${left}px`;
      this.element.style.top = `${top}px`;
    });
    const stopDrag = (event: PointerEvent) => {
      if (!this.dragState || event.pointerId !== this.dragState.pointerId) {
        return;
      }
      this.dragState = null;
      if (grip.hasPointerCapture(event.pointerId)) {
        grip.releasePointerCapture(event.pointerId);
      }
    };
    grip.addEventListener('pointerup', stopDrag);
    grip.addEventListener('pointercancel', stopDrag);
    this.element.append(grip);

    for (const { tool, label, icon } of TOOL_ORDER) {
      const button = this.button(icon, label, () => options.onAction(tool));
      button.dataset.tool = tool;
      button.setAttribute('aria-pressed', String(tool === 'select'));
      this.toolButtons.set(tool, button);
      this.element.append(button);
    }

    this.element.append(this.divider());

    const colorButton = this.button('', 'Ink color', () =>
      options.onAction('color'),
    );
    colorButton.classList.add('swatch');
    this.swatch = document.createElement('span');
    this.swatch.className = 'swatch-dot';
    colorButton.append(this.swatch);
    this.element.append(colorButton);

    this.widthIcon = document.createElement('span');
    this.widthIcon.className = 'width-icon';
    const widthButton = this.button('', 'Stroke width', () =>
      options.onAction('width'),
    );
    widthButton.append(this.widthIcon);
    this.element.append(widthButton);

    this.element.append(this.divider());

    this.undoButton = this.button(ICONS.undo, 'Undo (Cmd/Ctrl+Z)', () =>
      options.onAction('undo'),
    );
    this.redoButton = this.button(ICONS.redo, 'Redo (Cmd/Ctrl+Shift+Z)', () =>
      options.onAction('redo'),
    );
    this.element.append(this.undoButton, this.redoButton);

    this.element.append(
      this.button(ICONS.trash, 'Clear annotations', () =>
        options.onAction('clear'),
      ),
    );

    if (options.extras.length) {
      this.element.append(this.divider());
      if (options.extras.includes('copy')) {
        this.element.append(
          this.button(ICONS.copy, 'Copy image', () => options.onAction('copy')),
        );
      }
      if (options.extras.includes('download')) {
        this.element.append(
          this.button(ICONS.download, 'Download image', () =>
            options.onAction('download'),
          ),
        );
      }
    }

    this.element.append(
      this.button(ICONS.close, 'Close (Esc)', () => options.onAction('close')),
    );
    this.setStyle(options.style);
    this.setHistory(false, false);
  }

  setTool(tool: Tool) {
    for (const [id, button] of this.toolButtons) {
      button.classList.toggle('on', id === tool);
      button.setAttribute('aria-pressed', String(id === tool));
    }
  }

  setStyle(style: Style) {
    this.style = style;
    this.swatch.style.background = style.color;
    this.widthIcon.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="${Math.max(1, Math.min(8, style.width))}" stroke-linecap="round" aria-hidden="true"><path d="M4 12h16"/></svg>`;
    this.widthIcon.title = `Stroke width ${style.width}px`;
  }

  setHistory(canUndo: boolean, canRedo: boolean) {
    this.undoButton.disabled = !canUndo;
    this.redoButton.disabled = !canRedo;
  }

  get currentStyle() {
    return this.style;
  }

  private button(
    icon: string,
    label: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tbtn';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.innerHTML = icon;
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  private divider() {
    const divider = document.createElement('span');
    divider.className = 'divider';
    return divider;
  }
}

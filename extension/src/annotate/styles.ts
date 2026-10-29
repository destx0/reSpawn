export const ANNOTATE_STYLE = `
:host { all: initial; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
.annotate-canvas {
  position: fixed; inset: 0;
  width: 100%; height: 100%;
  z-index: 2;
  pointer-events: none;
  touch-action: none;
}
.annotate-toolbar {
  --ink-bg: #1b1b1b;
  --ink-border: rgba(255, 255, 255, 0.14);
  --ink-strong: #fafafa;
  --ink-text: #e8e8e8;
  --ink-muted: #b4b4b4;
  --ink-faint: #8c8c8c;
  --ink-hover: rgba(255, 255, 255, 0.06);
  --ink-ring: rgba(255, 255, 255, 0.32);
  --ink-soft: rgba(255, 255, 255, 0.09);
  --ink-font: 'Source Sans 3', 'Source Sans Pro', 'Segoe UI', system-ui, sans-serif;
  position: fixed; left: auto; right: 14px; bottom: 14px;
  z-index: 3;
  display: flex; align-items: center; gap: 2px;
  height: 46px; padding: 0 6px;
  border: 1px solid var(--ink-border);
  border-radius: 11px;
  background: var(--ink-bg);
  color: var(--ink-text);
  box-shadow:
    0 18px 48px rgba(0, 0, 0, 0.45),
    0 2px 8px rgba(0, 0, 0, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
  font-family: var(--ink-font);
  font-size: 12px;
  pointer-events: auto;
}
.grip {
  display: grid; place-items: center;
  width: 18px; height: 28px;
  color: var(--ink-faint);
  cursor: grab;
  touch-action: none;
}
.grip:active { cursor: grabbing; }
.grip svg { display: block; }
.tbtn {
  display: grid; place-items: center;
  width: 30px; height: 28px; padding: 0;
  border: 1px solid transparent; border-radius: 6px;
  background: transparent; color: var(--ink-faint);
  cursor: pointer;
  transition:
    background 120ms ease-out,
    color 120ms ease-out,
    border-color 120ms ease-out;
}
.tbtn svg { display: block; }
.tbtn:hover { background: var(--ink-hover); color: var(--ink-strong); }
.tbtn.on {
  border-color: var(--ink-ring);
  background: var(--ink-soft);
  color: var(--ink-strong);
}
.tbtn:disabled {
  cursor: default;
  opacity: 0.35;
}
.tbtn:disabled:hover { background: transparent; color: var(--ink-faint); }
.tbtn:focus-visible {
  outline: 2px solid var(--ink-strong);
  outline-offset: 2px;
}
.divider {
  width: 1px; height: 18px;
  margin: 0 3px;
  background: var(--ink-border);
}
.swatch { position: relative; }
.swatch-dot {
  display: block;
  width: 14px; height: 14px;
  border-radius: 50%;
  background: #ff5a1f;
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.55),
    inset 0 0 0 1px rgba(0, 0, 0, 0.25);
}
.width-icon { display: grid; place-items: center; }
.text-editor {
  position: fixed;
  z-index: 4;
  min-width: 120px;
  max-width: 340px;
  padding: 4px 6px;
  border: 1px dashed rgba(255, 255, 255, 0.55);
  border-radius: 4px;
  outline: none;
  background: rgba(20, 20, 20, 0.88);
  color: #fafafa;
  font-family: 'Source Sans 3', 'Source Sans Pro', 'Segoe UI', system-ui, sans-serif;
  font-weight: 600;
  line-height: 1.25;
  resize: none;
  overflow: hidden;
}
@media (prefers-reduced-motion: reduce) {
  .tbtn { transition: none; }
}
`;

export const EDITOR_STYLE = `
.shot-backdrop {
  position: fixed; inset: 0;
  z-index: 0;
  background: rgba(0, 0, 0, 0.72);
}
.shot-image {
  position: fixed;
  z-index: 1;
  display: block;
  border-radius: 4px;
  box-shadow:
    0 28px 80px rgba(0, 0, 0, 0.55),
    0 3px 10px rgba(0, 0, 0, 0.3);
  user-select: none;
  -webkit-user-drag: none;
}
`;

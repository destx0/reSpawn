// CSS for the inspector overlay. It lives in the shadow root, so page styles
// cannot reach it. Tokens follow the extension palette (zinc surfaces, blue
// accent); the box-model colours are the usual margin/padding/gap triad.

export const OVERLAY_STYLE = `
:host { all: initial; }
* { box-sizing: border-box; }
.root {
  --accent: #2563eb;
  --margin: #f59e0b;
  --padding: #10b981;
  --gap: #8b5cf6;
  --guide: #f59e0b;
  --label-bg: rgb(24 24 27 / 0.92);
  --label-fg: #fafafa;
  --label-muted: #a1a1aa;

  position: fixed;
  inset: 0;
  pointer-events: none;
  font: 11px/1.3 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
  color: var(--label-fg);
  direction: ltr;
  text-align: left;
  -webkit-font-smoothing: antialiased;
}
.layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.box {
  position: fixed;
  pointer-events: none;
  box-sizing: border-box;
}
.box--hover {
  border: 1px solid var(--accent);
  background: rgb(37 99 235 / 0.08);
  opacity: 0.65;
}
.box--outline {
  border: 1.5px solid var(--accent);
}
.box--content {
  border: 1px dashed rgb(37 99 235 / 0.45);
}
.box--gap {
  border: 1px dashed rgb(139 92 246 / 0.8);
  background: rgb(139 92 246 / 0.06);
}
.box--distance {
  border: 1px dashed rgb(37 99 235 / 0.7);
}
.band {
  position: fixed;
  pointer-events: none;
}
.band--margin { background: rgb(245 158 11 / 0.2); }
.band--padding { background: rgb(16 185 129 / 0.22); }

.label,
.tag,
.chip,
.distance-tag,
.guide-distance__tag {
  position: fixed;
  pointer-events: none;
  padding: 2px 5px;
  border-radius: 4px;
  background: var(--label-bg);
  color: var(--label-fg);
  font-size: 10px;
  font-weight: 500;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  box-shadow: 0 1px 4px rgb(0 0 0 / 0.25);
}
.label {
  max-width: min(420px, calc(100vw - 16px));
  overflow: hidden;
  text-overflow: ellipsis;
}
.tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.tag__margin { color: #fbbf24; }
.tag__padding { color: #34d399; }
.tag__gap { color: #c4b5fd; }
.tag__separator { color: #71717a; }
.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.chip__swatch {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  border: 1px solid rgb(255 255 255 / 0.28);
  flex: none;
}
.chip__muted { color: var(--label-muted); }

.connector {
  position: fixed;
  pointer-events: none;
}
.connector--vertical { border-left: 1px dashed rgb(37 99 235 / 0.72); }
.connector--horizontal { border-top: 1px dashed rgb(37 99 235 / 0.72); }

.distance-line {
  position: fixed;
  pointer-events: none;
  background: var(--accent);
}
.distance-line--horizontal { height: 1px; }
.distance-line--vertical { width: 1px; }
.distance-tag { transform: translate(-50%, -50%); }

.guide {
  position: fixed;
  pointer-events: none;
}
.guide--vertical {
  top: 0;
  width: 1px;
  height: 100vh;
  background: var(--guide);
}
.guide--horizontal {
  left: 0;
  width: 100vw;
  height: 1px;
  background: var(--guide);
}
.guide--preview {
  opacity: 0.5;
  background: repeating-linear-gradient(
    to bottom,
    var(--guide) 0 4px,
    transparent 4px 8px
  );
}
.guide--horizontal.guide--preview {
  background: repeating-linear-gradient(
    to right,
    var(--guide) 0 4px,
    transparent 4px 8px
  );
}
.guide--dragging {
  box-shadow: 0 0 0 1px rgb(255 255 255 / 0.6);
}

.guide-distance {
  position: fixed;
  pointer-events: none;
}
.guide-distance__line {
  position: absolute;
  background: var(--guide);
  opacity: 0.45;
}
.guide-distance--vertical {
  top: 50%;
  height: 1px;
}
.guide-distance--vertical .guide-distance__line {
  left: 0;
  right: 0;
  top: 0;
  height: 1px;
}
.guide-distance--horizontal {
  left: 50%;
  width: 1px;
}
.guide-distance--horizontal .guide-distance__line {
  top: 0;
  bottom: 0;
  left: 0;
  width: 1px;
}
.guide-distance__tag {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
}

/* Typography: a small dark card that matches the measurement labels. */
.ti-box {
  position: fixed;
  pointer-events: none;
  border: 1px solid rgb(37 99 235 / 0.5);
  background: rgb(37 99 235 / 0.04);
}
.ti-box--pinned {
  border-color: rgb(37 99 235 / 0.32);
  background: transparent;
}
.ti-card {
  position: fixed;
  z-index: 2;
  pointer-events: none;
  max-width: 260px;
  padding: 6px 8px;
  border: 1px solid rgb(255 255 255 / 0.1);
  border-radius: 7px;
  background: rgb(24 24 27 / 0.94);
  color: var(--label-fg);
  font: 10px/1.35 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
  font-variant-numeric: tabular-nums;
  box-shadow: 0 4px 14px rgb(0 0 0 / 0.22);
  opacity: 1;
  transition: opacity 80ms ease;
}
.ti-card[data-state='hidden'] {
  opacity: 0;
}
.ti-card--pinned {
  pointer-events: auto;
  padding-right: 16px;
  border-left: 2px solid var(--accent);
  cursor: grab;
  touch-action: none;
}
.ti-card--pinned:active {
  cursor: grabbing;
}
.ti-rows {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  column-gap: 10px;
  row-gap: 1px;
  align-items: baseline;
}
.ti-label {
  color: var(--label-muted);
  font-size: 9.5px;
}
.ti-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 10.5px;
}
.ti-var {
  color: #93c5fd;
}
.ti-sep {
  color: #71717a;
}
.ti-close {
  position: absolute;
  top: 1px;
  right: 1px;
  width: 14px;
  height: 14px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--label-muted);
  font: 12px/12px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
  text-align: center;
  cursor: pointer;
}
.ti-close:hover {
  background: rgb(255 255 255 / 0.08);
  color: var(--label-fg);
}
`;

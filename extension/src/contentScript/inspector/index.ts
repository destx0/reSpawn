import { InspectorOverlay } from '../../inspector/overlay.js';

let overlay: InspectorOverlay | null = null;

/** The palette reuses the overlay to drive its Inspect / Type / V / H rows. */
export const getInspector = () => overlay;

/**
 * Mount the inspector in the top frame only. Pages that already ship the
 * `inspector-ng` Angular overlay (`<inspector-overlay>`) keep it: two overlays
 * on one page would fight over the pointer and the shortcuts.
 */
export function initInspector() {
  if (window !== window.top) return null;
  if (document.querySelector('inspector-overlay')) return null;
  if (overlay) return overlay;

  overlay = new InspectorOverlay({ document, window });
  overlay.mount();
  return overlay;
}

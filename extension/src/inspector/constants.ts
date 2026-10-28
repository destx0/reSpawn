// Tuning values for the inspector overlay. The snap distance and hitbox come
// from inspector-ng (`constants.ts`); the colours follow the extension palette
// (`contentScript/checkpoints/palette.ts`) instead of inspector-ng's oklch set.

/** A guide snaps to another guide within this many pixels. */
export const GUIDE_SNAP_DISTANCE = 10;
/** How close the pointer has to be to grab an existing guide. */
export const GUIDE_HITBOX_SIZE = 14;
/** Rects smaller than this are not worth selecting. */
export const MIN_TARGET_SIZE = 2;
/** Cap for the typography overlay; scanning every leaf text node is expensive. */
export const TEXT_BLOCK_LIMIT = 160;

export const OVERLAY_HOST_ID = 'respawn-inspector-host';

/** Sits below the palette (2147483646) and the toast (2147483647). */
export const OVERLAY_Z_INDEX = '2147483645';

export const HIGHLIGHT_COLOR = '#2563eb';
export const GUIDE_COLOR = '#f59e0b';
export const MARGIN_COLOR = '#f59e0b';
export const PADDING_COLOR = '#10b981';
export const GAP_COLOR = '#8b5cf6';

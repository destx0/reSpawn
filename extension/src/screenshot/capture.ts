import { getAnnotations } from '../annotate/index.js';
import { renderAnnotations } from '../annotate/render.js';
import { showToast } from '../contentScript/checkpoints/toast.js';
import { getInspector } from '../contentScript/inspector/index.js';
import { openScreenshotEditor } from './editor.js';
import { requestCapture } from './messages.js';

const TOAST_HOST_ID = 'respawn-toast-host';
const INSPECTOR_HOST_ID = 'respawn-inspector-host';

const MAX_TILES = 40;
const MAX_DIMENSION = 32767;
const MAX_AREA = 268_000_000;
/** captureVisibleTab is limited to two calls per second. */
const MIN_CAPTURE_GAP = 550;
const SCROLL_SETTLE = 120;

type Tile = {
  readonly image: HTMLImageElement;
  readonly y: number;
};

type SavedVisibility = {
  readonly node: HTMLElement;
  readonly visibility: string;
  readonly priority: string;
};

class Cancelled extends Error {}

const waitForPaint = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const pageHeightOf = () =>
  Math.max(
    document.documentElement.scrollHeight,
    document.body?.scrollHeight ?? 0,
    window.innerHeight,
  );

let capturing = false;

/**
 * Full-page screenshot: scroll the window in viewport-sized steps, capture each
 * tile through the background, stitch them, then draw page annotations at their
 * document coordinates. Fixed and sticky elements are only kept in the first
 * tile so headers do not repeat.
 */
export async function captureFullPage() {
  if (capturing) return;
  capturing = true;

  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  const scrollBehavior = document.documentElement.style.scrollBehavior;
  document.documentElement.style.scrollBehavior = 'auto';

  const fixed = collectFixedElements();
  const restoreUi = hideUi();
  let hiddenFixed: SavedVisibility[] = [];
  let cancelled = false;

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    cancelled = true;
  };
  window.addEventListener('keydown', onKeyDown, true);

  let blob: Blob | null = null;
  let tileCount = 0;
  try {
    const { tiles, height, scale } = await collectTiles(
      pageHeightOf(),
      () => cancelled,
      () => {
        hiddenFixed = hideNodes(fixed);
      },
    );
    if (cancelled) return;
    tileCount = tiles.length;
    blob = await stitch(tiles, height, scale);
  } catch (error) {
    if (!cancelled && !(error instanceof Cancelled)) {
      showToast(
        error instanceof Error ? error.message : 'Screenshot failed.',
        'error',
      );
    }
  } finally {
    window.removeEventListener('keydown', onKeyDown, true);
    restoreNodes(hiddenFixed);
    window.scrollTo(scrollX, scrollY);
    document.documentElement.style.scrollBehavior = scrollBehavior;
    restoreUi();
    capturing = false;
  }

  if (blob && !cancelled) {
    openScreenshotEditor(blob);
    showToast(
      `Full page captured · ${tileCount} ${
        tileCount === 1 ? 'tile' : 'tiles'
      }`,
      'success',
    );
  }
}

function collectFixedElements() {
  const elements: HTMLElement[] = [];
  const nodes = document.body?.querySelectorAll<HTMLElement>('*');
  if (!nodes) return elements;
  for (const element of nodes) {
    if (element.id.startsWith('respawn-')) continue;
    const position = getComputedStyle(element).position;
    if (position !== 'fixed' && position !== 'sticky') continue;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (rect.bottom <= 0 || rect.top >= window.innerHeight) continue;
    elements.push(element);
  }
  return elements;
}

function hideNodes(nodes: HTMLElement[]): SavedVisibility[] {
  return nodes.map((node) => {
    const visibility = node.style.getPropertyValue('visibility');
    const priority = node.style.getPropertyPriority('visibility');
    node.style.setProperty('visibility', 'hidden', 'important');
    return { node, visibility, priority };
  });
}

function restoreNodes(saved: SavedVisibility[]) {
  for (const { node, visibility, priority } of saved) {
    if (visibility) node.style.setProperty('visibility', visibility, priority);
    else node.style.removeProperty('visibility');
  }
}

function hideUi() {
  getAnnotations().beginCapture();
  getInspector()?.setSuppressed(true);
  const saved: SavedVisibility[] = [];
  for (const id of [TOAST_HOST_ID, INSPECTOR_HOST_ID]) {
    const node = document.getElementById(id);
    if (!node) continue;
    saved.push({
      node,
      visibility: node.style.getPropertyValue('visibility'),
      priority: node.style.getPropertyPriority('visibility'),
    });
    node.style.setProperty('visibility', 'hidden', 'important');
  }
  return () => {
    restoreNodes(saved);
    getInspector()?.setSuppressed(getAnnotations().isActive);
    getAnnotations().endCapture();
  };
}

async function collectTiles(
  initialHeight: number,
  isCancelled: () => boolean,
  onFirstTile: () => void,
) {
  const tiles: Tile[] = [];
  const viewport = window.innerHeight;
  let pageHeight = Math.max(initialHeight, viewport);
  let y = 0;
  let scale = 1;
  let lastCapture = 0;

  for (let index = 0; index < MAX_TILES; index++) {
    if (isCancelled()) throw new Cancelled();
    window.scrollTo(0, y);
    await waitForPaint();
    await sleep(SCROLL_SETTLE);
    if (isCancelled()) throw new Cancelled();

    const wait = MIN_CAPTURE_GAP - (Date.now() - lastCapture);
    if (wait > 0) await sleep(wait);

    const actualY = window.scrollY;
    const response = await requestCapture();
    lastCapture = Date.now();
    if (!response.ok) throw new Error(response.error);

    const image = await loadImage(response.dataUrl);
    if (index === 0) {
      scale = image.naturalWidth / window.innerWidth;
      onFirstTile();
    }
    tiles.push({ image, y: actualY });

    pageHeight = Math.max(
      pageHeight,
      document.documentElement.scrollHeight,
      document.body?.scrollHeight ?? 0,
    );
    if (actualY + viewport >= pageHeight - 1) break;

    const maxScroll = Math.max(0, pageHeight - viewport);
    const next = Math.min(actualY + viewport, maxScroll);
    if (next <= actualY) break;
    y = next;
  }

  const covered = tiles.reduce(
    (bottom, tile) => Math.max(bottom, tile.y + window.innerHeight),
    viewport,
  );
  return {
    tiles,
    height: Math.min(pageHeight, covered),
    scale,
  };
}

function loadImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not read a capture tile.'));
    image.src = dataUrl;
  });
}

async function stitch(tiles: Tile[], pageHeight: number, captureScale: number) {
  const cssWidth = window.innerWidth;
  const cssHeight = Math.max(pageHeight, window.innerHeight);
  let outputScale = captureScale;
  outputScale = Math.min(outputScale, MAX_DIMENSION / cssHeight);
  outputScale = Math.min(
    outputScale,
    Math.sqrt(MAX_AREA / Math.max(1, cssWidth * cssHeight)),
  );
  outputScale = Math.max(0.01, outputScale);

  const width = Math.max(1, Math.round(cssWidth * outputScale));
  const height = Math.max(1, Math.round(cssHeight * outputScale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not build the full-page image.');

  for (const tile of tiles) {
    const w = tile.image.naturalWidth;
    const h = tile.image.naturalHeight;
    const dw = (w / captureScale) * outputScale;
    const dh = (h / captureScale) * outputScale;
    ctx.drawImage(
      tile.image,
      0,
      0,
      w,
      h,
      0,
      Math.round(tile.y * outputScale),
      dw,
      dh,
    );
  }

  const annotations = getAnnotations().annotations;
  if (annotations.length) {
    renderAnnotations(
      ctx,
      annotations,
      (point) => ({
        x: point.x * outputScale,
        y: point.y * outputScale,
      }),
      outputScale,
      null,
    );
  }

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png'),
  );
  if (!blob) throw new Error('Could not encode the full-page image.');
  return blob;
}

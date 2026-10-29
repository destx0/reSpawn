import {
  CheckpointMeta,
  formatRelativeTime,
  formatSize,
  fuzzyCheckpoints,
  isRouteQuery,
  resolveRouteForUrl,
} from '../../checkpoints/core.js';
import {
  ALL_SITES_KEY,
  downloadCheckpoint,
  readAllSites,
  readCheckpointFile,
  writeAllSites,
} from '../../checkpoints/files.js';
import {
  readSiteMappings,
  SITE_MAPPINGS_KEY,
} from '../../checkpoints/siteSettings.js';
import {
  sameSite,
  SiteMapping,
  translateUrl,
} from '../../checkpoints/sites.js';
import { requestCheckpoints } from '../../checkpoints/messages.js';
import { getAnnotations, toggleAnnotations } from '../../annotate/index.js';
import { captureRegion } from '../../screenshot/index.js';
import { getInspector } from '../inspector/index.js';
import { showToast } from './toast.js';

const HOST_ID = 'respawn-palette-host';
const INDEX_KEY = 'respawn:checkpoints:index';

type Item =
  | { readonly kind: 'go'; readonly query: string; readonly route: string }
  | { readonly kind: 'save'; readonly name: string }
  | { readonly kind: 'checkpoint'; readonly checkpoint: CheckpointMeta };

type InspectorTool = 'inspect' | 'typography' | 'vertical' | 'horizontal';

const INSPECTOR_TOOLS: ReadonlyArray<{
  readonly id: InspectorTool;
  readonly label: string;
  readonly hint: string;
}> = [
  { id: 'inspect', label: 'Inspect', hint: 'alt I · click an element' },
  { id: 'typography', label: 'Typography', hint: 'hover text to inspect' },
  { id: 'vertical', label: 'Vertical guides', hint: 'click to place' },
  { id: 'horizontal', label: 'Horizontal guides', hint: 'click to place' },
];

// Feather icons (MIT), inlined so the content script stays dependency-free.
const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICONS = {
  search: svg('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  globe: svg(
    '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  ),
  upload: svg(
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  ),
  camera: svg(
    '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  ),
  annotate: svg(
    '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  ),
  cursor: svg('<path d="m3 3 7.07 17 2.51-7.39L20 10.07z"/>'),
  type: svg('<path d="M4 7V4h16v3M9 20h6M12 4v16"/>'),
  vertical: svg('<path d="M12 4v16M8.5 4h7M8.5 20h7"/>'),
  horizontal: svg('<path d="M4 12h16M4 8.5v7M20 8.5v7"/>'),
  dots:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">' +
    '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>',
};

const TOOL_ICONS: Record<InspectorTool, string> = {
  inspect: ICONS.cursor,
  typography: ICONS.type,
  vertical: ICONS.vertical,
  horizontal: ICONS.horizontal,
};

const HINTS = [
  { keys: '↵', label: 'restore' },
  { keys: '⇧↵', label: 'go' },
  { keys: 'alt S', label: 'save' },
  { keys: 'alt A', label: 'all sites' },
  { keys: '/', label: 'route' },
  { keys: 'F2', label: 'rename' },
  { keys: '⇧⌫', label: 'delete' },
  { keys: 'alt E', label: 'export' },
] as const;
let nextHint = 0;

/** Alt+<letter> palette shortcuts, matched by `code` (macOS Option types symbols). */
function altKey(event: KeyboardEvent, code: string) {
  return (
    event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    event.code === code
  );
}

// Dark is the default. A host with data-theme="light" opts into the paper
// theme; the palette never follows the OS preference.
const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
.backdrop {
  --pal-bg: #1b1b1b;
  --pal-bar: #252525;
  --pal-dock: #141414;
  --pal-border: rgba(255, 255, 255, 0.14);
  --pal-border-strong: rgba(255, 255, 255, 0.22);
  --pal-text: #e8e8e8;
  --pal-strong: #fafafa;
  --pal-muted: #b4b4b4;
  --pal-faint: #8c8c8c;
  --pal-accent: #f2f2f2;
  --pal-accent-2: #ffffff;
  --pal-accent-soft: rgba(255, 255, 255, 0.09);
  --pal-accent-ring: rgba(255, 255, 255, 0.32);
  --pal-selected: #2a2a2a;
  --pal-hover: rgba(255, 255, 255, 0.05);
  --pal-shadow:
    0 28px 80px rgba(0, 0, 0, 0.55),
    0 3px 10px rgba(0, 0, 0, 0.3);
  --font-ui: 'Source Sans 3', 'Source Sans Pro', 'Segoe UI', system-ui, sans-serif;
  --font-mono: 'Source Code Pro', ui-monospace, SFMono-Regular, Menlo, monospace;
  position: fixed; inset: 0; z-index: 2147483646;
  display: flex; align-items: flex-start; justify-content: center;
  padding-top: min(16vh, 140px);
  background: rgb(0 0 0 / 0.38);
  color: var(--pal-text);
  color-scheme: dark;
  font-family: var(--font-ui);
  font-size: 12px;
  line-height: 1.35;
  animation: fade 120ms ease-out;
}
:host([data-theme='light']) .backdrop {
  --pal-bg: #f7f7f7;
  --pal-bar: #efefef;
  --pal-dock: #e9e9e9;
  --pal-border: rgba(0, 0, 0, 0.12);
  --pal-border-strong: rgba(0, 0, 0, 0.2);
  --pal-text: #3a3a3a;
  --pal-strong: #111111;
  --pal-muted: #5f5f5f;
  --pal-faint: #8a8a8a;
  --pal-accent: #111111;
  --pal-accent-2: #000000;
  --pal-accent-soft: rgba(0, 0, 0, 0.06);
  --pal-accent-ring: rgba(0, 0, 0, 0.28);
  --pal-selected: #ececec;
  --pal-hover: rgba(0, 0, 0, 0.04);
  --pal-shadow:
    0 28px 80px rgba(0, 0, 0, 0.18),
    0 3px 10px rgba(0, 0, 0, 0.08);
  color-scheme: light;
}
@keyframes fade { from { opacity: 0; } }
@keyframes paletteIn {
  from { opacity: 0; transform: translateY(-5px) scale(0.995); }
  to { opacity: 1; transform: none; }
}
svg { display: block; flex: none; }
.dialog {
  width: min(600px, calc(100vw - 32px));
  max-height: min(60vh, 440px);
  display: flex; flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--pal-border);
  border-radius: 11px;
  background: var(--pal-bg);
  color: var(--pal-text);
  box-shadow:
    var(--pal-shadow),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
  animation: paletteIn 180ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
}
.search {
  display: flex; align-items: center; gap: 7px;
  flex: none; height: 46px; padding: 0 9px 0 15px;
  border-bottom: 1px solid var(--pal-border);
  background: var(--pal-bar);
  color: var(--pal-faint);
  transition: box-shadow 120ms ease-out, color 120ms ease-out;
}
.search:focus-within {
  color: var(--pal-accent);
  box-shadow: inset 0 -1px 0 var(--pal-accent-ring);
}
.search > svg { width: 14px; height: 14px; }
.search input {
  flex: 1; min-width: 0; padding: 0;
  border: 0; outline: 0; background: transparent;
  color: var(--pal-strong);
  font-family: var(--font-ui);
  font-size: 13px; font-weight: 450; letter-spacing: 0.005em;
}
.search input::placeholder { color: var(--pal-faint); opacity: 0.92; }
.hint {
  display: inline-flex; align-items: center; gap: 4px;
  flex: none; color: var(--pal-faint);
  font-size: 8.5px; white-space: nowrap; opacity: 0.85;
  pointer-events: none;
}
.hint kbd {
  padding: 2px 3px;
  border: 1px solid var(--pal-border);
  border-radius: 3px;
  color: var(--pal-muted);
  font-family: var(--font-mono);
  font-size: 8px; line-height: 1;
}
.icon-btn {
  position: relative;
  display: grid; place-items: center;
  flex: none; width: 28px; height: 28px; padding: 0;
  border: 1px solid transparent; border-radius: 6px;
  background: transparent; color: var(--pal-faint);
  cursor: pointer;
  transition:
    background 120ms ease-out,
    color 120ms ease-out,
    border-color 120ms ease-out;
}
.icon-btn svg { width: 15px; height: 15px; }
.icon-btn:hover { background: var(--pal-hover); color: var(--pal-strong); }
.icon-btn.on {
  border-color: var(--pal-accent-ring);
  background: var(--pal-accent-soft);
  color: var(--pal-accent);
}
.icon-btn:focus-visible {
  outline: 2px solid var(--pal-accent);
  outline-offset: 2px;
}
.dot {
  position: absolute; top: 4px; right: 4px;
  width: 5px; height: 5px; border-radius: 50%;
  background: var(--pal-accent);
  box-shadow: 0 0 0 2px var(--pal-bar);
}
.list {
  flex: 1; min-height: 0;
  overflow-y: auto;
  margin: 0; padding: 5px 4px;
  list-style: none;
  scrollbar-width: thin;
  scrollbar-color: var(--pal-border) transparent;
}
.list::-webkit-scrollbar { width: 8px; }
.list::-webkit-scrollbar-thumb {
  border-radius: 4px;
  background: var(--pal-border);
}
.list:empty { display: none; }
.row {
  position: relative;
  display: flex; align-items: center; gap: 9px;
  min-height: 40px; margin: 1px; padding: 2px 10px 2px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 120ms ease-out, box-shadow 120ms ease-out;
}
.row:hover { background: var(--pal-hover); }
.row.active {
  background: var(--pal-selected);
  box-shadow: inset 0 0 0 1px var(--pal-accent-ring);
}
.main { display: flex; flex: 1; flex-direction: column; min-width: 0; }
.title {
  overflow: hidden;
  color: var(--pal-strong);
  font-size: 12.5px; font-weight: 600; letter-spacing: -0.005em;
  line-height: 1.35; text-overflow: ellipsis; white-space: nowrap;
}
.title.mono {
  font-family: var(--font-mono);
  font-size: 11.5px; font-weight: 500; letter-spacing: 0;
}
.sub {
  overflow: hidden;
  color: var(--pal-faint);
  font-size: 9.5px; line-height: 1.35;
  text-overflow: ellipsis; white-space: nowrap;
}
.sub.mono,
.sub .mono,
.sub .host { font-family: var(--font-mono); }
.sub .mono,
.sub .host { color: var(--pal-muted); }
.time {
  flex: none; margin-left: auto;
  color: var(--pal-faint);
  font-family: var(--font-mono);
  font-size: 9px; font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}
.row-more {
  display: grid; place-items: center;
  flex: none; width: 18px; height: 18px; padding: 0;
  border: 0; border-radius: 4px;
  background: transparent; color: var(--pal-faint);
  opacity: 0; cursor: pointer; transform: translateX(2px);
  transition:
    opacity 120ms ease-out,
    transform 120ms ease-out,
    background 120ms ease-out,
    color 120ms ease-out;
}
.row-more svg { width: 14px; height: 14px; }
.row:hover .row-more,
.row-more:focus-visible { opacity: 1; transform: none; }
.row-more:hover { background: var(--pal-hover); color: var(--pal-strong); }
.row-more:focus-visible {
  outline: 2px solid var(--pal-accent);
  outline-offset: 1px;
}
@media (hover: none) {
  .row-more { opacity: 1; transform: none; }
}
.rename {
  width: 100%; padding: 0;
  border: 0; border-bottom: 1px solid var(--pal-accent-ring);
  outline: 0; background: transparent;
  color: var(--pal-strong);
  font-family: var(--font-ui);
  font-size: 12.5px; font-weight: 600;
}
.empty {
  padding: 20px 12px;
  color: var(--pal-faint);
  font-size: 12px; text-align: center;
}
.error {
  padding: 8px 14px;
  border-top: 1px solid var(--pal-border);
  background: rgba(255, 255, 255, 0.04);
  color: var(--pal-strong);
  font-size: 11.5px;
}
.toolbar {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  flex: none; height: 46px; padding: 0 9px;
  border-top: 1px solid var(--pal-border);
  background: var(--pal-dock);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.035);
}
.tools { display: flex; gap: 4px; }
.divider {
  width: 1px; height: 18px; margin: 0 2px;
  background: var(--pal-border);
}
.dock-btn {
  display: grid; place-items: center;
  width: 30px; height: 28px; padding: 0;
  border: 1px solid transparent; border-radius: 6px;
  background: transparent; color: var(--pal-faint);
  cursor: pointer;
  transition:
    background 120ms ease-out,
    color 120ms ease-out,
    border-color 120ms ease-out;
}
.dock-btn svg { width: 15px; height: 15px; }
.dock-btn:hover { background: var(--pal-hover); color: var(--pal-strong); }
.dock-btn.on {
  border-color: var(--pal-accent-ring);
  background: var(--pal-accent-soft);
  color: var(--pal-accent);
}
.dock-btn.save {
  background: var(--pal-accent);
  color: var(--pal-bg);
}
.dock-btn.save:hover {
  background: var(--pal-accent-2);
  color: var(--pal-bg);
}
.dock-btn:focus-visible {
  outline: 2px solid var(--pal-accent);
  outline-offset: 2px;
}
.menu {
  position: fixed; z-index: 3;
  min-width: 150px; padding: 4px;
  border: 1px solid var(--pal-border-strong);
  border-radius: 8px;
  background: var(--pal-bar);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
  font-family: var(--font-ui);
}
.menu-item {
  display: flex; align-items: center;
  width: 100%; height: 28px; padding: 0 8px;
  border: 0; border-radius: 5px;
  background: transparent; color: var(--pal-text);
  font-family: var(--font-ui);
  font-size: 12px; text-align: left;
  cursor: pointer;
}
.menu-item:hover,
.menu-item:focus-visible {
  background: var(--pal-hover);
  color: var(--pal-strong);
  outline: none;
}
.menu-item.danger { color: var(--pal-strong); font-weight: 600; }
.menu-sep {
  display: block; height: 1px; margin: 4px 2px;
  background: var(--pal-border);
}
@media (max-width: 620px) {
  .hint { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .backdrop, .dialog { animation: none; }
  .search, .row, .row-more, .icon-btn, .dock-btn, .menu-item {
    transition: none;
  }
}
`;

class Palette {
  private host: HTMLElement | null = null;
  private backdrop!: HTMLDivElement;
  private input!: HTMLInputElement;
  private hint!: HTMLSpanElement;
  private list!: HTMLUListElement;
  private errorBox!: HTMLDivElement;
  private globeButton!: HTMLButtonElement;
  private fileInput!: HTMLInputElement;
  private annotateButton: HTMLButtonElement | null = null;
  private menu: HTMLDivElement | null = null;
  private menuAnchor: HTMLButtonElement | null = null;
  private menuPointerHandler: ((event: PointerEvent) => void) | null = null;
  private menuResizeHandler: (() => void) | null = null;
  private allCheckpoints: CheckpointMeta[] = [];
  private checkpoints: CheckpointMeta[] = [];
  private mappings: SiteMapping[] = [];
  private allSites = false;
  private items: Item[] = [];
  private active = 0;
  private renamingId: string | null = null;
  private confirmDeleteId: string | null = null;
  private busy = false;
  private previousFocus: Element | null = null;
  private readonly toolbarButtons = new Map<InspectorTool, HTMLButtonElement>();

  get isOpen() {
    return !!this.host;
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  open() {
    if (this.host) return;
    // The palette sits above the inspector; stop it from eating palette clicks.
    getInspector()?.setSuppressed(true);
    getAnnotations().setSuppressed(true);
    this.previousFocus = document.activeElement;
    this.host = document.createElement('div');
    this.host.id = HOST_ID;
    const root = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLE;

    const backdrop = document.createElement('div');
    backdrop.className = 'backdrop';
    this.backdrop = backdrop;
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) this.close();
    });

    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'reSpawn checkpoints');

    const search = document.createElement('div');
    search.className = 'search';
    search.innerHTML = ICONS.search;
    this.input = document.createElement('input');
    this.input.placeholder = 'Search checkpoints or /route';
    this.input.setAttribute('role', 'combobox');
    this.input.setAttribute('aria-controls', 'respawn-list');
    this.input.setAttribute('aria-expanded', 'true');
    this.input.spellcheck = false;
    this.input.autocomplete = 'off';
    this.input.addEventListener('input', () => {
      this.active = 0;
      this.confirmDeleteId = null;
      this.setError(null);
      this.render();
    });
    this.hint = document.createElement('span');
    this.hint.className = 'hint';
    this.hint.setAttribute('aria-hidden', 'true');
    this.globeButton = this.iconButton(
      ICONS.globe,
      'Show all sites (Alt+A)',
      'icon-btn tool globe',
      () => void this.toggleAllSites(),
    );
    this.globeButton.setAttribute('aria-pressed', 'false');
    search.append(this.input, this.hint, this.globeButton);

    this.errorBox = document.createElement('div');
    this.errorBox.className = 'error';
    this.errorBox.hidden = true;

    this.list = document.createElement('ul');
    this.list.className = 'list';
    this.list.id = 'respawn-list';
    this.list.setAttribute('role', 'listbox');
    this.list.addEventListener('scroll', () => this.closeMenu(), {
      passive: true,
    });

    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'application/json,.json';
    this.fileInput.hidden = true;
    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput.files?.[0];
      this.fileInput.value = '';
      if (file) void this.importFile(file);
    });

    const toolbar = this.buildToolbar();
    dialog.append(search, this.list, this.errorBox, toolbar);
    backdrop.append(dialog);
    root.append(style, backdrop);

    // Keep keystrokes away from the page's own shortcuts.
    for (const type of ['keydown', 'keyup', 'keypress'] as const) {
      this.host.addEventListener(type, (event) => event.stopPropagation());
    }
    this.host.addEventListener('keydown', (event) => {
      if (event.isTrusted) this.onKeyDown(event);
    });
    // The page can reach into the shadow root; ignore its synthetic clicks.
    root.addEventListener(
      'click',
      (event) => {
        if (!event.isTrusted) event.stopImmediatePropagation();
      },
      true,
    );

    document.documentElement.append(this.host);
    this.showHint();
    this.input.focus();
    this.render();
    void this.refresh();
    chrome.storage.onChanged.addListener(this.onStorageChanged);
  }

  close() {
    if (!this.host) return;
    this.closeMenu();
    chrome.storage.onChanged.removeListener(this.onStorageChanged);
    this.host.remove();
    this.host = null;
    this.renamingId = null;
    this.confirmDeleteId = null;
    getAnnotations().setSuppressed(false);
    getInspector()?.setSuppressed(getAnnotations().isActive);
    if (this.previousFocus instanceof HTMLElement) this.previousFocus.focus();
  }

  private showHint() {
    const hint = HINTS[nextHint++ % HINTS.length];
    this.hint.innerHTML = `<kbd>${hint.keys}</kbd><span>${hint.label}</span>`;
  }

  private onStorageChanged = (
    changes: { [key: string]: chrome.storage.StorageChange },
    area: string,
  ) => {
    if (
      (area === 'local' || area === 'sync') &&
      (changes[INDEX_KEY] ||
        changes[ALL_SITES_KEY] ||
        changes[SITE_MAPPINGS_KEY])
    ) {
      this.closeMenu();
      void this.refresh();
    }
  };

  private async refresh() {
    this.closeMenu();
    const [response, allSites, mappings] = await Promise.all([
      requestCheckpoints({ type: 'RESPAWN/LIST' }),
      readAllSites(),
      readSiteMappings(),
    ]);
    if (!this.host) return;
    if (!response.ok) {
      this.setError(response.error);
      return;
    }
    this.allSites = allSites;
    this.mappings = mappings;
    this.allCheckpoints = response.checkpoints;
    this.checkpoints = allSites
      ? response.checkpoints
      : response.checkpoints.filter((checkpoint) =>
          sameSite(checkpoint.url, location.href, mappings),
        );
    this.render();
  }

  private computeItems(): Item[] {
    const trimmed = this.input.value.trim();
    const items: Item[] = [];
    if (isRouteQuery(trimmed)) {
      let route: string | null = null;
      try {
        route = resolveRouteForUrl(trimmed, location.href);
      } catch {
        route = null;
      }
      if (route) items.push({ kind: 'go', query: trimmed, route });
    }
    for (const checkpoint of fuzzyCheckpoints(this.checkpoints, trimmed)) {
      items.push({ kind: 'checkpoint', checkpoint });
    }
    // Saving with a custom name only matters while typing one; the filled plus
    // in the toolbar saves with the automatic name.
    if (trimmed && !isRouteQuery(trimmed)) {
      items.push({ kind: 'save', name: trimmed });
    }
    return items;
  }

  private isToolActive(tool: InspectorTool) {
    const state = getInspector()?.state;
    if (!state) return false;
    switch (tool) {
      case 'inspect':
        return state.mode === 'select';
      case 'typography':
        return state.mode === 'typography';
      case 'vertical':
        return state.mode === 'guides' && state.orientation === 'vertical';
      case 'horizontal':
        return state.mode === 'guides' && state.orientation === 'horizontal';
    }
  }

  private buildToolbar() {
    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', 'Palette actions');

    const save = this.iconButton(
      ICONS.plus,
      'Save current state (Alt+S)',
      'dock-btn save',
      () => void this.run({ kind: 'save', name: '' }, false),
    );
    const divider = document.createElement('span');
    divider.className = 'divider';

    const hasInspector = !!getInspector();
    const tools = document.createElement('div');
    tools.className = 'tools';
    tools.hidden = !hasInspector;
    for (const tool of INSPECTOR_TOOLS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'dock-btn tool-btn';
      button.dataset.tool = tool.id;
      button.title = `${tool.label} — ${tool.hint}`;
      button.setAttribute('aria-label', tool.label);
      button.innerHTML = TOOL_ICONS[tool.id];
      button.addEventListener('click', () => this.runTool(tool.id));
      this.toolbarButtons.set(tool.id, button);
      tools.append(button);
    }

    const toolsDivider = document.createElement('span');
    toolsDivider.className = 'divider';
    toolsDivider.hidden = !hasInspector;

    const camera = this.iconButton(
      ICONS.camera,
      'Screenshot',
      'dock-btn',
      () => {
        this.close();
        void captureRegion();
      },
    );
    this.annotateButton = this.iconButton(
      ICONS.annotate,
      'Annotate',
      'dock-btn annotate',
      () => {
        this.close();
        toggleAnnotations();
      },
    );
    this.annotateButton.setAttribute('aria-pressed', 'false');

    const actionDivider = document.createElement('span');
    actionDivider.className = 'divider';
    const importButton = this.iconButton(
      ICONS.upload,
      'Import JSON',
      'dock-btn',
      () => this.fileInput.click(),
    );

    toolbar.append(
      save,
      divider,
      tools,
      toolsDivider,
      camera,
      this.annotateButton,
      actionDivider,
      importButton,
      this.fileInput,
    );
    return toolbar;
  }

  private renderToolbar() {
    for (const [id, button] of this.toolbarButtons) {
      const active = this.isToolActive(id);
      button.classList.toggle('on', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }

  private render() {
    if (!this.host) return;
    this.hint.hidden = this.input.value.length > 0;
    this.renderGlobe();
    this.renderToolbar();
    const annotationsActive = getAnnotations().isActive;
    this.annotateButton?.classList.toggle('on', annotationsActive);
    this.annotateButton?.setAttribute(
      'aria-pressed',
      String(annotationsActive),
    );
    this.items = this.computeItems();
    if (this.active >= this.items.length) this.active = this.items.length - 1;
    if (this.active < 0) this.active = 0;

    const rows = this.items.map((item, index) => this.renderRow(item, index));
    if (!rows.length) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.setAttribute('role', 'presentation');
      empty.textContent = this.input.value.trim()
        ? 'No matches'
        : this.allCheckpoints.length
          ? 'No checkpoints for this site · Alt+A shows all'
          : 'No checkpoints yet';
      rows.push(empty);
    }
    this.list.replaceChildren(...rows);
    const activeRow = this.list.querySelector('.row.active');
    activeRow?.scrollIntoView({ block: 'nearest' });
    if (activeRow) {
      this.input.setAttribute('aria-activedescendant', activeRow.id);
    } else {
      this.input.removeAttribute('aria-activedescendant');
    }
    const renameInput = this.list.querySelector<HTMLInputElement>('.rename');
    if (renameInput && this.host.shadowRoot!.activeElement !== renameInput) {
      renameInput.focus();
      renameInput.select();
    }
  }

  private renderRow(item: Item, index: number): HTMLLIElement {
    const row = document.createElement('li');
    row.className = `row${index === this.active ? ' active' : ''}`;
    row.id = `respawn-item-${index}`;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(index === this.active));
    row.addEventListener('mouseenter', () => {
      if (this.menu) return;
      if (this.active !== index) {
        this.active = index;
        this.render();
      }
    });
    row.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('.row-more, .rename')) return;
      this.active = index;
      void this.run(item, event.shiftKey);
    });

    const main = document.createElement('div');
    main.className = 'main';
    const title = document.createElement('div');
    title.className = 'title';
    const sub = document.createElement('div');
    sub.className = 'sub';
    main.append(title, sub);
    row.append(main);

    if (item.kind === 'go') {
      title.textContent = item.route;
      title.classList.add('mono');
      sub.textContent = 'go, keep state';
    } else if (item.kind === 'save') {
      title.textContent = item.name ? `Save “${item.name}”` : 'Save checkpoint';
      sub.textContent = `${location.pathname}${location.search}${location.hash}`;
      sub.classList.add('mono');
    } else {
      const { checkpoint } = item;
      if (this.renamingId === checkpoint.id) {
        const rename = document.createElement('input');
        rename.className = 'rename';
        rename.value = checkpoint.name;
        rename.addEventListener('keydown', (event) => {
          event.stopPropagation();
          if (!event.isTrusted || event.isComposing) return;
          if (event.key === 'Enter') {
            event.preventDefault();
            void this.rename(checkpoint.id, rename.value);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            this.renamingId = null;
            this.render();
            this.input.focus();
          }
        });
        main.replaceChildren(rename);
        row.dataset.id = checkpoint.id;
        return row;
      }

      const translated = translateUrl(
        checkpoint.url,
        location.href,
        this.mappings,
      );
      const route = translated?.route ?? checkpoint.route;
      title.textContent = checkpoint.name;
      if (checkpoint.name === route) title.classList.add('mono');
      const host = new URL(checkpoint.origin).host;
      const crossSite = !translated && checkpoint.origin !== location.origin;
      if (crossSite) {
        const hostEl = document.createElement('span');
        hostEl.className = 'host';
        hostEl.textContent = host;
        const routeEl = document.createElement('span');
        routeEl.className = 'mono';
        routeEl.textContent = ` ${route}`;
        sub.append(hostEl, routeEl);
      } else if (checkpoint.name === route) {
        sub.textContent = formatSize(checkpoint.size);
      } else {
        sub.textContent = route;
        sub.classList.add('mono');
      }

      const time = document.createElement('span');
      time.className = 'time';
      time.textContent = formatRelativeTime(
        checkpoint.lastUsedAt ?? checkpoint.createdAt,
      );
      const more = this.rowMoreButton(checkpoint.id);
      row.dataset.id = checkpoint.id;
      row.append(time, more);
    }
    return row;
  }

  private iconButton(
    icon: string,
    label: string,
    className: string,
    onClick: () => void,
  ) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.innerHTML = icon;
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  private rowMoreButton(id: string) {
    const button = this.iconButton(
      ICONS.dots,
      'More actions',
      'row-more',
      () => this.openMenuForId(id),
    );
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    return button;
  }

  private renderGlobe() {
    const others = this.allCheckpoints.filter(
      (checkpoint) => !sameSite(checkpoint.url, location.href, this.mappings),
    ).length;
    const label = this.allSites
      ? 'Showing all sites (Alt+A)'
      : 'Show all sites (Alt+A)';
    this.globeButton.title = label;
    this.globeButton.setAttribute('aria-label', label);
    this.globeButton.setAttribute('aria-pressed', String(this.allSites));
    this.globeButton.classList.toggle('on', this.allSites);
    this.globeButton.innerHTML = ICONS.globe;
    if (!this.allSites && others > 0) {
      const dot = document.createElement('span');
      dot.className = 'dot';
      this.globeButton.append(dot);
    }
  }

  private openMenuForId(id: string, focusLast = false) {
    const checkpoint =
      this.checkpoints.find((item) => item.id === id) ??
      this.allCheckpoints.find((item) => item.id === id);
    if (!checkpoint) return;
    const anchor = this.list.querySelector<HTMLButtonElement>(
      `.row[data-id="${CSS.escape(id)}"] .row-more`,
    );
    if (anchor) this.openMenu(checkpoint, anchor, focusLast);
  }

  private openMenu(
    checkpoint: CheckpointMeta,
    anchor: HTMLButtonElement,
    focusLast: boolean,
  ) {
    this.closeMenu();
    const menu = document.createElement('div');
    menu.className = 'menu';
    menu.setAttribute('role', 'menu');

    const confirming = this.confirmDeleteId === checkpoint.id;
    const addItem = (label: string, action: () => void, className = '') => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `menu-item ${className}`.trim();
      button.setAttribute('role', 'menuitem');
      button.textContent = label;
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        action();
      });
      menu.append(button);
    };

    addItem('Export JSON', () => {
      this.closeMenu(false);
      void this.exportCheckpoint(checkpoint);
    });
    addItem('Rename', () => {
      this.closeMenu(false);
      this.renamingId = checkpoint.id;
      this.render();
    });
    const separator = document.createElement('span');
    separator.className = 'menu-sep';
    menu.append(separator);
    addItem(
      confirming ? 'Confirm delete' : 'Delete',
      () => {
        if (!confirming) {
          this.confirmDeleteId = checkpoint.id;
          this.closeMenu(false);
          this.render();
          this.openMenuForId(checkpoint.id, true);
          return;
        }
        this.closeMenu(false);
        void this.requestDelete(checkpoint.id);
      },
      'danger',
    );

    this.menu = menu;
    this.menuAnchor = anchor;
    anchor.setAttribute('aria-expanded', 'true');
    this.backdrop.append(menu);
    this.positionMenu(menu, anchor);

    this.menuPointerHandler = (event: PointerEvent) => {
      const path = event.composedPath();
      if (!path.includes(menu) && !path.includes(anchor)) this.closeMenu();
    };
    this.backdrop.addEventListener(
      'pointerdown',
      this.menuPointerHandler,
      true,
    );
    this.menuResizeHandler = () => this.closeMenu();
    window.addEventListener('resize', this.menuResizeHandler);
    menu.addEventListener('keydown', this.onMenuKeyDown);

    const items = Array.from(
      menu.querySelectorAll<HTMLButtonElement>('.menu-item'),
    );
    const target = focusLast ? items[items.length - 1] : items[0];
    target?.focus();
  }

  private positionMenu(menu: HTMLElement, anchor: HTMLElement) {
    const rect = anchor.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const gap = 4;
    let top = rect.bottom + gap;
    if (top + menuRect.height > window.innerHeight - 8) {
      top = rect.top - menuRect.height - gap;
    }
    const right = Math.max(8, window.innerWidth - rect.right);
    menu.style.top = `${Math.max(8, top)}px`;
    menu.style.right = `${right}px`;
  }

  private onMenuKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.closeMenu(true);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      const items = this.menu
        ? Array.from(this.menu.querySelectorAll<HTMLButtonElement>('.menu-item'))
        : [];
      if (!items.length) return;
      const active = this.host?.shadowRoot?.activeElement as
        | HTMLButtonElement
        | null;
      const index = active ? items.indexOf(active) : -1;
      const next =
        event.key === 'ArrowDown'
          ? (index + 1) % items.length
          : (index - 1 + items.length) % items.length;
      items[next].focus();
      return;
    }
    if (event.key === 'Tab') this.closeMenu(false);
  };

  private closeMenu(restoreFocus = false) {
    const menu = this.menu;
    const anchor = this.menuAnchor;
    if (menu) {
      menu.removeEventListener('keydown', this.onMenuKeyDown);
      menu.remove();
    }
    if (this.menuPointerHandler) {
      this.backdrop.removeEventListener(
        'pointerdown',
        this.menuPointerHandler,
        true,
      );
      this.menuPointerHandler = null;
    }
    if (this.menuResizeHandler) {
      window.removeEventListener('resize', this.menuResizeHandler);
      this.menuResizeHandler = null;
    }
    this.menu = null;
    this.menuAnchor = null;
    if (anchor) {
      anchor.setAttribute('aria-expanded', 'false');
      if (restoreFocus && anchor.isConnected) anchor.focus();
    }
  }

  private onKeyDown(event: KeyboardEvent) {
    if (this.renamingId || event.isComposing) return;
    const target = event.composedPath()[0] as HTMLElement | null;
    if (target?.closest?.('.menu')) return;
    // Buttons handle their own Enter/Space; keep Escape working.
    if (target?.closest?.('button') && event.key !== 'Escape') return;
    if (this.menu && event.key === 'Escape') {
      event.preventDefault();
      this.closeMenu(true);
      return;
    }
    const item = this.items[this.active];
    if (altKey(event, 'KeyA')) {
      event.preventDefault();
      void this.toggleAllSites();
      return;
    }
    if (altKey(event, 'KeyE')) {
      event.preventDefault();
      if (item?.kind === 'checkpoint')
        void this.exportCheckpoint(item.checkpoint);
      return;
    }
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        if (this.confirmDeleteId) {
          this.confirmDeleteId = null;
          this.render();
        } else {
          this.close();
        }
        return;
      case 'ArrowDown':
        event.preventDefault();
        this.active = Math.min(this.active + 1, this.items.length - 1);
        this.confirmDeleteId = null;
        this.render();
        return;
      case 'ArrowUp':
        event.preventDefault();
        this.active = Math.max(this.active - 1, 0);
        this.confirmDeleteId = null;
        this.render();
        return;
      case 'Enter':
        event.preventDefault();
        if (item) void this.run(item, event.shiftKey);
        return;
      case 'F2':
        if (item?.kind === 'checkpoint') {
          event.preventDefault();
          this.renamingId = item.checkpoint.id;
          this.render();
        }
        return;
      case 'Delete':
        if (item?.kind === 'checkpoint' && event.shiftKey) {
          event.preventDefault();
          this.confirmDeleteId = item.checkpoint.id;
          this.render();
          this.openMenuForId(item.checkpoint.id, true);
        }
        return;
    }
    // Alt+S / Alt+P are handled by the global hotkey listener.
  }

  private async run(item: Item, shift: boolean) {
    if (this.busy) return;
    this.busy = true;
    this.setError(null);
    try {
      let response;
      if (item.kind === 'go') {
        response = await requestCheckpoints({
          type: 'RESPAWN/NAVIGATE',
          route: item.query,
        });
      } else if (item.kind === 'save') {
        response = await requestCheckpoints({
          type: 'RESPAWN/SAVE',
          name: item.name || undefined,
        });
      } else if (shift) {
        const translated = translateUrl(
          item.checkpoint.url,
          location.href,
          this.mappings,
        );
        response = await requestCheckpoints({
          type: 'RESPAWN/NAVIGATE',
          route: translated?.route ?? item.checkpoint.route,
        });
      } else {
        response = await requestCheckpoints({
          type: 'RESPAWN/RESTORE',
          id: item.checkpoint.id,
        });
      }
      if (response.ok) this.close();
      else this.setError(response.error);
    } finally {
      this.busy = false;
    }
  }

  private runTool(tool: InspectorTool) {
    const inspector = getInspector();
    if (!inspector) return;
    this.close();
    switch (tool) {
      case 'inspect':
        inspector.toggleMode('select');
        break;
      case 'typography':
        inspector.toggleMode('typography');
        break;
      case 'vertical':
        inspector.setOrientation('vertical');
        break;
      case 'horizontal':
        inspector.setOrientation('horizontal');
        break;
    }
  }

  private async toggleAllSites() {
    this.active = 0;
    // The storage listener re-renders with the new list.
    await writeAllSites(!this.allSites);
  }

  private async importFile(file: File) {
    this.setError(null);
    let data: unknown;
    try {
      data = await readCheckpointFile(file);
    } catch (error) {
      this.setError((error as Error).message);
      return;
    }
    const response = await requestCheckpoints({
      type: 'RESPAWN/IMPORT',
      data,
      origin: location.origin,
    });
    this.input.focus();
    if (!response.ok) {
      this.setError(response.error);
      return;
    }
    showToast(`Imported “${response.checkpoint.name}”`, 'success');
  }

  private async exportCheckpoint(checkpoint: CheckpointMeta) {
    this.setError(null);
    const response = await requestCheckpoints({
      type: 'RESPAWN/EXPORT',
      id: checkpoint.id,
    });
    if (!response.ok) {
      this.setError(response.error);
      return;
    }
    downloadCheckpoint(response.record);
    showToast(`Exported “${checkpoint.name}”`, 'success');
  }

  private async rename(id: string, name: string) {
    const response = await requestCheckpoints({
      type: 'RESPAWN/RENAME',
      id,
      name,
    });
    if (!response.ok) {
      this.setError(response.error);
      return;
    }
    this.renamingId = null;
    this.input.focus();
    await this.refresh();
  }

  private async requestDelete(id: string) {
    if (this.confirmDeleteId !== id) {
      this.confirmDeleteId = id;
      this.render();
      return;
    }
    this.confirmDeleteId = null;
    this.closeMenu();
    const response = await requestCheckpoints({ type: 'RESPAWN/DELETE', id });
    if (!response.ok) this.setError(response.error);
    this.input.focus();
    await this.refresh();
  }

  private setError(message: string | null) {
    if (!this.host) return;
    this.errorBox.hidden = !message;
    this.errorBox.textContent = message ?? '';
  }
}

export const palette = new Palette();

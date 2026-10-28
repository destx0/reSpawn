import {
  CheckpointMeta,
  formatRelativeTime,
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
import { getInspector } from '../inspector/index.js';
import { showToast } from './toast.js';

const HOST_ID = 'respawn-palette-host';
const INDEX_KEY = 'respawn:checkpoints:index';

type Item =
  | { readonly kind: 'go'; readonly query: string; readonly route: string }
  | { readonly kind: 'save'; readonly name: string }
  | { readonly kind: 'checkpoint'; readonly checkpoint: CheckpointMeta }
  | { readonly kind: 'tool'; readonly tool: InspectorTool };

type InspectorTool = 'inspect' | 'type' | 'vertical' | 'horizontal';

const INSPECTOR_TOOLS: ReadonlyArray<{
  readonly id: InspectorTool;
  readonly label: string;
  readonly hint: string;
  readonly keywords: string;
}> = [
  {
    id: 'inspect',
    label: 'Inspect',
    hint: 'alt I · click an element',
    keywords: 'inspect select element pointer measure distance',
  },
  {
    id: 'type',
    label: 'Type',
    hint: 'typography overlay',
    keywords: 'type typography text font size colour color',
  },
  {
    id: 'vertical',
    label: 'Vertical guides',
    hint: 'click to place',
    keywords: 'vertical guide guides alignment spacing',
  },
  {
    id: 'horizontal',
    label: 'Horizontal guides',
    hint: 'click to place',
    keywords: 'horizontal guide guides alignment spacing',
  },
];

const matchesTool = (
  query: string,
  tool: (typeof INSPECTOR_TOOLS)[number],
) => {
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = `${tool.label} ${tool.hint} ${tool.keywords}`.toLocaleLowerCase();
  return terms.every((term) => haystack.includes(term));
};

// Feather icons (MIT), inlined so the content script stays dependency-free.
const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICONS = {
  search: svg('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>'),
  bookmark: svg('<path d="m19 21-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  arrow: svg('<path d="M5 12h14M12 5l7 7-7 7"/>'),
  edit: svg('<path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>'),
  trash: svg(
    '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  ),
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
  globe: svg(
    '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  ),
  upload: svg(
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  ),
  download: svg(
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  ),
  cursor: svg('<path d="m3 3 7.07 17 2.51-7.39L20 10.07z"/>'),
  type: svg('<path d="M4 7V4h16v3M9 20h6M12 4v16"/>'),
  vertical: svg('<path d="M12 3v18"/>'),
  horizontal: svg('<path d="M3 12h18"/>'),
};

const TOOL_ICONS: Record<InspectorTool, string> = {
  inspect: ICONS.cursor,
  type: ICONS.type,
  vertical: ICONS.vertical,
  horizontal: ICONS.horizontal,
};

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

const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; }
.backdrop {
  --bg: #ffffff; --fg: #18181b; --muted: #71717a; --faint: #a1a1aa;
  --line: #e4e4e7; --hover: #f4f4f5; --active: #f4f4f5;
  --accent: #2563eb; --danger: #dc2626;
  position: fixed; inset: 0; z-index: 2147483646;
  display: flex; align-items: flex-start; justify-content: center;
  padding-top: min(16vh, 140px);
  background: rgb(0 0 0 / 0.2);
  font: 13px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif;
  color: var(--fg);
  animation: fade 120ms ease-out;
}
@media (prefers-color-scheme: dark) {
  .backdrop {
    --bg: #18181b; --fg: #f4f4f5; --muted: #a1a1aa; --faint: #71717a;
    --line: #27272a; --hover: #232326; --active: #27272a;
    --accent: #60a5fa; --danger: #f87171;
    background: rgb(0 0 0 / 0.45);
  }
}
@keyframes fade { from { opacity: 0; } }
@keyframes rise { from { opacity: 0; transform: translateY(-4px) scale(0.99); } }
svg { display: block; flex: none; }
.dialog {
  width: min(560px, calc(100vw - 32px));
  max-height: min(60vh, 480px);
  display: flex; flex-direction: column;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: 0 16px 48px rgb(0 0 0 / 0.22), 0 2px 6px rgb(0 0 0 / 0.08);
  overflow: hidden;
  animation: rise 140ms ease-out;
}
.search {
  display: flex; align-items: center; gap: 10px;
  padding: 0 16px; height: 48px; color: var(--faint);
}
input {
  flex: 1; min-width: 0; border: 0; outline: 0; background: transparent;
  font: inherit; font-size: 15px; color: var(--fg);
}
input::placeholder { color: var(--faint); }
.list {
  overflow-y: auto; padding: 4px 6px 6px; margin: 0; list-style: none;
  border-top: 1px solid var(--line);
}
.list:empty { display: none; }
.row {
  display: flex; align-items: center; gap: 12px;
  height: 42px; padding: 0 10px; border-radius: 8px; cursor: pointer;
}
.row.active { background: var(--active); }
.row.on .title { color: var(--accent); }
.row.on > svg { color: var(--accent); }
.row > svg { color: var(--faint); }
.row.active > svg { color: var(--accent); }
.main { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 10px; }
.title {
  flex: none; max-width: 60%;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.sub {
  flex: 1; min-width: 0;
  color: var(--faint); font-size: 12px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
}
.meta { color: var(--faint); font-size: 12px; flex: none; }
.btn {
  display: none; place-items: center;
  width: 26px; height: 26px; padding: 0; border: 0; border-radius: 6px;
  background: transparent; color: var(--muted); cursor: pointer;
}
.row.active .btn, .btn.confirm, .btn.tool { display: grid; }
.btn.tool { position: relative; color: var(--faint); }
.btn.tool.on { color: var(--accent); }
.badge {
  position: absolute; top: -2px; right: -4px;
  min-width: 14px; height: 14px; padding: 0 3px; border-radius: 7px;
  background: var(--accent); color: var(--bg);
  font-size: 9.5px; font-weight: 600; line-height: 14px; text-align: center;
}
.row.active .meta { display: none; }
.btn:hover { color: var(--fg); background: var(--line); }
.btn.confirm, .btn.confirm:hover { color: var(--danger); }
.rename {
  flex: 1; font-size: 13px; padding: 0;
  border: 0; border-bottom: 1px solid var(--accent);
}
.empty { padding: 20px 14px; color: var(--faint); text-align: center; }
.error {
  padding: 8px 16px; font-size: 12px; color: var(--danger);
  border-top: 1px solid var(--line);
}
.footer {
  display: flex; gap: 14px; justify-content: flex-end;
  padding: 7px 14px; border-top: 1px solid var(--line);
  color: var(--faint); font-size: 11px;
}
kbd {
  font: inherit; font-size: 10.5px; padding: 0 4px; margin-right: 3px;
  border-radius: 4px; border: 1px solid var(--line);
}
`;

class Palette {
  private host: HTMLElement | null = null;
  private input!: HTMLInputElement;
  private list!: HTMLUListElement;
  private errorBox!: HTMLDivElement;
  private globeButton!: HTMLButtonElement;
  private fileInput!: HTMLInputElement;
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
    this.previousFocus = document.activeElement;
    this.host = document.createElement('div');
    this.host.id = HOST_ID;
    const root = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLE;

    const backdrop = document.createElement('div');
    backdrop.className = 'backdrop';
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
    this.input.placeholder = 'Search checkpoints or go to /route';
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
    this.globeButton = this.button(
      ICONS.globe,
      '',
      () => void this.toggleAllSites(),
    );
    this.globeButton.classList.add('tool');
    const importButton = this.button(ICONS.upload, 'Import JSON', () =>
      this.fileInput.click(),
    );
    importButton.classList.add('tool');
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'application/json,.json';
    this.fileInput.hidden = true;
    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput.files?.[0];
      this.fileInput.value = '';
      if (file) void this.importFile(file);
    });
    search.append(this.input, this.globeButton, importButton, this.fileInput);

    this.errorBox = document.createElement('div');
    this.errorBox.className = 'error';
    this.errorBox.hidden = true;

    this.list = document.createElement('ul');
    this.list.className = 'list';
    this.list.id = 'respawn-list';
    this.list.setAttribute('role', 'listbox');

    const footer = document.createElement('div');
    footer.className = 'footer';
    footer.innerHTML =
      '<span><kbd>↵</kbd>restore</span>' +
      '<span><kbd>⇧↵</kbd>go</span>' +
      '<span><kbd>alt A</kbd>all sites</span>' +
      '<span><kbd>esc</kbd>close</span>';

    dialog.append(search, this.list, this.errorBox, footer);
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
    this.input.focus();
    this.render();
    void this.refresh();
    chrome.storage.onChanged.addListener(this.onStorageChanged);
  }

  close() {
    if (!this.host) return;
    chrome.storage.onChanged.removeListener(this.onStorageChanged);
    this.host.remove();
    this.host = null;
    this.renamingId = null;
    this.confirmDeleteId = null;
    getInspector()?.setSuppressed(false);
    if (this.previousFocus instanceof HTMLElement) this.previousFocus.focus();
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
      void this.refresh();
    }
  };

  private async refresh() {
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
    const query = this.input.value;
    const trimmed = query.trim();
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
    if (!isRouteQuery(trimmed)) {
      items.push({ kind: 'save', name: trimmed });
    }
    // Tool rows only exist when the inspector could mount (the page may ship
    // its own `inspector-overlay`, in which case we leave it alone).
    if (getInspector()) {
      for (const tool of INSPECTOR_TOOLS) {
        if (matchesTool(trimmed, tool)) items.push({ kind: 'tool', tool: tool.id });
      }
    }
    return items;
  }

  private isToolActive(tool: InspectorTool) {
    const state = getInspector()?.state;
    if (!state) return false;
    switch (tool) {
      case 'inspect':
        return state.mode === 'select';
      case 'type':
        return state.typography;
      case 'vertical':
        return state.mode === 'guides' && state.orientation === 'vertical';
      case 'horizontal':
        return state.mode === 'guides' && state.orientation === 'horizontal';
    }
  }

  private render() {
    if (!this.host) return;
    this.renderGlobe();
    this.items = this.computeItems();
    if (this.active >= this.items.length) this.active = this.items.length - 1;
    if (this.active < 0) this.active = 0;

    const rows = this.items.map((item, index) => this.renderRow(item, index));
    if (!this.checkpoints.length && !this.input.value.trim()) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = this.allCheckpoints.length
        ? 'No checkpoints for this site · Alt+A shows all'
        : 'No checkpoints yet';
      rows.unshift(empty);
    }
    this.list.replaceChildren(...rows);
    const activeRow = this.list.querySelector('.row.active');
    activeRow?.scrollIntoView({ block: 'nearest' });
    if (activeRow) {
      this.input.setAttribute('aria-activedescendant', activeRow.id);
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
    row.addEventListener('mousemove', () => {
      if (this.active !== index) {
        this.active = index;
        this.render();
      }
    });
    row.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('.btn, .rename')) return;
      this.active = index;
      void this.run(item, event.shiftKey);
    });

    const main = document.createElement('div');
    main.className = 'main';
    const title = document.createElement('span');
    title.className = 'title';
    const sub = document.createElement('span');
    sub.className = 'sub';
    main.append(title, sub);
    const icon =
      item.kind === 'go'
        ? ICONS.arrow
        : item.kind === 'save'
          ? ICONS.plus
          : item.kind === 'tool'
            ? TOOL_ICONS[item.tool]
            : ICONS.bookmark;
    row.innerHTML = icon;
    row.append(main);

    if (item.kind === 'tool') {
      const tool = INSPECTOR_TOOLS.find((entry) => entry.id === item.tool);
      title.textContent = tool?.label ?? item.tool;
      sub.textContent = tool?.hint ?? '';
      if (this.isToolActive(item.tool)) row.classList.add('on');
    } else if (item.kind === 'go') {
      title.textContent = item.route;
      sub.textContent = 'go, keep state';
    } else if (item.kind === 'save') {
      title.textContent = item.name ? `Save “${item.name}”` : 'Save checkpoint';
      sub.textContent = `${location.pathname}${location.search}${location.hash}`;
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
      } else {
        const translated = translateUrl(
          checkpoint.url,
          location.href,
          this.mappings,
        );
        const route = translated?.route ?? checkpoint.route;
        title.textContent = checkpoint.name;
        const host =
          translated || checkpoint.origin === location.origin
            ? ''
            : new URL(checkpoint.origin).host;
        sub.textContent = checkpoint.name === route ? host : `${host}${route}`;
      }
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = formatRelativeTime(
        checkpoint.lastUsedAt ?? checkpoint.createdAt,
      );
      const exportButton = this.button(
        ICONS.download,
        'Export JSON (Alt+E)',
        () => void this.exportCheckpoint(checkpoint),
      );
      const renameButton = this.button(ICONS.edit, 'Rename (F2)', () => {
        this.renamingId = checkpoint.id;
        this.render();
      });
      const confirming = this.confirmDeleteId === checkpoint.id;
      const deleteButton = this.button(
        confirming ? ICONS.check : ICONS.trash,
        confirming ? 'Click again to delete' : 'Delete (Shift+Del)',
        () => void this.requestDelete(checkpoint.id),
      );
      deleteButton.classList.add('delete');
      if (confirming) deleteButton.classList.add('confirm');
      row.append(meta, exportButton, renameButton, deleteButton);
    }
    return row;
  }

  private button(icon: string, label: string, onClick: () => void) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.innerHTML = icon;
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      onClick();
    });
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
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = String(others);
      this.globeButton.append(badge);
    }
  }

  private onKeyDown(event: KeyboardEvent) {
    if (this.renamingId || event.isComposing) return;
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
          void this.requestDelete(item.checkpoint.id);
        }
        return;
    }
    // Alt+S / Alt+P are handled by the global hotkey listener.
  }

  private async run(item: Item, shift: boolean) {
    if (item.kind === 'tool') {
      this.runTool(item.tool);
      return;
    }
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
      case 'type':
        inspector.toggleTypography();
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

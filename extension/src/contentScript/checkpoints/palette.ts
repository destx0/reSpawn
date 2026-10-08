import {
  CheckpointMeta,
  formatRelativeTime,
  fuzzyCheckpoints,
  isRouteQuery,
  resolveRouteForUrl,
} from '../../checkpoints/core.js';
import { requestCheckpoints } from '../../checkpoints/messages.js';

const HOST_ID = 'respawn-palette-host';
const INDEX_KEY = 'respawn:checkpoints:index';

type Item =
  | { readonly kind: 'go'; readonly query: string; readonly route: string }
  | { readonly kind: 'save'; readonly name: string }
  | { readonly kind: 'checkpoint'; readonly checkpoint: CheckpointMeta };

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
};

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
.row.active .btn, .btn.confirm { display: grid; }
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
  private checkpoints: CheckpointMeta[] = [];
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
    search.append(this.input);

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
    if (this.previousFocus instanceof HTMLElement) this.previousFocus.focus();
  }

  private onStorageChanged = (
    changes: { [key: string]: chrome.storage.StorageChange },
    area: string,
  ) => {
    if (area === 'local' && changes[INDEX_KEY]) void this.refresh();
  };

  private async refresh() {
    const response = await requestCheckpoints({ type: 'RESPAWN/LIST' });
    if (!this.host) return;
    if (!response.ok) {
      this.setError(response.error);
      return;
    }
    this.checkpoints = response.checkpoints.filter(
      (checkpoint) => checkpoint.origin === location.origin,
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
    return items;
  }

  private render() {
    if (!this.host) return;
    this.items = this.computeItems();
    if (this.active >= this.items.length) this.active = this.items.length - 1;
    if (this.active < 0) this.active = 0;

    const rows = this.items.map((item, index) => this.renderRow(item, index));
    if (!this.checkpoints.length && !this.input.value.trim()) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = 'No checkpoints yet';
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
    row.innerHTML =
      item.kind === 'go'
        ? ICONS.arrow
        : item.kind === 'save'
          ? ICONS.plus
          : ICONS.bookmark;
    row.append(main);

    if (item.kind === 'go') {
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
        title.textContent = checkpoint.name;
        if (checkpoint.name !== checkpoint.route) {
          sub.textContent = checkpoint.route;
        }
      }
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = formatRelativeTime(
        checkpoint.lastUsedAt ?? checkpoint.createdAt,
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
      row.append(meta, renameButton, deleteButton);
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

  private onKeyDown(event: KeyboardEvent) {
    if (this.renamingId || event.isComposing) return;
    const item = this.items[this.active];
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
        response = await requestCheckpoints({
          type: 'RESPAWN/NAVIGATE',
          route: item.checkpoint.route,
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

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

const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; }
.backdrop {
  --bg: #ffffff; --fg: #0f172a; --muted: #64748b; --line: #e2e8f0;
  --hover: #f1f5f9; --active: #e0ecff; --accent: #2563eb; --danger: #dc2626;
  position: fixed; inset: 0; z-index: 2147483646;
  display: flex; align-items: flex-start; justify-content: center;
  padding-top: min(14vh, 120px);
  background: rgb(15 23 42 / 0.28);
  font: 13px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif;
  color: var(--fg);
}
@media (prefers-color-scheme: dark) {
  .backdrop {
    --bg: #0f172a; --fg: #e2e8f0; --muted: #94a3b8; --line: #1e293b;
    --hover: #1e293b; --active: #1e3a5f; --accent: #60a5fa; --danger: #f87171;
    background: rgb(0 0 0 / 0.45);
  }
}
.dialog {
  width: min(600px, calc(100vw - 32px));
  max-height: min(70vh, 560px);
  display: flex; flex-direction: column;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: 0 24px 64px rgb(0 0 0 / 0.28);
  overflow: hidden;
}
.search {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px; border-bottom: 1px solid var(--line);
}
.brand {
  font-weight: 700; font-size: 11px; letter-spacing: 0.06em;
  text-transform: uppercase; color: var(--accent);
}
input {
  flex: 1; min-width: 0; border: 0; outline: 0; background: transparent;
  font: inherit; font-size: 15px; color: var(--fg);
}
input::placeholder { color: var(--muted); }
.list { overflow-y: auto; padding: 6px; margin: 0; list-style: none; }
.row {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px; border-radius: 8px; cursor: pointer;
}
.row:hover { background: var(--hover); }
.row.active { background: var(--active); }
.icon {
  width: 22px; height: 22px; border-radius: 6px; flex: none;
  display: grid; place-items: center;
  font-size: 12px; font-weight: 700; color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}
.main { flex: 1; min-width: 0; }
.title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sub {
  color: var(--muted); font-size: 12px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
}
.meta { color: var(--muted); font-size: 12px; flex: none; }
.btn {
  border: 0; background: transparent; color: var(--muted);
  font: inherit; font-size: 12px; padding: 2px 6px; border-radius: 5px;
  cursor: pointer; visibility: hidden;
}
.row:hover .btn, .row.active .btn { visibility: visible; }
.btn:hover { color: var(--fg); background: var(--line); }
.btn.danger { color: var(--danger); }
.rename {
  width: 100%; font-size: 13px; font-weight: 600;
  border: 1px solid var(--accent); border-radius: 5px; padding: 2px 6px;
}
.empty, .error { padding: 18px 14px; color: var(--muted); text-align: center; }
.error { color: var(--danger); text-align: left; padding: 8px 16px; }
.footer {
  display: flex; gap: 14px; flex-wrap: wrap;
  padding: 8px 14px; border-top: 1px solid var(--line);
  color: var(--muted); font-size: 11.5px;
}
kbd {
  font: inherit; font-size: 11px; padding: 0 4px; border-radius: 4px;
  border: 1px solid var(--line); background: var(--hover);
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
    const brand = document.createElement('span');
    brand.className = 'brand';
    brand.textContent = 'reSpawn';
    this.input = document.createElement('input');
    this.input.placeholder =
      'Search checkpoints, or go to /route, ./child, ../sibling';
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
    search.append(brand, this.input);

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
      '<span><kbd>↵</kbd> restore</span>' +
      '<span><kbd>⇧</kbd><kbd>↵</kbd> go without restoring</span>' +
      '<span><kbd>F2</kbd> rename</span>' +
      '<span><kbd>⇧</kbd><kbd>Del</kbd> delete</span>' +
      '<span><kbd>Alt</kbd><kbd>S</kbd> save</span>';

    dialog.append(search, this.errorBox, this.list, footer);
    backdrop.append(dialog);
    root.append(style, backdrop);

    // Keep keystrokes away from the page's own shortcuts.
    for (const type of ['keydown', 'keyup', 'keypress'] as const) {
      this.host.addEventListener(type, (event) => event.stopPropagation());
    }
    this.host.addEventListener('keydown', (event) => this.onKeyDown(event));

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
      empty.textContent = `No checkpoints for ${location.host} yet.`;
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

    const icon = document.createElement('span');
    icon.className = 'icon';
    const main = document.createElement('div');
    main.className = 'main';
    const title = document.createElement('div');
    title.className = 'title';
    const sub = document.createElement('div');
    sub.className = 'sub';
    main.append(title, sub);
    row.append(icon, main);

    if (item.kind === 'go') {
      icon.textContent = '→';
      title.textContent = `Go to ${item.route}`;
      sub.textContent = 'Navigate in the app without changing state';
    } else if (item.kind === 'save') {
      icon.textContent = '+';
      title.textContent = item.name
        ? `Save checkpoint as “${item.name}”`
        : 'Save checkpoint';
      sub.textContent = `${location.pathname}${location.search}${location.hash}`;
    } else {
      const { checkpoint } = item;
      icon.textContent = '◆';
      if (this.renamingId === checkpoint.id) {
        const rename = document.createElement('input');
        rename.className = 'rename';
        rename.value = checkpoint.name;
        rename.addEventListener('keydown', (event) => {
          event.stopPropagation();
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
        title.replaceWith(rename);
      } else {
        title.textContent = checkpoint.name;
      }
      sub.textContent = checkpoint.route;
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = formatRelativeTime(
        checkpoint.lastUsedAt ?? checkpoint.createdAt,
      );
      const renameButton = this.button('Rename', () => {
        this.renamingId = checkpoint.id;
        this.render();
      });
      const confirming = this.confirmDeleteId === checkpoint.id;
      const deleteButton = this.button(
        confirming ? 'Confirm delete' : 'Delete',
        () => void this.requestDelete(checkpoint.id),
        true,
      );
      if (confirming) deleteButton.style.visibility = 'visible';
      row.append(meta, renameButton, deleteButton);
    }
    return row;
  }

  private button(label: string, onClick: () => void, danger = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `btn${danger ? ' danger' : ''}`;
    button.textContent = label;
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  private onKeyDown(event: KeyboardEvent) {
    if (this.renamingId) return;
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

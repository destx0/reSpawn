# reSpawn

> reSpawn — an extension of Redux DevTools with Checkpoint features and internal navigation.

Fork of [Redux DevTools](https://github.com/reduxjs/redux-devtools), reimagined as **reSpawn**. It retains all Redux DevTools capabilities for powering up Redux (and any state-change architecture) development workflows, and adds:

- **Checkpoint features** — save, restore, and fork state snapshots across time-travel sessions
- **Internal navigation** — first-class routing-aware inspection and navigation within the devtools UI

It can be used as a browser extension (for Chrome, Edge and Firefox), as a standalone app or as a React component integrated in the client app.

![image](https://user-images.githubusercontent.com/7957859/48663602-3aac4900-ea9b-11e8-921f-97059cbb599c.png)

## Checkpoints and navigation

Checkpoints work with any app that connects to Redux DevTools: NgRx (`provideStoreDevtools`), Redux / Redux Toolkit, and other `connect()` clients. Nothing needs to be installed in the app.

| Where                          | How                              | What happens                                                                                                                                                                                                                                                                                                    |
| ------------------------------ | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page                           | `Alt+S`                          | Save the current state and route as a checkpoint, auto-named after the route (`/cart`, `/cart 2`, …)                                                                                                                                                                                                            |
| Page                           | `Alt+P`                          | Open the command palette: fuzzy-search checkpoints, or type a route                                                                                                                                                                                                                                             |
| Palette                        | `Enter`                          | Restore the highlighted checkpoint: apply its state, navigate to its route, then apply the state again after route guards and resolvers have run                                                                                                                                                                |
| Palette                        | `Shift+Enter`                    | Go to the checkpoint's route without changing state                                                                                                                                                                                                                                                             |
| Palette                        | `/path`, `./child`, `../sibling` | Navigate inside the app without a reload. Relative paths resolve against the current route, and work inside the hash for `#/` routers                                                                                                                                                                           |
| Palette                        | `F2` / `Shift+Del`               | Rename / delete the highlighted checkpoint                                                                                                                                                                                                                                                                      |
| Palette                        | `Alt+A`                          | Show checkpoints from all sites (the globe icon; shared with the panel). Another site's checkpoint restores on the current site at its route                                                                                                                                                                    |
| Palette                        | `Alt+E`                          | Export the highlighted checkpoint                                                                                                                                                                                                                                                                               |
| Palette                        | Upload icon                      | Import a checkpoint JSON file                                                                                                                                                                                                                                                                                   |
| Page                           | `Alt+I`                          | Toggle **inspect mode**: hover an element to measure it, click to pin the selection (see [Element inspector](#element-inspector))                                                                                                                                                                                |
| Page                           | `A`                              | Toggle **typography mode**: hover text for a compact computed-style card, click to pin it (see [Element inspector](#element-inspector))                                                                                                                                                                         |
| DevTools → **Checkpoints** tab | Toolbar & row icons              | Save (+), import, and the globe toggle for other sites' checkpoints. The search box also takes a route (`Enter` goes there). Hover a row to restore, go, rename, export or delete; double-click restores. A checkpoint from another site (e.g. localhost vs. staging) restores on the current site at its route |

Notes:

- Checkpoints are stored in the extension (`chrome.storage.local`), not in the page, so they survive reloads and clearing site data. They are grouped by origin, or by mapping group when a site mapping matches.
- A restore replaces the store with the saved state, so the DevTools action history starts again from that state.
- Navigation uses `history.pushState` followed by a `popstate` event. Angular Router, React Router and Vue Router handle that like a browser back/forward.
- Checkpoint hotkeys (`Alt+S` / `Alt+P`) are active only on pages whose top frame has a connected store. They step aside when the `inspector-ng` overlay (`<inspector-overlay>`) is present, since it has its own shortcuts.
- Exports are JSON files with `state` as a plain JSON object, so they can be edited by hand. Importing also accepts `inspector-ng` version 1 checkpoint exports.

### Element inspector

The extension also carries the measuring tools from `inspector-ng`, with no library installed in the app. They live in the page and work on any site.

| Where  | How                             | What happens                                                                                                                                        |
| ------ | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page   | `Alt+I`                         | Toggle inspect mode. While it is on, clicks select elements instead of reaching the app                                                             |
| Page   | `A`                             | Toggle **typography mode**: hover text for a small computed-style card, click to pin it. Ignored while typing in a field                             |
| Page   | Hover                           | Highlight the element under the pointer                                                                                                             |
| Page   | Click                           | Pin the selection: margin, border, padding and content boxes, the element label, its size, font size, line height and colour, and `M`/`P` spacing    |
| Page   | Hold `Alt`                      | Measure the distance between the pinned element and the one under the pointer, including all four sides when one contains the other                  |
| Page   | `Ctrl`/`Cmd` + click            | Select the minimum common parent of the pinned element and the one you click                                                                        |
| Page   | `Esc`                           | Clear the selection and guides, and leave inspect mode. In typography mode the first `Esc` only clears pinned cards                                  |
| Palette | **Inspect** button (`Alt+P`)    | Same as `Alt+I`                                                                                                                                     |
| Palette | **Typography** button           | Hover text to inspect family, size, weight, line height, tracking and the CSS variable behind each value. Click to pin a card; drag cards to move them, `Ctrl`/`Cmd` + `Z` to undo pins |
| Palette | **Vertical / Horizontal** buttons | Place alignment guides: move the pointer for a preview, click to place, drag a guide to move it. Guides snap within 10px and show the gap between them |

Notes:

- Inspect mode takes over pointer events like DevTools' own element picker, so pressing a button while inspecting does not activate it. `Esc` or `Alt+I` leaves the mode and the page behaves normally again.
- Typography cards are deliberately small: five rows plus an optional `var(--token)`, with no header or text snippet. Pinned cards survive opening the palette; hover inspection pauses until it closes.
- Typography mode ignores the bare `A` while an input, textarea, select or contenteditable has focus, and never handles `Ctrl`/`Cmd` + `A`. `Ctrl`/`Cmd` + `Z` undoes typography pins before the page sees it.
- The overlay is drawn in a shadow root, so page CSS cannot reach it. Nothing is written to the page's DOM except one host element (`#respawn-inspector-host`).
- Guides and measurements live in memory for the current page; they are not saved. Typography pins are cleared when the mode ends.
- The inspector works on pages without a store. `Alt+S` / `Alt+P` still require a connected store.
- Pages that ship the `inspector-ng` Angular overlay (`<inspector-overlay>`) keep their own overlay; the extension's inspector stands down to avoid drawing twice.

### Site mappings

DevTools → **Settings** → **Site mappings** connects the same app across environments. A mapping can have any number of named environments:

```text
Production  https://abc.com/app
Staging     https://staging.abc.com/app
Local       http://localhost:4200
```

A checkpoint saved on any of them is listed on the others and restored at the translated route. `http` and `https` are ignored, so entries can be scheme-less. A base without a port matches any port; an explicit port is exact. `*` is a host wildcard: `*.abc.com/app` matches subdomains and `*/app` matches every site. A path like `/app` is a prefix, so it also matches `/app/orders`.

The suggested settings include `*/app` → `localhost:4200`, for the common case where the public app is under `/app` and the local app is at the root.

## Documentation

- [Browser Extension Installation and Configuration](https://github.com/reduxjs/redux-devtools/tree/main/extension#installation)
- [Manual Integration as a React Component](./docs/Walkthrough.md#manual-integration)
- [Extension Options (Arguments)](https://github.com/reduxjs/redux-devtools/blob/main/extension/docs/API/Arguments.md)
- [Extension Methods (Advanced API)](https://github.com/reduxjs/redux-devtools/blob/main/extension/docs/API/Methods.md)
- [Remote monitoring](./docs/Integrations/Remote.md)
- [Troubleshooting](https://github.com/reduxjs/redux-devtools/blob/main/extension/docs/Troubleshooting.md)
- [Recipes](https://github.com/reduxjs/redux-devtools/blob/main/extension/docs/Recipes.md)
- [FAQ](https://github.com/reduxjs/redux-devtools/blob/main/extension/docs/FAQ.md)

## Development

This is a monorepo powered by [pnpm](https://pnpm.io/). [Install pnpm](https://pnpm.io/installation) and run `pnpm install` to get started. Each package's dependencies need to be built before the package itself can be built. You can either build all the packages (i.e., `pnpm run build:all`) or use pnpm workspace commands to build only the packages necessary for the packages you're working on (i.e., `pnpm --filter "remotedev-redux-devtools-extension" build`).

### Versioning

reSpawn is currently at **0.0.1** (initial fork reset). All workspace packages have been reset to `0.0.1`.

### License

MIT

# reSpawn

> reSpawn — an extension of Redux DevTools with Checkpoint features and internal navigation.

Fork of [Redux DevTools](https://github.com/reduxjs/redux-devtools), reimagined as **reSpawn**. It retains all Redux DevTools capabilities for powering up Redux (and any state-change architecture) development workflows, and adds:

- **Checkpoint features** — save, restore, and fork state snapshots across time-travel sessions
- **Internal navigation** — first-class routing-aware inspection and navigation within the devtools UI

It can be used as a browser extension (for Chrome, Edge and Firefox), as a standalone app or as a React component integrated in the client app.

![image](https://user-images.githubusercontent.com/7957859/48663602-3aac4900-ea9b-11e8-921f-97059cbb599c.png)

## Checkpoints and navigation

Checkpoints work with any app that connects to Redux DevTools: NgRx (`provideStoreDevtools`), Redux / Redux Toolkit, and other `connect()` clients. Nothing needs to be installed in the app.

| Where                          | How                              | What happens                                                                                                                                                                                                        |
| ------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page                           | `Alt+S`                          | Save the current state and route as a checkpoint, auto-named after the route (`/cart`, `/cart 2`, …)                                                                                                                |
| Page                           | `Alt+P`                          | Open the command palette: fuzzy-search this site's checkpoints, or type a route                                                                                                                                     |
| Palette                        | `Enter`                          | Restore the highlighted checkpoint: apply its state, navigate to its route, then apply the state again after route guards and resolvers have run                                                                    |
| Palette                        | `Shift+Enter`                    | Go to the checkpoint's route without changing state                                                                                                                                                                 |
| Palette                        | `/path`, `./child`, `../sibling` | Navigate inside the app without a reload. Relative paths resolve against the current route, and work inside the hash for `#/` routers                                                                               |
| Palette                        | `F2` / `Shift+Del`               | Rename / delete the highlighted checkpoint                                                                                                                                                                          |
| DevTools → **Checkpoints** tab | Buttons                          | Save (optional name), go to a route, search, restore, go, rename, export, delete, import. **All sites** shows other origins' checkpoints. **Open** loads that checkpoint's URL in the inspected tab and restores it |

Notes:

- Checkpoints are stored in the extension (`chrome.storage.local`), not in the page, so they survive reloads and clearing site data. They are grouped by origin.
- A restore replaces the store with the saved state, so the DevTools action history starts again from that state.
- Navigation uses `history.pushState` followed by a `popstate` event. Angular Router, React Router and Vue Router handle that like a browser back/forward.
- Hotkeys are active only on pages whose top frame has a connected store. They step aside when the `inspector-ng` overlay (`<inspector-overlay>`) is present, since it has its own shortcuts.
- Exports are JSON files. Importing also accepts `inspector-ng` version 1 checkpoint exports.

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

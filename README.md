# reSpawn

> reSpawn — an extension of Redux DevTools with Checkpoint features and internal navigation.

Fork of [Redux DevTools](https://github.com/reduxjs/redux-devtools), reimagined as **reSpawn**. It retains all Redux DevTools capabilities for powering up Redux (and any state-change architecture) development workflows, and adds:

- **Checkpoint features** — save, restore, and fork state snapshots across time-travel sessions
- **Internal navigation** — first-class routing-aware inspection and navigation within the devtools UI

It can be used as a browser extension (for Chrome, Edge and Firefox), as a standalone app or as a React component integrated in the client app.

![image](https://user-images.githubusercontent.com/7957859/48663602-3aac4900-ea9b-11e8-921f-97059cbb599c.png)

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

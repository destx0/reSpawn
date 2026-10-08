# Checkpoints end-to-end check

Drives headless Chromium over the DevTools protocol with the built extension
loaded. It covers saving with Alt+S, restoring with and without the DevTools
panel open, `./` and `../` navigation, the Alt+P palette, Open & restore
across origins, import of inspector-ng exports, and the panel UI.

```bash
pnpm build:extension
NG_NODE_MODULES=/path/to/node_modules pnpm test:checkpoints-e2e
```

- `fixtures/redux`: a Redux app using the extension enhancer, with a tiny
  `popstate` router.
- `fixtures/ng`: Angular 17 + NgRx store-devtools + Angular Router. This repo
  doesn't depend on Angular, so set `NG_NODE_MODULES` to a `node_modules` that
  has `@angular/*` 17, `@ngrx/store`, `@ngrx/store-devtools` and `zone.js`, for
  example the inspector-ng repo's. Without it, the NgRx checks are skipped.
- `CHROME_BIN` (default `/usr/bin/chromium`) must be a build that still accepts
  `--load-extension` (Chromium does; branded Chrome 137+ does not).
- Screenshots of the panel and palette are written to the OS temp directory.

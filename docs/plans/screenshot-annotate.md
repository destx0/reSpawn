# Screenshot & annotate plan

> Goal: bring Measurer's screenshot and annotation tools into reSpawn as a
> page-side tool launched from **Alt+C** or the **Alt+P palette camera menu**.
> No changes to the DevTools panel.
>
> Status: **first pass implemented** (2026-10-29). The shipped UX differs from
> the original plan in §1–§8; see §12 for what actually landed.
>
> Nothing in the DevTools panel was touched.

---

## 0. Sources inspected

| Source | What it gives |
| --- | --- |
| `/home/omu/cud/mesurer/packages/mesurer/core/screenshot.ts` | rect normalize/clamp/move/resize, PNG crop, clipboard copy, download, filename, hide-nodes, paint wait |
| `/home/omu/cud/mesurer/packages/mesurer/hooks/use-screenshot.ts` | capture orchestration, viewport image, click vs drag selection |
| `/home/omu/cud/mesurer/packages/mesurer/core/arrows.ts` | arrow geometry, arrowhead, hit-testing |
| `/home/omu/cud/mesurer/packages/mesurer/core/ink.ts` | pen strokes, marker width, eraser |
| `/home/omu/cud/mesurer/packages/mesurer/core/text-transform.ts` | text note bounds and transforms |
| `/home/omu/cud/mesurer/packages/mesurer/core/arrow-transform.ts`, `pen-transform.ts`, `group-transform.ts` | annotation move/transform math |
| `/home/omu/cud/mesurer/packages/mesurer/components/screenshot-*.tsx`, `pen-card.tsx`, `text-card.tsx` | editor UI, toolbar and cards |
| `/home/omu/cud/mesurer/apps/extension/src/background.ts:304` | `captureVisibleTab` routing through the background |
| `/home/omu/cud/mesurer/apps/extension/src/capture-visible-tab.ts` | content-script capture request |
| `extension/src/contentScript/checkpoints/palette.ts` | palette host, toolbar, `runTool`, keyboard model |
| `extension/src/contentScript/checkpoints/index.ts` | Alt+S / Alt+P hotkeys, text-field and trust guards |
| `extension/src/contentScript/index.ts:344` | init order and store gate |
| `extension/src/inspector/overlay.ts` | shadow-host overlay pattern, `setSuppressed`, selected element state |
| `extension/src/contentScript/checkpoints/toast.ts` | toast host id and z-index |
| `extension/src/checkpoints/messages.ts` | typed request/response pattern |
| `extension/src/background/checkpoints.ts:723` | background `onMessage` listener pattern |
| `extension/test/checkpoints-e2e/run.mjs` | CDP e2e harness and `evaluate` helper |
| `docs/plans/element-inspector.md` | plan format and page-side overlay decisions |

Measurer's screenshot flow is the reference for the region mode: dim the page,
drag a region, hide the overlay, capture, crop. reSpawn keeps that flow and adds
viewport and full-page modes behind the palette camera menu.

---

## 1. Scope

### Locked decisions

| Decision | Choice |
| --- | --- |
| Surface | Alt+C + Alt+P palette camera menu. No DevTools panel changes. |
| Hotkey | `Alt+C` opens the live drag-region overlay |
| Region selection | Drag on the dimmed page; a pinned inspector element pre-fills the rect |
| Other modes | Palette camera menu: **Region**, **Viewport**, **Full page** |
| Annotation tools | Rectangle, arrow, pen, text |
| Annotation transforms | Select, move, delete, undo/redo. No resize/rotate/multi-select in v1. |
| Clipboard | `navigator.clipboard.write`; on failure toast + download. No new permissions. |

### Out of scope

- Video recording, GIF/MP4 export.
- Comments/threads.
- Color picker, inspect cards, settings, x-ray, rulers.
- DevTools panel buttons or a new panel section.
- Custom scroll-container capture (v2; viewport fallback in v1).
- Persistence of annotations or captures.

---

## 2. Surface decision

Measurer's editor is a page overlay. reSpawn already has the pattern
(`src/inspector/overlay.ts`: one shadow host, fixed layers, capture-phase
listeners).

**Palette is the launcher, not the editor.** The palette is a compact search
dialog (`palette.ts:266-370`) with its own keyboard model; a canvas editor would
break it. The editor is a separate full-viewport shadow host, opened after the
palette closes.

**Why not the DevTools panel:** `captureVisibleTab` targets the active tab of a
window. From a docked panel this is workable, from an undocked panel it is not,
and the panel would still need a content-script bridge for scroll capture. The
palette already runs in the tab, which is Measurer's capture model
(`apps/extension/src/background.ts:304-318`).

### z-index budget

| Layer | z-index | Source |
| --- | --- | --- |
| toast | `2147483647` | `contentScript/checkpoints/toast.ts:13` |
| palette | `2147483646` | `contentScript/checkpoints/palette.ts:123` |
| **region overlay / editor** | `2147483646` | new; palette is closed while either is open |
| inspector | `2147483645` | `inspector/constants.ts` |

The editor and the region overlay must close before the palette can open.
`Alt+P` while either is open closes it first. The toast stays above both so
copy/download feedback is visible.

---

## 3. Flow

### Region mode (Alt+C)

```
Alt+C
  │
  ├─ close palette, suppress + hide inspector, hide toast
  ├─ dim the page, crosshair, pixel-size label
  ├─ initial rect = pinned inspector element, if any
  ├─ drag to create / adjust the region
  └─ release
       ├─ hide the selection overlay
       ├─ wait for paint
       ├─ one captureVisibleTab
       ├─ restore page, inspector, toast
       ├─ crop the capture to the region
       └─ open editor with the cropped image
```

### Palette camera menu

```
Alt+P → camera button → menu
  ├─ Region     (same as Alt+C; closes the palette)
  ├─ Viewport   (one capture, editor opens with the full viewport)
  └─ Full page  (tile loop, editor opens with the stitched image)
```

The palette is store-gated today (`contentScript/index.ts:344`,
`checkpoints/index.ts:88`), so the camera menu is only reachable on pages with a
Redux store. **Alt+C is not gated** and works everywhere.

### Editor (all modes)

```
editor
  ├─ image fit-to-width, zoom controls
  ├─ crop adjustment (default = the captured area)
  ├─ annotate: rectangle, arrow, pen, text
  ├─ Copy PNG  → clipboard, fallback toast + download
  ├─ Download PNG
  └─ Esc → close, restore the page
```

Rationale:

1. Region mode captures after the drag, so the overlay is never in the shot.
2. Viewport and full-page modes capture first and edit after.
3. One editor code path for all three modes.

---

## 4. Modules

```
extension/src/screenshot/
  types.ts       Rect, CapturedShot, CaptureMode, Annotation union, EditorState
  geometry.ts    normalize / clamp / move / resize / point-in-rect
  messages.ts    RESPAWN_SCREENSHOT/CAPTURE request + response, requestCapture()
  capture.ts     hide/restore overlays, region/viewport shot, tile loop, restoration
  region.ts      drag-region overlay: dim, hole, handles, size label, prefill
  stitch.ts      pure tile math: tile offsets, fixed-element list, canvas caps
  overlay.ts     editor class: host, image, crop, annotation layers, toolbar
  annotate.ts    arrow / rect / pen / text geometry, hit-testing, history
  styles.ts      shadow CSS string
extension/src/background/screenshot.ts   captureVisibleTab handler
```

### Wiring

| File | Change |
| --- | --- |
| `src/contentScript/index.ts` | `initScreenshot()` next to `initInspector()` |
| `src/contentScript/checkpoints/palette.ts` | camera button + menu (Region / Viewport / Full page) |
| `src/inspector/overlay.ts` | expose the pinned element or its rect for region prefill |
| `src/background/index.ts` | `import './screenshot.js'` |
| `src/contentScript/hotkeys.ts` (new) | shared `isAltChord` / `typesText` guards |
| `chrome/manifest.json`, `edge/manifest.json`, `firefox/manifest.json` | only if Phase 0 proves host permissions insufficient |

### Message namespace

`isCheckpointRequest` (`src/checkpoints/messages.ts:96`) accepts every
`RESPAWN/` message, so a `RESPAWN/CAPTURE` would be swallowed by the checkpoint
listener (`src/background/checkpoints.ts:723`). Use
`RESPAWN_SCREENSHOT/CAPTURE` — it does not match the `RESPAWN/` prefix — with
its own `onMessage` listener. No checkpoint code changes.

### Icon and copy

Feather icons are already inlined in `palette.ts:71-101`; add `camera` there.
Editor toolbar icons follow the same inline-SVG approach.

---

## 5. Capture pipeline

### 5.1 Background handler

`src/background/screenshot.ts`:

1. Reject if the sender has no tab or is not the top frame.
2. Look up `sender.tab.windowId`; confirm the sender tab is the active tab in
   that window (`chrome.tabs.query({ active: true, windowId })`).
3. Call `chrome.tabs.captureVisibleTab(windowId, { format: 'png' })`.
4. Return `{ ok: true, dataUrl, width, height }` or `{ ok: false, error }`.

The active-tab check mirrors Measurer and prevents capturing a tab the user
switched to mid-capture.

### 5.2 Permissions

Chrome requires `<all_urls>` or `activeTab` for `captureVisibleTab`, but its
own docs also state that host permissions let extensions call the method on
matching tabs. reSpawn has `http://*/*`, `https://*/*`, `file:///*`.

**Phase 0 is a real test**, not an assumption. If the call rejects, add
`<all_urls>` to all three manifests. `activeTab` is not viable: Alt+C is a page
hotkey, not an extension invocation, so the grant would never be issued.

File URLs additionally require the user to allow file access.

### 5.3 Region overlay

A new shadow host (`respawn-screenshot-region-host`) at z-index `2147483646`,
separate from the editor:

- Full-viewport dim (`rgba(0,0,0,0.35)`) with a transparent hole.
- Crosshair cursor; a W×H label follows the pointer.
- Initial rect:
  - if the inspector has a pinned element, use its `getBoundingClientRect()`;
  - otherwise nothing until the user drags.
- Drag to create; 8 handles adjust an existing rect; `Escape` cancels.
- A zero-size release cancels rather than capturing a 0×0 image.
- On release:
  1. hide the region host and the inspector host,
  2. `waitForNextPaint(window)` — two rAFs, ported from `core/screenshot.ts:178`,
  3. capture the viewport,
  4. restore hosts and inspector,
  5. crop the capture to the region in image pixels.

`InspectorOverlay.setSuppressed` is not enough: it only pauses pointer handling
and typography (`inspector/overlay.ts:199-204`). Hide the host element.

Region prefill needs a getter on `InspectorOverlay` for `selectedElement`
(`overlay.ts:107`). The measurement is already computed there; expose the rect,
not the element, to keep the screenshot module independent.

### 5.4 Viewport capture

One `captureVisibleTab` call, no cropping. Used by the palette camera menu.

### 5.5 Full-page capture

Tile loop in `capture.ts`, tile math in `stitch.ts`:

- `pageHeight = document.documentElement.scrollHeight`,
  `step = window.innerHeight`.
- For each `y = 0, step, 2*step, …`: `scrollTo(0, y)`, wait two rAFs, capture.
- `scale = image.width / window.innerWidth`; draw each tile at
  `(0, tile.top * scale)` on the output canvas.
- Restore the original scroll position in `finally`.

#### Fixed and sticky elements

Collect before the loop: `position: fixed | sticky` elements whose rect
intersects the viewport. Hide them for tiles after the first, restore at the
end. The header then appears once at the top of the stitched image, which is
the expected full-page look.

Caveat: sticky elements inside custom scroll containers are not detected
correctly; v1 accepts this.

#### Limits

- Max tiles: 40. Abort with a toast beyond that.
- Max canvas dimension: 32,767 px; max area ~268M px. Downscale the output or
  abort with a toast when exceeded.
- `captureVisibleTab` is limited to 2 calls/second. Space captures ~550 ms
  apart; retry once on failure.

#### Custom scroll containers

If `document.scrollingElement` does not scroll (`scrollHeight <=
clientHeight`) while the page still overflows, the page uses an inner scroller.
Full-page mode falls back to viewport capture with an info toast. Supporting
arbitrary containers is a v2 item.

#### Cancellation and progress

- `Escape` sets a cancel flag; the loop checks it before every tile.
- No in-page progress overlay: it would appear in the capture. The page visibly
  scrolls, and the editor opens when done. A background action badge could be
  added later.
- If the user switches tabs mid-loop, the background rejects the next shot;
  the content side aborts and shows an error toast on return.

### 5.6 Failure modes

| Failure | Behavior |
| --- | --- |
| Capture rejected | toast with the error; page restored; editor not opened |
| One tile fails | abort, restore, toast; no partial image |
| Canvas too large | downscale with a toast, or abort if extreme |
| Page height changes mid-loop | recompute after each tile; capped by max tiles |
| Scroll position changed by the app | restore the original position; the app's own scroll may win |
| Pinned element gone before prefill | no prefill; region overlay waits for a drag |

---

## 6. Editor

### 6.1 Image model

- Each mode produces one `HTMLImageElement`.
  - Region: the captured viewport cropped to the dragged rect.
  - Viewport: the full captured viewport.
  - Full page: the stitched image.
- All annotation coordinates and the crop rectangle are stored in **image
  pixels**, not CSS pixels.
- Display: fit-to-width by default, with zoom controls. Pointer → image:
  `(pointer - imageOffset) / zoom`.
- Export: draw the crop rectangle of the image, then translate annotations by
  `(-crop.x, -crop.y)`. The crop can change after annotating without re-baking
  annotations.

### 6.2 Layers

| Layer | Contents | Pointer |
| --- | --- | --- |
| image | `<img>` | none |
| annotations | `<canvas>` at image resolution | selection/hit-testing |
| crop | dimmed outside + handles + rule-of-thirds | crop mode only |
| toolbar | tools, colors, width, Copy, Download, Close | auto |

### 6.3 Tools

- **Rectangle:** drag start → end; stroke only in v1, optional fill later.
- **Arrow:** drag start → end; head scales with stroke width; geometry ported
  from `core/arrows.ts`.
- **Pen:** pointer points in image space, smoothed; stroke width from the
  toolbar; eraser deferred.
- **Text:** click to place; inline input; fixed size choices; color from the
  toolbar. Committed on blur or Enter.
- **Crop:** re-crop within the captured image; `Reset` restores the full image.

### 6.4 Selection and history

- Click selects the topmost annotation; drag moves it; `Delete`/`Backspace`
  removes it.
- Snapshot-based history: each mutation pushes the annotation array; undo/redo
  bounded to ~50 entries.
- `Cmd/Ctrl+Z`, `Cmd/Ctrl+Shift+Z`.

### 6.5 Output

- **Copy:** `navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])`.
  On failure (insecure origin, no API, denied), toast "Copy unavailable —
  downloading instead" and download.
- **Download:** `<a download>` with an object URL, filename
  `respawn-<yyyy>-<mm>-<dd>-<hhmmss>.png`, URL revoked after a timeout.
- Both compress to PNG from the composited canvas.

### 6.6 Keyboard and accessibility

| Key | Action |
| --- | --- |
| `Escape` | close editor (confirm if annotations exist) |
| `Cmd/Ctrl+Z` | undo |
| `Cmd/Ctrl+Shift+Z` | redo |
| `Delete` / `Backspace` | delete selected annotation |
| `Enter` | copy |
| `1` / `2` / `3` / `4` | rectangle / arrow / pen / text |
| `Alt+C` | ignored while the editor is open |

- Toolbar buttons are `<button>` with `aria-pressed` and labels.
- The editor traps focus inside the shadow root while open.
- The image has an accessible name; the canvas is `aria-hidden`.

---

## 7. Entry points

### 7.1 Global hotkey (Alt+C)

New listener in `contentScript/index.ts` via `initScreenshot()`:

- Top frame only.
- `event.isTrusted`, `!event.isComposing`, `!event.repeat`.
- `isAltChord(event, 'KeyC')` and `!typesText(event)`; extract the duplicated
  guards (`inspector/overlay.ts:64`, `checkpoints/index.ts:46`) into
  `contentScript/hotkeys.ts`.
- No store gate. This must not live inside `initCheckpoints`, which only runs
  its hotkey path when a store is connected (`contentScript/index.ts:344`,
  `checkpoints/index.ts:88`).
- Opens the region overlay directly. Ignore when the editor or region overlay
  is already open.

### 7.2 Palette camera menu

- A camera button in the palette toolbar, outside `INSPECTOR_TOOLS`.
- `runTool` returns early when the inspector is missing (`palette.ts:752-755`),
  so the screenshot launcher gets its own method.
- Click opens a small popover above the toolbar:
  - **Region** — closes the palette, opens the region overlay (same as Alt+C)
  - **Viewport** — closes the palette, captures the viewport, opens the editor
  - **Full page** — closes the palette, runs the tile loop, opens the editor
- The palette's key handler must step aside while the menu is open, like it
  already does for the toolbar (`palette.ts:363-365`).
- `palette.close()` restores inspector suppression (`palette.ts:377`); the
  screenshot launcher then hides the inspector host for the capture.

---

## 8. Phases

| Phase | Work | Gate |
| --- | --- | --- |
| 0 | `RESPAWN_SCREENSHOT/CAPTURE` message + background handler; verify `captureVisibleTab` on http, https and file pages | PNG returned with current manifest |
| 1 | Shared hotkey guards, `Alt+C` region overlay, prefill from the pinned element, region capture, editor opens with the cropped image | Works on a page with no Redux store; Esc restores the page |
| 2 | Crop adjustment, copy/download, filename, toasts, focus trap | Manual + e2e |
| 3 | Rectangle, arrow, pen, text, selection, move, delete, undo/redo | Manual |
| 4 | Palette camera menu (Region / Viewport / Full page), full-page tiling, stitching, fixed/sticky handling, limits, cancellation | Long fixture page: stitched height, header appears once, scroll restored |
| 5 | Unit + e2e + README | `type-check`, `lint`, `build:extension`, `test:app`, e2e green |

Full page is last so a working region/viewport tool exists at every point.

---

## 9. Testing

### Unit (`test/app/inspector/` style)

- `stitch.ts`: tile count and offsets for short, exact and partial last tiles;
  max-tile and canvas caps; downscale factor.
- `geometry.ts`: normalize, clamp, move, resize, hit-testing, crop transform.
- `annotate.ts`: arrow head and hit area, pen smoothing, text bounds, history
  undo/redo boundaries.
- `capture.ts` region mapping: CSS px → image px under DPR and browser zoom.

### E2E (`test/checkpoints-e2e/run.mjs`)

Real `captureVisibleTab` under CDP is not guaranteed. Add a small test hook,
e.g. `window.__respawnScreenshot.openWithDataUrl(dataUrl)`, gated to the
fixture, and assert:

- `Alt+C` mounts the region overlay; the inspector and palette are hidden,
- dragging creates a rect and shows the size label,
- release opens the editor with the cropped image,
- each tool changes the annotation canvas,
- Escape closes and restores focus and scroll,
- palette camera menu lists Region / Viewport / Full page.

### Manual checklist

1. HTTPS page: Alt+C, drag, arrow, copy, paste elsewhere.
2. HTTP page: copy falls back to download with a toast.
3. Region prefill from a pinned inspector element.
4. Full page on a 10,000 px fixture: header once, no duplicated content, scroll
   restored.
5. Inspector and palette hidden in the capture.
6. Alt+C inside an input does not fire.
7. Firefox: hotkey, capture, copy fallback.
8. DevTools docked and undocked.

---

## 10. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| `captureVisibleTab` permission rejection | feature cannot ship | Phase 0 test; add `<all_urls>` if needed |
| Region overlay captured in the shot | dirty screenshot | hide the host, wait two rAFs before capture |
| Drag while the inspector is active | two overlays fighting | suppress + hide the inspector host, restore after |
| Scroll capture on lazy/virtualized pages | duplicated or missing content | tile cap, recompute height, document limitation |
| Fixed/sticky detection misses | repeated headers | hide-after-first-tile policy; v1 limitation |
| Custom scroll containers | full page equals viewport | detect and fall back with a toast |
| Canvas size limits | export failure | cap + downscale |
| Clipboard unavailable on http | copy fails | toast + download fallback |
| Editor styles affected by page CSS | broken UI | shadow root + `all: initial` like palette/inspector |
| Page removes the host | editor disappears | acceptable, same as palette |
| Alt+C conflicts | page shortcut broken | typesText guard, top frame only, no repeat |

---

## 11. Open items

- Arrow, pen and text port: extract geometry only; Measurer's React components
  and hooks are not reusable.
- Eraser, resize/rotate, multi-select: deferred.
- Offscreen clipboard for insecure pages: deferred; fallback is download.
- Scroll-container capture: deferred.
- Video recording: out of scope.
- Plan doc location: `docs/plans/screenshot-annotate.md`.

---

*Written 2026-10-29 against Measurer at `/home/omu/cud/mesurer` and reSpawn
`main` at `065f439`. No code written yet.*

---

## 12. Implementation notes (2026-10-29)

Status: **first pass shipped**.

### Surface

The palette footer now carries two entry buttons, not the annotation tools:

```
[ + ] | inspect  type  V-guides  H-guides | [ camera ] [ annotate ] | [ import ]
```

- **Screenshot** (`camera`) closes the palette, opens the region overlay, captures
  the viewport and opens the editor.
- **Annotate** (`pencil`) closes the palette and opens the floating annotation
  bar on the live page.

The annotation bar itself is a draggable floating dark bar at the bottom right,
with select, rectangle, arrow, pen, text, ink colour, stroke width, undo, redo,
clear and close. The screenshot editor reuses the same bar with copy and
download added.

### Modules shipped

```
extension/src/annotate/
  types.ts, geometry.ts, store.ts, render.ts
  surface.ts    canvas pointer/draft/text editing
  toolbar.ts    draggable floating bar
  overlay.ts    page overlay (bottom-right bar, scroll redraw, shortcuts)
  styles.ts, index.ts
extension/src/screenshot/
  messages.ts, capture.ts, editor.ts, index.ts
extension/src/background/screenshot.ts
```

Palette wiring lives in `src/contentScript/checkpoints/palette.ts`; the
background handler is imported from `src/background/index.ts`.

### Behaviour

- Page annotations are stored in document coordinates, so they scroll with the
  page. They survive closing the bar until the page reloads; clear is undoable.
- The bar's shortcuts: `V` select, `R` rectangle, `A` arrow, `P` pen, `T` text,
  `Cmd/Ctrl+Z`, `Cmd/Ctrl+Shift+Z`, `Delete`, `Esc`.
- Before a page capture the selection outline is cleared and the bar is hidden,
  so neither is baked into the image. Annotation shapes themselves stay visible
  and are captured.
- The screenshot editor fits the capture to the viewport (never upscales),
  keeps annotations in image pixels, and exports at native resolution.
- Copy uses `navigator.clipboard.write`; when unavailable it downloads the PNG
  and reports that in a toast.

### Permission change

`captureVisibleTab` rejected the previous `http/https/file` host patterns with
`Either the '<all_urls>' or 'activeTab' permission is required.` All three
manifests (`chrome/`, `edge/`, `firefox/`) now use `"host_permissions":
["<all_urls>"]`. The store warning text is unchanged because the extension
already requested every http/https/file page.

### Verification

- `pnpm --filter respawn-extension type-check`
- `pnpm --filter respawn-extension lint` (0 errors)
- `pnpm --filter respawn-extension build:extension`
- `node test/checkpoints-e2e/run.mjs` — **90/90**, including palette buttons,
  the floating bar, all four tools, region capture and editor open/close.

### Not shipped / deviations

- Full-page tiling, inspector prefill, global `Alt+C`, persistence and video are
  not implemented.
- The bar defaults to the bottom right to avoid the centre-bottom toast; it can
  be dragged anywhere.
- The page annotation layer is modal while the bar is open (the canvas consumes
  page clicks); closing the bar restores page interaction and leaves the shapes
  on screen.

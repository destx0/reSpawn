# Element inspector migration plan

> Goal: bring the inspect/measure features of `inspector-ng`
> (`/home/omu/cud/inspector/inspector/projects/inspector-ng`) into the reSpawn
> browser extension, without the Angular library and without touching the page
> app.
>
> Status: **implemented** (2026-10-28). Decisions taken during implementation are
> recorded in §7; deviations from this plan are listed in §10.

---

## 0. Sources inspected

| Source | What it gave |
| --- | --- |
| `projects/inspector-ng/src/lib/dom.ts` | measurement, labels, typography, text blocks, hit-testing |
| `projects/inspector-ng/src/lib/distances.ts` | pixel-distance overlay between two rects |
| `projects/inspector-ng/src/lib/geometry.ts` | `clamp`, viewport size, rect comparison |
| `projects/inspector-ng/src/lib/types.ts` | `Rect`, `InspectMeasurement`, `Guide`, `DistanceOverlay`, … |
| `projects/inspector-ng/src/lib/constants.ts` | guide snap distance (10px), guide hitbox (14px) |
| `projects/inspector-ng/src/lib/inspector.component.ts` | modes, guides, hotkeys, pointer handling, palette actions |
| `projects/inspector-ng/src/lib/inspector.component.html` | overlay layers, spacing tags, palette markup |
| `projects/inspector-ng/src/lib/inspector.component.css` | box-model colours, chips, guides, distances |
| `projects/inspector-ng/src/lib/extension-bridge.ts` | Angular-only, not needed here |
| `extension/src/contentScript/**` | existing shadow-DOM palette + toast, hotkey arbitration |
| `extension/src/checkpoints/**` | pure-helper + message + background storage pattern |
| `extension/src/options/syncOptions.ts` | where user-facing toggles live |
| `extension/chrome/manifest.json`, `firefox/manifest.json` | content scripts run in every frame, `page.bundle` is `world: MAIN` |
| `extension/test/checkpoints-e2e/run.mjs` | CDP harness to extend for overlay tests |

---

## 1. What reSpawn already has

Checkpoints are already migrated (`src/checkpoints/*`, `src/app/checkpoints/*`,
`src/contentScript/checkpoints/*`). Relevant overlap:

| Existing piece | Location | Reusable for the inspector |
| --- | --- | --- |
| Shadow-DOM page overlay pattern | `src/contentScript/checkpoints/palette.ts:77-290` | yes — same host/shadow/style approach |
| Toast | `src/contentScript/checkpoints/toast.ts:1-40` | yes — reuse for "Guides cleared" etc. |
| Global hotkeys | `src/contentScript/checkpoints/index.ts:61-99` | extend, don't duplicate |
| Fuzzy search, relative-time, ids | `src/checkpoints/core.ts:98-223` | palette already uses them |
| Storage/background messaging | `src/checkpoints/messages.ts`, `src/background/checkpoints.ts` | only if guides are persisted |
| Options plumbing | `src/options/syncOptions.ts:3-14` | add inspector toggles here |

There is **no** element inspection code in reSpawn today:

```bash
grep -rnE "getBoundingClientRect|elementFromPoint|createSidebarPane" extension/src
# no matches
```

---

## 2. Inventory — inspect features in `inspector-ng`

### 2.1 Element inspection (select mode)

| # | Feature | Implementation | Notes |
| --- | --- | --- | --- |
| 1 | Hit-test under the cursor, ignoring the overlay itself | `dom.ts:182-217` | `elementsFromPoint`, skips `body`/`html`, skips rects ≤ 2px |
| 2 | Hover highlight box | `inspector.component.ts:780-848` | `hoverHighlightEnabled` toggle |
| 3 | Click to select; selection persists across moves | `inspector.component.ts:858-881`, `1065-1106` | |
| 4 | Box-model rendering: margin box, border/content box, padding box | `inspector.component.html:339-394` | four nested rects |
| 5 | Parent gap highlight when the parent is flex/grid with `gap > 0` | `dom.ts:76-105`, `.html:340-355` | "G row/column" tag |
| 6 | Element label `tag#id.class` | `dom.ts:13-20` | first class only |
| 7 | Size + type meta line (`label · 120 x 40 · 14px / 20px / #1f2937`) | `inspector.component.ts:326-332` | |
| 8 | Margin/padding shorthand tag (`M 8 · P 8 16`) | `.ts:665-678`, `.html:383-393` | CSS-shorthand collapsing |
| 9 | Recompute on scroll/resize | `.ts:883-891` | viewport coords, `position: fixed` |
| 10 | Shift+click selects without firing the page click | `.ts:335-347` | capture-phase, `stopImmediatePropagation` |
| 11 | Ctrl/Cmd+click selects the **minimum common parent** of current + clicked element | `.ts:1079-1096`, `1229-1251` | |
| 12 | Esc clears selection/guides/transient state | `.ts:741-778` | |

### 2.2 Distance measurement

| # | Feature | Implementation |
| --- | --- | --- |
| 13 | Hold `Alt` in select mode → measure selected ↔ hovered | `.ts:731-739`, `1108-1130` |
| 14 | Horizontal/vertical gap lines with px labels | `distances.ts:25-55`, `.html:446-480` |
| 15 | Connector lines when the elements are offset on the other axis | `distances.ts:33-54` |
| 16 | Nested rects → four-side distances (inner vs outer) and nearest-boundary selection | `distances.ts:57-119`, `145-172` |
| 17 | Relation detection via `contains` | `.ts:1132-1139` |
| 18 | Viewport clamping of connectors | `distances.ts:121-141` |

### 2.3 Alignment guides

| # | Feature | Implementation |
| --- | --- | --- |
| 19 | Vertical/horizontal guide mode | `.ts:286-288`, `395-406` |
| 20 | Live preview following the cursor | `.ts:1188-1200` |
| 21 | Click to place, pointer-drag to move, pointerup to drop | `.ts:658-663`, `786-802`, `850-856` |
| 22 | Snap to existing guides within 10px | `constants.ts:1`, `.ts:1202-1209` |
| 23 | Guide hitbox 14px for selecting a guide under the pointer | `constants.ts:2`, `.ts:1211-1227` |
| 24 | Live distance labels between adjacent guides of the same orientation | `.ts:289-316`, `.html:531-548` |
| 25 | Clear all guides (Esc) | `.ts:646-649` |

### 2.4 Typography overlay ("Type")

| # | Feature | Implementation |
| --- | --- | --- |
| 26 | Enumerate visible leaf text blocks (limit 160) | `dom.ts:111-180` |
| 27 | Per-block chip: colour swatch, font-size, line-height, hex colour | `.html:397-413` |
| 28 | Viewport clamping / filtering of chips | `.ts:1141-1166` |
| 29 | Computed typography readout (`fontFamily/size/weight/lineHeight/letterSpacing/color/textAlign`) | `dom.ts:44-55` |
| 30 | Hex normalisation of `rgb()`/`rgba()` colours | `dom.ts:22-42` |

### 2.5 Command palette integration

| # | Feature | Implementation |
| --- | --- | --- |
| 31 | Inspector actions: Inspect, Type, V, H, Save, Paste | `.ts:69-76`, `517-547` |
| 32 | Palette keyboard model: ↑/↓ wrap, ←/→ move between result list and actions, Enter, Esc, F2, Delete | `.ts:920-1030` |
| 33 | Pet switcher in the palette header | `.ts:78-215`, `1168-1180` |
| 34 | Toast feedback ("Saved …", "Restored …") | `.ts:1047-1055` |

### 2.6 Not part of the feature set

- `extension-bridge.ts` — Angular DI bridge (`window.__INSPECTOR_NG__`), replaced by the extension itself.
- `provideInspectorCheckpoints()` / meta-reducer / IndexedDB repository — replaced by reSpawn's background + `chrome.storage.local`.
- `measure-caterpillar`, 34 pet sprites — 133 KB of inlined base64; see §7.

---

## 3. Gap analysis

| inspector-ng feature | reSpawn today | Target |
| --- | --- | --- |
| Checkpoints, palette, restore, navigate, import/export, rename/delete, all-sites | **done** (`src/checkpoints`, `src/contentScript/checkpoints`) | unchanged |
| Element hover/select + box model (#1-12) | missing | new overlay engine |
| Distance measurement (#13-18) | missing | new overlay layer |
| Guides (#19-25) | missing | new overlay layer |
| Typography overlay (#26-30) | missing | new overlay layer |
| Palette inspector actions (#31-32) | palette exists, actions missing | add action strip |
| Pets (#33) | missing | optional, likely drop |
| Hotkeys `Alt+I`, hold `Alt`, `Esc`, `Shift+click`, `Ctrl+click` | only `Alt+S`/`Alt+P`/`Alt+A`/`Alt+I`(import, palette-scoped)/`Alt+E` | extend global handler |
| Settings for colours / hover | none | new options |

---

## 4. Architecture decision: run in the content script, not `page.bundle`

`inspector-ng` is an in-page Angular component. The extension must not need
that, and must work on any app (React, Vue, Angular, plain DOM).

**Recommendation: build the overlay in the isolated content script.**

Reasons:

1. `getBoundingClientRect`, `getComputedStyle`, `elementsFromPoint` all work in
   the isolated world — nothing needs MAIN-world access.
2. reSpawn already ships its palette this way
   (`src/contentScript/checkpoints/palette.ts`), including a shadow root, so
   page CSS cannot leak in and page scripts cannot easily break the UI.
3. No MAIN-world requirement: the overlay only reads layout, so it works the
   same in all three targets (`chrome/`, `edge/`, `firefox/`) regardless of
   `world: MAIN` support differences.
4. No `window.postMessage` bridge, no extra `manifest.json` entry, no risk of
   colliding with a page's own `window` globals.

Layout:

```
content.bundle.js (isolated, every frame)
  ├── checkpoints/index.ts      existing: Alt+S, Alt+P, page requests
  └── inspector/index.ts        new: overlay host, Alt+I, hold-Alt, Esc
page.bundle.js (MAIN)           untouched — state instrumentation only
```

Frames: the content script runs in every frame (`all_frames: true`), but the
overlay and hotkeys should mount **top frame only**, matching
`src/contentScript/checkpoints/index.ts:81`. Cross-origin iframes cannot be
measured from the parent; each frame could show its own overlay if we later want
that, but hotkeys must stay top-only.

Z-index budget (already established):

| Layer | z-index |
| --- | --- |
| toast | `2147483647` (`toast.ts:13`) |
| palette backdrop | `2147483646` (`palette.ts:77`) |
| **new overlay** | `2147483645` |
| page content | below |

---

## 5. Proposed modules

Pure, testable code first (mirrors how `src/checkpoints/core.ts` was ported):

```
extension/src/inspector/
  types.ts        # Rect, BoxEdges, Guide, GuideOrientation, ToolMode,
                  # TextInspection, InspectMeasurement, TextBlockAnnotation,
                  # DistanceAxis, DistanceRelation, DistanceOverlay
  constants.ts    # snap distance, hitbox, colours, host id, z-index
  geometry.ts     # clamp, getViewportSize, rectContainsPoint, rectsEqual, grow/shrink
  format.ts       # formatValue, formatEdges, formatGap, formatMeasurement, band strips
  dom.ts          # getRectFromDom, getElementLabel, getTextInspection,
                  # getInspectMeasurement, getVisibleTextBlocks
  selection.ts    # getTargetElement, shadow-root descent, common parent, hit-testing
  distances.ts    # getDistanceOverlay
  guides.ts       # createGuide, snapGuidePosition, findGuideAtPoint, guide distances
  styles.ts       # CSS string for the overlay (inspector.component.css:554-1064)
  overlay.ts      # InspectorOverlay class: state, layers, render, events
```

Thin wiring:

```
extension/src/contentScript/inspector/index.ts   # initInspector({...}): mount + hotkeys
```

Modified files:

| File | Change |
| --- | --- |
| `extension/src/contentScript/index.ts:343` | call `initInspector()` next to `initCheckpoints()` |
| `extension/src/contentScript/checkpoints/index.ts:82-98` | route `Alt+I` to the inspector; keep `Alt+S`/`Alt+P` |
| `extension/src/contentScript/checkpoints/palette.ts` | add `tool` rows (Inspect / Type / V / H) in `computeItems()` |
| `extension/src/options/syncOptions.ts` | add `inspectorEnabled`, `hoverHighlightEnabled`, `highlightColor`, `guideColor` |
| `extension/src/options/*Group.tsx` | UI for the four options |
| `extension/test/checkpoints-e2e/run.mjs` | 10 inspector assertions in the existing CDP harness |

`extension/build.mjs` needs no change: the new code is imported from the
existing `content.bundle` entry.

### Rendering model

One shadow host, five independent layers, so pointer-move work stays cheap:

| Layer | Updated on | Contents |
| --- | --- | --- |
| `hover` | `pointermove` (rAF-throttled) | 1 rect |
| `select` | click, scroll, resize | margin/padding/content/gap rects + label + spacing tag |
| `distance` | `pointermove` while `Alt` held | 2 rects, connectors, axis lines, px tags |
| `guides` | place/drag/clear | preview guide, guide buttons, distance tags |
| `type` | toggle, resize (debounced) | up to 160 chips |

Rules:

- Root and all layers: `position: fixed; inset: 0; pointer-events: none`.
- Guide handles are `<button>` with `pointer-events: auto` (same as
  `inspector.component.html:506`).
- Rebuild only the layer that changed; never re-render the whole tree on
  `pointermove`.
- `getVisibleTextBlocks` walks `body *` and calls `getComputedStyle` per node —
  run it only on toggle/resize, never on pointer move.

### Hotkeys (single owner)

Extend the existing capture-phase listener in
`src/contentScript/checkpoints/index.ts` rather than adding a second one:

| Key | Action | Guard |
| --- | --- | --- |
| `Alt+I` | toggle Inspect mode | top frame, trusted event, not composing, not typing text |
| hold `Alt` | distances (select mode only) | `keydown`/`keyup` on `Alt` |
| `Alt+S` | save checkpoint | unchanged (requires store) |
| `Alt+P` | palette | unchanged (requires store) |
| `Esc` | clear selection → guides → transient layers | only when inspector has state |
| `Shift+click` | select element, swallow the page click | select mode only, capture phase |
| `Ctrl/Cmd+click` | select minimum common parent | select mode only |

The existing `typesText()` guard (`checkpoints/index.ts:47-53`) is needed for
`Alt+I` on macOS: Option+I types `ˆ`.

### Palette integration

`inspector-ng`'s palette *is* reSpawn's palette. The palette builds its rows from
the query in `computeItems()` (`palette.ts:351-371`): a `go` row, matching
checkpoints, then a `save` row. Import already exists as `Alt+I` + hidden file
input (`palette.ts:544-547`).

Recommended integration: append four `tool` rows (Inspect, Type, V, H) to
`computeItems()`, after the `save` row.

- They inherit the existing ↑/↓/Enter/Esc handling and the active index for
  free — no port of the Angular command model (±700 lines of index arithmetic
  in `inspector.component.ts:920-1030`).
- They are searchable ("type", "guide"), which is better than a fixed footer.
- `computeItems()` is pure, so the row set is unit-testable.

Alternative: a fixed footer strip with 4 buttons; cheaper visually, but then the
buttons are not reachable by arrow keys and need their own focus model.

---

## 6. Phases

### Phase 1 — pure modules + tests — **done**

- [x] Ported `types.ts`, `geometry.ts`, `dom.ts`, `distances.ts`.
- [x] Guide helpers live in `guides.ts`; hit-testing and common-parent in
      `selection.ts` (instead of the planned `snap.ts`).
- [x] `test/app/inspector/inspector.spec.js`: 24 cases covering geometry,
      formatting, colour normalisation, measurement, distances (separated,
      diagonal, nested, overlapping), snapping, guide distances and the common
      parent.
- [x] Gate: `pnpm --filter respawn-extension type-check`, lint and `test:app`
      pass.

### Phase 2 — overlay engine (select mode) — **done**

- [x] `styles.ts` (boxes, bands, tags, chips, guides, distances) using the
      extension's hex/zinc palette rather than `oklch`.
- [x] `overlay.ts`: shadow host, five layers, box model, gap, label, spacing
      tag, scroll/resize recompute, host recovery observer.
- [x] `contentScript/inspector/index.ts` + `contentScript/index.ts` wiring.
- [x] `Alt+I`, `Esc`, `Ctrl`/`Cmd`+click; inspect mode consumes clicks instead
      of requiring `Shift` (see §10).
- [x] Gate: covered by the CDP e2e (hover box matches `getBoundingClientRect`,
      click pins, `Esc` clears).

### Phase 3 — distances, guides, typography — **done**

- [x] `Alt` hold → distance layer (rects, connectors, axis tags, nested sides).
- [x] Guide mode: preview, place, drag, snap (10px), hitbox (14px), adjacent
      distance labels, clear.
- [x] Typography: visible text blocks, chips, viewport clamp, debounced refresh.
- [x] Palette tool rows: Inspect / Type / Vertical guides / Horizontal guides.
- [x] Gate: e2e covers distances, guide placement and typography.

### Phase 4 — settings + persistence — **not done (out of scope)**

- [ ] Options (`inspectorEnabled`, `hoverHighlightEnabled`, colours) — skipped;
      the overlay uses the palette's defaults.
- [ ] Guide persistence — deliberately skipped; guides stay in memory.

### Phase 5 — DevTools Elements sidebar — **not done (out of scope)**

Skipped per the decision to ship the page overlay only.

### Phase 6 — e2e + docs — **done**

- [x] `test/checkpoints-e2e/run.mjs` gained 10 inspector checks: host, hover,
      selection, swallowed clicks, `Alt` distances, `Esc`, clicks after `Esc`,
      palette tool rows, guide placement, typography.
- [x] README: new "Element inspector" section and updated shortcut table.
- [x] Gate: `build:extension` and the e2e suite (58/58) pass.

---

## 7. Decisions (resolved)

1. **`Alt+I`** — inspect mode on the page. The palette's `Alt+I` import shortcut
   is removed; import stays reachable through the upload button in the palette
   header.
2. **Pets** — dropped. Nothing from `pet-*.ts` / `generated-pets*.ts` is ported.
3. **Guides** — in memory only. No `chrome.storage.local` persistence.
4. **Typography surface** — page chips only. No DevTools Elements sidebar.
5. **Store requirement** — none for the inspector. Only `Alt+S` / `Alt+P` stay
   store-gated.
6. **`Shift+click`** — superseded: inspect mode consumes every click (see §10).
7. **Pages that already ship `inspector-ng`** — the extension stands down when
   `<inspector-overlay>` is present.

---

## 8. Risks and constraints

| Risk | Mitigation |
| --- | --- |
| `pointermove` cost on huge pages | rAF-throttle; per-layer rendering; typography only on toggle/resize |
| Page CSS leaking into the overlay | shadow root + inline `<style>` (existing palette pattern) |
| Page scripts hiding/removing the host | host id `respawn-inspector-host`, re-mount on `document_start`; page can still remove it — acceptable, same as palette |
| `Shift+click` breaking app interactions | only in select mode; `Esc` and `Alt+I` exit |
| macOS `Option+I` typing `ˆ` | reuse `typesText()` guard (`checkpoints/index.ts:47-53`) |
| Cross-origin iframes | content script runs per frame; no cross-frame measurement; hotkeys top-frame only |
| Firefox MV3 differences | isolated-world only, no `world: MAIN` dependency |
| Overlay on top of DevTools-inspected page | nothing to do — DevTools sidebar is separate (Phase 5) |
| Bundle growth | pure modules ~15 KB; no pet sprites |

---

## 9. Verification gates

```bash
pnpm --filter respawn-extension type-check
pnpm --filter respawn-extension lint
pnpm --filter respawn-extension build:extension
pnpm --filter respawn-extension test:app
node test/checkpoints-e2e/run.mjs      # 58/58, includes 10 inspector checks
```

Manual, on `test/checkpoints-e2e/fixtures/redux` and the NgRx fixture:

1. `Alt+I` shows a hover box; the label matches DevTools' box model.
2. Click pins the selection; scroll and resize keep it aligned.
3. Hold `Alt` over a sibling → horizontal/vertical px distances; nested elements
   → four-side distances.
4. Palette → Vertical/Horizontal guides: preview follows the cursor, click
   places, drag moves, snapping at ≤ 10px, adjacent labels update, `Esc` clears.
5. Palette → Type shows chips with swatch + font-size + line-height + hex colour.
6. `Ctrl/Cmd+click` selects the common parent.
7. `Alt+P` palette still restores/navigates; the tool rows work.
8. No console errors on a page without a store.

---

## 10. Deviations from the plan

| Planned | Shipped | Why |
| --- | --- | --- |
| `Shift+click` selects without firing the page click | Inspect mode consumes **all** clicks | inspector-ng's plain click both selected and activated the element, which makes inspecting a button press it. Mesurer consumes pointer/click while its tool is on, like DevTools' picker. |
| Palette `Alt+I` = import | Import only via the upload button | `Alt+I` is inspect on the page; one meaning is better than a shortcut that changes with focus. |
| `snap.ts` | `guides.ts` + `selection.ts` | Guide math and hit-testing are separate concerns; both are unit-tested. |
| `paddingRect` (inspector-ng) | `contentRect` | inspector-ng's `paddingRect` was the content box; the name now matches the CSS box model. Bands are drawn as strips so margin/padding colours do not blend. |
| Options for colours/hover | Hard-coded defaults from the palette | Out of scope for the first pass; the values live in `constants.ts`. |
| Guides per origin | In memory | Per decision. |
| DevTools Elements sidebar | Not built | Per decision. |
| Pets | Not ported | Per decision; also 133 KB of base64 in the content bundle. |

---

*Written 2026-10-28 against `inspector-ng` at `projects/inspector-ng/src/lib`
and reSpawn at commit on `main`; implementation notes added the same day.*

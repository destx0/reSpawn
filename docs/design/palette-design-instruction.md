# reSpawn palette — design instruction

Restyle only the **Alt+P palette** (`extension/src/contentScript/checkpoints/palette.ts`). Do not touch the DevTools panel. Use `docs/design/palette-refined.html` as the visual reference; ignore its lab page, annotation, notes and theme controls.

## Direction

Clean, monochrome, dark-first. No hue anywhere: black, white and neutral gray shades only. Dark is the default; do not follow the OS theme.

## Surface

- 600px max width, 11px radius, 1px neutral border, soft two-layer shadow.
- Dark: bar `#252525`, body `#1b1b1b`, toolbar `#141414`; text `#fafafa` / `#e8e8e8` / `#b4b4b4` / `#8c8c8c`; selected `#2a2a2a` with a 1px white-alpha inset ring; hover `rgba(255,255,255,.05)`.
- Light: inverse paper grays, black accents.

## Search bar — 46px

- Search icon, 13px input, one rotating shortcut hint, globe icon with a 5px dot.
- Hint: 8.5px, faint, one keycap plus one or two words. Rotate on each palette open: `restore`, `go`, `save`, `all sites`, `route`, `rename`, `delete`, `export`.
- Hide the hint while typing; no timer. Hide it under 620px.
- No count badge, no import in the search bar, no labels.

## Checkpoint list

- Only checkpoints: no save row, section labels, bookmark icons or footer.
- 40px rows. Title 12.5px/600; route 9.5px mono; time 9px mono, right-aligned.
- Hover reveals a single `⋯`. Selected row: full 1px ring plus a shade fill; no side stripe, dot or keycaps.
- Route-query row and typed-name save row appear only while relevant.

## Bottom toolbar — 46px

- Filled plus = **Save current state**. It is the only filled control.
- Divider, then four ghost inspector tools. Divider, then a ghost import icon.
- No labels, no footer, no keycaps. If there is no inspector, omit the tools.

## Type and motion

- Source Sans 3 / Source Sans Pro for UI; Source Code Pro for routes and times.
- 180ms palette entrance; 120ms hover; respect reduced motion.

Keep every existing command and behavior: save, restore, go, all sites, rename, delete, export, import and inspector tools.

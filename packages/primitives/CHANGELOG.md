# Changelog

Developer preview: names, parts and data shapes can change between versions. Versions are `0.0.x` until a `0.1.0`.

## 0.0.11

- Default look for the chart: with `tokens.css` alone, candles, volume, grid, axis labels, crosshair, studies, panel series and the volume profile are drawn readable on a light page and a dark one. Marks follow the page's text colour (`currentColor`) with the up and down colours mixed in; up bodies are light, down bodies solid. The rules use `:where()`, so your own CSS still wins. In 0.0.10 these drew black until you added the README's chart CSS.

## 0.0.10

First public release (Apache-2.0).

- Licence: Apache-2.0 (`LICENSE`). The TypeScript source in `src/` (without tests) ships in the package.
- New parts since 0.0.6: `Tape` (latest trades, newest first, rows hold still while you read) and `Ladder` (price-grouped rows, size bars, last price and spread). Core: `readTape`, `holdTape`, `tapeSummary`, `newestFirst`, `buildLadder` and their key rules.
- A live demo page drives `Tape` and `Ladder` together from one made-up feed: https://ui.matchstick.trading/docs/live.
- Series carry a clock: `Panels.Root` series and `Study.Line` take `points` (`{ t, kind, v? }`). The bare `values` array is a shim that still works and will be removed in a later version; `pointsFromValues` converts one.
- Core: series contract and `report`, the `DataAdapter` interface and `csvAdapter`.
- Panels: one-point runs drawn as dots, a fixed `range` per band, reference `levels`, `style: 'histogram'`.
- Design tokens moved to the shared Matchstick tokens: the focus colour is pink and a few neutrals changed (see "Tokens" in the README).

## 0.0.6 and earlier

Not published. Everything above builds on the 0.0.2 to 0.0.6 previews: chart, studies, drawings, volume profile, panels, selection, toolbar and menu, full screen, replay transport, scrubber and cursor, depth profile, diff table, symbol search, receipt, notice and the CSV reader.

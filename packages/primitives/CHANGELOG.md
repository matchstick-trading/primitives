# Changelog

Developer preview: names, parts and data shapes can change between versions. Versions are `0.0.x` until a `0.1.0`.

## Unreleased

- `Chart.Root` takes `validatedBars`: promise your bars are clean and the chart skips the per-bar check, which matters for a very long series replaced on every update. Default off. A very long series also no longer sorts every gap to find its usual gap (a fixed pseudo-random sample of 20 000 gaps is used above 20 000 bars).

- Fixes for live and interactive charts, found by three independent bug-hunting runs:
  - `followLiveEdge` on an empty or short chart keeps every bar in view instead of sliding the view past the first bar.
  - `atLiveEdge` is true when the newest bar is at the right edge even after a zoom (the right edge need not be exactly the bar count); `growViewport` follows such a view too.
  - `growViewport` keeps a zoomed-out view's span on each new bar instead of snapping back to the last 120.
  - A price range set by hand is dropped when the bars change to a series it no longer touches (a symbol switch), so the chart is not blank.
  - `applyTick` continues the newest bar's own grid, so daily bars stamped at a local midnight (or a CSV with a UTC offset) take ticks instead of dropping them as late.
  - `Scrubber`: a second pointer during a drag no longer begins a second gesture, and the thumb's keys do nothing during a drag, so a release commits once.
  - `barInterval` is recomputed when a host refills the same array; a trade without an `id` no longer collides with another row's given id.

## 0.0.12

- First slice of Live, in `@matchstick-trading/primitives/core`, additive. `applyTick(bars, tick, interval)` folds one tick into the newest bar or opens a new bar when the interval rolls over; a tick for a bar that has closed, or with a bad number, is reported with a note and changes nothing. `atLiveEdge` and `followLiveEdge` keep a viewport on the newest bar only if it was on it. New example `examples/live-bars.mjs` (synthetic ticks). Ticks use `CandleBar`'s units (numbers, Unix milliseconds); no `Chart` change, no throttled announcements and no feed yet.

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

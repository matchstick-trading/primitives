# Changelog

Developer preview: names, parts and data shapes can change between versions. Versions are `0.0.x` until a `0.1.0`.

## 0.0.13

- `parseBarsCsv`: in a semicolon or tab file, a row refused for its time no longer decides that the file writes decimal points (it could turn `1,080` into 1080 in the rows that were kept). Found by the Codex review of this release.
- `readTradesCsv`: a price or size written `.25`, `10.` or (in a decimal-comma file) `,25` is read as `0.25`, `10` and `0.25` instead of the trade being dropped by the tape's rules, and a date that does not exist (`2026-02-30`) is named as that row's problem instead of reordering the valid rows around it; a price written `.25` or `10.` now also settles that a file writes decimal points, so `1,200` beside it is a thousand, and a side such as `constructor` is refused like any other bad side. Found by the Codex review of this release; trade markers also follow a bar array refilled at the same length (the window of a history sliding forward).

- First-hour help (DEV-2026-11-567). Nothing about what is drawn changes.
  - In development (not in a production build), `Chart.Root` logs one console warning when it leaves bars out ("3 of 3 bars left out of the chart: 3 with a timestamp that is text (an ISO date or digits): a bar timestamp is a number in Unix ms") or when every bar looks stamped in Unix seconds, which draws January 1970. An empty or missing list says nothing, since that is a chart still loading. `validatedBars` skips the check.
  - A series point whose time is a number is named in the series' problems ("Bars take Unix milliseconds; series points take ISO-8601 UTC text"). Both time formats stay; the README now shows them side by side.
  - The four `examples/*.mjs` scripts say to run `npm run build` first in a clone (they import the built package); from the npm copy nothing changes.

- Trade markers (DEV-2026-11-561): `Chart.TradeMarkers` draws one mark per trade on its bar at its price (a triangle up for a buy, down for a sell, a diamond for an unknown side). Display only. `readTradesCsv` (core) reads a trades file (time, price, size, side) into the rows `Tape` and the markers take, names each bad row by its line in the file and keeps prices and sizes as the exact text written; `describeTradesCsv` gives a status line; `placeTradeMarkers` is the bar-and-price lookup behind the part. Additive; the names can change before a release (#467).

- `Chart.Root` takes `validatedBars`: promise your bars are clean and the chart skips the per-bar check, which matters for a very long series replaced on every update. Default off. A very long series also no longer sorts every gap to find its usual gap (a fixed pseudo-random sample of 2 000 gaps is used above 2 000 bars), and `barsAreDaily` reuses that cached answer.

- Fixes for live and interactive charts, found by three independent bug-hunting runs:
  - `followLiveEdge` on an empty or short chart keeps every bar in view instead of sliding the view past the first bar.
  - `atLiveEdge` is true when the newest bar is at the right edge even after a zoom (the right edge need not be exactly the bar count); `growViewport` follows such a view too.
  - `growViewport` keeps a zoomed-out view's span on each new bar instead of snapping back to the last 120.
  - A price range set by hand is dropped when the bars change to a series it no longer touches (a symbol switch), so the chart is not blank.
  - `applyTick` continues the newest bar's own grid, so daily bars stamped at a local midnight (or a CSV with a UTC offset) take ticks instead of dropping them as late.
  - `Scrubber`: a second pointer during a drag no longer begins a second gesture, and the thumb's keys do nothing during a drag, so a release commits once.
  - `barInterval` is recomputed when a host refills the same array; a trade without an `id` no longer collides with another row's given id.

- Input fixes from Fable round 2 (DEV-2026-11-552):
  - A bar without `volume` draws no NaN in `Chart.Volume`, the readout and table leave volume out instead of printing "undefined", and `applyTick` starts such a bar's volume from 0.
  - The CSV reader honours an hours-only offset (`+01`, `-05`, `+00`).
  - In a tab or semicolon file whose prices use decimal points, a comma in a number is a thousands separator (`12,345`), not a decimal comma.
  - A 14-digit or 12-digit stamp such as `20240102143000` is read as that date-time instead of a 1970 or 1976 Unix time.
  - A header-less file's extra columns and a blank-header column are read as series named `Column N` instead of being dropped.
  - `csvAdapter.read` and `parseBarsCsv` return an error result, not a throw, for input that is not text or for `null` options.
  - A column named `volatility` or `vol_change` is no longer read as volume.
  - `snapToBar` returns `null` with no bars (it made an anchor at 1970), so `Drawings.Layer` places nothing on an empty chart.
  - `Scrubber.Thumb` leaves arrows, Home and End with Alt, Ctrl or Meta held to the browser.
  - `Chart.Root` rescales when the newest or first bar is replaced in place, or the same array is refilled at the same length.
Fixes from the first outside user, all on daily bars.

- `TimeAxis` prints dates ("Nov 9", with the year when it changes) when the bars are a day or more apart; intraday bars still print HH:MM. `formatBarDate` and `barsAreDaily` are in the core. A `format` prop still wins.
- The first `TimeAxis` label no longer clips at the chart's left edge: when centring it would cross the edge, it starts at the edge (#463).
- `Study.Line`: `name` is optional (a line with none is listed under its `id`, or "Study", instead of drawing without a Legend entry), and `values` (one number per bar, what `sma(bars, 20)` returns) is no longer deprecated for a study computed from the chart's own bars. `points` stays for a series on its own clock. `Panels.Root` is unchanged.
- `tokens.css` sizes and fills the `Scrubber` track and draws its thumb and marks; `--mt-scrubber-height` sets the height (24px).
- The instruction file (`AGENTS.md`) and README no longer tell an agent to avoid real data. You can chart your own data and feeds in your own app; the only rule is to check your data provider's terms before you paste market data into anything you publish or share. The examples we ship stay made-up.

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

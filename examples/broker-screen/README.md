# Broker screen

A small, runnable example: the trader-facing screen of a trading app, with a chart, a price ladder and a tape, fed by a
made-up broker feed. It is the shape you would use on top of a back end that has an API and no screen of its own. It
uses the published package, `@matchstick-trading/primitives` 0.0.13, and nothing else but React and Vite. All data is
made up.

[Open in StackBlitz](https://stackblitz.com/github/matchstick-trading/primitives/tree/main/examples/broker-screen) (no account needed), or run it locally:

```sh
npm install
npm run dev
```

What you get: 40 earlier bars, then live bars that open every five seconds; a ladder that follows the book; a tape of
the latest trades, newest first; and a button that pauses the feed.

## How it works

- `src/mockBroker.ts`: the stand-in for your back end. `mockHistory()` is what a history call would return;
  `startMockBroker(onTick, onBook)` is what a pushed feed would call. To use a real back end, replace this file and keep
  the callbacks. Mind the data terms of whatever feed you connect.
- `src/App.tsx`: one `applyTick()` call (from `@matchstick-trading/primitives/core`) folds each tick into the newest
  bar or opens a new one; the ladder gets the book as exact decimal strings; the tape gets the ticks as trades.

## Limits

- A developer preview: parts and names can change in the next version.
- Checked in Chromium on desktop Linux only. Not checked on Safari, a phone or a screen reader.
- The feed is a timer in the page. A real feed also needs login, reconnects and rate limits, which this does not show.
- The chart shows all bars it is given; it has no "follow the newest bar" control yet. This example keeps the last 120 bars.
- `npm run build` prints many "use client" warnings from the package. They are harmless here: the build succeeds.
- The parts show data; they place no orders.

MIT licence, for this folder only: see [LICENSE](LICENSE). The package under `packages/primitives` is Apache-2.0.

# Replay on a chart

A small, runnable example: replay a made-up session bar by bar, with a bot's trades appearing on the chart as the replay
passes them. It uses the published package, `@matchstick-trading/primitives` 0.0.13, and nothing else but React and Vite.
All data is made up.

[Open in StackBlitz](https://stackblitz.com/github/matchstick-trading/primitives/tree/main/examples/replay-on-a-chart) (no account needed), or run it locally:

```sh
npm install
npm run dev
```

What you get: candles and volume, a scrubber, Start / Back / Play / Forward, a speed picker, and four buy and sell marks.
Play stops at the last bar; Play again starts over.

## How it works

- `src/data.ts`: the bars (`timestamp` in milliseconds, open, high, low, close, volume) and a list of trades (time, side,
  price). Replace both with your own. The trade time has to match a bar's `timestamp`.
- `src/App.tsx`: the replay is one number, how many bars have been revealed. The chart gets `bars.slice(0, bar + 1)`.
  `Transport` and `Scrubber` only report clicks; this file decides what they do and runs the timer.
- `src/TradeMarks.tsx`: Primitives has no trade-marker part yet, so this draws one with `useChart()`, which gives the
  frame (the bars in view, the price range, the bar width). It must sit inside `Chart.Plot`. When a marker part is added
  to the package this file is what it replaces.

## Limits

- A developer preview: parts and names can change in the next version.
- Checked in Chromium on desktop Linux only. Not checked on Safari, a phone or a screen reader.
- `npm run build` prints many "use client" warnings from the package. They are harmless here: the build succeeds.
- The marks are drawn per trade, with no thinning: a very long list of trades will be slow. Try it before you rely on it.
- The parts show data; they place no orders.

MIT licence, for this folder only: see [LICENSE](LICENSE). The package under `packages/primitives` is Apache-2.0.

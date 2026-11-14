# Review an agent’s trades

A small, runnable example: an AI agent suggests trades on a made-up session, you replay the session, and you accept or
reject each suggestion as it appears. It uses the published package, `@matchstick-trading/primitives` 0.0.12, and nothing
else but React and Vite. All data is made up. There is no model, no network and no broker: the "agent" is a list in
`src/data.ts`, and nothing you click is sent anywhere.

[Open in StackBlitz](https://stackblitz.com/github/matchstick-trading/primitives/tree/main/examples/agent-review) (no account needed), or run it locally:

```sh
npm install
npm run dev
```

What you get: candles and volume, a scrubber, Start / Back / Play / Forward, a speed picker, and six suggested trades.
Each suggestion appears on the chart and in a list when the replay reaches it. Accept or Reject it (press again to undo);
the mark on the chart and the count above the list follow your choice.

## How it works

- `src/data.ts`: the bars and the agent’s suggestions. A suggestion is `id`, `time`, `side`, `price`, `size`, `note` and
  `accepted` (`null` = not reviewed, `true` = accepted, `false` = rejected). That shape belongs to this example, not to
  Primitives: copy it, rename it, or replace it with whatever your agent sends.
- `src/App.tsx`: the replay is one number, how many bars have been revealed. The review is a list in React state, one
  `accepted` value per suggestion. `Transport` and `Scrubber` only report clicks; this file decides what they do.
- `src/ProposalMarks.tsx`: draws the marks with `useChart()` (the same approach as the replay example), because this
  version of the package has no trade-marker part. It must sit inside `Chart.Plot`.

## Limits

- A developer preview: parts and names can change in the next version.
- The review is kept in memory only; reload and it is gone. Wiring it to a real agent, a log or a broker is yours to do.
- Checked in Chromium on desktop Linux only. Not checked on Safari, a phone or a screen reader.
- `npm run build` prints many "use client" warnings from the package. They are harmless here: the build succeeds.
- The parts show data; they place no orders.

MIT licence, for this folder only: see [LICENSE](LICENSE). The package under `packages/primitives` is Apache-2.0.

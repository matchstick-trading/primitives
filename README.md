# Matchstick Primitives

Headless, keyboard-first parts for trading screens: candles and volume, studies, volume profile, drawing tools,
a replay transport, depth and symbol search. The logic is a plain-TypeScript core with no dependencies; React
parts sit on top of it.

**Docs and live demos:** https://ui.matchstick.trading

> **Developer preview, v0.0.13.** Parts, names and data shapes can change in the next version without a migration
> path. Nothing here promises later versions, updates or support.

## What this repository is for

This repository holds the package source (`packages/primitives`), the issue tracker, these notes and small teaching examples.

Install the package from npm: `npm install @matchstick-trading/primitives` (React 18 or 19 is a peer dependency).

Licence: Apache-2.0, this package only. Matchstick Replay and the engine are not covered. See
[`packages/primitives/LICENSE`](packages/primitives/LICENSE).

Open an issue to:

- report a bug in a part, a demo or the docs, or
- ask an integration question: how to fit the parts into your framework, your data shape or your build.

## Examples

`examples/` holds small teaching examples written for this repository, each MIT-licensed under its own `LICENSE`
file. That licence covers only the example folder it sits in; the package under `packages/primitives` is Apache-2.0.

- [Symbol ranking](examples/symbol-ranking): one way to rank symbol-search results, in plain TypeScript.
  [Open in StackBlitz](https://stackblitz.com/github/matchstick-trading/primitives/tree/main/examples/symbol-ranking), no account needed.
- [Replay on a chart](examples/replay-on-a-chart): replay a made-up session bar by bar, with a bot's trades drawn on the chart as it passes them.
  [Open in StackBlitz](https://stackblitz.com/github/matchstick-trading/primitives/tree/main/examples/replay-on-a-chart), no account needed.
- [Review an agent’s trades](examples/agent-review): replay a made-up session while a made-up agent suggests trades; accept or reject each one as it appears.
  [Open in StackBlitz](https://stackblitz.com/github/matchstick-trading/primitives/tree/main/examples/agent-review), no account needed.
- [Broker screen](examples/broker-screen): a chart, a price ladder and a tape fed by a made-up broker feed.
  [Open in StackBlitz](https://stackblitz.com/github/matchstick-trading/primitives/tree/main/examples/broker-screen), no account needed.

## Version and supported scope

v0.0.13. What was run and checked, and what wasn't yet, is listed on
[Supported scope](https://ui.matchstick.trading/docs/supported). In short:

- React 19.2 and 18.3.1 for the React parts; the core needs no framework.
- 0.0.13 was checked in Chromium on desktop Linux: the test suite, and the new development warnings in a built bundle (development and production). The packed install under React 18 and 19 and the light and dark page check were last run on 0.0.11. Earlier
  previews were also checked in Chrome 151 and Firefox 155 on desktop Linux, and touch by emulation.
- Real Safari on an iPad was run for 0.0.4 only. Nothing since, including 0.0.13, has been run on real Safari.
  Phone browsers and screen readers are not checked yet.
- Times are shown in UTC. The bars and volume share one price pane; other series can have their own panes (opt-in).

## Reporting an issue

1. Check [Supported scope](https://ui.matchstick.trading/docs/supported): the problem may be a known limitation.
2. Pick a template: **Bug** or **Integration question**.
3. Reproduce it with synthetic or made-up data. Please don't paste real account data, customer details, API keys,
   licence tokens or data you don't have the right to share.

## Data

Every demo uses synthetic data generated in the browser. Nothing in the docs or this repository is market data,
and nothing here is investment advice. The parts show data; they don't place orders.

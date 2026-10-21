# Matchstick Primitives

Headless, keyboard-first parts for trading screens: candles and volume, studies, volume profile, drawing tools,
a replay transport, depth and symbol search. The logic is a plain-TypeScript core with no dependencies; React
parts sit on top of it.

**Docs and live demos:** https://ui.matchstick.trading

> **Developer preview, v0.0.1.** Parts, names and data shapes can change in the next version without a migration
> path. Nothing here promises later versions, updates or support.

## What this repository is for

This repository holds the issue tracker and these notes. It does not hold the source.

No licence yet. Lawyers cost money and this is a one-person company, so the terms are coming once we can afford to write them properly. Until then, read the docs and try the playground, and the source stays with us.

What you may do today: evaluate the docs and the playground. Using the source is not allowed yet.

Open an issue to:

- report a bug in a part, a demo or the docs, or
- ask an integration question: how to fit the parts into your framework, your data shape or your build.

## Version and supported scope

v0.0.1. What was run and checked, and what wasn't yet, is listed on
[Supported scope](https://ui.matchstick.trading/docs/supported). In short:

- React 19.2 and 18.3.1 for the React parts; the core needs no framework.
- Checked in Chrome 151 and Firefox 155 on desktop Linux. Safari, mobile browsers, touch and screen readers are
  not checked yet.
- Times are shown in UTC. One price pane with volume; no separate oscillator pane yet.

## Reporting an issue

1. Check [Supported scope](https://ui.matchstick.trading/docs/supported): the problem may be a known limitation.
2. Pick a template: **Bug** or **Integration question**.
3. Reproduce it with synthetic or made-up data. Please don't paste real account data, customer details, API keys,
   licence tokens or data you don't have the right to share.

## Data

Every demo uses synthetic data generated in the browser. Nothing in the docs or this repository is market data,
and nothing here is investment advice. The parts show data; they don't place orders.

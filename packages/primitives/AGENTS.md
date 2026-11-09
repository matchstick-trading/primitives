# Matchstick Primitives: how an agent should use this package

You are reading the package that was installed, so read it from here instead of the website. Developer preview 0.0.12;
names and parts can change. All data in the examples is made up.

## Ask first

- Ask the user before you write any file in their project, install anything else, or open a sign-in.
- Never read environment files, and never print keys, tokens or passwords.
- Licence: Apache-2.0 (`LICENSE`). Copying code from `src/` into the user's project is allowed under that licence, but
  ask first (see above) and keep the licence notice with any file you copy.

## Read in this order

1. `README.md`: what the parts are and a first chart.
2. `dist/index.d.ts`: every part, prop and type, with doc comments. `dist/core/index.d.ts` is the React-free core.
3. `src/tokens.css` (import it as `@matchstick-trading/primitives/tokens.css`): the design tokens. The rest of `src/` is the readable TypeScript source. Parts set `data-part` and state attributes; style those, not class names.
4. `examples/`, when present: run one and describe what it printed or drew.

## Rules

- Use made-up data only. Do not connect a part to a real market data feed or to the user's account.
- There is no order entry, account or trading feature here, and the parts do not place trades. Do not add them or
  suggest that they do.
- Make no claim about brokers, platforms or other products, about performance or trading results, or about price.
- Do not report "done" without saying what you saw. If something was blocked or blank, say what and why.

## What it cannot do yet

Say these to the user before they plan around the package. The full list is https://ui.matchstick.trading/docs/supported.

- Series take `points` (`{ t, kind, v? }`, ISO-8601 UTC `t`); the bare `values` array is a shim that is still accepted in this version and will be removed in a later one. See the README, "Give a series a clock".
- It is a developer preview (0.0.12): names, parts and data shapes can change without a migration path, and there is no promise of updates or support.
- It is licensed Apache-2.0, for this package only (see `LICENSE` and the README).
- `./core` has no rendering. Without React you draw the output yourself.
- Cursor and Transport state live in the React parts, not in `./core`.
- Only what the supported-scope page lists was run and checked; anything not listed is unchecked, not known to fail.

## Where to look when something does not work

- Styling looks absent: import `@matchstick-trading/primitives/tokens.css` once. From 0.0.11 it draws the chart parts in the page's text colour; before that, style the `data-` attributes yourself. Your own CSS wins.
- A study line is invisible: from 0.0.11 `tokens.css` strokes it; on 0.0.10 the study parts draw SVG with no stroke or fill and the README has the `data-part='study-line'` rule and the nesting (`Study.Root` inside `Chart.Root`, around `Chart.Plot` and `Study.Legend`).
- A chart is blank: it needs a non-empty, ascending list of bars with unique `timestamp` values in milliseconds.
- Questions and issues: https://github.com/matchstick-trading/primitives/issues

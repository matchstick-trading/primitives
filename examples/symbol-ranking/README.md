# Symbol ranking

A small teaching example: one way to rank symbol-search results, in plain TypeScript with no dependencies.
It is written for reading, not copied from the Matchstick Primitives kit.

[Open in StackBlitz](https://stackblitz.com/github/matchstick-trading/primitives/tree/main/examples/symbol-ranking) (no account needed), or run it locally:

```sh
npm install
npm run dev
```

The order, best first:

1. The symbol, exactly: `acme` → ACME first, then ACMEW (a prefix).
2. The start of a symbol: `ac` → ACX, ACME, ACMEW.
3. An alias, exactly: `blue` → BLU.
4. The start of a word in the name: `ridge` → RDG, NRTH. Several words must each start a name word: `north rail` → NRTH.

Ties go to the shorter symbol, then A to Z. There is no typo tolerance, on purpose: `acmr` finds nothing.

The instruments are made up. MIT licence, for this folder only: see [LICENSE](LICENSE).

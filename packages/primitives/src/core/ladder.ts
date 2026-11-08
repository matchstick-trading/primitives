/**
 * The rules of the price ladder as plain functions. Prices and sizes arrive as exact decimal strings and are summed and
 * grouped as scaled integers, never as floats; the only number made here is a bar's width, 0 to 1. A level that breaks a
 * rule is reported and left out. A crossed book is reported and still drawn as given: nothing here repairs a book.
 */

export interface LadderLevelIn {
  /** Exact decimal string, above zero. */
  price: string;
  /** Exact decimal string, above zero. */
  size: string;
}

export interface LadderInput {
  bids: readonly LadderLevelIn[];
  asks: readonly LadderLevelIn[];
  /** The grouping step, an exact decimal string above zero: `0.25` groups prices into quarters. Bids round down, asks round up, so grouping never crosses the spread. */
  step: string;
  /** Rows shown on each side, nearest the spread. Default 10. */
  levels?: number;
  /** The last trade price, for the divider row. */
  last?: string;
  /** Size traded at each price, for the traded column. A trade at or above the best ask is counted in the ask row's bucket, a lower one in the bid row's. */
  traded?: readonly LadderLevelIn[];
}

export type LadderSide = 'bid' | 'ask';

export interface LadderRow {
  /** `side:price`, the row's identity (the price, not the position). */
  id: string;
  side: LadderSide;
  /** The bucket's price, with as many decimal places as the step. */
  price: string;
  /** Total size in the bucket, with as many places as the most precise size given. */
  size: string;
  /** Size traded at this price, when any was. */
  traded?: string;
  /** Bar width: this row's size over the largest row shown, 0 to 1. */
  fraction: number;
  /** The best bid or the best ask. */
  best: boolean;
}

export interface LadderIssue {
  where: 'bids' | 'asks' | 'traded' | 'step' | 'last' | 'book';
  /** Place in that list, when the problem is one entry. */
  index?: number;
  message: string;
}

export interface LadderBuilt {
  /** Top to bottom: highest ask first, lowest ask last. */
  asks: LadderRow[];
  /** Top to bottom: highest bid first. */
  bids: LadderRow[];
  /** Asks then bids, the order a ladder is drawn. */
  rows: LadderRow[];
  /** The divider between asks and bids: the last price and the spread, each only when it can be said. */
  last: { price?: string; spread?: string };
  issues: LadderIssue[];
}

const POSITIVE = /^(\d+)(?:\.(\d+))?$/;

interface Dec { units: bigint; places: number }

function parse(value: unknown): Dec | null {
  if (typeof value !== 'string') return null;
  const m = POSITIVE.exec(value);
  if (!m || !/[1-9]/.test(value)) return null;
  const places = m[2]?.length ?? 0;
  return { units: BigInt(m[1] + (m[2] ?? '')), places };
}

const rescale = (d: Dec, places: number): bigint => d.units * 10n ** BigInt(places - d.places);

function show(units: bigint, places: number): string {
  const digits = units.toString().padStart(places + 1, '0');
  return places === 0 ? digits : `${digits.slice(0, -places)}.${digits.slice(-places)}`;
}

interface Good { index: number; price: Dec; size: Dec }

function readLevels(list: readonly LadderLevelIn[] | undefined, where: 'bids' | 'asks' | 'traded', issues: LadderIssue[]): Good[] {
  const out: Good[] = [];
  (list ?? []).forEach((item, index) => {
    const price = parse(item?.price);
    const size = parse(item?.size);
    if (!price || !size) { issues.push({ where, index, message: `${!price ? 'price' : 'size'} must be an exact decimal string above zero` }); return; }
    out.push({ index, price, size });
  });
  return out;
}

/**
 * Group the book into rows. Bids and asks are grouped by `step`, summed exactly, trimmed to `levels` rows a side, and
 * given a bar width. Nothing is drawn for a level that breaks a rule; `issues` says which.
 */
export function buildLadder(input: LadderInput): LadderBuilt {
  const issues: LadderIssue[] = [];
  const empty: LadderBuilt = { asks: [], bids: [], rows: [], last: {}, issues };
  const step = parse(input.step);
  if (!step) { issues.push({ where: 'step', message: 'step must be an exact decimal string above zero' }); return empty; }
  const bids = readLevels(input.bids, 'bids', issues);
  const asks = readLevels(input.asks, 'asks', issues);
  const traded = readLevels(input.traded, 'traded', issues);

  const places = Math.max(step.places, ...bids.concat(asks, traded).map((g) => g.price.places));
  const unit = rescale(step, places);
  const sizePlaces = Math.max(0, ...bids.concat(asks, traded).map((g) => g.size.places));
  const floor = (p: bigint) => (p / unit) * unit;
  const ceil = (p: bigint) => ((p + unit - 1n) / unit) * unit;

  const bucket = (list: Good[], round: (p: bigint) => bigint): Map<bigint, bigint> => {
    const sums = new Map<bigint, bigint>();
    for (const g of list) {
      const key = round(rescale(g.price, places));
      sums.set(key, (sums.get(key) ?? 0n) + rescale(g.size, sizePlaces));
    }
    return sums;
  };
  const descending = (a: bigint, b: bigint) => (a < b ? 1 : a > b ? -1 : 0);
  const take = Math.max(1, Math.floor(input.levels ?? 10));
  const bidBuckets = [...bucket(bids, floor)].sort((a, b) => descending(a[0], b[0])).slice(0, take);
  const askBuckets = [...bucket(asks, ceil)].sort((a, b) => descending(b[0], a[0])).slice(0, take); // lowest first, nearest the spread

  const bestBid = bids.length ? bids.reduce((m, g) => (rescale(g.price, places) > m ? rescale(g.price, places) : m), 0n) : null;
  const bestAsk = asks.length ? asks.reduce((m, g) => { const p = rescale(g.price, places); return m === null || p < m ? p : m; }, null as bigint | null) : null;
  if (bestBid !== null && bestAsk !== null && bestBid >= bestAsk) {
    issues.push({ where: 'book', message: `crossed book: best bid ${show(bestBid, places)} is not below best ask ${show(bestAsk, places)}` });
  }

  // Traded size: at or above the best ask it belongs to an ask row, below it to a bid row.
  const tradedUp = bucket(traded.filter((g) => bestAsk !== null && rescale(g.price, places) >= bestAsk), ceil);
  const tradedDown = bucket(traded.filter((g) => bestAsk === null || rescale(g.price, places) < bestAsk), floor);

  const largest = [...bidBuckets, ...askBuckets].reduce((m, [, s]) => (s > m ? s : m), 0n);
  const bar = (s: bigint) => (largest === 0n ? 0 : Number((s * 10000n) / largest) / 10000);
  const make = (side: LadderSide, [key, size]: [bigint, bigint], best: boolean, tradedMap: Map<bigint, bigint>): LadderRow => {
    const price = show(key / 10n ** BigInt(places - step.places), step.places); // a bucket key is a whole number of steps, so this divides exactly
    const t = tradedMap.get(key);
    return { id: `${side}:${price}`, side, price, size: show(size, sizePlaces), traded: t === undefined ? undefined : show(t, sizePlaces), fraction: bar(size), best };
  };
  const askRows = askBuckets.map((b, i) => make('ask', b, i === 0, tradedUp)).reverse(); // drawn highest first
  const bidRows = bidBuckets.map((b, i) => make('bid', b, i === 0, tradedDown));

  const last: LadderBuilt['last'] = {};
  if (input.last !== undefined) {
    if (parse(input.last)) last.price = input.last;
    else issues.push({ where: 'last', message: 'last must be an exact decimal string above zero' });
  }
  if (bestBid !== null && bestAsk !== null && bestAsk > bestBid) last.spread = show(bestAsk - bestBid, places);

  return { asks: askRows, bids: bidRows, rows: [...askRows, ...bidRows], last, issues };
}

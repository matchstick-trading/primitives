/**
 * Live bars as plain functions: fold one tick into the bars, and decide whether the viewport keeps following the newest
 * bar. A tick is a time, a price and a size, in the same units as `CandleBar` (Unix milliseconds, numbers). Nothing here
 * reads a clock, opens a feed or touches a page; the caller says when a tick arrives and what the bar interval is.
 */
import type { CandleBar, ChartViewport } from './chart-scale.js';

export interface LiveTick {
  /** Unix milliseconds. */
  timestamp: number;
  /** Above zero. */
  price: number;
  /** Above zero. */
  size: number;
}

/**
 * What happened to the tick.
 * `updated`: it landed in the newest bar. `opened`: it started a new bar. `late`: it belongs to an earlier bar, so the
 * bars are unchanged. `invalid`: a number was missing or not above zero, so the bars are unchanged.
 */
export type TickOutcome = 'updated' | 'opened' | 'late' | 'invalid';

export interface TickResult {
  /** A new array when a bar changed; the same array, untouched, when the tick was left out. */
  bars: CandleBar[];
  outcome: TickOutcome;
  /** Why the tick was left out. Present for `late` and `invalid`. */
  note?: string;
}

const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

/** The start of the bar a time falls in: whole intervals since the Unix epoch. */
export const barStart = (timestamp: number, interval: number): number => Math.floor(timestamp / interval) * interval;

/**
 * Fold one tick into bars that are oldest first. The tick's bar is the interval its time falls in. In the newest bar it
 * moves high, low, close and volume; after the newest bar it opens a bar at the tick's price (a quiet stretch leaves no
 * empty bars); before the newest bar it is reported as `late` and left out, so a bar that has closed never changes.
 * The input array and its bars are not changed.
 */
export function applyTick(bars: readonly CandleBar[], tick: LiveTick, interval: number): TickResult {
  const same = bars as CandleBar[];
  if (!positive(interval)) return { bars: same, outcome: 'invalid', note: 'interval must be above zero' };
  if (typeof tick.timestamp !== 'number' || !Number.isFinite(tick.timestamp)) return { bars: same, outcome: 'invalid', note: 'timestamp must be a number' };
  if (!positive(tick.price)) return { bars: same, outcome: 'invalid', note: 'price must be a number above zero' };
  if (!positive(tick.size)) return { bars: same, outcome: 'invalid', note: 'size must be a number above zero' };
  const start = barStart(tick.timestamp, interval);
  const last = bars[bars.length - 1];
  if (last === undefined || start > last.timestamp) {
    const opened: CandleBar = { timestamp: start, open: tick.price, high: tick.price, low: tick.price, close: tick.price, volume: tick.size };
    return { bars: [...bars, opened], outcome: 'opened' };
  }
  if (start < last.timestamp) return { bars: same, outcome: 'late', note: 'belongs to a bar that has already closed' };
  const updated: CandleBar = {
    ...last,
    high: Math.max(last.high, tick.price),
    low: Math.min(last.low, tick.price),
    close: tick.price,
    volume: last.volume + tick.size,
  };
  return { bars: [...bars.slice(0, -1), updated], outcome: 'updated' };
}

/** True when the viewport's right edge is on the newest bar (or past it), so the chart is following the live edge. */
export const atLiveEdge = (view: ChartViewport, barCount: number): boolean => view.end >= barCount;

/**
 * Keep following: if the viewport was on the live edge before bars were added, move it right by the bars added, so the
 * newest bar stays in view. If the reader had panned back, the viewport stays where it is.
 */
export function followLiveEdge(view: ChartViewport, countBefore: number, countAfter: number): ChartViewport {
  const added = countAfter - countBefore;
  if (added <= 0 || !atLiveEdge(view, countBefore)) return view;
  return { start: view.start + added, end: view.end + added };
}

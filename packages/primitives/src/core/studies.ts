/**
 * Chart studies as plain functions: moving averages, Bollinger bands, VWAP, RSI and ATR. Each takes the bars and
 * returns one value per bar, `null` while the study is still warming up (or where a bar's input is not a finite
 * number). Standard textbook definitions only. Nothing here throws: a bad period is rounded to a whole number of at
 * least 1, and empty input gives an empty array.
 */
import type { CandleBar, ChartViewport } from './chart-scale.js';

/** One value per bar, `null` where the study has no value yet. */
export type Series = Array<number | null>;

/** Which price of a bar a study reads. hl2 is (high + low) / 2, hlc3 adds the close, ohlc4 averages all four. */
export type StudySource = 'open' | 'high' | 'low' | 'close' | 'hl2' | 'hlc3' | 'ohlc4';

/** A bar's price for `source`; NaN when a needed field is not finite. */
export function sourcePrice(bar: CandleBar, source: StudySource = 'close'): number {
  switch (source) {
    case 'open': return bar.open;
    case 'high': return bar.high;
    case 'low': return bar.low;
    case 'hl2': return (bar.high + bar.low) / 2;
    case 'hlc3': return (bar.high + bar.low + bar.close) / 3;
    case 'ohlc4': return (bar.open + bar.high + bar.low + bar.close) / 4;
    default: return bar.close;
  }
}

const whole = (period: number, fallback: number) => (Number.isFinite(period) ? Math.max(1, Math.floor(period)) : fallback);
const blank = (length: number): Series => new Array<number | null>(length).fill(null);

/** Simple moving average: the mean of the last `period` prices. Null until a full window of finite prices exists. */
export function sma(bars: readonly CandleBar[], period: number, source: StudySource = 'close'): Series {
  const n = whole(period, 1);
  const out = blank(bars.length);
  const prices = bars.map((b) => sourcePrice(b, source));
  for (let i = n - 1; i < prices.length; i++) {
    let sum = 0;
    let ok = true;
    for (let k = i - n + 1; k <= i; k++) {
      if (!Number.isFinite(prices[k])) { ok = false; break; }
      sum += prices[k];
    }
    if (ok) out[i] = sum / n;
  }
  return out;
}

/**
 * Exponential moving average with weight 2 / (period + 1). It starts from the simple average of the first `period`
 * prices, so the first value sits at index period - 1. A bar with no finite price gets null and the average carries
 * on from the next good bar.
 */
export function ema(bars: readonly CandleBar[], period: number, source: StudySource = 'close'): Series {
  const n = whole(period, 1);
  const out = blank(bars.length);
  const alpha = 2 / (n + 1);
  let previous: number | null = null;
  let seed = 0;
  let seen = 0;
  for (let i = 0; i < bars.length; i++) {
    const price = sourcePrice(bars[i], source);
    if (!Number.isFinite(price)) continue;
    if (previous === null) {
      seed += price;
      seen++;
      if (seen === n) { previous = seed / n; out[i] = previous; }
    } else {
      previous = previous + alpha * (price - previous);
      out[i] = previous;
    }
  }
  return out;
}

/** Weighted moving average: the newest price in the window counts `period` times, the oldest once. */
export function wma(bars: readonly CandleBar[], period: number, source: StudySource = 'close'): Series {
  const n = whole(period, 1);
  const out = blank(bars.length);
  const prices = bars.map((b) => sourcePrice(b, source));
  const weights = (n * (n + 1)) / 2;
  for (let i = n - 1; i < prices.length; i++) {
    let sum = 0;
    let ok = true;
    for (let k = 0; k < n; k++) {
      const price = prices[i - n + 1 + k];
      if (!Number.isFinite(price)) { ok = false; break; }
      sum += price * (k + 1);
    }
    if (ok) out[i] = sum / weights;
  }
  return out;
}

export interface BollingerBands {
  middle: Series;
  upper: Series;
  lower: Series;
}

/** Bollinger bands on the close: a simple average, and `mult` population standard deviations above and below it. */
export function bollinger(bars: readonly CandleBar[], period = 20, mult = 2): BollingerBands {
  const n = whole(period, 20);
  const k = Number.isFinite(mult) ? mult : 2;
  const middle = sma(bars, n, 'close');
  const upper = blank(bars.length);
  const lower = blank(bars.length);
  for (let i = 0; i < bars.length; i++) {
    const mean = middle[i];
    if (mean === null) continue;
    let squares = 0;
    for (let j = i - n + 1; j <= i; j++) squares += (bars[j].close - mean) ** 2;
    const deviation = Math.sqrt(squares / n);
    upper[i] = mean + k * deviation;
    lower[i] = mean - k * deviation;
  }
  return { middle, upper, lower };
}

export interface VwapOptions {
  /**
   * Where the running total restarts: 'session' at each UTC day boundary (moved by `sessionStartUtcMinute`), 'all' never,
   * or a timestamp: bars before it have no value and the total starts on the first bar at or after it.
   */
  anchor?: 'session' | 'all' | number;
  /** Minutes after 00:00 UTC at which a session begins. Default 0. */
  sessionStartUtcMinute?: number;
  /** Band widths in volume-weighted standard deviations, for example [1, 2]. */
  bands?: readonly number[];
}

export interface VwapBand {
  mult: number;
  upper: Series;
  lower: Series;
}

export interface VwapResult {
  vwap: Series;
  bands: VwapBand[];
}

const DAY_MS = 86_400_000;

/**
 * Volume-weighted average price on the typical price (high + low + close) / 3, restarting at the anchor. A bar with
 * no volume yet in its run has no value. Bands sit `mult` volume-weighted standard deviations of the typical price
 * around the line.
 */
export function vwap(bars: readonly CandleBar[], options: VwapOptions = {}): VwapResult {
  const { anchor = 'session', bands = [] } = options;
  const offset = (Number.isFinite(options.sessionStartUtcMinute) ? options.sessionStartUtcMinute! : 0) * 60_000;
  const mults = bands.filter((m) => Number.isFinite(m));
  const line = blank(bars.length);
  const edges = mults.map((mult) => ({ mult, upper: blank(bars.length), lower: blank(bars.length) }));
  let session = Number.NaN;
  let volume = 0;
  let money = 0;
  let squares = 0;
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    if (typeof anchor === 'number' && bar.timestamp < anchor) continue;
    if (anchor === 'session') {
      const day = Math.floor((bar.timestamp - offset) / DAY_MS);
      if (day !== session) { session = day; volume = 0; money = 0; squares = 0; }
    }
    const price = sourcePrice(bar, 'hlc3');
    if (Number.isFinite(price) && Number.isFinite(bar.volume) && bar.volume > 0) {
      volume += bar.volume;
      money += bar.volume * price;
      squares += bar.volume * price * price;
    }
    if (volume <= 0) continue;
    const mean = money / volume;
    line[i] = mean;
    const deviation = Math.sqrt(Math.max(0, squares / volume - mean * mean));
    for (const edge of edges) {
      edge.upper[i] = mean + edge.mult * deviation;
      edge.lower[i] = mean - edge.mult * deviation;
    }
  }
  return { vwap: line, bands: edges };
}

/**
 * Relative strength index with Wilder smoothing, 0 to 100. The first value sits at index `period` (it needs
 * `period` price changes). All gains and no losses is 100; no movement at all is 50.
 */
export function rsi(bars: readonly CandleBar[], period = 14): Series {
  const n = whole(period, 14);
  const out = blank(bars.length);
  let gain = 0;
  let loss = 0;
  const score = () => (gain === 0 && loss === 0 ? 50 : loss === 0 ? 100 : 100 - 100 / (1 + gain / loss));
  for (let i = 1; i < bars.length; i++) {
    const change = bars[i].close - bars[i - 1].close;
    if (!Number.isFinite(change)) return out; // a gap in the data ends the study rather than guessing
    const up = Math.max(0, change);
    const down = Math.max(0, -change);
    if (i <= n) {
      gain += up / n;
      loss += down / n;
      if (i === n) out[i] = score();
    } else {
      gain = (gain * (n - 1) + up) / n;
      loss = (loss * (n - 1) + down) / n;
      out[i] = score();
    }
  }
  return out;
}

/**
 * Average true range with Wilder smoothing. A bar's true range is the largest of high - low, |high - previous close|
 * and |low - previous close| (just high - low for the first bar). The first value sits at index period - 1.
 */
export function atr(bars: readonly CandleBar[], period = 14): Series {
  const n = whole(period, 14);
  const out = blank(bars.length);
  let average = 0;
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const previous = i > 0 ? bars[i - 1].close : bar.close;
    const range = Math.max(bar.high - bar.low, Math.abs(bar.high - previous), Math.abs(bar.low - previous));
    if (!Number.isFinite(range)) return out;
    if (i < n) {
      average += range / n;
      if (i === n - 1) out[i] = average;
    } else {
      average = (average * (n - 1) + range) / n;
      out[i] = average;
    }
  }
  return out;
}

/** The whole-bar indexes a viewport shows, clamped to the series; last < first when nothing is visible. Same rule as the chart frame. */
export function visibleIndexes(viewport: ChartViewport, total: number): { first: number; last: number } {
  const start = Number.isFinite(viewport.start) ? viewport.start : 0;
  const end = Number.isFinite(viewport.end) ? viewport.end : start + 1;
  return { first: Math.max(0, Math.floor(start)), last: Math.min(total - 1, Math.ceil(Math.max(end, start + 1)) - 1) };
}

/**
 * The [low, high] of the study values over bars first..last, for `Chart.Root`'s `include` so a line outside the candle
 * range stays in view. With no value to show it returns [Infinity, -Infinity], which the chart ignores.
 */
export function studyRange(visible: { first: number; last: number }, ...series: ReadonlyArray<ReadonlyArray<number | null>>): [number, number] {
  let low = Infinity;
  let high = -Infinity;
  for (const values of series) {
    const end = Math.min(visible.last, values.length - 1);
    for (let i = Math.max(0, visible.first); i <= end; i++) {
      const value = values[i];
      if (value === null || !Number.isFinite(value)) continue;
      if (value < low) low = value;
      if (value > high) high = value;
    }
  }
  return [low, high];
}

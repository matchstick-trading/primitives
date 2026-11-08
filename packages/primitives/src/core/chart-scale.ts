/**
 * The shared geometry of the chart primitives (Candles, Volume, Studies, VolumeProfile, Drawings) as plain
 * functions. Bars are OpenCandle-shaped records: a Unix-millisecond `timestamp` and numeric OHLCV. Extra fields on a
 * record are ignored.
 *
 * The x axis is the bar index, not the clock, so gaps (nights, weekends) take no space, as traders expect. A point
 * in time between or beyond bars maps to a fractional index, so drawings anchored to a time keep their place when
 * the chart scrolls. Nothing here throws on empty or bad input: an empty chart has a frame with no bars.
 */

export interface CandleBar {
  /** Unix milliseconds, ascending and unique across the series. */
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** The bars on screen: indexes [start, end), fractional while panning. */
export interface ChartViewport {
  start: number;
  end: number;
}

export interface ChartSize {
  width: number;
  height: number;
}

export type PriceSpan = readonly [number, number];
export type ChartInclude = readonly PriceSpan[] | ((visible: { first: number; last: number }) => readonly PriceSpan[]);

export interface ChartFrameOptions {
  /** Share of the height kept for the volume pane under the prices, 0 for none. Default 0.2. */
  volumeShare?: number;
  /** Empty pixels above the highest and below the lowest price. Default 8. */
  pricePadding?: number;
  /** Width kept on the right for price labels, so they never sit on the bars. Default 56. */
  axisRight?: number;
  /** Height kept at the bottom for time labels. Default 18. */
  axisBottom?: number;
  /**
   * Extra prices that must stay in view (study lines, drawings), as [low, high] pairs, or a function of the whole
   * bars in view that returns them (so a study can measure only what is on screen, e.g. with studyRange).
   */
  include?: ChartInclude;
  /**
   * A fixed price range [low, high] in place of the autoscale. With it set, the bars and `include` no longer decide
   * the range, so the view can be moved to any price (a drawing placed above or below the bars).
   */
  priceRange?: PriceSpan | null;
}

export interface ChartFrame {
  width: number;
  height: number;
  /** Where the bars end and the price-label gutter begins (width minus axisRight). */
  plotWidth: number;
  /** Where the panes end and the time-label gutter begins (height minus axisBottom). */
  plotHeight: number;
  viewport: ChartViewport;
  /** The whole bars inside the viewport, clamped to the series. */
  first: number;
  last: number;
  /** Pixels per bar. */
  barWidth: number;
  /** Price pane: y runs from priceTop to priceBottom. */
  priceTop: number;
  priceBottom: number;
  priceMin: number;
  priceMax: number;
  /** True when the price range is a fixed one a person set, false when it follows the bars. */
  manualPrice: boolean;
  /** Volume pane under the prices; empty (volumeTop === volumeBottom) when volumeShare is 0. */
  volumeTop: number;
  volumeBottom: number;
  volumeMax: number;
  /** Bar index (fractional allowed) to the x of that bar's centre. */
  x: (index: number) => number;
  /** x to a fractional bar index. */
  indexAt: (x: number) => number;
  y: (price: number) => number;
  priceAt: (y: number) => number;
  /** Volume to the y of the top of its bar in the volume pane. */
  volumeY: (volume: number) => number;
}

const finite = (n: number, fallback: number) => (Number.isFinite(n) ? n : fallback);

/** A viewport showing the last `count` bars (all of them when there are fewer). */
export function lastBars(total: number, count: number): ChartViewport {
  const n = Math.max(1, Math.floor(finite(count, 1)));
  const end = Math.max(0, Math.floor(finite(total, 0)));
  // A short history shows just its bars; an empty one keeps a nonzero span so the frame stays finite.
  return { start: Math.max(0, end - n), end: end === 0 ? n : end };
}

/**
 * The view after the series grows (or shrinks) from `seenTotal` to `total` bars. A view that showed the whole series reopens on the
 * default window (a chart that starts with 1 or 2 bars must not stay 1 or 2 bars wide), a view at the newest bar keeps its span and
 * follows, and a view the user moved away from the end stays put. A view past the data is pulled back.
 */
export function growViewport(view: ChartViewport, seenTotal: number, total: number, span = 120): ChartViewport {
  if (view.start <= 0 && view.end >= seenTotal) return lastBars(total, span);
  if (view.end >= seenTotal || view.end > total) return lastBars(total, view.end - view.start);
  return view;
}

export function chartFrame(bars: readonly CandleBar[], viewport: ChartViewport, size: ChartSize, options: ChartFrameOptions = {}): ChartFrame {
  const width = Math.max(1, finite(size.width, 1));
  const height = Math.max(1, finite(size.height, 1));
  let start = finite(viewport.start, 0);
  let end = finite(viewport.end, start + 1);
  if (end - start < 1) end = start + 1;
  const span = end - start;
  const plotWidth = Math.max(1, width - Math.max(0, finite(options.axisRight ?? 56, 56)));
  const plotHeight = Math.max(1, height - Math.max(0, finite(options.axisBottom ?? 18, 18)));
  const barWidth = plotWidth / span;
  const first = Math.max(0, Math.floor(start));
  const last = Math.min(bars.length - 1, Math.ceil(end) - 1);

  const volumeShare = Math.min(0.6, Math.max(0, finite(options.volumeShare ?? 0.2, 0.2)));
  const padding = Math.max(0, finite(options.pricePadding ?? 8, 8));
  const volumeHeight = Math.round(plotHeight * volumeShare);
  const priceTop = padding;
  const priceBottom = Math.max(priceTop + 1, plotHeight - volumeHeight - padding);
  const volumeTop = plotHeight - volumeHeight;
  const volumeBottom = plotHeight;

  const fixed = options.priceRange;
  const manualPrice = !!fixed && Number.isFinite(fixed[0]) && Number.isFinite(fixed[1]) && fixed[1] > fixed[0];
  let priceMin = Infinity;
  let priceMax = -Infinity;
  let volumeMax = 0;
  for (let i = first; i <= last; i++) {
    const bar = bars[i];
    if (!manualPrice) {
      if (Number.isFinite(bar.low) && bar.low < priceMin) priceMin = bar.low;
      if (Number.isFinite(bar.high) && bar.high > priceMax) priceMax = bar.high;
    }
    if (Number.isFinite(bar.volume) && bar.volume > volumeMax) volumeMax = bar.volume;
  }
  if (manualPrice) {
    priceMin = fixed![0];
    priceMax = fixed![1];
  } else {
    const include = typeof options.include === 'function' ? safeInclude(options.include, first, last) : options.include ?? [];
    for (const [low, high] of include) {
      if (Number.isFinite(low) && low < priceMin) priceMin = low;
      if (Number.isFinite(high) && high > priceMax) priceMax = high;
    }
    if (!Number.isFinite(priceMin) || !Number.isFinite(priceMax)) {
      priceMin = 0;
      priceMax = 1;
    } else if (priceMin === priceMax) {
      const pad = Math.abs(priceMin) * 0.01 || 1;
      priceMin -= pad;
      priceMax += pad;
    }
  }
  if (volumeMax <= 0) volumeMax = 1;

  const priceRange = priceMax - priceMin;
  const priceSpan = priceBottom - priceTop;
  const x = (index: number) => (index - start + 0.5) * barWidth;
  const indexAt = (px: number) => px / barWidth + start - 0.5;
  const y = (price: number) => priceBottom - ((price - priceMin) / priceRange) * priceSpan;
  const priceAt = (py: number) => priceMin + ((priceBottom - py) / priceSpan) * priceRange;
  const volumeY = (volume: number) => volumeBottom - (Math.max(0, volume) / volumeMax) * (volumeBottom - volumeTop);

  return {
    width, height, plotWidth, plotHeight, viewport: { start, end }, first, last, barWidth,
    priceTop, priceBottom, priceMin, priceMax, manualPrice, volumeTop, volumeBottom, volumeMax,
    x, indexAt, y, priceAt, volumeY,
  };
}

function safeInclude(include: (visible: { first: number; last: number }) => readonly PriceSpan[], first: number, last: number): readonly PriceSpan[] {
  try {
    const out = include({ first, last });
    return Array.isArray(out) ? out : [];
  } catch {
    return [];
  }
}

const intervals = new WeakMap<readonly CandleBar[], { length: number; interval: number }>();

/** The usual gap between bars in milliseconds (the median), or 60 000 when there are fewer than two bars. */
export function barInterval(bars: readonly CandleBar[]): number {
  if (bars.length < 2) return 60_000;
  const known = intervals.get(bars);
  if (known?.length === bars.length) return known.interval; // a host that pushes onto the same array gets a fresh one
  // Every gap, not a sample: gaps that repeat (a weekend every fifth bar) would fool a sample taken at a fixed stride.
  // Sorted once per series and remembered, so the drawings and the readout can ask as often as they like.
  const gaps = new Float64Array(bars.length - 1);
  for (let i = 1; i < bars.length; i++) gaps[i - 1] = bars[i].timestamp - bars[i - 1].timestamp;
  gaps.sort();
  const median = gaps[gaps.length >> 1];
  const interval = median > 0 && Number.isFinite(median) ? median : 60_000;
  intervals.set(bars, { length: bars.length, interval });
  return interval;
}

/**
 * A time to a fractional bar index: exact on a bar, interpolated between two bars, and extrapolated by the usual
 * interval before the first or after the last bar. This is what keeps a drawing on its time as bars arrive.
 */
export function indexOfTime(bars: readonly CandleBar[], timestamp: number): number {
  const n = bars.length;
  if (n === 0 || !Number.isFinite(timestamp)) return 0;
  if (timestamp <= bars[0].timestamp) return (timestamp - bars[0].timestamp) / barInterval(bars);
  if (timestamp >= bars[n - 1].timestamp) return n - 1 + (timestamp - bars[n - 1].timestamp) / barInterval(bars);
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].timestamp <= timestamp) lo = mid;
    else hi = mid;
  }
  const a = bars[lo].timestamp;
  const b = bars[hi].timestamp;
  return lo + (b === a ? 0 : (timestamp - a) / (b - a));
}

/** The inverse of indexOfTime. */
export function timeOfIndex(bars: readonly CandleBar[], index: number): number {
  const n = bars.length;
  if (n === 0 || !Number.isFinite(index)) return 0;
  if (index <= 0) return bars[0].timestamp + index * barInterval(bars);
  if (index >= n - 1) return bars[n - 1].timestamp + (index - (n - 1)) * barInterval(bars);
  const lo = Math.floor(index);
  const a = bars[lo].timestamp;
  return a + (index - lo) * (bars[lo + 1].timestamp - a);
}

/** Round, readable price ticks for the axis: about `count` steps of 1, 2 or 5 times a power of ten. */
export function priceTicks(min: number, max: number, count = 6): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [];
  const raw = (max - min) / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? 10 * power;
  // Each tick is a whole number of steps, rounded to the step's own places, so float noise goes and a range of
  // 1e-14 still gets distinct ticks (a fixed 12 places would round them all to 0).
  const places = Math.min(100, Math.max(0, 1 - Math.floor(Math.log10(step))));
  const ticks: number[] = [];
  for (let i = Math.ceil(min / step); i * step <= max + step * 1e-9 && ticks.length < 50; i += 1) ticks.push(Number((i * step).toFixed(places)));
  return ticks;
}

/** Decimals needed to print a tick step without noise (0.25 needs 2, 5 needs 0), up to the chart's 20. */
export function tickDecimals(ticks: readonly number[]): number {
  if (ticks.length < 2) return 2;
  const step = Math.abs(ticks[1] - ticks[0]);
  if (!Number.isFinite(step) || step === 0) return 2;
  // The fewest places that print the step exactly (0.25 needs 2, 2.5 needs 1), not only its order of magnitude. A
  // step below one at these places is not yet printed, however small it is (2e-10 needs 10, not 0).
  for (let places = 0; places < 20; places += 1) {
    const scaled = step * 10 ** places;
    if (Math.round(scaled) >= 1 && Math.abs(scaled - Math.round(scaled)) < 1e-6 * scaled) return places;
  }
  return 20;
}

export type ChartKeyAction = 'pan-left' | 'pan-right' | 'zoom-in' | 'zoom-out' | 'price-up' | 'price-down' | 'price-zoom-in' | 'price-zoom-out' | 'first' | 'last' | 'previous-bar' | 'next-bar' | 'clear';

/**
 * Chart keys: ArrowLeft/Right move the crosshair bar by bar, Shift+Arrow pans a screen tenth, + and - zoom, ArrowUp/Down move the price range a tenth and Shift+ArrowUp/Down zoom it (the first of them leaves the autoscale), Home and
 * End jump to the first and last bar, Escape clears the crosshair.
 */
export function resolveChartKey(event: { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): ChartKeyAction | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  switch (event.key) {
    case 'ArrowLeft': return event.shiftKey ? 'pan-left' : 'previous-bar';
    case 'ArrowRight': return event.shiftKey ? 'pan-right' : 'next-bar';
    case '+': case '=': return 'zoom-in';
    case '-': case '_': return 'zoom-out';
    case 'ArrowUp': return event.shiftKey ? 'price-zoom-in' : 'price-up';
    case 'ArrowDown': return event.shiftKey ? 'price-zoom-out' : 'price-down';
    case 'Home': return event.shiftKey ? null : 'first';
    case 'End': return event.shiftKey ? null : 'last';
    case 'Escape': return 'clear';
    default: return null;
  }
}

/**
 * Zoom around a point in bar-index space, where bar i is centred on the integer i (the space frame.x() and
 * frame.indexAt() use). A pointer passes frame.indexAt(x); the keyboard passes the active bar's index, which is that
 * bar's centre, so neither needs converting. The point keeps its share of the plot width, so whatever is under the
 * pointer, and any drawing anchored there, stays put. factor < 1 zooms in. Keeps 5..total+50 bars.
 */
export function zoomViewport(viewport: ChartViewport, factor: number, around: number, total: number): ChartViewport {
  const span = viewport.end - viewport.start;
  const next = Math.min(Math.max(5, total + 50), Math.max(5, span * (Number.isFinite(factor) && factor > 0 ? factor : 1)));
  // x() puts bar i's centre half a bar in from the left edge, so the share is measured from start - 0.5.
  const share = span > 0 ? (around - viewport.start + 0.5) / span : 0.5;
  const start = around + 0.5 - next * Math.min(1, Math.max(0, share));
  return clampViewport({ start, end: start + next }, total);
}

/** Move the viewport by `bars` (negative is back in time), keeping at least 5 bars of the series in view. */
export function panViewport(viewport: ChartViewport, bars: number, total: number): ChartViewport {
  const shift = Number.isFinite(bars) ? bars : 0;
  return clampViewport({ start: viewport.start + shift, end: viewport.end + shift }, total);
}

function clampViewport(viewport: ChartViewport, total: number): ChartViewport {
  const span = viewport.end - viewport.start;
  const keep = Math.min(5, Math.max(1, total));
  let start = viewport.start;
  if (start > total - keep) start = total - keep;
  if (start + span < keep) start = keep - span;
  return { start, end: start + span };
}

/** The lowest low and highest high of the whole series (padded like the autoscale when they are equal), or null when it has no finite prices. */
export function dataPriceSpan(bars: readonly CandleBar[]): PriceSpan | null {
  let low = Infinity;
  let high = -Infinity;
  for (const bar of bars) {
    if (Number.isFinite(bar.low) && bar.low < low) low = bar.low;
    if (Number.isFinite(bar.high) && bar.high > high) high = bar.high;
  }
  if (!(low <= high)) return null;
  // Flat data gets the same padding the autoscale gives it, so a first pan or zoom keeps its direction and size.
  if (low === high) {
    const pad = Math.abs(low) * 0.01 || 1;
    return [low - pad, high + pad];
  }
  return [low, high];
}

/**
 * Keeps a hand-set price range usable: its height between a fiftieth and twenty times the height of all the bars, and
 * its middle no further from the bars than half its own height, so the bars can always be found again. With no bars
 * there is nothing to measure against and the range passes through unchanged.
 */
export function clampPriceRange(range: PriceSpan, data: PriceSpan | null): PriceSpan {
  let [low, high] = range;
  if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) return range;
  if (!data) return [low, high];
  const dataHeight = Math.max(data[1] - data[0], Math.abs(data[1]) * 1e-6, 1e-9);
  const height = Math.min(dataHeight * 20, Math.max(dataHeight / 50, high - low));
  let middle = (low + high) / 2;
  middle = Math.min(data[1] + height / 2, Math.max(data[0] - height / 2, middle));
  low = middle - height / 2;
  high = middle + height / 2;
  return [low, high];
}

/** Zoom a price range around a price: factor < 1 zooms in, and `around` keeps its share of the height. */
export function zoomPriceRange(range: PriceSpan, factor: number, around: number, data: PriceSpan | null): PriceSpan {
  const height = range[1] - range[0];
  const f = Number.isFinite(factor) && factor > 0 ? factor : 1;
  const share = height > 0 ? (around - range[0]) / height : 0.5;
  const next = height * f;
  const low = around - next * Math.min(1, Math.max(0, share));
  return clampPriceRange([low, low + next], data);
}

/** Move a price range by `delta` price units (positive is up). */
export function panPriceRange(range: PriceSpan, delta: number, data: PriceSpan | null): PriceSpan {
  const d = Number.isFinite(delta) ? delta : 0;
  return clampPriceRange([range[0] + d, range[1] + d], data);
}

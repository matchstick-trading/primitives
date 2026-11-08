/**
 * A volume profile as plain functions: how much traded at each price level over a run of bars. Each bar's volume is
 * spread evenly over the price rows its high-low range touches. Nothing here throws: an empty run, a flat price range or
 * zero volume gives a profile with no point of control (`poc` is -1, `vah` and `val` are null).
 */
import type { CandleBar } from './chart-scale.js';

export interface ProfileRow {
  /** Bottom and top price of the row. */
  low: number;
  high: number;
  volume: number;
  /** The part of `volume` from bars that closed up, and from bars that closed down. A bar that closed where it opened counts half each. */
  upVolume: number;
  downVolume: number;
}

export interface VolumeProfileOptions {
  /** First and last bar index of the run, inclusive. */
  first: number;
  last: number;
  /** Number of price rows, 1 to 500. Default 24. */
  rows?: number;
  /** Share of the volume the value area holds, above 0 up to 1. Default 0.7. */
  valueArea?: number;
}

export interface VolumeProfileResult {
  /** Lowest price first. */
  rows: ProfileRow[];
  /** Index of the point of control: the row with the most volume (the lowest one on a tie). -1 when there is no volume. */
  poc: number;
  /** Top of the highest row and bottom of the lowest row in the value area. Null when there is no volume. */
  vah: number | null;
  val: number | null;
  /** The value area as row indexes [low, high]; [-1, -1] when there is none. */
  valueAreaRows: [number, number];
  total: number;
}

const EMPTY: VolumeProfileResult = { rows: [], poc: -1, vah: null, val: null, valueAreaRows: [-1, -1], total: 0 };

/**
 * The profile of bars first..last. The value area starts at the point of control and takes whichever neighbouring row
 * has more volume (the one above on a tie), one row at a time, until it holds the `valueArea` share of the total.
 */
export function volumeProfile(bars: readonly CandleBar[], options: VolumeProfileOptions): VolumeProfileResult {
  const first = Math.max(0, Math.floor(Number.isFinite(options.first) ? options.first : 0));
  const last = Math.min(bars.length - 1, Math.floor(Number.isFinite(options.last) ? options.last : -1));
  const count = Math.min(500, Math.max(1, Math.floor(Number.isFinite(options.rows) ? options.rows! : 24)));
  const share = options.valueArea !== undefined && Number.isFinite(options.valueArea) && options.valueArea > 0 ? Math.min(1, options.valueArea) : 0.7;

  let min = Infinity;
  let max = -Infinity;
  // The same bars as the allocation below: one with no volume would stretch the rows without adding to them.
  for (let i = first; i <= last; i++) {
    const { high, low, volume } = bars[i];
    if (!Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(volume) || volume <= 0) continue;
    if (low < min) min = low;
    if (high > max) max = high;
  }
  if (!(max >= min)) return { ...EMPTY, rows: [], valueAreaRows: [-1, -1] };

  // A flat range is one row, so the volume still has somewhere to go.
  const flat = max === min;
  const size = flat ? 1 : count;
  const step = flat ? 0 : (max - min) / size;
  const rows: ProfileRow[] = [];
  for (let r = 0; r < size; r++) rows.push({ low: flat ? min : min + r * step, high: flat ? max : r === size - 1 ? max : min + (r + 1) * step, volume: 0, upVolume: 0, downVolume: 0 });
  const rowOf = (price: number) => (flat ? 0 : Math.min(size - 1, Math.max(0, Math.floor((price - min) / step))));

  let total = 0;
  for (let i = first; i <= last; i++) {
    const bar = bars[i];
    if (!Number.isFinite(bar.high) || !Number.isFinite(bar.low) || !Number.isFinite(bar.volume) || bar.volume <= 0) continue;
    const from = rowOf(bar.low);
    const to = rowOf(bar.high);
    const part = bar.volume / (to - from + 1);
    const up = bar.close > bar.open ? 1 : bar.close < bar.open ? 0 : 0.5;
    for (let r = from; r <= to; r++) {
      rows[r].volume += part;
      rows[r].upVolume += part * up;
      rows[r].downVolume += part * (1 - up);
    }
    total += bar.volume;
  }
  if (total <= 0) return { rows, poc: -1, vah: null, val: null, valueAreaRows: [-1, -1], total: 0 };

  let poc = 0;
  for (let r = 1; r < size; r++) if (rows[r].volume > rows[poc].volume) poc = r;

  const target = total * share - total * 1e-9;
  let low = poc;
  let high = poc;
  let held = rows[poc].volume;
  while (held < target && (low > 0 || high < size - 1)) {
    const above = high < size - 1 ? rows[high + 1].volume : -1;
    const below = low > 0 ? rows[low - 1].volume : -1;
    if (above >= below) { high++; held += rows[high].volume; } else { low--; held += rows[low].volume; }
  }
  return { rows, poc, vah: rows[high].high, val: rows[low].low, valueAreaRows: [low, high], total };
}

/** The bar indexes whose timestamps fall in [from, to], as {first, last}; last < first when none do. Bars are in time order. */
export function indexRangeOfTime(bars: readonly CandleBar[], from: number, to: number): { first: number; last: number } {
  let first = bars.length;
  let last = -1;
  for (let i = 0; i < bars.length; i++) {
    const t = bars[i].timestamp;
    if (t >= from && t <= to) {
      if (first === bars.length) first = i;
      last = i;
    }
  }
  return { first, last };
}

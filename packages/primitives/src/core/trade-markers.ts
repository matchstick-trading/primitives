/**
 * Where trades sit on a chart: each trade goes on the bar it happened in, at its own price. Display only: this finds
 * a bar and a height for a trade and does nothing else. A trade before the first bar, after the last bar's span, or in a
 * gap between two bars (a closed market) has no bar to sit on and is counted as left out, never moved to the nearest one.
 */

import { barInterval, type CandleBar } from './chart-scale.js';
import type { TapeRow, TapeSide } from './tape.js';

export interface TradeMarker {
  /** The trade's id, as given or assigned by `readTape`. */
  id: string;
  /** The index of the bar the trade falls in. */
  index: number;
  price: number;
  side: TapeSide;
}

export interface TradeMarkersPlaced {
  /** In time order, so `index` never goes down: a marker part can find the ones in view by search. */
  markers: TradeMarker[];
  /** Trades with no bar to sit on. */
  outside: number;
}

/** Put each trade (oldest first) on its bar. A binary search per trade, so thousands of trades are cheap. `intervalMs` is the bar length when you know it; otherwise it is read from the bars (60 seconds for a single bar). */
export function placeTradeMarkers(trades: readonly TapeRow[], bars: readonly CandleBar[], intervalMs?: number): TradeMarkersPlaced {
  const markers: TradeMarker[] = [];
  const n = bars.length;
  if (n === 0) return { markers, outside: trades.length };
  // With one bar there is no gap to read the bar length from, so a host that knows it (a five-minute chart) passes it.
  const interval = intervalMs !== undefined && intervalMs > 0 ? intervalMs : barInterval(bars);
  let outside = 0;
  for (const trade of trades) {
    const at = Date.parse(trade.t);
    const price = Number(trade.price);
    if (!Number.isFinite(at) || !Number.isFinite(price) || at < bars[0].timestamp) { outside++; continue; }
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (bars[mid].timestamp <= at) lo = mid;
      else hi = mid - 1;
    }
    if (at >= bars[lo].timestamp + interval) { outside++; continue; }
    markers.push({ id: trade.id, index: lo, price, side: trade.side });
  }
  return { markers, outside };
}

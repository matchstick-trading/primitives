// Live bars, headless: fold a stream of ticks into one-minute bars, and keep a viewport on the newest bar.
// Synthetic ticks only, no feed and no clock. Run: node examples/live-bars.mjs
import { applyTick, atLiveEdge, followLiveEdge } from '@matchstick-trading/primitives/core';

const MINUTE = 60_000;
const start = 1_700_000_040_000; // a minute boundary
// [seconds after start, price, size]
const ticks = [
  [1, 100, 2], [5, 101, 1], [12, 99.5, 3], [20, 100.5, 1], [33, 102, 4], [41, 101.5, 2], [58, 101, 1],
  [61, 101.25, 5], [64, 103, 1], [70, 100.75, 2], [88, 101.5, 3], [95, 102.25, 1], [110, 101, 2],
  [121, 100, 1], [125, 99, 4], [130, 99.75, 2], [150, 100.25, 1], [160, 98.5, 3], [170, 99, 1], [179, 99.25, 2],
  [30, 50, 1], // arrives late: belongs to the first bar, which has closed
  [180, 0, 1], // a bad price
];

// Three earlier bars are already on the chart, and the viewport shows all three (end is exclusive), so it is on the live edge.
let bars = [-3, -2, -1].map((n, i) => ({ timestamp: start + n * MINUTE, open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 10 }));
let view = { start: 0, end: 3 };
for (const [sec, price, size] of ticks) {
  const before = bars.length;
  const result = applyTick(bars, { timestamp: start + sec * 1000, price, size }, MINUTE);
  bars = result.bars;
  view = followLiveEdge(view, before, bars.length);
  if (result.outcome === 'opened') console.log(`+${sec}s: new bar at ${price}`);
  if (result.note) console.log(`+${sec}s: tick left out (${result.outcome}): ${result.note}`);
}

console.log('bars:');
for (const b of bars) console.log(`  ${new Date(b.timestamp).toISOString().slice(11, 16)}  O ${b.open}  H ${b.high}  L ${b.low}  C ${b.close}  V ${b.volume}`);
console.log(`viewport ${JSON.stringify(view)} shows bars ${view.start} to ${view.end - 1} of ${bars.length}; following the newest bar: ${atLiveEdge(view, bars.length)}`);

// A reader who panned back stays where they are while a new bar arrives.
const panned = { start: 0, end: 2 };
console.log('panned back, then a bar opens:', JSON.stringify(followLiveEdge(panned, 3, 4)));

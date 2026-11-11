import { describe, expect, it } from 'vitest';
import { applyTick, atLiveEdge, followLiveEdge, type LiveTick } from './live.js';
import { chartFrame, lastBars, type CandleBar } from './chart-scale.js';

const MIN = 60_000;
const T0 = 1_700_000_040_000; // on a minute boundary
const tick = (sec: number, price: number, size: number): LiveTick => ({ timestamp: T0 + sec * 1000, price, size });

// 20 synthetic ticks across three one-minute bars, folded by hand below.
const TICKS: LiveTick[] = [
  tick(1, 100, 2), tick(5, 101, 1), tick(12, 99.5, 3), tick(20, 100.5, 1), tick(33, 102, 4), tick(41, 101.5, 2), tick(58, 101, 1),
  tick(61, 101.25, 5), tick(64, 103, 1), tick(70, 100.75, 2), tick(88, 101.5, 3), tick(95, 102.25, 1), tick(110, 101, 2),
  tick(121, 100, 1), tick(125, 99, 4), tick(130, 99.75, 2), tick(150, 100.25, 1), tick(160, 98.5, 3), tick(170, 99, 1), tick(179, 99.25, 2),
];

const HAND: CandleBar[] = [
  { timestamp: T0, open: 100, high: 102, low: 99.5, close: 101, volume: 14 },
  { timestamp: T0 + MIN, open: 101.25, high: 103, low: 100.75, close: 101, volume: 14 },
  { timestamp: T0 + 2 * MIN, open: 100, high: 100.25, low: 98.5, close: 99.25, volume: 14 },
];

describe('applyTick', () => {
  it('folds 20 ticks across two bar boundaries into the hand-folded bars', () => {
    let bars: CandleBar[] = [];
    const outcomes: string[] = [];
    for (const t of TICKS) { const r = applyTick(bars, t, MIN); bars = r.bars; outcomes.push(r.outcome); }
    expect(bars).toEqual(HAND);
    expect(outcomes.filter((o) => o === 'opened')).toHaveLength(3);
    expect(outcomes.filter((o) => o === 'updated')).toHaveLength(17);
  });

  it('leaves a closed bar alone and says why when a tick is late', () => {
    const before = applyTick(applyTick([], tick(1, 100, 1), MIN).bars, tick(65, 101, 1), MIN).bars;
    const r = applyTick(before, tick(30, 50, 1), MIN);
    expect(r.outcome).toBe('late');
    expect(r.bars).toBe(before);
    expect(r.note).toMatch(/closed/);
  });

  it('reports a bad price, size or interval and changes nothing', () => {
    const bars: CandleBar[] = [];
    expect(applyTick(bars, tick(1, 0, 1), MIN).outcome).toBe('invalid');
    expect(applyTick(bars, tick(1, 1, Number.NaN), MIN).outcome).toBe('invalid');
    expect(applyTick(bars, tick(1, 1, 1), 0).outcome).toBe('invalid');
  });

  it('does not change the bars it was given', () => {
    const first = applyTick([], tick(1, 100, 1), MIN).bars;
    const copy = JSON.parse(JSON.stringify(first));
    applyTick(first, tick(2, 105, 1), MIN);
    expect(first).toEqual(copy);
  });
});

describe('followLiveEdge', () => {
  it('moves with a new bar when the viewport was on the newest bar, and stays put when it had panned back', () => {
    expect(followLiveEdge({ start: 0, end: 10 }, 10, 11)).toEqual({ start: 1, end: 11 });
    const back = { start: 0, end: 6 };
    expect(followLiveEdge(back, 10, 11)).toBe(back);
  });
});

// Requirements from the Fable test (bugs found in two or more runs), written from what a host expects, not from the code.
describe('following the live edge', () => {
  const bar = (i: number): CandleBar => ({ timestamp: i * MIN, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 });

  it('a chart that starts empty draws every bar as ticks arrive', () => {
    let bars: CandleBar[] = [];
    let view = lastBars(0, 120);
    for (let i = 0; i < 3; i++) {
      const before = bars.length;
      bars = applyTick(bars, { timestamp: i * MIN, price: 100 + i, size: 1 }, MIN).bars;
      view = followLiveEdge(view, before, bars.length);
      const frame = chartFrame(bars, view, { width: 800, height: 400 });
      expect([frame.first, frame.last]).toEqual([0, bars.length - 1]);
    }
  });

  it('a short chart keeps every bar in view while there is room, then follows the newest bar', () => {
    let view = { start: 0, end: 120 }; // the package's own window, with 10 bars so far
    const all = Array.from({ length: 200 }, (_, i) => bar(i));
    for (let n = 10; n < 200; n++) {
      view = followLiveEdge(view, n, n + 1);
      const frame = chartFrame(all.slice(0, n + 1), view, { width: 800, height: 400 });
      expect(frame.last).toBe(n);
      if (n + 1 <= 120) expect(frame.first).toBe(0);
    }
  });

  it('zooming on the newest bar does not stop the chart following', () => {
    const zoomed = { start: 54.95, end: 99.95 }; // what a wheel zoom with the pointer on the newest bar leaves
    expect(zoomed.end).toBeLessThan(100);
    expect(atLiveEdge(zoomed, 100)).toBe(true);
    const next = followLiveEdge(zoomed, 100, 101);
    expect(next.end - next.start).toBeCloseTo(zoomed.end - zoomed.start, 9);
    expect(next.end).toBeGreaterThan(100);
  });

  it('a reader who panned back by a few bars is left where they are', () => {
    const panned = { start: 40, end: 90 };
    expect(atLiveEdge(panned, 100)).toBe(false);
    expect(followLiveEdge(panned, 100, 101)).toBe(panned);
  });
});

describe('a tick on bars that are not on the epoch grid', () => {
  const DAY = 86_400_000;
  const OFFSET = 8 * 3_600_000; // bars stamped at 08:00 UTC, as a local midnight in UTC-8 would be
  const day = (i: number): CandleBar => ({ timestamp: i * DAY + OFFSET, open: 10, high: 12, low: 9, close: 11, volume: 5 });

  it('a tick inside the newest bar updates it instead of being dropped as late', () => {
    const bars = [day(0), day(1)];
    const result = applyTick(bars, { timestamp: day(1).timestamp + 3 * 3_600_000, price: 13, size: 2 }, DAY);
    expect(result.outcome).toBe('updated');
    expect(result.bars).toHaveLength(2);
    expect(result.bars[1].high).toBe(13);
    expect(result.bars[1].timestamp).toBe(day(1).timestamp);
  });

  it('a tick in the next day opens a bar on the same grid; a tick before the newest bar is late', () => {
    const bars = [day(0), day(1)];
    const opened = applyTick(bars, { timestamp: day(2).timestamp + 60_000, price: 11, size: 1 }, DAY);
    expect(opened.outcome).toBe('opened');
    expect(opened.bars[2].timestamp).toBe(day(2).timestamp);
    expect(applyTick(bars, { timestamp: day(1).timestamp - 1, price: 11, size: 1 }, DAY).outcome).toBe('late');
  });
});

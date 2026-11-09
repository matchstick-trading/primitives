import { describe, expect, it } from 'vitest';
import { applyTick, followLiveEdge, type LiveTick } from './live.js';
import type { CandleBar } from './chart-scale.js';

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

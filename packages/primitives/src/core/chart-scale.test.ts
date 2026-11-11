import { describe, expect, it } from 'vitest';
import { barInterval, chartFrame, growViewport, lastBars, priceRangeMissesData, zoomViewport, type CandleBar } from './chart-scale';

const bars: CandleBar[] = Array.from({ length: 200 }, (_, i) => ({
  timestamp: 1_700_000_000_000 + i * 60_000, open: 100, high: 105, low: 95, close: 101, volume: 10 + i,
}));
const SIZE = { width: 800, height: 400 };

// A zoom must keep whatever is under the pointer under the pointer: a drawing at that time may not slide.
describe('zoomViewport keeps the point under the pointer still', () => {
  it('wheel zoom: the pointer\'s time stays at the same x for zoom in and out, from any viewport', () => {
    for (const vp of [{ start: 20, end: 100 }, { start: 120, end: 190 }, { start: 0, end: 200 }]) {
      const frame = chartFrame(bars, vp, SIZE);
      for (const pointerX of [40, 300, 700]) {
        const around = frame.indexAt(pointerX);
        for (const factor of [0.5, 0.8, 0.9, 1.1, 1.25]) {
          const next = chartFrame(bars, zoomViewport(vp, factor, around, bars.length), SIZE);
          expect(next.x(around), `vp ${vp.start}-${vp.end} pointer ${pointerX} factor ${factor}`).toBeCloseTo(pointerX, 6);
        }
      }
    }
  });

  it('keyboard zoom: a bar index zooms around that bar\'s centre', () => {
    const vp = { start: 20, end: 100 };
    const before = chartFrame(bars, vp, SIZE);
    for (const factor of [0.8, 1.25]) {
      const next = chartFrame(bars, zoomViewport(vp, factor, 60, bars.length), SIZE);
      expect(next.x(60)).toBeCloseTo(before.x(60), 6);
    }
  });
});

// A chart that starts with a few bars and grows must open on the default window, not stay 1 or 2 bars wide.
describe('growViewport when the series grows', () => {
  it('a view that showed the whole short series reopens on the default window', () => {
    for (const [from, to] of [[1, 60], [2, 60], [0, 1]]) expect(growViewport(lastBars(from, 120), from, to)).toEqual(lastBars(to, 120));
    let view = lastBars(0, 120);
    for (const [seen, total] of [[0, 1], [1, 2], [2, 60]]) view = growViewport(view, seen, total);
    expect(view).toEqual({ start: 0, end: 60 });
  });
  it('a live append keeps following, and a view the user moved away from the end stays put', () => {
    expect(growViewport({ start: 80, end: 200 }, 200, 201)).toEqual({ start: 81, end: 201 });
    expect(growViewport({ start: 30, end: 60 }, 200, 201)).toEqual({ start: 30, end: 60 });
    expect(growViewport({ start: 0, end: 30 }, 60, 61)).toEqual({ start: 0, end: 30 });
  });
});

// A long series is sampled for its usual gap; a repeating gap (a weekend every fifth bar) must not fool the sample.
describe('barInterval on a long series', () => {
  it('finds the true median gap with a repeating long gap, with and without sampling', () => {
    const make = (n: number): CandleBar[] => { let t = 1_700_000_000_000; return Array.from({ length: n }, (_, i) => { t += i % 5 === 4 ? 3 * 86_400_000 : 86_400_000 / 4; return { timestamp: t, open: 1, high: 2, low: 0, close: 1, volume: 1 }; }); };
    expect(barInterval(make(15_000))).toBe(86_400_000 / 4);
    expect(barInterval(make(400_000))).toBe(86_400_000 / 4);
  });
  it('is not fooled by a long gap that repeats at a prime period (every 53rd bar)', () => {
    let t = 1_700_000_000_000;
    const bars: CandleBar[] = Array.from({ length: 21_201 }, (_, i) => { t += i % 53 === 1 ? 86_400_000 : 60_000; return { timestamp: t, open: 1, high: 2, low: 0, close: 1, volume: 1 }; });
    expect(barInterval(bars)).toBe(60_000);
  });
});

describe('the view when a live series grows', () => {
  it('a reader who zoomed out to see everything keeps that span on each new bar', () => {
    const zoomedOut = { start: -48.2, end: 501.8 };
    const next = growViewport(zoomedOut, 500, 501);
    expect(next.end - next.start).toBeGreaterThan(400);
    expect(growViewport(next, 501, 502).end - growViewport(next, 501, 502).start).toBeGreaterThan(400);
  });
  it('a chart that has only a few bars still opens on the default window once it grows', () => {
    expect(growViewport({ start: 0, end: 2 }, 2, 3)).toEqual({ start: 0, end: 3 });
    expect(growViewport({ start: 0, end: 100 }, 100, 300)).toEqual({ start: 180, end: 300 });
  });
  it('a view zoomed on the newest bar keeps following', () => {
    const next = growViewport({ start: 54.95, end: 99.95 }, 100, 101);
    expect(next.end).toBe(101);
  });
});

describe('a hand-set price range when the bars change', () => {
  it('is dropped when it no longer touches the bars, kept when it still does', () => {
    expect(priceRangeMissesData([98.8, 106.8], [4998, 5006])).toBe(true);
    expect(priceRangeMissesData([5100, 5200], [4998, 5006])).toBe(true);
    expect(priceRangeMissesData([4999, 5001], [4998, 5006])).toBe(false);
    expect(priceRangeMissesData([5005, 5100], [4998, 5006])).toBe(false);
    expect(priceRangeMissesData([1, 2], null)).toBe(false);
  });
});

describe('barInterval after a host refills the same array', () => {
  const make = (n: number, step: number): CandleBar[] => Array.from({ length: n }, (_, i) => ({ timestamp: 1_700_000_000_000 + i * step, open: 1, high: 2, low: 0, close: 1, volume: 1 }));
  it('reports the new interval when 500 minute bars are replaced in place by 500 day bars', () => {
    const bars = make(500, 60_000);
    expect(barInterval(bars)).toBe(60_000);
    const days = make(500, 86_400_000);
    for (let i = 0; i < 500; i++) bars[i] = days[i];
    expect(barInterval(bars)).toBe(86_400_000);
  });
});

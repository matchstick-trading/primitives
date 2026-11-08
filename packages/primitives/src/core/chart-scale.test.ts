import { describe, expect, it } from 'vitest';
import { chartFrame, growViewport, lastBars, zoomViewport, type CandleBar } from './chart-scale';

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

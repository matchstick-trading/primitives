import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkBars, devWarn } from './bar-check.js';

// Requirement (operator, 2026-11-14, DEV-2026-11-567): a chart that draws nothing, or draws January 1970, must say why in
// development, and say nothing in production or for good bars.
const bar = (timestamp: unknown, price: unknown = 100) => ({ timestamp, open: price, high: price, low: price, close: price, volume: 1 }) as never;
const ms = 1_700_000_000_000;

describe('left-out and mistimed bars', () => {
  it('names bars stamped in seconds (they would draw January 1970)', () => {
    const msg = checkBars([bar(1_700_000_000), bar(1_700_000_060)], 2);
    expect(msg).toMatch(/Unix seconds/);
    expect(msg).toMatch(/milliseconds/);
  });

  it('says nothing for good bars', () => {
    expect(checkBars([bar(ms), bar(ms + 60_000)], 2)).toBeNull();
  });

  it('counts the bars left out and names why: ISO text, string prices', () => {
    const iso = checkBars([bar('2026-01-05T14:30:00Z'), bar('2026-01-05T14:31:00Z'), bar('2026-01-05T14:32:00Z')], 0);
    expect(iso).toMatch(/3 of 3 bars left out/);
    expect(iso).toMatch(/Unix ms/);
    const price = checkBars([bar(ms, '101.5'), bar(ms + 60_000)], 1);
    expect(price).toMatch(/1 of 2 bars left out/);
    expect(price).toMatch(/string/);
  });

  it('says nothing for an empty list (data still loading)', () => {
    expect(checkBars([], 0)).toBeNull();
  });
});

describe('devWarn', () => {
  const env = process.env.NODE_ENV;
  afterEach(() => { process.env.NODE_ENV = env; vi.restoreAllMocks(); });

  it('is silent in production and warns once per message in development', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.NODE_ENV = 'production';
    devWarn('unique message A');
    expect(warn).not.toHaveBeenCalled();
    process.env.NODE_ENV = 'development';
    devWarn('unique message A');
    devWarn('unique message A');
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

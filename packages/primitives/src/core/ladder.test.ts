import { describe, expect, it } from 'vitest';
import { buildLadder } from './ladder.js';

describe('buildLadder', () => {
  const book = {
    bids: [{ price: '1000.10', size: '1.5' }, { price: '1000.05', size: '2.25' }, { price: '999.95', size: '4' }],
    asks: [{ price: '1000.20', size: '3' }, { price: '1000.30', size: '0.5' }, { price: '1000.35', size: '1' }],
  };

  it('groups with the bids rounded down and the asks rounded up, summing exactly', () => {
    const built = buildLadder({ ...book, step: '0.25' });
    expect(built.bids.map((r) => [r.price, r.size])).toEqual([['1000.00', '3.75'], ['999.75', '4.00']]);
    expect(built.asks.map((r) => [r.price, r.size])).toEqual([['1000.50', '1.50'], ['1000.25', '3.00']]); // highest first
    expect(built.last.spread).toBe('0.10');
    expect(built.asks[1].best && built.bids[0].best).toBe(true);
  });

  it('leaves a bad level out and says which, and reports a crossed book without repairing it', () => {
    const built = buildLadder({ bids: [{ price: '1000.30', size: '1' }, { price: '1,000', size: '1' }], asks: [{ price: '1000.20', size: '1' }], step: '0.05' });
    expect(built.issues.map((i) => [i.where, i.index ?? -1])).toEqual([['bids', 1], ['book', -1]]);
    expect(built.bids).toHaveLength(1);
    expect(built.last.spread).toBeUndefined();
  });

  it('puts traded size on the row whose bucket holds the price', () => {
    const built = buildLadder({ ...book, step: '0.05', traded: [{ price: '1000.20', size: '2' }, { price: '1000.20', size: '1' }, { price: '1000.10', size: '0.5' }] });
    expect(built.asks.find((r) => r.price === '1000.20')?.traded).toBe('3.00');
    expect(built.bids.find((r) => r.price === '1000.10')?.traded).toBe('0.50');
  });

  it('prints bucket prices at the step precision even when the book has more decimal places', () => {
    const built = buildLadder({ bids: [{ price: '1000.10', size: '2' }], asks: [{ price: '1000.20', size: '3' }], step: '0.1' });
    expect(built.bids[0].price).toBe('1000.1');
    expect(built.asks[0].price).toBe('1000.2');
  });
});

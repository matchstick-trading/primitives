import { describe, expect, it } from 'vitest';
import { holdTape, newestFirst, readTape, tapeSummary } from './tape.js';

const trade = (t: string, over: Record<string, unknown> = {}) => ({ t, price: '1000.20', size: '1.500', side: 'buy', ...over });

describe('readTape', () => {
  it('keeps good rows in order and reports each bad row with its place, without drawing it', () => {
    const { rows, issues } = readTape([
      trade('2026-01-05T14:30:00.100Z'),
      trade('2026-01-05T14:30:00.200Z', { price: '1,000.20' }), // not an exact decimal
      trade('2026-01-05T14:30:00.300Z', { size: '0' }), // not above zero
      trade('2026-01-05T14:29:59.000Z'), // back in time
      trade('2026-01-05T14:30:00.100Z', { side: 'sell' }), // same instant as row 0 is fine
      trade('2026-02-30T14:30:00Z'), // no such day
      trade('2026-01-05T14:30:00.100900Z'), // later than row 4 by under a millisecond
      trade('2026-01-05T14:30:00.100100Z'), // back in time by under a millisecond
    ]);
    expect(rows.map((r) => r.id)).toEqual(['0', '4', '6']);
    expect(issues.map((i) => i.index)).toEqual([1, 2, 3, 5, 7]);
    expect(rows[0].price).toBe('1000.20');
    expect(rows[0].time).toBe('14:30:00.100');
  });

  it('refuses a repeated id instead of drawing two rows under one key', () => {
    const { rows, issues } = readTape([trade('2026-01-05T14:30:00Z', { id: 'a' }), trade('2026-01-05T14:30:01Z', { id: 'a' })]);
    expect(rows).toHaveLength(1);
    expect(issues[0].message).toMatch(/already used/);
  });
});

describe('holdTape', () => {
  it('keeps the shown rows in place and counts what arrived since', () => {
    const all = readTape([0, 1, 2, 3, 4].map((n) => trade(`2026-01-05T14:30:0${n}Z`))).rows;
    const shown = newestFirst(all.slice(0, 3)).map((r) => r.id); // 2,1,0 held
    const held = holdTape(shown, all);
    expect(held.rows.map((r) => r.id)).toEqual(['2', '1', '0']);
    expect(held.waiting).toBe(2);
  });

  it('still counts what is waiting after the window drops every held row', () => {
    const all = readTape([2, 3].map((n) => ({ ...trade(`2026-01-05T14:30:0${n}Z`), id: String(n) }))).rows;
    expect(holdTape(['1', '0'], all)).toEqual({ rows: [], waiting: 2 });
  });
});

describe('tapeSummary', () => {
  it('is one line for the whole list, not a line per trade', () => {
    const rows = readTape([trade('2026-01-05T14:30:00Z'), trade('2026-01-05T14:30:01Z', { side: 'sell', price: '1000.15' })]).rows;
    expect(tapeSummary(rows)).toBe('2 trades: 1 buy, 1 sell. Last: sell 1.500 at 1000.15, 14:30:01 UTC.');
  });
});

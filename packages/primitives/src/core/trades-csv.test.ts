import { describe, expect, it } from 'vitest';
import { readTradesCsv } from './trades-csv';

// Written from the requirement before the reader existed (DEV-2026-11-561). Price and size are money and quantity:
// a misread comma draws a trade at the wrong price on a chart that looks right (the DEV-558 bug on a trades file).
describe('readTradesCsv: prices and sizes keep their value', () => {
  it('reads a thousands comma in a comma file, and names the file line of a bad row', () => {
    const csv = [
      'time,price,size,side',
      '2026-01-05T14:30:05.123Z,"4,725.50","1,200",buy',
      '2026-01-05T14:30:06Z,4725.25,2,sell',
      '2026-01-05T14:30:07Z,4725.25,2,maybe',
    ].join('\n');
    const { rows, issues } = readTradesCsv(csv);
    expect(rows.map((r) => [r.price, r.size, r.side])).toEqual([['4725.50', '1200', 'buy'], ['4725.25', '2', 'sell']]);
    expect(issues.map((i) => i.line)).toEqual([4]);
  });

  it('reads a decimal comma when the whole semicolon file uses decimal commas', () => {
    const { rows, issues } = readTradesCsv('time;price;size;side\n2026-01-05T14:30:05Z;4725,5;0,25;buy');
    expect(issues).toEqual([]);
    expect(rows[0]).toMatchObject({ price: '4725.5', size: '0.25' });
  });

  it('in a semicolon file that writes decimals with points, a bare 4,725 is a thousand and 0,5 is refused, never read as 5 or 05', () => {
    const csv = [
      'time;price;size;side',
      '2026-01-05T14:30:05Z;4725.50;1;buy',
      '2026-01-05T14:30:06Z;4,725;1;sell',
      '2026-01-05T14:30:07Z;0,5;1;buy',
    ].join('\n');
    const { rows, issues } = readTradesCsv(csv);
    expect(rows.map((r) => r.price)).toEqual(['4725.50', '4725']);
    expect(issues.map((i) => i.line)).toEqual([4]);
  });

  it('reads a grouped point-decimal price (4,725.50) in a semicolon file as 4725.50, not a refused decimal comma', () => {
    const { rows, issues } = readTradesCsv('time;price;size;side\n2026-01-05T14:30:05Z;4,725.50;1,200;buy');
    expect(issues).toEqual([]);
    expect(rows[0]).toMatchObject({ price: '4725.50', size: '1200' });
  });
});

describe('readTradesCsv: times keep their recorded precision', () => {
  it('keeps trades a newest-first file records inside one millisecond, and one just before midnight', () => {
    const csv = ['time,price,size,side', '2026-01-05T23:59:59.9999Z,10,1,sell', '2026-01-05T23:59:59.9998Z,10,1,buy'].join('\n');
    const { rows, issues } = readTradesCsv(csv);
    expect(issues).toEqual([]);
    expect(rows.map((r) => r.t)).toEqual(['2026-01-05T23:59:59.9998Z', '2026-01-05T23:59:59.9999Z']);
  });

  it('chooses the number convention from the whole file, not its first rows', () => {
    const rows = Array.from({ length: 150 }, (_, i) => `2026-01-05T14:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z;4,725;1,200;buy`);
    rows.push('2026-01-05T15:00:00Z;4,725.50;1;sell');
    const { rows: read, issues } = readTradesCsv(['time;price;size;side', ...rows].join('\n'));
    expect(issues).toEqual([]);
    expect(read[0]).toMatchObject({ price: '4725', size: '1200' });
    expect(read).toHaveLength(151);
  });

  it('a rejected boundary row (price 0) does not flip the file direction and drop valid trades', () => {
    const csv = ['time,price,size,side', '2026-01-05T14:30:05Z,10,1,buy', '2026-01-05T14:30:06Z,10,1,buy', '2026-01-05T14:30:04Z,0,1,buy'].join('\n');
    const { rows, issues } = readTradesCsv(csv);
    expect(rows.map((r) => r.t)).toEqual(['2026-01-05T14:30:05Z', '2026-01-05T14:30:06Z']);
    expect(issues.map((i) => i.line)).toEqual([4]);
  });
});


// Codex review of the 0.0.13 sync (public primitives #6): a row the reader accepts must not make valid rows vanish.
describe('readTradesCsv: one bad row does not take valid trades with it', () => {
  it('keeps .25, 10. and a decimal comma ,25 as exact decimal strings instead of dropping the trade', () => {
    const { rows, issues } = readTradesCsv('time,price,size,side\n2026-01-05T14:30:05Z,.25,10.,buy');
    expect(issues).toEqual([]);
    expect(rows[0]).toMatchObject({ price: '0.25', size: '10' });
    const comma = readTradesCsv('time;price;size;side\n2026-01-05T14:30:05Z;100,5;,25;buy');
    expect(comma.issues).toEqual([]);
    expect(comma.rows[0]).toMatchObject({ price: '100.5', size: '0.25' });
  });

  it('names a date that does not exist (Feb 30) and keeps the ascending rows around it in order', () => {
    const csv = ['time,price,size,side', '2026-03-01T14:30:05Z,1,1,buy', '2026-03-02T14:30:05Z,1,1,buy', '2026-02-30T14:30:05Z,1,1,buy'].join('\n');
    const { rows, issues } = readTradesCsv(csv);
    expect(rows.map((r) => r.t)).toEqual(['2026-03-01T14:30:05Z', '2026-03-02T14:30:05Z']);
    expect(issues.map((i) => i.line)).toEqual([4]);
  });
});

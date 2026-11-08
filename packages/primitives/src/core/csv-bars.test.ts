import { describe, expect, it } from 'vitest';
import { parseBarsCsv } from './csv-bars';

// A misread price or time draws a wrong chart that looks right, so these pin what a dropped file turns into.
describe('parseBarsCsv', () => {
  it('reads a daily export with an adjusted-close column, ignoring the extra column', () => {
    const csv = 'Date,Open,High,Low,Close,Adj Close,Volume\n2024-01-02,10,12,9,11,10.5,1000\n2024-01-03,11,13,10.5,12.25,12,1500\n';
    const { bars, errors } = parseBarsCsv(csv);
    expect(errors).toEqual([]);
    expect(bars).toEqual([
      { timestamp: Date.UTC(2024, 0, 2), open: 10, high: 12, low: 9, close: 11, volume: 1000 },
      { timestamp: Date.UTC(2024, 0, 3), open: 11, high: 13, low: 10.5, close: 12.25, volume: 1500 },
    ]);
  });

  it('reads Unix seconds, milliseconds and microseconds as the same instant', () => {
    const t = Date.UTC(2024, 0, 2, 14, 30);
    for (const stamp of [t / 1000, t, t * 1000]) {
      const { bars } = parseBarsCsv(`time,open,high,low,close,volume\n${stamp},1,2,0.5,1.5,10`);
      expect(bars[0]?.timestamp).toBe(t);
    }
  });

  it('reads semicolon files with decimal commas', () => {
    const { bars, errors } = parseBarsCsv('Datum;Open;High;Low;Close;Volume\n2024-01-02;10,5;12;9,25;11;100');
    expect(errors).toEqual([]);
    expect(bars[0]).toMatchObject({ open: 10.5, low: 9.25 });
  });

  it('joins separate date and time columns, read as UTC', () => {
    const { bars } = parseBarsCsv('Date,Time,Open,High,Low,Close,Volume\n2024-01-02,14:30,1,2,0.5,1.5,10');
    expect(bars[0]?.timestamp).toBe(Date.UTC(2024, 0, 2, 14, 30));
  });

  it('reads a header-less file as time, open, high, low, close, volume', () => {
    const { bars } = parseBarsCsv('1704205800000,1,2,0.5,1.5,10,1704205859999,15');
    expect(bars[0]).toEqual({ timestamp: 1704205800000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 });
  });

  it('sorts a newest-first file ascending and says so', () => {
    const { bars, notes } = parseBarsCsv('date,open,high,low,close\n2024-01-03,2,3,1,2\n2024-01-02,1,2,0.5,1.5');
    expect(bars.map((b) => b.open)).toEqual([1, 2]);
    expect(notes).toContain('sorted');
  });

  it('reports bad rows by line instead of fixing or dropping them silently', () => {
    const csv = [
      'date,open,high,low,close,volume',
      '2024-01-02,10,12,9,11,100',
      '2024-01-03,10,9,8,11,100', // high below the close
      '2024-01-04,10,abc,9,11,100', // not a number
      'not a date,10,12,9,11,100',
      '2024-01-02,10,12,9,11,100', // same time as line 2
    ].join('\n');
    const { bars, errors } = parseBarsCsv(csv);
    expect(bars).toHaveLength(1);
    expect(errors.map((e) => e.line)).toEqual([3, 4, 5, 6]);
  });

  it('picks the columns and units a file means, not a near match', () => {
    const at = (csv: string) => parseBarsCsv(csv).bars.map((b) => b.timestamp);
    expect(at('Date,Timestamp,Open,High,Low,Close\n2024-01-02,2024-01-02T14:30:00Z,1,2,0.5,1')).toEqual([Date.UTC(2024, 0, 2, 14, 30)]);
    expect(at('time,open,high,low,close\n31536000000,1,2,0.5,1')).toEqual([Date.UTC(1971, 0, 1)]); // milliseconds
    expect(at('2024-01-02,1,2,0.5,1.5,10')).toEqual([Date.UTC(2024, 0, 2)]); // no header, ISO time
    expect(parseBarsCsv('1704205800;1,1;2,2;0,5;1,5;10,0').bars[0]).toMatchObject({ open: 1.1, close: 1.5, volume: 10 });
    expect(parseBarsCsv('Date,Open,High,Low,Close,Volume USD,Volume\n2024-01-02,1,2,0.5,1,999,10').bars[0]?.volume).toBe(10);
  });

  it('refuses times and numbers that would chart as plausible but wrong', () => {
    const csv = [
      'date,time,open,high,low,close,volume',
      '2024-00-15,10:00,1,2,0.5,1,1', // month zero
      '2024-01-02,,1,2,0.5,1,1', // no time in a date-and-time file
      '2024-01-03,10:00,1e999,1e999,0.5,1,1', // overflows to Infinity
    ].join('\n');
    const { bars, errors } = parseBarsCsv(csv);
    expect(bars).toEqual([]);
    expect(errors.map((e) => e.line)).toEqual([2, 3, 4]);
    expect(parseBarsCsv('time,open,high,low,close\n2024-01-02T00:00:00+99:99,1,2,0.5,1').bars).toEqual([]);
  });

  it('keeps a quoted line break inside its record and numbers later lines by the file', () => {
    const { bars, errors } = parseBarsCsv('Date,Notes,Open,High,Low,Close\n2024-01-02,"two\nlines",1,2,0.5,1\nbad,row,1,2,0.5,1');
    expect(bars).toHaveLength(1);
    expect(errors.map((e) => e.line)).toEqual([4]);
  });

  it('says what is missing when a price column cannot be found', () => {
    const { bars, errors } = parseBarsCsv('date,price\n2024-01-02,10');
    expect(bars).toEqual([]);
    expect(errors[0]?.message).toMatch(/open/i);
  });
});

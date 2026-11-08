import { describe, expect, it } from 'vitest';
import { csvAdapter, toSeriesSet } from './adapter';
import { report, validateSeriesSet } from './series';

// Spec: a 0 is a value, an empty or NA cell is "unknown", never 0; a file in local
// time says so; a text column is not a series. A chart that turns blanks into zeros draws a wrong line that looks right.
describe('csvAdapter', () => {
  const csv = ['Date,Open,High,Low,Close,Volume,Signal,Symbol', '2026-01-05 09:30,10,12,9,11,100,0,ABC', '2026-01-05 09:31,11,13,10,12,100,,ABC', '2026-01-05 09:32,12,14,11,13,100,NA,ABC', '2026-01-05 09:33,13,15,12,14,100,2.5,ABC'].join('\n');

  it('keeps 0 as a value, makes empty and NA unknown, leaves the text column out, and the set validates and reports them', () => {
    const r = csvAdapter.read(csv, { utcOffsetMinutes: -300 });
    expect(r.errors).toEqual([]);
    expect(r.bars[0]?.timestamp).toBe(Date.UTC(2026, 0, 5, 14, 30)); // 09:30 at UTC-5
    expect(r.series.map((s) => s.id)).toEqual(['signal']);
    expect(r.series[0]?.points.map((p) => (p.kind === 'value' ? p.v : p.kind))).toEqual([0, 'unknown', 'unknown', 2.5]);
    expect(r.notes.join(' ')).toContain('UTC-5:00');
    const set = toSeriesSet(r);
    expect(validateSeriesSet(set).ok).toBe(true);
    expect(report(set).filter((f) => f.kind === 'unclassified')).toHaveLength(2);
  });

  it('says UTC when no offset is given, and names a bad row by line', () => {
    const r = csvAdapter.read('time,open,high,low,close\n2026-01-05T09:30:00,1,2,0.5,1.5\n2026-01-05T09:31:00,1,2,0.5,x');
    expect(r.notes).toContain('Times with no zone were read as UTC.');
    expect(r.errors).toEqual([{ line: 3, message: 'A price or the volume is not a number.' }]);
  });

  it('keeps a named extra column that has no value on any row, as unknown', () => {
    const r = csvAdapter.read('time,open,high,low,close,volume,flag\n2026-01-05T14:00:00Z,1,2,0.5,1.5,10,\n2026-01-05T14:01:00Z,1.5,2,1,1.2,10,NA\n', { utcOffsetMinutes: 0 });
    const flag = r.series.find((x) => x.id.includes('flag'));
    expect(flag?.points.map((p) => p.kind)).toEqual(['unknown', 'unknown']);
  });

  it('names a column it leaves out, and says nothing about zones when every time has one', () => {
    const r = csvAdapter.read('time,open,high,low,close,volume,ind\n2026-01-05T14:00:00Z,1,2,0.5,1.5,10,abc\n2026-01-05T14:01:00Z,1.5,2,1,1.2,10,2\n');
    expect(r.series).toEqual([]);
    expect(r.notes.join(' ')).toMatch(/Column "ind"/);
    expect(r.notes.join(' ')).not.toMatch(/no zone/);
  });
});

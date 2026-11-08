import { describe, expect, it } from 'vitest';
import { alignSeries, report, resolveSeries, seriesSetSchema, validateSeriesSet, type DataSeries, type SeriesPoint, type SeriesSet } from './series';

// Written from the series data contract: its five synthetic fixtures and the
// bad set are the spec. A series that draws a gap as zero, or hides a feed that stopped, looks right and is wrong.
const day = (hhmmss: string) => `2026-01-05T${hhmmss}Z`;
const val = (t: string, v: number): SeriesPoint => ({ t: day(t), kind: 'value', v });
const gap = (t: string, kind: Exclude<SeriesPoint['kind'], 'value'>): SeriesPoint => ({ t: day(t), kind }) as SeriesPoint;
const ser = (id: string, points: SeriesPoint[]): DataSeries => ({ id, label: id, points });
const set = (primary: string, series: DataSeries[], extra: Partial<SeriesSet> = {}): SeriesSet => ({ schemaVersion: '0', alignment: { mode: 'exact', primary }, series, ...extra });

describe('series contract fixtures', () => {
  it('1: warm-up is not-applicable and a real zero stays a value', () => {
    const s = set('bars', [ser('bars', [val('14:00:00', 10), val('15:00:00', 11), val('16:00:00', 12), val('17:00:00', 13)]), ser('osc', [gap('14:00:00', 'not-applicable'), gap('15:00:00', 'not-applicable'), val('16:00:00', 0), val('17:00:00', 100)])]);
    expect(validateSeriesSet(s).ok).toBe(true);
    expect(report(s)).toEqual([]);
    expect(alignSeries([Date.parse(day('16:00:00')), Date.parse(day('17:00:00'))], s.series[1]).values).toEqual([0, 100]);
  });

  it('2: a closed session against a missing point is a disagreement', () => {
    const s = set('a', [ser('a', [val('14:00:00', 1), gap('15:00:00', 'market-closed')]), ser('b', [val('14:00:00', 1), gap('15:00:00', 'missing')])]);
    expect(report(s)).toEqual([{ t: day('15:00:00'), kind: 'gap-kind-differs', series: ['a', 'b'], detail: 'a=market-closed, b=missing' }]);
  });

  it('3: different timestamps line up as-of within the tolerance, and one with no point is reported', () => {
    const s = set('p', [ser('p', [val('14:00:00', 1), val('14:01:00', 2), val('14:05:00', 3)]), ser('e', [val('13:59:30', 7), val('14:02:00', 8)])], { alignment: { mode: 'asof', toleranceMs: 90000, primary: 'p' } });
    expect(report(s)).toEqual([{ t: day('14:05:00'), kind: 'no-point', series: ['p', 'e'], detail: 'e has no point within 90000 ms' }]);
    const times = s.series[0].points.map((p) => Date.parse(p.t));
    expect(alignSeries(times, s.series[1], { mode: 'asof', toleranceMs: 90000 })).toMatchObject({ values: [7, 7, null], states: ['value', 'value', 'no-point'] });
  });

  it('4: a feed that stops is found from the window end', () => {
    const s = set('a', [ser('a', [val('14:00:00', 1), val('15:00:00', 1), val('16:00:00', 1), val('17:00:00', 1)]), ser('b', [val('14:00:00', 1), val('15:00:00', 1)])], { window: { start: day('14:00:00'), end: day('17:00:00') } });
    const found = report(s);
    expect(found.map((f) => [f.kind, f.t, f.series])).toEqual([['feed-stopped', day('15:00:00'), ['b']], ['no-point', day('16:00:00'), ['a', 'b']]]);
  });

  it('5: unknown is listed, never a disagreement with another gap; halted differs from missing', () => {
    const s = set('csv', [ser('csv', [val('14:00:00', 1), gap('15:00:00', 'unknown'), gap('16:00:00', 'halted')]), ser('ref', [val('14:00:00', 1), gap('15:00:00', 'missing'), gap('16:00:00', 'missing')])]);
    expect(report(s).map((f) => [f.kind, f.t])).toEqual([['unclassified', day('15:00:00')], ['gap-kind-differs', day('16:00:00')]]);
  });

  it('an unknown against a value is a disagreement', () => {
    const s = set('a', [ser('a', [gap('14:00:00', 'unknown')]), ser('b', [val('14:00:00', 5)])]);
    expect(report(s).map((f) => f.kind)).toEqual(['unclassified', 'gap-kind-differs']);
  });
});

describe('null, zero and gap in what the parts draw', () => {
  it('draws zero as a value, a gap kind as no value, and a bar with no point as no-point', () => {
    const times = [0, 60_000, 120_000, 180_000].map((n) => Date.UTC(2026, 0, 5, 14, 0, 0) + n);
    const iso = (n: number) => new Date(n).toISOString();
    const r = resolveSeries(times, { id: 's', label: 's', points: [{ t: iso(times[0]!), kind: 'value', v: 0 }, { t: iso(times[1]!), kind: 'unknown' }, { t: iso(times[2]!), kind: 'market-closed' }] });
    expect(r.values).toEqual([0, null, null, null]);
    expect(r.states).toEqual(['value', 'unknown', 'market-closed', 'no-point']);
    expect(r.problems).toEqual([]);
  });
});

describe('bad input to the parts (bad input)', () => {
  const times = [0, 60_000].map((n) => Date.UTC(2026, 0, 5, 14, 0, 0) + n);
  it('does not throw on a null entry, a non-list, or NaN, and says what was left out', () => {
    const t = new Date(times[0]!).toISOString();
    const withNull = resolveSeries(times, { id: 'a', label: 'a', points: [{ t, kind: 'value', v: 1 }, null as never] });
    expect(withNull.values).toEqual([1, null]);
    expect(withNull.problems.join(' ')).toMatch(/1 point that cannot be used/);
    expect(resolveSeries(times, { id: 'a', label: 'a', points: null as never }).problems.join(' ')).toMatch(/not a list/);
    expect(resolveSeries(times, { id: 'a', label: 'a', points: [{ t, kind: 'value', v: NaN }] }).problems.join(' ')).toMatch(/cannot be used/);
  });
});

describe('review findings (PR 405)', () => {
  const base = (points: unknown[]) => ({ schemaVersion: '0', alignment: { mode: 'exact', primary: 'a' }, series: [{ id: 'a', label: 'a', points }] });
  it('refuses a calendar date that does not exist, and an empty slot in a points array', () => {
    expect(validateSeriesSet(base([{ t: '2026-02-30T14:00:00Z', kind: 'unknown' }])).ok).toBe(false);
    expect(validateSeriesSet(base(new Array(1))).ok).toBe(false);
    expect(validateSeriesSet(base([{ t: '2026-02-28T14:00:00Z', kind: 'unknown' }])).ok).toBe(true);
  });
  it('still reports a feed that stopped when it resumes after the range', () => {
    const s = set('a', [ser('a', [val('14:00:00', 1), val('15:00:00', 1), val('16:00:00', 1)]), ser('b', [val('14:00:00', 1), val('15:00:00', 1), val('18:00:00', 1)])], { window: { start: day('14:00:00'), end: day('17:00:00') } });
    expect(report(s).map((f) => f.kind)).toContain('feed-stopped');
  });
});

describe('the boundary', () => {
  it('names every problem in one pass, and accepts the set as a Standard Schema', () => {
    const bad = { schemaVersion: '0', alignment: { mode: 'exact', primary: 'nope' }, series: [{ id: 'x', label: 'x', points: [{ t: day('15:00:00'), kind: 'value', v: 1 }, { t: day('14:00:00'), kind: 'value', v: Number.NaN }] }] };
    const r = validateSeriesSet(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.path.join('.'))).toEqual(expect.arrayContaining(['series.0.points.1.t', 'series.0.points.1.v', 'alignment.primary']));
    const std = seriesSetSchema['~standard'].validate(bad);
    expect(std.issues?.length).toBeGreaterThanOrEqual(3);
  });
});

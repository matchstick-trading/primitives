// A series with a clock. A point says when it is (an ISO-8601 UTC instant) and what it is: a finite number, or one of five
// reasons there is no number. Zero is a value; NaN and infinity are refused, never drawn as gaps. The rules here are plain
// functions: no calendar (a calendar is the host's), no repair (a disagreement is reported, never fixed), no network.
// The shape follows the series data contract draft; `report` and `alignSeries` are the two pure readers of it.

/** Why a point has no number. `value` has one. */
export type PointKind = 'value' | 'missing' | 'market-closed' | 'not-applicable' | 'halted' | 'unknown';

/** One point on a series. `t` is ISO-8601 UTC, for example `2026-01-05T14:30:00Z`. Only `value` carries `v`. */
export type SeriesPoint =
  | { t: string; kind: 'value'; v: number }
  | { t: string; kind: Exclude<PointKind, 'value'> };

/** Which calendar decided `market-closed`. A label: the host fills it and nothing here resolves it. */
export interface SeriesCalendar {
  id: string;
  version?: string;
  tz: string;
}

export interface DataSeries {
  id: string;
  label: string;
  unit?: string;
  calendar?: SeriesCalendar;
  /** Strictly increasing in time. */
  points: SeriesPoint[];
}

/** `exact`: same instant. `asof`: the latest point at or before, within `toleranceMs`. `none`: no cross-series comparison. */
export type AlignMode = 'exact' | 'asof' | 'none';

export interface SeriesSet {
  schemaVersion: '0';
  alignment: { mode: AlignMode; toleranceMs?: number; primary: string };
  /** Half-open `[start, end)`: a point at `end` is outside it. */
  window?: { start: string; end: string };
  series: DataSeries[];
}

export const POINT_KINDS: readonly PointKind[] = ['value', 'missing', 'market-closed', 'not-applicable', 'halted', 'unknown'];

/** One problem found at the boundary, with the path to it (`series.1.points.3.t`). */
export interface SeriesIssue {
  path: (string | number)[];
  message: string;
}

export type SeriesValidation = { ok: true; value: SeriesSet } | { ok: false; issues: SeriesIssue[] };

const ISO_UTC = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(\.\d+)?Z$/;
/** An ISO-8601 UTC instant whose calendar date is real: `Date.parse` alone would turn 2026-02-30 into March 2. */
const isIso = (s: unknown): s is string => {
  if (typeof s !== 'string') return false;
  const m = ISO_UTC.exec(s);
  if (!m || !Number.isFinite(Date.parse(s))) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
};
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function unknownKeys(obj: Record<string, unknown>, allowed: readonly string[], path: (string | number)[], issues: SeriesIssue[]) {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) issues.push({ path: [...path, k], message: `unknown key "${k}"` });
}

/**
 * Check a value at the boundary (a recorded session, an adapter's output, a hand-built set). Every problem is returned
 * in one pass, not only the first. The input is not changed.
 */
export function validateSeriesSet(input: unknown): SeriesValidation {
  const issues: SeriesIssue[] = [];
  if (!isRecord(input)) return { ok: false, issues: [{ path: [], message: 'expected an object' }] };
  unknownKeys(input, ['schemaVersion', 'alignment', 'window', 'series'], [], issues);
  if (input.schemaVersion !== '0') issues.push({ path: ['schemaVersion'], message: 'must be "0"' });

  const al = input.alignment;
  if (!isRecord(al)) issues.push({ path: ['alignment'], message: 'expected an object' });
  else {
    unknownKeys(al, ['mode', 'toleranceMs', 'primary'], ['alignment'], issues);
    if (al.mode !== 'exact' && al.mode !== 'asof' && al.mode !== 'none') issues.push({ path: ['alignment', 'mode'], message: 'must be "exact", "asof" or "none"' });
    if (al.toleranceMs !== undefined && !(typeof al.toleranceMs === 'number' && Number.isInteger(al.toleranceMs) && al.toleranceMs >= 0)) issues.push({ path: ['alignment', 'toleranceMs'], message: 'must be a whole number of milliseconds, 0 or more' });
    if (al.mode === 'asof' && al.toleranceMs === undefined) issues.push({ path: ['alignment', 'toleranceMs'], message: 'required when mode is asof' });
    if (typeof al.primary !== 'string' || al.primary === '') issues.push({ path: ['alignment', 'primary'], message: 'must name a series' });
  }

  const w = input.window;
  if (w !== undefined) {
    if (!isRecord(w)) issues.push({ path: ['window'], message: 'expected an object' });
    else {
      unknownKeys(w, ['start', 'end'], ['window'], issues);
      if (!isIso(w.start)) issues.push({ path: ['window', 'start'], message: 'must be an ISO-8601 UTC time like 2026-01-05T14:30:00Z' });
      if (!isIso(w.end)) issues.push({ path: ['window', 'end'], message: 'must be an ISO-8601 UTC time like 2026-01-05T14:30:00Z' });
      if (isIso(w.start) && isIso(w.end) && Date.parse(w.end) <= Date.parse(w.start)) issues.push({ path: ['window', 'end'], message: 'end must be after start (the range is [start, end))' });
    }
  }

  const list = input.series;
  if (!Array.isArray(list) || list.length === 0) issues.push({ path: ['series'], message: 'expected at least one series' });
  else {
    const ids: string[] = [];
    for (let i = 0; i < list.length; i++) {
      const s: unknown = list[i]; // by index: an empty slot in a sparse array is read as undefined, not skipped
      const at = ['series', i];
      if (!isRecord(s)) { issues.push({ path: at, message: 'expected an object' }); continue; }
      unknownKeys(s, ['id', 'label', 'unit', 'calendar', 'points'], at, issues);
      if (typeof s.id !== 'string' || s.id === '') issues.push({ path: [...at, 'id'], message: 'must be a non-empty string' });
      else ids.push(s.id);
      if (typeof s.label !== 'string' || s.label === '') issues.push({ path: [...at, 'label'], message: 'must be a non-empty string' });
      if (s.unit !== undefined && typeof s.unit !== 'string') issues.push({ path: [...at, 'unit'], message: 'must be a string' });
      if (s.calendar !== undefined) {
        const c = s.calendar;
        if (!isRecord(c)) issues.push({ path: [...at, 'calendar'], message: 'expected an object' });
        else {
          unknownKeys(c, ['id', 'version', 'tz'], [...at, 'calendar'], issues);
          if (typeof c.id !== 'string' || c.id === '') issues.push({ path: [...at, 'calendar', 'id'], message: 'must be a non-empty string' });
          if (typeof c.tz !== 'string' || c.tz === '') issues.push({ path: [...at, 'calendar', 'tz'], message: 'must be a non-empty string' });
          if (c.version !== undefined && typeof c.version !== 'string') issues.push({ path: [...at, 'calendar', 'version'], message: 'must be a string' });
        }
      }
      if (!Array.isArray(s.points)) { issues.push({ path: [...at, 'points'], message: 'expected a list' }); continue; }
      let last = Number.NEGATIVE_INFINITY;
      for (let j = 0; j < s.points.length; j++) {
        const p: unknown = s.points[j];
        const pat = [...at, 'points', j];
        if (!isRecord(p)) { issues.push({ path: pat, message: 'expected an object' }); continue; }
        const kind = p.kind;
        if (typeof kind !== 'string' || !POINT_KINDS.includes(kind as PointKind)) { issues.push({ path: [...pat, 'kind'], message: `must be one of ${POINT_KINDS.join(', ')}` }); continue; }
        unknownKeys(p, kind === 'value' ? ['t', 'kind', 'v'] : ['t', 'kind'], pat, issues);
        if (!isIso(p.t)) issues.push({ path: [...pat, 't'], message: 'must be an ISO-8601 UTC time like 2026-01-05T14:30:00Z' });
        else {
          const ms = Date.parse(p.t);
          if (ms <= last) issues.push({ path: [...pat, 't'], message: 'timestamps must strictly increase' });
          last = ms;
        }
        if (kind === 'value' && !(typeof p.v === 'number' && Number.isFinite(p.v))) issues.push({ path: [...pat, 'v'], message: 'a value must be a finite number (NaN and infinity are refused)' });
      }
    }
    if (new Set(ids).size !== ids.length) issues.push({ path: ['series'], message: 'series ids must be unique' });
    if (isRecord(al) && typeof al.primary === 'string' && al.primary !== '' && !ids.includes(al.primary)) issues.push({ path: ['alignment', 'primary'], message: 'primary must name a series' });
  }
  return issues.length === 0 ? { ok: true, value: input as unknown as SeriesSet } : { ok: false, issues };
}

/** The outcome shape Standard Schema v1 uses, kept local so the core imports nothing. */
type StandardResult<T> = { value: T; issues?: undefined } | { issues: ReadonlyArray<{ message: string; path?: ReadonlyArray<string | number> }>; value?: undefined };

/**
 * `validateSeriesSet` as a Standard Schema (v1), so any validator-aware tool can run it at a boundary, for example
 * `check(seriesSetSchema, data)` from `@fieldtest/core`. Imports nothing.
 */
export const seriesSetSchema: {
  readonly '~standard': { readonly version: 1; readonly vendor: 'matchstick-primitives'; readonly validate: (value: unknown) => StandardResult<SeriesSet>; readonly types?: { readonly input: SeriesSet; readonly output: SeriesSet } };
} = {
  '~standard': {
    version: 1,
    vendor: 'matchstick-primitives',
    validate(value) {
      const r = validateSeriesSet(value);
      return r.ok ? { value: r.value } : { issues: r.issues.map((i) => ({ message: i.message, path: i.path })) };
    },
  },
};

/** What `report` finds. It reads and never repairs. */
export type FindingKind = 'gap-kind-differs' | 'no-point' | 'feed-stopped' | 'unclassified';

export interface SeriesFinding {
  /** An ISO time, on the primary's grid for the comparison findings. */
  t: string;
  kind: FindingKind;
  /** The series involved: the primary first, then the other, for a comparison. */
  series: string[];
  detail: string;
}

const inWindow = (set: SeriesSet, ms: number) => !set.window || (ms >= Date.parse(set.window.start) && ms < Date.parse(set.window.end));

/** Index of the last time in `times` (ascending) that is at or before `t`, or -1. */
function atOrBefore(times: readonly number[], t: number): number {
  let lo = 0;
  let hi = times.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

/**
 * Where the series in a set disagree, read on the primary's timestamps. In order: every `unknown` point in the window
 * (`unclassified`), a series that stops before the window ends (`feed-stopped`), then for each primary point and
 * each other series, no point within tolerance (`no-point`) or two different kinds (`gap-kind-differs`).
 *
 * `not-applicable` against anything is expected (a warm-up) and is not reported. `unknown` against another gap kind
 * cannot disagree, but `unknown` against a value does. `halted` is an ordinary kind. With mode `none` there is no
 * comparison across series. The set is not changed; run `validateSeriesSet` first for a set from outside.
 */
export function report(set: SeriesSet): SeriesFinding[] {
  const out: SeriesFinding[] = [];
  const primary = set.series.find((s) => s.id === set.alignment.primary);
  for (const s of set.series)
    for (const q of s.points)
      if (q.kind === 'unknown' && inWindow(set, Date.parse(q.t))) out.push({ t: q.t, kind: 'unclassified', series: [s.id], detail: `${s.id}: absent, source does not say why` });

  if (set.window) {
    const end = Date.parse(set.window.end);
    for (const s of set.series) {
      const inside = s.points.filter((q) => Date.parse(q.t) < end); // a point after the range cannot hide a feed that stopped inside it
      const ts = inside.map((q) => Date.parse(q.t));
      const gaps = ts.slice(1).map((x, i) => x - ts[i]).sort((x, y) => x - y);
      const step = gaps[Math.floor(gaps.length / 2)] ?? 0; // the usual interval: the median
      const last = ts.length ? ts[ts.length - 1] : undefined;
      if (last === undefined || last < end - step) {
        const lastText = last === undefined ? 'none' : inside[inside.length - 1].t;
        out.push({ t: last === undefined ? set.window.start : lastText, kind: 'feed-stopped', series: [s.id], detail: `${s.id} last point ${lastText} is more than one interval (${step} ms) before the range end ${set.window.end} (exclusive)` });
      }
    }
  }

  if (!primary || set.alignment.mode === 'none') return out;
  const tolerance = set.alignment.mode === 'asof' ? set.alignment.toleranceMs ?? 0 : 0;
  const isGap = (k: PointKind) => k !== 'value';
  for (const s of set.series) {
    if (s === primary) continue;
    const times = s.points.map((q) => Date.parse(q.t));
    for (const pt of primary.points) {
      const t = Date.parse(pt.t);
      if (!inWindow(set, t)) continue;
      const at = atOrBefore(times, t);
      if (at < 0 || t - times[at] > tolerance) { out.push({ t: pt.t, kind: 'no-point', series: [primary.id, s.id], detail: `${s.id} has no point within ${tolerance} ms` }); continue; }
      const other = s.points[at];
      const same = other.kind === pt.kind;
      const warmup = other.kind === 'not-applicable' || pt.kind === 'not-applicable';
      const dontKnow = (other.kind === 'unknown' || pt.kind === 'unknown') && isGap(other.kind) && isGap(pt.kind);
      if (!same && !warmup && !dontKnow) out.push({ t: pt.t, kind: 'gap-kind-differs', series: [primary.id, s.id], detail: `${primary.id}=${pt.kind}, ${s.id}=${other.kind}` });
    }
  }
  return out;
}

/** What a series is at one bar: a number, a kind of nothing, or `no-point` when the series has no point there. */
export type AlignedState = PointKind | 'no-point';

export interface AlignedSeries {
  id: string;
  label: string;
  /** One entry per bar; `null` for any bar without a finite value. Zero stays zero. */
  values: Array<number | null>;
  /** One entry per bar: why `values` is null there, or `value`. */
  states: AlignedState[];
}

export interface AlignOptions {
  mode?: AlignMode;
  /** For `asof`: how far back a point may be and still count. Milliseconds. */
  toleranceMs?: number;
}

/**
 * Put a series on the bars' clock: for each bar time, the point at that instant (`exact`) or the latest point at or
 * before it within the tolerance (`asof`). A bar with no point gets `null` and the state `no-point`. Nothing is carried
 * across a gap kind and no zero is invented. `none` is read as `exact`.
 */
export function alignSeries(barTimes: readonly number[], series: DataSeries, options: AlignOptions = {}): AlignedSeries {
  const tolerance = options.mode === 'asof' ? Math.max(0, options.toleranceMs ?? 0) : 0;
  const times = series.points.map((q) => Date.parse(q.t));
  const values: Array<number | null> = new Array(barTimes.length).fill(null);
  const states: AlignedState[] = new Array(barTimes.length).fill('no-point');
  for (let i = 0; i < barTimes.length; i++) {
    const at = atOrBefore(times, barTimes[i]);
    if (at < 0 || barTimes[i] - times[at] > tolerance) continue;
    const p = series.points[at];
    states[i] = p.kind;
    if (p.kind === 'value') values[i] = p.v;
  }
  return { id: series.id, label: series.label, values, states };
}

/**
 * Turn a value-per-bar array (a study, or anything made by position) into points on the bars' clock. A number is a
 * value; `null`, NaN and infinity become `gapKind` (default `not-applicable`, which is what a warm-up is).
 */
export function pointsFromValues(barTimes: ReadonlyArray<number | { timestamp: number }>, values: ReadonlyArray<number | null | undefined>, gapKind: Exclude<PointKind, 'value'> = 'not-applicable'): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  for (let i = 0; i < barTimes.length; i++) {
    const v = values[i];
    const at = barTimes[i]!;
    const t = new Date(typeof at === 'number' ? at : at.timestamp).toISOString();
    out.push(typeof v === 'number' && Number.isFinite(v) ? { t, kind: 'value', v } : { t, kind: gapKind });
  }
  return out;
}

/** A series as a part receives it: on its own clock (`points`), or by position (`values`, the shim). */
export interface SeriesInput {
  id: string;
  label: string;
  points?: ReadonlyArray<SeriesPoint>;
  /** Kept for now so existing code keeps drawing: one value per bar by position. It will be removed in a later version. */
  values?: ReadonlyArray<number | null>;
}

export interface ResolvedSeries {
  /** One entry per bar; `null` for none. */
  values: ReadonlyArray<number | null>;
  /** Why a bar has no value; absent for the position shim, which cannot say. */
  states?: AlignedState[];
  /** Plain sentences about what is wrong with the input, empty when nothing is. Nothing is repaired. */
  problems: string[];
}

const NO_VALUES: ReadonlyArray<number | null> = [];

/**
 * The values to draw for one series on these bars. `points` are placed by time (see `alignSeries`); `values` are read by
 * position. Problems are returned in words and the series is still drawn as far as it can be: a length that does not
 * match the bars, a series with no value on any bar, points out of time order.
 */
export function resolveSeries(barTimes: readonly number[], input: SeriesInput, options: AlignOptions = {}): ResolvedSeries {
  const problems: string[] = [];
  const name = `"${input.label || input.id}"`;
  let values: ReadonlyArray<number | null>;
  let states: AlignedState[] | undefined;
  if (input.points !== undefined) {
    if (!Array.isArray(input.points)) {
      problems.push(`${name} has points that are not a list, so it is not drawn.`);
      values = NO_VALUES;
    } else {
      // Only a usable point goes on: an object with a readable time, a known kind, and a finite number on a value.
      const usable: SeriesPoint[] = [];
      let bad = 0;
      for (let i = 0; i < input.points.length; i++) {
        const p = input.points[i] as SeriesPoint | null | undefined;
        const ok = typeof p === 'object' && p !== null && isIso(p.t)
          && (POINT_KINDS as readonly string[]).includes(p.kind) && (p.kind !== 'value' || (typeof p.v === 'number' && Number.isFinite(p.v)));
        if (ok) usable.push(p as SeriesPoint);
        else {
          bad++;
          // A rejected point with a readable time stays as an unknown, so an as-of alignment cannot carry the value before it across.
          if (typeof p === 'object' && p !== null && isIso(p.t)) usable.push({ t: p.t, kind: 'unknown' });
        }
      }
      if (bad > 0) problems.push(`${name} has ${bad} point${bad === 1 ? '' : 's'} that cannot be used (a missing time, a time that is not ISO-8601 UTC ending in Z, an unknown kind, or a value that is not a finite number), so ${bad === 1 ? 'it was' : 'they were'} left out.`);
      let prev = Number.NEGATIVE_INFINITY;
      let ordered = true;
      for (const p of usable) {
        const t = Date.parse(p.t);
        if (t <= prev) { ordered = false; break; }
        prev = t;
      }
      if (!ordered) { problems.push(`${name} has points that are not in strictly increasing time order, so it is not drawn.`); values = NO_VALUES; }
      else {
        const aligned = alignSeries(barTimes, { id: input.id, label: input.label, points: usable }, options);
        values = aligned.values;
        states = aligned.states;
        if (usable.length > 0 && aligned.states.every((s) => s === 'no-point')) problems.push(`${name} has no point on any bar. Point times are ISO-8601 UTC text, for example 2026-01-05T14:30:00Z, and must fall on the bars' times.`);
      }
    }
  } else {
    values = input.values ?? NO_VALUES;
    if (input.values !== undefined && input.values.length !== barTimes.length) problems.push(`${name} has ${input.values.length} values for ${barTimes.length} bars. Values are read by position, so the extra or missing ones are ignored. Pass points with times instead.`);
  }
  if (!problems.some((p) => !p.includes('cannot be used')) && !values.some((v) => typeof v === 'number' && Number.isFinite(v))) problems.push(`${name} has no value on any bar.`);
  return { values, states, problems };
}

/** The ids used by more than one series, once each. */
export function duplicateIds(items: ReadonlyArray<{ id: string }>): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const { id } of items) (seen.has(id) ? dup : seen).add(id);
  return [...dup];
}

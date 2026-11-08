import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { useChart } from './ChartParts.js';
import { resolveSeries, type SeriesPoint } from './core/series.js';
import { SelectionContext } from './selection-context.js';

/**
 * Study as parts: Root, Line, Band, Legend. Line and Band go inside `Chart.Plot` and draw a study's values on the
 * price scale; they read the frame through useChart(). A Legend outside the SVG lists each study and its value at the
 * crosshair bar, so the numbers are text and not only a picture.
 *
 * Wrap `Chart.Plot` and the Legend in one `Study.Root`: the lines tell it their name and values, and the Legend reads
 * them back. Without a Root the lines still draw and the Legend is empty. Keep a study's values in a `useMemo`; a
 * new array each render only costs a re-registration, never a loop.
 */
interface Entry {
  name: string;
  /** One series for a line; [lower, upper] for a band. */
  series: ReadonlyArray<ReadonlyArray<number | null>>;
  /** The selection id, when the study has one and a Selection.Root is above. */
  selectId?: string;
  /** What is wrong with the series, in words; the Legend shows it. */
  problems?: readonly string[];
}
interface Registry {
  register: (id: string, entry: Entry) => void;
  unregister: (id: string) => void;
}
const RegistryContext = createContext<Registry | null>(null);
const EntriesContext = createContext<ReadonlyMap<string, Entry>>(new Map());

/** Keeps the studies' names and values so the Legend can list them. Draws nothing. */
function Root({ children }: { children?: ReactNode }) {
  const [entries, setEntries] = useState<ReadonlyMap<string, Entry>>(() => new Map());
  const register = useCallback((id: string, entry: Entry) => {
    setEntries((current) => {
      const next = new Map(current);
      next.set(id, entry);
      return next;
    });
  }, []);
  const unregister = useCallback((id: string) => {
    setEntries((current) => {
      if (!current.has(id)) return current;
      const next = new Map(current);
      next.delete(id);
      return next;
    });
  }, []);
  const registry = useMemo<Registry>(() => ({ register, unregister }), [register, unregister]);
  return (
    <RegistryContext.Provider value={registry}>
      <EntriesContext.Provider value={entries}>{children}</EntriesContext.Provider>
    </RegistryContext.Provider>
  );
}

function useRegistration(name: string, series: Entry['series'], selectId?: string, problems?: readonly string[]) {
  const registry = useContext(RegistryContext);
  const id = useId();
  useEffect(() => {
    registry?.register(id, { name, series, selectId, problems });
    return () => registry?.unregister(id);
  }, [registry, id, name, series, selectId, problems]);
}

/** Wide enough for a finger: the transparent hit stroke is --mt-touch-target (44px) across. */
const HIT_WIDTH = 44;

/**
 * Selection for a study with an `id`: whether it is selected, and the extra id the Legend needs. Without a Selection.Root
 * above, or without an id, nothing is selectable and the study draws exactly as it did.
 */
function useStudySelection(id: string | undefined, name: string) {
  const selection = useContext(SelectionContext);
  const setName = selection?.setName;
  useEffect(() => {
    if (setName && id !== undefined && name) setName('study', id, name);
  }, [setName, id, name]);
  const selectId = selection && id !== undefined ? id : undefined;
  const sel = selection?.selection;
  const selected = selectId !== undefined && !!sel && sel.kind === 'study' && sel.id === selectId;
  return { selectId, selected };
}

const num = (n: number) => n.toFixed(2);

/** One run of consecutive bars first..last, as SVG path segments. `pick` returns a point for a bar or null to break the run. */
function runs(first: number, last: number, pick: (i: number) => number | null): number[][] {
  const out: number[][] = [];
  let run: number[] = [];
  for (let i = first; i <= last; i++) {
    if (pick(i) === null) {
      if (run.length) out.push(run);
      run = [];
    } else run.push(i);
  }
  if (run.length) out.push(run);
  return out;
}

const valid = (v: number | null | undefined): v is number => v !== null && v !== undefined && Number.isFinite(v);

export interface StudyLineProps {
  /** The line on its own clock, placed on the bars by exact time. A bar with no point on it has no value there; a bar's gap kind (closed, missing, ...) is not drawn. */
  points?: ReadonlyArray<SeriesPoint>;
  /**
   * One value per bar by position, null where the study has none. A study computed from these bars (`sma(bars, 20)`) is
   * already by position. Give `points` for a series that comes from elsewhere. Neither given draws nothing.
   * @deprecated Give `points` (`pointsFromValues(bars, sma(bars, 20))` makes them). `values` is removed in 0.0.7.
   */
  values?: ReadonlyArray<number | null>;
  /** Shown in the Legend and carried as `data-study`. */
  name: string;
  /** Makes the study selectable (with a Selection.Root above): by a tap on the line and by its Legend button. Unique on the chart. */
  id?: string;
  className?: string;
}

/** A line through the study's values in view. It lifts the pen at every null, so a warm-up gap stays a gap. */
const NO_VALUES: ReadonlyArray<number | null> = [];

function Line({ values: given, points, name, id, className }: StudyLineProps) {
  const { frame, readoutId, bars } = useChart('Study.Line');
  // Points are placed on the bars by exact time; a study's own values are already one per bar.
  const resolved = useMemo(() => {
    if (points === undefined) {
      if (given !== undefined) return { values: given, problems: [] as string[] };
      return { values: NO_VALUES, problems: [`"${name}" has neither points nor values, so there is nothing to draw.`] };
    }
    const r = resolveSeries(bars.map((b) => b.timestamp), { id: id ?? name, label: name, points });
    return { values: r.values, problems: r.problems };
  }, [points, given, bars, id, name]);
  const values = resolved.values;
  const series = useMemo(() => [values], [values]);
  const { selectId, selected } = useStudySelection(id, name);
  useRegistration(name, series, selectId, resolved.problems);
  let d = '';
  for (const run of runs(frame.first, frame.last, (i) => (valid(values[i]) ? 0 : null))) {
    if (run.length < 2) continue;
    d += run.map((i, k) => `${k === 0 ? 'M' : 'L'}${num(frame.x(i))},${num(frame.y(values[i] as number))}`).join('');
  }
  if (!d) return null;
  const line = <path className={className} data-part="study-line" data-state={selected ? 'selected' : undefined} clipPath={`url(#${readoutId}-price)`} data-study={name} d={d} fill="none" aria-hidden="true" />;
  if (selectId === undefined) return line;
  // A wide transparent stroke on top, so a finger can hit a thin line. The Selection.Layer reads the tap from `data-select-id`.
  return (
    <>
      {line}
      <path data-part="study-hit" data-select-id={selectId} clipPath={`url(#${readoutId}-price)`} d={d} fill="none" stroke="transparent" strokeWidth={HIT_WIDTH} strokeLinecap="round" strokeLinejoin="round" pointerEvents="stroke" aria-hidden="true" />
    </>
  );
}

export interface StudyBandProps {
  upper: ReadonlyArray<number | null>;
  lower: ReadonlyArray<number | null>;
  /** Shown in the Legend as "lower - upper" and carried as `data-study`. Without a name the band is not listed. */
  name?: string;
  /** Makes the study selectable (with a Selection.Root above): by a tap on the band and, when it has a name, by its Legend button. Unique on the chart. */
  id?: string;
  className?: string;
}

/** The space between two series, filled. It stops where either series has no value. */
function Band({ upper: givenUpper, lower: givenLower, name = '', id, className }: StudyBandProps) {
  const upper = givenUpper ?? NO_VALUES; // a side that is not computed yet leaves the band empty
  const lower = givenLower ?? NO_VALUES;
  const { frame, readoutId } = useChart('Study.Band');
  const series = useMemo(() => [lower, upper], [lower, upper]);
  const { selectId, selected } = useStudySelection(id, name);
  useRegistration(name, series, selectId);
  let d = '';
  const both = (i: number) => (valid(upper[i]) && valid(lower[i]) ? 0 : null);
  for (const run of runs(frame.first, frame.last, both)) {
    if (run.length < 2) continue;
    const top = run.map((i, k) => `${k === 0 ? 'M' : 'L'}${num(frame.x(i))},${num(frame.y(upper[i] as number))}`).join('');
    const bottom = [...run].reverse().map((i) => `L${num(frame.x(i))},${num(frame.y(lower[i] as number))}`).join('');
    d += `${top}${bottom}Z`;
  }
  if (!d) return null;
  const band = <path className={className} data-part="study-band" data-state={selected ? 'selected' : undefined} clipPath={`url(#${readoutId}-price)`} data-study={name || undefined} d={d} aria-hidden="true" />;
  if (selectId === undefined) return band;
  return (
    <>
      {band}
      <path data-part="study-hit" data-select-id={selectId} clipPath={`url(#${readoutId}-price)`} d={d} fill="transparent" stroke="transparent" strokeWidth={HIT_WIDTH} strokeLinejoin="round" pointerEvents="all" aria-hidden="true" />
    </>
  );
}

export interface StudyLegendProps {
  className?: string;
  /** Prints one value. Default: the chart's decimals. */
  format?: (value: number) => string;
}

/**
 * The studies and their values at the crosshair bar (the last bar in view while there is no crosshair). Put it outside
 * the SVG. `data-active` is present while the values belong to a crosshair bar. A study with no value there shows a dash.
 */
function Legend({ className, format }: StudyLegendProps) {
  const { active, frame, decimals } = useChart('Study.Legend');
  const entries = useContext(EntriesContext);
  const selection = useContext(SelectionContext);
  const index = active ?? frame.last;
  const text = (v: number | null | undefined) => (valid(v) ? (format ? format(v) : v.toFixed(decimals)) : '–');
  const items: ReactNode[] = [];
  entries.forEach((entry, id) => {
    if (!entry.name) return;
    const selectId = selection ? entry.selectId : undefined;
    const selected = selectId !== undefined && selection!.selection?.kind === 'study' && selection!.selection.id === selectId;
    const name = <span data-part="study-name">{entry.name}</span>;
    items.push(
      <li key={id} data-part="study-legend-item" data-study={entry.name} data-state={selected ? 'selected' : undefined}>
        {selectId === undefined ? name : (
          <button type="button" data-mt="" data-touch-target="" data-part="study-select" aria-pressed={selected} onClick={() => selection!.select(selected ? null : { kind: 'study', id: selectId })}>{name}</button>
        )}{' '}
        <span data-part="study-value" data-mt-numeric>{entry.series.map((s) => text(s[index])).join(' – ')}</span>
        {(entry.problems ?? []).map((p) => <span key={p} data-part="study-problem" role="note"> {p}</span>)}
      </li>,
    );
  });
  return <ul className={className} data-part="study-legend" data-active={active !== null ? '' : undefined} aria-label="Study values">{items}</ul>;
}

export { Root, Line, Band, Legend };

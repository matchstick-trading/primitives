import { useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { buttonFace } from './accessible-name.js';
import { useChart } from './ChartParts.js';
import { chartFrame, priceTicks, tickDecimals, type CandleBar, type ChartFrame, type ChartViewport, type PriceSpan } from './core/chart-scale.js';
import { AXIS_BOTTOM, describeMove, MAIN_PANEL, moveSeries, moveTargets, normalizeLayout, panelBands, panelOf, reconcileLayout, type MoveDestination, type PanelLayout, type PanelSpec } from './core/panels.js';
import { duplicateIds, resolveSeries, type AlignOptions, type ResolvedSeries } from './core/series.js';
import { PanelsContext, type PanelSeriesData, type PanelsContextValue } from './panels-context.js';
import { SelectionContext } from './selection-context.js';

/**
 * Panels as parts: Panels.Root, Panels.Layer, Panels.List and Panels.Move. A chart is one or more vertical bands, each
 * with its own price scale, on one shared time axis. The chart's own bars and volume stay in the first band, `main`.
 * Other series (a value per bar, like a study) are placed in a band by id and moved between bands by a menu of relative
 * destinations ("Move up to Main", "Move to a new panel below"), which works by touch and keyboard. Headless: the parts
 * set `data-part` and `data-state='selected'`; tokens.css gives the lines a stroke and the host gives them colour.
 *
 * Everything is opt-in: without a Panels.Root above it, Chart draws exactly as it did.
 */

export interface PanelsRootProps {
  /** How a series with `points` is placed on the bars. Default `{ mode: 'exact' }`; `asof` with `toleranceMs` takes the latest point at or before each bar. */
  align?: AlignOptions;
  /** The series to draw besides the chart's bars. Keep it stable (useMemo); a new array each render only costs a layout pass. */
  series: readonly (PanelSeriesData & { /** The panel it starts in (default `main`). Panels named here are created below `main`, in the order the series appear. */ panel?: string })[];
  /** Names and weights for the bands the series start in, below `main`. A panel a series names but this leaves out is created with its id as the label. */
  panels?: readonly PanelSpec[];
  /** Controlled layout; without it Root keeps its own. */
  layout?: PanelLayout;
  onLayoutChange?: (layout: PanelLayout) => void;
  children?: ReactNode;
}

const HIDDEN: CSSProperties = { position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 };

/** The layout the `panel` fields of the series ask for: `main` first, then each named panel in the order first seen. */
function initialLayout(series: PanelsRootProps['series'], named: readonly PanelSpec[] = []): PanelLayout {
  const panels: PanelSpec[] = [{ id: MAIN_PANEL, label: 'Main' }];
  // A band named in `panels` that no series asks for is not made: a band with no series is removed.
  for (const n of named) if (n.id !== MAIN_PANEL && series.some((s) => s.panel === n.id)) panels.push(n);
  const placement: Record<string, string> = {};
  for (const s of series) {
    if (!s.panel || s.panel === MAIN_PANEL) continue;
    if (!panels.some((p) => p.id === s.panel)) panels.push({ id: s.panel, label: s.panel });
    placement[s.id] = s.panel;
  }
  return { panels, placement };
}

const finite = (v: number | null | undefined): v is number => v !== null && v !== undefined && Number.isFinite(v);

/** Holds the layout, says each move in a polite live region and tells Chart how tall the first band is. Wrap the Chart in it. */
function Root({ series: given, panels: named, layout, onLayoutChange, align, children }: PanelsRootProps) {
  // A list that is not a list, or an entry that is not a series, is left out and named in the problems, not thrown at render.
  const series = useMemo(() => (Array.isArray(given) ? given.filter((s) => s !== null && typeof s === 'object' && typeof s.id === 'string') : []), [given]);
  const unusable = given === undefined ? 0 : Array.isArray(given) ? given.length - series.length : -1;
  const [inner, setInner] = useState<PanelLayout>(() => initialLayout(series, named));
  // Series that come or go after the first render: a new one starts where it asks, a gone one leaves its panel (an empty panel goes). Done while rendering, so there is no frame with the series in the wrong band.
  const [seen, setSeen] = useState<string[]>(() => series.map((s) => s.id));
  if (layout === undefined && (seen.length !== series.length || series.some((s, i) => s.id !== seen[i]))) {
    setSeen(series.map((s) => s.id));
    setInner((was) => reconcileLayout(was, series, seen, named));
  }
  const current = useMemo(() => normalizeLayout(layout !== undefined ? layout : inner), [layout, inner]);
  const latest = useRef(current);
  latest.current = current;
  const labels = useRef(new Map<string, string>());
  labels.current = new Map(series.map((s) => [s.id, s.label]));
  const [status, setStatus] = useState('');
  const pending = useRef<{ id: string; panel: string } | null>(null);
  const announce = (now: PanelLayout) => {
    const p = pending.current;
    if (!p || panelOf(now, p.id) !== p.panel) return;
    pending.current = null;
    const where = now.panels.find((x) => x.id === p.panel);
    setStatus(describeMove(labels.current.get(p.id) ?? p.id, where?.label ?? 'a panel'));
  };
  const move = useCallback((seriesId: string, destination: MoveDestination) => {
    const was = latest.current;
    const next = moveSeries(was, seriesId, destination);
    if (next === was) return;
    latest.current = next;
    if (layout === undefined) setInner(next);
    onLayoutChange?.(next);
    // A controlled host may decline the move; it is said only once the layout it gives back has the series there.
    pending.current = { id: seriesId, panel: panelOf(next, seriesId) };
    if (layout === undefined) announce(next);
  }, [layout, onLayoutChange]);
  useEffect(() => { if (layout !== undefined) announce(current); }, [layout, current]);

  // Series placed on the bars once per bars array and series object; a crosshair move re-renders without redoing it.
  const mode = align?.mode;
  const tolerance = align?.toleranceMs;
  // One entry per bars array, rebuilt when its length changes (a host may append bars to the same array).
  const cache = useMemo(() => ({ byBars: new WeakMap<readonly CandleBar[], { len: number; times: number[]; made: WeakMap<PanelSeriesData, ResolvedSeries> }>() }), [mode, tolerance]);
  const resolve = useCallback((item: PanelSeriesData, bars: readonly CandleBar[]): ResolvedSeries => {
    let entry = cache.byBars.get(bars);
    if (!entry || entry.len !== bars.length) {
      entry = { len: bars.length, times: bars.map((b) => b.timestamp), made: new WeakMap() };
      cache.byBars.set(bars, entry);
    }
    let hit = entry.made.get(item);
    if (!hit) {
      hit = resolveSeries(entry.times, item, { mode, toleranceMs: tolerance });
      entry.made.set(item, hit);
    }
    return hit;
  }, [cache, mode, tolerance]);
  const problems = useMemo(() => {
    const out = duplicateIds(series).map((id) => `The series id "${id}" is used more than once. Ids must be unique on a chart.`);
    if (unusable < 0) out.push('The series given is not a list, so no series is drawn.');
    else if (unusable > 0) out.push(`${unusable} ${unusable === 1 ? 'entry' : 'entries'} in the series list ${unusable === 1 ? 'is' : 'are'} not a series (an object with a string id) and ${unusable === 1 ? 'was' : 'were'} left out.`);
    return out;
  }, [series, unusable]);

  const mainInclude = useCallback((visible: { first: number; last: number }, bars: readonly CandleBar[]): readonly PriceSpan[] => {
    const out: PriceSpan[] = [];
    for (const s of series) {
      if (panelOf(current, s.id) !== MAIN_PANEL) continue;
      const values = resolve(s, bars).values;
      let low = Infinity;
      let high = -Infinity;
      for (let i = visible.first; i <= visible.last; i++) {
        const v = values[i];
        if (finite(v)) { if (v < low) low = v; if (v > high) high = v; }
      }
      if (low <= high) out.push(s.style === 'histogram' ? [Math.min(low, 0), Math.max(high, 0)] : [low, high]); // a histogram's bars start at zero
    }
    return out;
  }, [series, current, resolve]);

  // A series of this Root that is no longer given cannot stay selected. Only ids this Root has had count, so a selection
  // of the chart's own bar series (a Series.Root, registered after the first render) is never touched here.
  const selection = useContext(SelectionContext);
  const selectedId = selection?.selection?.kind === 'series' ? selection.selection.id : null;
  const had = useRef(new Set<string>());
  useEffect(() => {
    const ids = new Set(series.map((s) => s.id));
    if (selection && selectedId !== null && had.current.has(selectedId) && !ids.has(selectedId)) {
      queueMicrotask(() => {
        const now = selection.current();
        if (now && now.kind === 'series' && now.id === selectedId) selection.select(null);
      });
    }
    had.current = new Set([...had.current, ...ids]);
  }, [selection, selectedId, series]);

  const value = useMemo<PanelsContextValue>(() => ({ series, layout: current, move, mainInclude, resolve, problems }), [series, current, move, mainInclude, resolve, problems]);
  return (
    <PanelsContext.Provider value={value}>
      {children}
      <span data-part="panels-status" role="status" aria-live="polite" style={HIDDEN}>{status}</span>
    </PanelsContext.Provider>
  );
}

function usePanels(part: string): PanelsContextValue {
  const context = useContext(PanelsContext);
  if (!context) throw new Error(`Panels.${part} needs a Panels.Root above it.`);
  return context;
}

const NO_ITEMS: readonly PanelSeriesData[] = [];

/** Words for a bar with no number, from the reason the series gives. */
const NO_VALUE_WORDS: Record<string, string> = {
  missing: 'missing (the feed has nothing here)',
  'market-closed': 'market closed',
  'not-applicable': 'not applicable',
  halted: 'halted',
  unknown: 'unknown (the source does not say why)',
  'no-point': 'no point at this bar',
};
const noValueWords = (state: string | undefined) => (state && NO_VALUE_WORDS[state]) || 'no value';

/**
 * One sentence on where a series has no value: how many bars, by reason, and when it stops for good. Empty when every
 * bar has a value, or none does (the problem note says that).
 */
function gapSummary(values: ReadonlyArray<number | null>, states: ReadonlyArray<string> | undefined, bars: readonly CandleBar[]): string {
  if (!states || bars.length === 0) return '';
  let gaps = 0;
  let lastValue = -1;
  const by: Record<string, number> = {};
  for (let i = 0; i < bars.length; i++) {
    if (finite(values[i])) { lastValue = i; continue; }
    gaps++;
    const k = noValueWords(states[i]);
    by[k] = (by[k] ?? 0) + 1;
  }
  if (gaps === 0 || lastValue < 0) return '';
  const parts = Object.entries(by).map(([k, n]) => `${n} ${k}`).join(', ');
  const stops = lastValue < bars.length - 1 ? ` No value after ${new Date(bars[lastValue]!.timestamp).toISOString()}.` : '';
  return `${gaps} of ${bars.length} bars have no value (${parts}).${stops}`;
}

const gapCache = new WeakMap<ResolvedSeries, { len: number; text: string }>();
/** The gap sentence, kept per resolved series so a crosshair move does not rescan every bar. */
function gapsOf(resolved: ResolvedSeries, bars: readonly CandleBar[]): string {
  const hit = gapCache.get(resolved);
  if (hit && hit.len === bars.length) return hit.text;
  const text = gapSummary(resolved.values, resolved.states, bars);
  gapCache.set(resolved, { len: bars.length, text });
  return text;
}

/** Wide enough for a finger: the transparent hit stroke is --mt-touch-target (44px) across. */
const HIT_WIDTH = 44;
const num = (n: number) => n.toFixed(2);

/** One path per run of consecutive values. */
function pathOf(frame: ChartFrame, values: ReadonlyArray<number | null>): string {
  let d = '';
  let run: number[] = [];
  const flush = () => {
    if (run.length >= 2) d += run.map((i, k) => `${k === 0 ? 'M' : 'L'}${num(frame.x(i))},${num(frame.y(values[i] as number))}`).join('');
    run = [];
  };
  for (let i = frame.first; i <= frame.last; i++) {
    if (finite(values[i])) run.push(i);
    else flush();
  }
  flush();
  return d;
}

type Placed = { item: PanelSeriesData; values: ReadonlyArray<number | null> };

/**
 * The bars a band's price scale is taken from: one per bar in view, spanning the values of the series in it (NaN where
 * none), plus zero for a histogram and any reference levels. Only the window is filled, so a long history costs
 * nothing; chartFrame reads nothing outside it.
 */
function scaleBars(bars: readonly CandleBar[], viewport: ChartViewport, inBand: readonly Placed[]): CandleBar[] {
  const out = new Array<CandleBar>(bars.length);
  const from = Math.max(0, Math.floor(viewport.start));
  const to = Math.min(bars.length - 1, Math.ceil(viewport.end) - 1);
  const extras: number[] = [];
  for (const { item } of inBand) {
    if (item.style === 'histogram') extras.push(0);
    for (const l of Array.isArray(item.levels) ? item.levels : []) if (Number.isFinite(l)) extras.push(l);
  }
  for (let i = from; i <= to; i++) {
    let low = Infinity;
    let high = -Infinity;
    for (const { values } of inBand) {
      const v = values[i];
      if (finite(v)) { if (v < low) low = v; if (v > high) high = v; }
    }
    const has = low <= high;
    if (has) for (const e of extras) { if (e < low) low = e; if (e > high) high = e; }
    out[i] = { timestamp: bars[i].timestamp, open: has ? low : NaN, high: has ? high : NaN, low: has ? low : NaN, close: has ? high : NaN, volume: 0 };
  }
  return out;
}

/** The fixed range a band asks for: the widest of the `range`s of its series, or null to follow the data. */
function fixedRange(inBand: readonly Placed[]): PriceSpan | null {
  let low = Infinity;
  let high = -Infinity;
  for (const { item } of inBand) {
    const r = item.range;
    if (r && Number.isFinite(r[0]) && Number.isFinite(r[1]) && r[0] < r[1]) { if (r[0] < low) low = r[0]; if (r[1] > high) high = r[1]; }
  }
  return low < high ? [low, high] : null;
}

function useSeriesSelection(id: string, label: string) {
  const selection = useContext(SelectionContext);
  const setName = selection?.setName;
  useEffect(() => { if (setName) setName('series', id, label); }, [setName, id, label]);
  const sel = selection?.selection;
  return { selectable: !!selection, selected: !!sel && sel.kind === 'series' && sel.id === id };
}

/** Runs of one bar with a value on both sides empty: a line cannot show them, so they are drawn as dots. */
function loneIndexes(frame: ChartFrame, values: ReadonlyArray<number | null>): number[] {
  const out: number[] = [];
  for (let i = frame.first; i <= frame.last && out.length < 300; i++) {
    if (finite(values[i]) && !finite(values[i - 1]) && !finite(values[i + 1])) out.push(i);
  }
  return out;
}

/** A bar from zero to the value, for each bar in view. */
function histogramPath(frame: ChartFrame, values: ReadonlyArray<number | null>): string {
  const half = Math.max(0.5, frame.barWidth * 0.35);
  const zero = frame.y(0);
  let d = '';
  for (let i = frame.first; i <= frame.last; i++) {
    const v = values[i];
    if (finite(v)) d += `M${num(frame.x(i) - half)},${num(zero)}V${num(frame.y(v))}h${num(half * 2)}V${num(zero)}Z`;
  }
  return d;
}

function SeriesPaths({ item, values, frame, clip }: { item: PanelSeriesData; values: ReadonlyArray<number | null>; frame: ChartFrame; clip: string }) {
  const { selectable, selected } = useSeriesSelection(item.id, item.label);
  const histogram = item.style === 'histogram';
  const d = histogram ? histogramPath(frame, values) : pathOf(frame, values);
  const lone = histogram ? [] : loneIndexes(frame, values);
  if (!d && lone.length === 0) return null;
  return (
    <>
      {d && <path data-part="panel-series" data-series={item.id} data-style={histogram ? 'histogram' : undefined} data-state={selected ? 'selected' : undefined} clipPath={clip} d={d} fill={histogram ? 'currentColor' : 'none'} aria-hidden="true" />}
      {lone.map((i) => <circle key={i} data-part="panel-point" data-series={item.id} data-state={selected ? 'selected' : undefined} clipPath={clip} cx={num(frame.x(i))} cy={num(frame.y(values[i] as number))} r={3} fill="currentColor" aria-hidden="true" />)}
      {selectable && <path data-part="series-hit" data-select-id={item.id} clipPath={clip} d={d + lone.map((i) => `M${num(frame.x(i))},${num(frame.y(values[i] as number))}h0`).join('')} fill="none" stroke="transparent" strokeWidth={HIT_WIDTH} strokeLinecap="round" strokeLinejoin="round" pointerEvents="stroke" aria-hidden="true" />}
    </>
  );
}

function Band({ spec, top, height, items, bars }: { spec: PanelSpec; top: number; height: number; items: readonly PanelSeriesData[]; bars: readonly CandleBar[] }) {
  const { frame: main, viewport, active, readoutId } = useChart('Panels.Layer');
  const { resolve } = usePanels('Layer');
  const placed = useMemo<Placed[]>(() => items.map((item) => ({ item, values: resolve(item, bars).values })), [items, bars, resolve]);
  const frame = useMemo(() => chartFrame(scaleBars(bars, viewport, placed), viewport, { width: main.width, height }, { volumeShare: 0, axisBottom: 0, priceRange: fixedRange(placed) }), [bars, bars.length, placed, viewport, main.width, height]);
  const levels = useMemo(() => [...new Set(items.flatMap((it) => (Array.isArray(it.levels) ? it.levels : []).filter(Number.isFinite)))], [items]);
  const ticks = priceTicks(frame.priceMin, frame.priceMax, 3);
  const places = tickDecimals(ticks);
  const clip = `${readoutId}-panel-${spec.id}`;
  return (
    <g data-part="panel" data-panel={spec.id} transform={`translate(0,${top})`}>
      <defs><clipPath id={clip}><rect x={0} y={0} width={frame.plotWidth} height={height} /></clipPath></defs>
      <line data-part="panel-divider" x1={0} x2={main.width} y1={0} y2={0} aria-hidden="true" />
      <g data-part="panel-grid" aria-hidden="true" clipPath={`url(#${clip})`}>
        {ticks.map((t) => <line key={t} x1={0} x2={frame.plotWidth} y1={frame.y(t)} y2={frame.y(t)} />)}
      </g>
      <g data-part="panel-axis" aria-hidden="true" style={{ pointerEvents: 'none' }}>
        {ticks.map((t) => <text key={t} x={frame.plotWidth + 6} y={frame.y(t) + 4} textAnchor="start">{t.toFixed(places)}</text>)}
      </g>
      {levels.map((l) => frame.y(l) >= 0 && frame.y(l) <= height && <line key={`level-${l}`} data-part="panel-level" x1={0} x2={frame.plotWidth} y1={frame.y(l)} y2={frame.y(l)} aria-hidden="true" />)}
      <text data-part="panel-label" x={6} y={14} aria-hidden="true" style={{ pointerEvents: 'none' }}>{spec.label}</text>
      {active !== null && <line data-part="panel-crosshair" x1={frame.x(active)} x2={frame.x(active)} y1={0} y2={height} aria-hidden="true" style={{ pointerEvents: 'none' }} />}
      {placed.map(({ item, values }) => <SeriesPaths key={item.id} item={item} values={values} frame={frame} clip={`url(#${clip})`} />)}
    </g>
  );
}

/**
 * Draws the series in their bands. Put it inside `Chart.Plot`, after the chart's own parts. The series in `main` use the
 * chart's price scale (and keep themselves in view); every other band has its own scale, grid, price labels and
 * a divider. With a Selection.Root above, a tap on a series line selects it. A band is never shorter than 40, so give the
 * chart enough height for the bands you use.
 */
function Layer() {
  const { series, layout, resolve } = usePanels('Layer');
  const { bars, frame, totalHeight, readoutId } = useChart('Panels.Layer');
  const bands = useMemo(() => panelBands(layout.panels, totalHeight - AXIS_BOTTOM), [layout.panels, totalHeight]);
  // One array per panel, kept between renders (a crosshair move re-renders but changes neither the series nor the layout).
  const byPanel = useMemo(() => {
    const map = new Map<string, PanelSeriesData[]>();
    for (const p of layout.panels) map.set(p.id, []);
    for (const s of series) map.get(panelOf(layout, s.id))?.push(s);
    return map;
  }, [series, layout]);
  const inPanel = (id: string) => byPanel.get(id) ?? NO_ITEMS;
  return (
    <g data-part="panels" aria-hidden="true">
      <g data-part="panel" data-panel={MAIN_PANEL} clipPath={`url(#${readoutId}-price)`}>
        {inPanel(MAIN_PANEL).map((item) => <SeriesPaths key={item.id} item={item} values={resolve(item, bars).values} frame={frame} clip={`url(#${readoutId}-price)`} />)}
      </g>
      {layout.panels.slice(1).map((spec, i) => {
        const band = bands[i + 1];
        return band ? <Band key={spec.id} spec={spec} top={band.top} height={band.height} items={inPanel(spec.id)} bars={bars} /> : null;
      })}
    </g>
  );
}

export interface PanelsListProps {
  className?: string;
  /** Prints one value. Default: the chart's decimals. */
  format?: (value: number) => string;
}

/**
 * The series as text: each one's name, its panel, and its value at the crosshair bar (the last bar in view when there is
 * no crosshair), so the numbers are not only a picture. With a Selection.Root above, each row has a button that selects
 * the series. Put it outside the SVG, inside `Chart.Root`.
 */
function List({ className, format }: PanelsListProps) {
  const { series, layout, resolve, problems: setProblems } = usePanels('List');
  const { active, frame, decimals, bars } = useChart('Panels.List');
  const selection = useContext(SelectionContext);
  const at = active ?? frame.last;
  const f = format ?? ((n: number) => n.toFixed(decimals));
  if (series.length === 0 && setProblems.length === 0) return null;
  return (
    <>
    {setProblems.map((p) => <p key={p} data-part="panel-problem" role="note">{p}</p>)}
    <ul className={className} data-part="panel-list" aria-label="Series">
      {series.map((s) => {
        const here = layout.panels.find((p) => p.id === panelOf(layout, s.id));
        const resolved = resolve(s, bars);
        const v = resolved.values[at];
        const selected = !!selection?.selection && selection.selection.kind === 'series' && selection.selection.id === s.id;
        const face = buttonFace(s.label, {});
        return (
          <li key={s.id} data-part="panel-list-item" data-series={s.id} data-state={selected ? 'selected' : undefined}>
            {selection
              ? <button type="button" data-mt="" data-touch-target="" data-part="panel-select" data-state={selected ? 'selected' : undefined} aria-pressed={selected} aria-label={face['aria-label']} onClick={() => selection.select(selected ? null : { kind: 'series', id: s.id })}>{face.content}</button>
              : <span data-part="panel-name">{s.label}</span>}
            <span data-part="panel-where"> {here?.label ?? 'Main'}</span>
            <span data-part="panel-value" data-mt-numeric=""> {finite(v) ? f(v) : noValueWords(resolved.states?.[at])}</span>
            {gapsOf(resolved, bars) && <span data-part="panel-gaps"> {gapsOf(resolved, bars)}</span>}
            {resolved.problems.map((p) => <span key={p} data-part="panel-problem" role="note"> {p}</span>)}
          </li>
        );
      })}
    </ul>
    </>
  );
}

export interface PanelsMoveProps {
  className?: string;
  /** The series to move. Default: the selected one (it needs a Selection.Root above). */
  seriesId?: string;
}

/**
 * The way to move a series to another panel without dragging: buttons for where it can go, relative to where it is
 * (up, down, a new panel above, a new panel below). It shows while a series of the Root is selected (or for `seriesId`)
 * and says each move in the live region. After a move the focus goes to the group, so a keyboard or screen reader user
 * is not left on a button that is gone.
 */
function Move({ className, seriesId }: PanelsMoveProps) {
  const { series, layout, move } = usePanels('Move');
  const selection = useContext(SelectionContext);
  const id = seriesId ?? (selection?.selection?.kind === 'series' ? selection.selection.id : undefined);
  const item = id === undefined ? undefined : series.find((s) => s.id === id);
  const group = useRef<HTMLDivElement | null>(null);
  const [moved, setMoved] = useState(0);
  useEffect(() => { if (moved > 0) group.current?.focus(); }, [moved]);
  if (!item) return null;
  const targets = moveTargets(layout, item.id);
  return (
    <div ref={group} className={className} role="group" tabIndex={-1} aria-label={`Move ${item.label}`} data-mt="" data-part="panel-move" data-series={item.id}>
      {targets.map((t) => (
        <button
          key={t.destination.kind === 'panel' ? `to:${t.destination.panelId}` : `new:${t.destination.side}`}
          type="button"
          data-mt=""
          data-touch-target=""
          data-part="panel-move-to"
          onClick={() => { move(item.id, t.destination); setMoved((n) => n + 1); }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export { Root, Layer, List, Move, usePanels };

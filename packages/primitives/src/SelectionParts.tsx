import { useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { buttonFace, type NameProps } from './accessible-name.js';
import { useChart } from './ChartParts.js';
import { SelectionContext, SeriesContext, type SelectionContextValue, type SelectionGuard, type SeriesContextValue } from './selection-context.js';
import { describeSelection, sameSelection, selectionAfterEscape, selectionAfterTap, type ChartSelection, type SelectionNames } from './core/selection.js';

/**
 * Selection as parts: Selection.Root, Selection.Layer, and Series.Root, Series.Select, Series.Options. One thing is
 * selected on a chart at a time: a drawing, the bar series or a study. Headless: the parts set `data-part` and
 * `data-state='selected'`; the host gives them a look and fills the options panel with its own controls.
 *
 * Root holds the selection (controlled or not) and says each change in a polite live region. Everything is opt-in:
 * without a Root above them, Drawings and Studies behave as they always did.
 */

export interface SelectionRootProps {
  /** Controlled selection; without it Root keeps its own. */
  selection?: ChartSelection;
  onSelectionChange?: (selection: ChartSelection) => void;
  children?: ReactNode;
}

// Visually hidden, still announced. Inline so the live region works without a stylesheet.
const HIDDEN: CSSProperties = { position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 };

/** Holds the selection and announces changes. Wrap the Chart, the Drawings.Root and the series and study controls in it. */
function Root({ selection, onSelectionChange, children }: SelectionRootProps) {
  const [inner, setInner] = useState<ChartSelection>(null);
  const current = selection !== undefined ? selection : inner;
  // `latest` is the selection as the host supplied it, plus any change requested in the event being handled, so two parts
  // agreeing on one tap report once. It goes back to the rendered value as soon as the event is over: a controlled host
  // that declines a request is never left with a selection it did not accept.
  const latest = useRef(current);
  const rendered = useRef(current);
  latest.current = current;
  rendered.current = current;
  const select = useCallback((next: ChartSelection) => {
    if (sameSelection(latest.current, next)) return;
    latest.current = next;
    queueMicrotask(() => { latest.current = rendered.current; });
    if (selection === undefined) setInner(next);
    onSelectionChange?.(next);
  }, [selection, onSelectionChange]);
  const currentRef = useCallback(() => latest.current, []);

  const [series, setSeries] = useState<{ id: string; label: string } | null>(null);
  const selectRef = useRef(select);
  selectRef.current = select;
  const mounted = useRef<{ id: string; label: string } | null>(null);
  const registerSeries = useCallback((next: { id: string; label: string }) => {
    mounted.current = next;
    setSeries(next);
    return () => {
      if (mounted.current === next) mounted.current = null;
      setSeries((was) => (was && was.id === next.id ? null : was));
      // A series that goes away cannot stay selected. A new label, or React replaying the effect, registers again in the
      // same commit, so only a series still gone after that is removed.
      queueMicrotask(() => {
        const now = latest.current;
        if (mounted.current?.id !== next.id && now && now.kind === 'series' && now.id === next.id) selectRef.current(null);
      });
    };
  }, []);

  const [names, setNames] = useState<SelectionNames>({});
  const namesRef = useRef(names);
  namesRef.current = names;
  const setName = useCallback((kind: 'drawing' | 'series' | 'study', id: string, name: string) => {
    setNames((was) => (was[kind]?.[id] === name ? was : { ...was, [kind]: { ...was[kind], [id]: name } }));
    return () => {};
  }, []);

  const guard = useRef<SelectionGuard | null>(null);
  const value = useMemo<SelectionContextValue>(
    () => ({ selection: current, select, current: currentRef, series, registerSeries, setName, guard }),
    [current, select, currentRef, series, registerSeries, setName],
  );

  const [status, setStatus] = useState('');
  const seen = useRef(current === null ? '' : `${current.kind}:${current.id}`);
  const usedId = useRef(false); // the last announcement had no name yet and said the id
  const key = current === null ? '' : `${current.kind}:${current.id}`;
  const nameNow = current === null ? undefined : names[current.kind]?.[current.id];
  useEffect(() => {
    if (seen.current === key && !(usedId.current && nameNow !== undefined)) return;
    seen.current = key;
    usedId.current = current !== null && nameNow === undefined;
    setStatus(describeSelection(current, names));
  }, [key, current, names, nameNow]);

  return (
    <SelectionContext.Provider value={value}>
      {children}
      <span data-part="selection-status" role="status" aria-live="polite" style={HIDDEN}>{status}</span>
    </SelectionContext.Provider>
  );
}

function useSelection(part: string): SelectionContextValue {
  const context = useContext(SelectionContext);
  if (!context) throw new Error(`${part} needs a Selection.Root above it.`);
  return context;
}

const TAP_SLOP = 6;
const TAP_MS = 600;

/**
 * The tap and Escape rules for the chart. Put it inside `Chart.Plot`, next to `Drawings.Layer` if there is one. It draws
 * nothing. A tap (not a drag) on clear chart puts a selection away; with nothing selected and a `Series.Root` mounted
 * it selects the series; a tap on a study's line or band (a `Study.Line` or `Study.Band` with an `id`) selects that study.
 * Escape, with the chart focused, clears the selection (a half-placed drawing or an armed tool take the first Escape).
 * A press on a drawing is Drawings.Layer's, and a drag is the chart panning, so neither counts.
 */
function Layer() {
  const ctx = useSelection('Selection.Layer');
  const chart = useChart('Selection.Layer');
  const ref = useRef<SVGGElement | null>(null);
  const live = useRef({ ctx, chart });
  live.current = { ctx, chart };

  useEffect(() => {
    const svg = ref.current?.ownerSVGElement;
    if (!svg) return;
    // `before` is the selection at the press: another listener on the same tap (Drawings.Layer putting a drawing away) may change it before the release.
    let tap: { pointerId: number; x: number; y: number; at: number; hit: ChartSelection; before: ChartSelection; inMain: boolean } | null = null;
    const down = new Set<number>();
    const onDown = (event: PointerEvent) => {
      if (event.isPrimary) down.clear();
      down.add(event.pointerId);
      // A second finger is a pinch, not a tap.
      if (down.size > 1) { tap = null; return; }
      if (event.button !== 0) return;
      const { ctx: c, chart: ch } = live.current;
      const point = ch.toChart(event.clientX, event.clientY);
      if (!point || point.x < 0 || point.x >= ch.frame.plotWidth || point.y < 0 || point.y >= ch.plotBottom) return;
      if (c.guard.current?.owns(event.clientX, event.clientY, event.pointerType)) return;
      // A line of a study or of a series in a panel (data-select-id) is a hit; clear chart below the first panel is not the bar series'.
      const hitEl = (event.target as Element | null)?.closest?.("[data-part='study-hit'],[data-part='series-hit']");
      const hitId = hitEl?.getAttribute('data-select-id');
      const hit: ChartSelection = hitId ? { kind: hitEl?.getAttribute('data-part') === 'series-hit' ? 'series' : 'study', id: hitId } : null;
      tap = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, at: event.timeStamp, hit, before: c.current(), inMain: point.y < ch.frame.plotHeight };
    };
    const onMove = (event: PointerEvent) => {
      if (tap && tap.pointerId === event.pointerId && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > TAP_SLOP) tap = null;
    };
    const onUp = (event: PointerEvent) => {
      down.delete(event.pointerId);
      if (!tap || tap.pointerId !== event.pointerId) return;
      const t = tap;
      tap = null;
      if (event.type !== 'pointerup' || Math.hypot(event.clientX - t.x, event.clientY - t.y) > TAP_SLOP || event.timeStamp - t.at >= TAP_MS) return;
      const { ctx: c } = live.current;
      c.select(selectionAfterTap(t.before, t.hit, t.inMain ? c.series?.id ?? null : null));
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const { ctx: c } = live.current;
      if (c.guard.current?.busy()) return;
      c.select(selectionAfterEscape(c.current()));
    };
    svg.addEventListener('pointerdown', onDown);
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerup', onUp);
    svg.addEventListener('pointercancel', onUp);
    svg.addEventListener('keydown', onKey);
    return () => {
      svg.removeEventListener('pointerdown', onDown);
      svg.removeEventListener('pointermove', onMove);
      svg.removeEventListener('pointerup', onUp);
      svg.removeEventListener('pointercancel', onUp);
      svg.removeEventListener('keydown', onKey);
    };
  }, []);
  return <g ref={ref} data-part="selection-layer" aria-hidden="true" />;
}

export interface SeriesRootProps {
  /** The selection id of the series. Unique on the chart. */
  id: string;
  /** What the series is called: the button's name, the panel's label and the live-region text. */
  label: string;
  children?: ReactNode;
}

/**
 * Says that a bar series exists, so a tap on clear chart can select it (with a Selection.Layer in the plot). It draws
 * nothing. Put it above the chart and the Series.Select and Series.Options. The selected series shows
 * `data-state='selected'` on its `Chart.Candles`.
 */
function SeriesRoot({ id, label, children }: SeriesRootProps) {
  const ctx = useSelection('Series.Root');
  const { registerSeries, setName } = ctx;
  useEffect(() => {
    const undo = registerSeries({ id, label });
    setName('series', id, label);
    return undo;
  }, [registerSeries, setName, id, label]);
  const selected = ctx.selection !== null && ctx.selection.kind === 'series' && ctx.selection.id === id;
  const value = useMemo<SeriesContextValue>(() => ({ id, label, selected }), [id, label, selected]);
  return <SeriesContext.Provider value={value}>{children}</SeriesContext.Provider>;
}

function useSeries(part: string): SeriesContextValue {
  const context = useContext(SeriesContext);
  if (!context) throw new Error(`Series.${part} needs a Series.Root above it.`);
  return context;
}

/**
 * A button that selects the series, and puts the selection away when pressed again: the keyboard and touch path to what
 * a tap on clear chart does. `aria-pressed` carries the state. Its name is the series label unless you give a `label`
 * or children.
 */
function Select({ className, icon, label, hideLabel, children }: NameProps & { className?: string; children?: ReactNode }) {
  const ctx = useSelection('Series.Select');
  const series = useSeries('Select');
  const face = buttonFace(series.label, { icon, label, hideLabel, children });
  return (
    <button
      type="button"
      className={className}
      data-mt=""
      data-touch-target=""
      data-part="series-select"
      data-state={series.selected ? 'selected' : undefined}
      aria-label={face['aria-label']}
      aria-pressed={series.selected}
      onClick={() => ctx.select(series.selected ? null : { kind: 'series', id: series.id })}
    >
      {face.content}
    </button>
  );
}

/**
 * A headless panel for the series' options. It shows its children only while the series is selected. The primitives
 * ship no option fields: put your own controls inside (an interval list, an instrument picker) and decide what a change
 * means. `label` names the group; the default is the series label and "options".
 */
function Options({ className, label, children }: { className?: string; label?: string; children?: ReactNode }) {
  const series = useSeries('Options');
  if (!series.selected) return null;
  return (
    <div className={className} role="group" aria-label={label ?? `${series.label} options`} data-mt="" data-part="series-options" data-series={series.id}>
      {children}
    </div>
  );
}

export { Root, Layer, SeriesRoot, Select, Options, useSelection };

import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { buttonFace, type NameProps } from './accessible-name.js';
import { primitiveAttributes, type Change } from './attributes.js';
import { chartFrame, clampPriceRange, dataPriceSpan, growViewport, lastBars, type ChartInclude, panPriceRange, panViewport, priceRangeMissesData, priceTicks, resolveChartKey, tickDecimals, zoomPriceRange, zoomViewport, type CandleBar, type ChartFrame, type ChartViewport, type PriceSpan } from './core/chart-scale.js';
import { INITIAL_CHART_GESTURE, isChartGestureActive, reduceChartGesture, type ChartGestureResult, type ChartGestureState, type ChartGestureView } from './core/chart-gesture.js';
import { heikinAshi, formatBarTime } from './core/candles.js';
import { AXIS_BOTTOM, MAIN_PANEL, panelBands } from './core/panels.js';
import { PanelsContext } from './panels-context.js';
import { SeriesContext } from './selection-context.js';

/**
 * Chart as parts: Root, Plot, Grid, Candles, Volume, PriceAxis, TimeAxis, Crosshair, Readout, Table. Headless: parts
 * draw SVG and add `data-change` (up or down bar) and `data-part`; tokens.css and the host give them colour. Studies
 * and drawings are more parts inside Plot that read the same frame through useChart().
 *
 * One tab stop. ArrowLeft/Right move the crosshair bar by bar, Shift+Arrow pans, + and - zoom, Home/End jump to the
 * ends, Escape clears. A pointer drag pans and the wheel zooms around the pointer. Two fingers pinch to zoom the time
 * (spread sideways) and the price (spread up and down). The price follows the bars until a person moves it: ArrowUp and
 * ArrowDown, Shift+ArrowUp and Shift+ArrowDown, a drag on the price labels, or the wheel over them fix the price range,
 * so a line can be placed at any price; Autoscale or Reset gives it back, and so does a double tap on the price labels. A Readout says the crosshair bar in
 * words and a Table carries the visible bars, so the chart is never only a picture.
 */
export type CandleStyle = 'candle' | 'hollow' | 'ohlc' | 'line' | 'area' | 'heikin-ashi';

export interface ChartContext {
  bars: readonly CandleBar[];
  frame: ChartFrame;
  /** The crosshair bar index, or null. */
  active: number | null;
  setActive: (index: number | null) => void;
  /** The crosshair price under the pointer, or null when the keyboard moved it (then it sits on the close). */
  pointerPrice: number | null;
  /** True while the pointer is over a panel below the first, where the first panel's price means nothing. */
  pointerBelow: boolean;
  viewport: ChartViewport;
  setViewport: (viewport: ChartViewport) => void;
  /** The price range a person fixed, or null while the price follows the bars. */
  priceRange: PriceSpan | null;
  /** Fix the price range (kept usable around the bars), or null to follow the bars again. */
  setPriceRange: (range: PriceSpan | null) => void;
  /** The lowest and highest price of all the bars, or null for none; what a fixed range is kept near. */
  dataSpan: PriceSpan | null;
  /** Client coordinates to chart (viewBox) coordinates; null before the Plot mounts. */
  toChart: (clientX: number, clientY: number) => { x: number; y: number } | null;
  readoutId: string;
  /** Decimals for printed prices. */
  decimals: number;
  /** The height of the whole plot, all panels and the time labels. Equal to `frame.height` unless a Panels.Root is above. */
  totalHeight: number;
  /** The bottom of the last panel, from the top of the plot: where a tap stops being on the chart. */
  plotBottom: number;
}
const Context = createContext<ChartContext | null>(null);

/** The frame and state of the chart above. Studies and drawings call this. */
export function useChart(part = 'part'): ChartContext {
  const context = useContext(Context);
  if (!context) throw new Error(`Chart ${part} needs a Chart.Root above it.`);
  return context;
}

export interface ChartRootProps {
  bars: readonly CandleBar[];
  /** Controlled viewport; by default the chart opens on the last 120 bars. */
  viewport?: ChartViewport;
  onViewportChange?: (viewport: ChartViewport) => void;
  /** Controlled fixed price range; null follows the bars. By default the chart keeps it itself and starts on the bars. */
  priceRange?: PriceSpan | null;
  onPriceRangeChange?: (range: PriceSpan | null) => void;
  /** Controlled crosshair bar index. */
  active?: number | null;
  onActiveChange?: (index: number | null) => void;
  /**
   * viewBox width. Leave it out and the chart lays itself out to its own width in CSS pixels, so axis text stays the
   * size your CSS gives it on a phone; it starts at 800 until measured. A number fixes the viewBox, and the SVG scales.
   */
  width?: number;
  /** viewBox height; with the width left out, the plot's height in CSS pixels. Default 420. */
  height?: number;
  /** Share of the height for volume, 0 to hide the pane. Default 0.2. */
  volumeShare?: number;
  /** Prices a study or drawing needs kept in view: [low, high] pairs, or a function of the bars in view. Keep it stable (useMemo or useCallback). */
  include?: ChartInclude;
  /** Decimals for printed prices. Default 2. */
  decimals?: number;
  /**
   * You promise every bar has a finite time (a valid JavaScript date, within 8.64e15 ms of 1970) and finite open, high, low and close, so the chart skips its check of each
   * bar. Worth it for a series of hundreds of thousands of bars that you replace on every update; a bad bar then draws
   * as a broken shape instead of being left out. Default false.
   */
  validatedBars?: boolean;
  /** Marks every part as synthetic data. */
  synthetic?: boolean;
  className?: string;
  'aria-label'?: string;
  children?: ReactNode;
}

const finiteBar = (bar: CandleBar | null | undefined): bar is CandleBar =>
  bar != null && Number.isFinite(bar.timestamp) && Math.abs(bar.timestamp) <= 8.64e15
  && Number.isFinite(bar.open) && Number.isFinite(bar.high) && Number.isFinite(bar.low) && Number.isFinite(bar.close);

/**
 * How much of each array has already been checked and found fully usable. A host that re-renders with the same array
 * (appending to it, or shrinking it) then pays only for the bars it has not seen, not for the whole series. Bars are
 * assumed not to be edited in place after they are checked, which the memo on [rawBars, length] below already assumed.
 */
const checked = new WeakMap<readonly CandleBar[], number>();

/** The bars that can be drawn: a bar with a missing or non-finite time or price is left out (so indexes after it shift: filter before computing a study), and no list draws nothing. */
function usableBars(bars: readonly CandleBar[] | null | undefined, validated = false): readonly CandleBar[] {
  if (!Array.isArray(bars)) return [];
  if (validated) return bars;
  const from = checked.get(bars) ?? 0;
  for (let i = from; i < bars.length; i++) {
    if (!finiteBar(bars[i])) return bars.filter(finiteBar);
  }
  checked.set(bars, Math.max(from, bars.length));
  return bars;
}

function Root({ bars: rawBars, viewport, onViewportChange, priceRange, onPriceRangeChange, active, onActiveChange, width: fixedWidth, height = 420, volumeShare, include, decimals: rawDecimals = 2, validatedBars = false, synthetic, className, 'aria-label': label = 'Price chart', children }: ChartRootProps) {
  const bars = useMemo(() => usableBars(rawBars, validatedBars), [rawBars, rawBars?.length, validatedBars]); // length too: a host may append to the same array
  const [innerViewport, setInnerViewport] = useState<ChartViewport>(() => lastBars(bars.length, 120));
  const [seenTotal, setSeenTotal] = useState(bars.length);
  const [innerActive, setInnerActive] = useState<number | null>(null);
  const [innerRange, setInnerRange] = useState<PriceSpan | null>(null);
  if (seenTotal !== bars.length) {
    // A new or grown series: a view that showed it all reopens on the default window, a view at the end keeps following, and never point past the data.
    setSeenTotal(bars.length);
    if (viewport === undefined) {
      const next = growViewport(innerViewport, seenTotal, bars.length);
      if (next !== innerViewport) setInnerViewport(next);
    }
    if (active === undefined && innerActive !== null && innerActive >= bars.length) setInnerActive(bars.length > 0 ? bars.length - 1 : null);
  }
  // toFixed throws outside 0..100; 20 is more than any price needs.
  const decimals = Number.isFinite(rawDecimals) ? Math.min(20, Math.max(0, Math.round(rawDecimals))) : 2;
  const [scaleBars, setScaleBars] = useState<readonly CandleBar[] | null>(null);
  const [pointerPrice, setPointerPrice] = useState<number | null>(null);
  const [pointerBelow, setPointerBelow] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const figureRef = useRef<HTMLElement | null>(null);
  const [measured, setMeasured] = useState<number | null>(null);
  // Follow the figure's width, so a narrow screen gets a narrower layout rather than smaller text. Measured before
  // paint, so the first frame is already the right width.
  useLayoutEffect(() => {
    const node = figureRef.current;
    if (fixedWidth !== undefined || !node) return;
    const read = () => { const w = Math.round(node.clientWidth); if (w > 0) setMeasured(w); };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, [fixedWidth]);
  const width = fixedWidth ?? measured ?? 800;
  const view = viewport ?? innerViewport;
  const activeIndex = active !== undefined ? active : innerActive;
  // Only a hand-set range needs the span of every bar, so it is measured on first use, not on every render.
  const getDataSpan = useMemo(() => {
    let done = false;
    let span: PriceSpan | null = null;
    return () => { if (!done) { span = dataPriceSpan(bars); done = true; } return span; };
  }, [bars, bars.length]);
  // A range set by hand that no longer touches the bars (the host switched to another symbol) is dropped, so the chart follows the bars again.
  const dataSpanNow = priceRange === undefined && innerRange !== null ? getDataSpan() : null;
  const innerRangeStale = innerRange !== null && priceRangeMissesData(innerRange, dataSpanNow);
  if (innerRangeStale) setInnerRange(null);
  const range = priceRange !== undefined ? priceRange : innerRangeStale ? null : innerRange;
  // With a Panels.Root above, the first band is only part of the height and the series placed in it keep themselves in view.
  const panels = useContext(PanelsContext);
  const layoutPanels = panels?.layout.panels;
  const mainHeight = useMemo(() => {
    if (!layoutPanels) return null;
    const band = panelBands(layoutPanels, height - AXIS_BOTTOM).find((b) => b.id === MAIN_PANEL);
    return band ? band.height : height - AXIS_BOTTOM;
  }, [layoutPanels, height]);
  const extraInclude = panels?.mainInclude;
  const mergedInclude = useMemo<ChartInclude | undefined>(() => {
    if (!extraInclude) return include;
    return (visible) => [...(typeof include === 'function' ? include(visible) : include ?? []), ...extraInclude(visible, bars)];
  }, [include, extraInclude, bars]);
  const frame = useMemo(() => chartFrame(scaleBars && scaleBars.length === bars.length ? scaleBars : bars, view, { width, height: mainHeight ?? height }, { volumeShare, include: mergedInclude, priceRange: range, ...(mainHeight !== null ? { axisBottom: 0 } : {}) }), [scaleBars, bars, bars.length, view, width, height, mainHeight, volumeShare, mergedInclude, range]);
  const totalHeight = mainHeight !== null ? height : frame.height;
  const plotBottom = mainHeight !== null ? height - AXIS_BOTTOM : frame.plotHeight;
  const readoutId = useId();
  const setViewport = useCallback((next: ChartViewport) => {
    if (viewport === undefined) setInnerViewport(next);
    onViewportChange?.(next);
  }, [viewport, onViewportChange]);
  const setPriceRange = useCallback((next: PriceSpan | null) => {
    const kept = next ? clampPriceRange(next, getDataSpan()) : null;
    if (priceRange === undefined) setInnerRange(kept);
    onPriceRangeChange?.(kept);
  }, [priceRange, onPriceRangeChange, getDataSpan]);
  const setActive = useCallback((next: number | null) => {
    if (active === undefined) setInnerActive(next);
    onActiveChange?.(next);
  }, [active, onActiveChange]);
  const toChart = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return null;
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: point.y };
  }, []);
  const context = useMemo<ChartContext>(() => ({
    bars, frame, active: activeIndex, setActive, pointerPrice, pointerBelow, viewport: view, setViewport, priceRange: range, setPriceRange,
    get dataSpan() { return getDataSpan(); },
    toChart, readoutId, decimals, totalHeight, plotBottom,
  }), [bars, frame, activeIndex, setActive, pointerPrice, pointerBelow, view, setViewport, range, setPriceRange, getDataSpan, toChart, readoutId, decimals, totalHeight, plotBottom]);
  const plotRef = useMemo(() => ({ svgRef, setPointerPrice, setPointerBelow, setScaleBars }), []);
  return (
    <Context.Provider value={context}>
      <PlotRef.Provider value={plotRef}>
        <figure ref={figureRef} className={className} aria-label={label} {...primitiveAttributes({ synthetic })}>{children}</figure>
      </PlotRef.Provider>
    </Context.Provider>
  );
}

const PlotRef = createContext<{
  svgRef: { current: SVGSVGElement | null };
  setPointerPrice: (price: number | null) => void;
  setPointerBelow: (below: boolean) => void;
  /** Bars the price range is taken from when they differ from the data (Heikin Ashi). */
  setScaleBars: (bars: readonly CandleBar[] | null) => void;
} | null>(null);

/** The drawing surface. Put Grid, Candles, Volume, axes, studies and drawings inside it. */
function Plot({ className, label = 'Candles, use the arrow keys to move between bars', children }: { className?: string; label?: string; children?: ReactNode }) {
  const chart = useChart('Plot');
  const { bars, frame, active, setActive, viewport, setViewport, setPriceRange, toChart, readoutId, totalHeight, plotBottom } = chart; // not dataSpan: reading it here would measure every bar on every render
  const plot = useContext(PlotRef);
  // The gesture rules live in core/chart-gesture; this holds the state between events and does the DOM work.
  const gesture = useRef<ChartGestureState>(INITIAL_CHART_GESTURE);
  const heldRange = (): PriceSpan => [frame.priceMin, frame.priceMax];
  const total = bars.length;
  const view = (): ChartGestureView => ({ frame, viewport, total, dataSpan: chart.dataSpan, hoverBottom: plotBottom });
  const clampBar = (index: number) => Math.min(total - 1, Math.max(0, Math.round(index)));

  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    const action = resolveChartKey(event);
    if (!action || total === 0) return;
    event.preventDefault();
    event.stopPropagation(); // arrows, Home and End are also transport shortcuts on a replay page
    plot?.setPointerPrice(null);
    plot?.setPointerBelow(false);
    const span = viewport.end - viewport.start;
    const current = active ?? frame.last;
    switch (action) {
      case 'previous-bar': case 'next-bar': {
        const next = clampBar(current + (action === 'next-bar' ? 1 : -1));
        setActive(next);
        if (next < viewport.start || next >= viewport.end) setViewport(panViewport(viewport, next < viewport.start ? next - viewport.start : next - viewport.end + 1, total));
        break;
      }
      case 'pan-left': setViewport(panViewport(viewport, -Math.max(1, span / 10), total)); break;
      case 'pan-right': setViewport(panViewport(viewport, Math.max(1, span / 10), total)); break;
      case 'price-up': case 'price-down': {
        const r = heldRange();
        setPriceRange(panPriceRange(r, ((action === 'price-up' ? 1 : -1) * (r[1] - r[0])) / 10, chart.dataSpan));
        break;
      }
      case 'price-zoom-in': case 'price-zoom-out': {
        const r = heldRange();
        setPriceRange(zoomPriceRange(r, action === 'price-zoom-in' ? 0.8 : 1.25, (r[0] + r[1]) / 2, chart.dataSpan));
        break;
      }
      case 'zoom-in': setViewport(zoomViewport(viewport, 0.8, active ?? viewport.end - 1, total)); break;
      case 'zoom-out': setViewport(zoomViewport(viewport, 1.25, active ?? viewport.end - 1, total)); break;
      case 'first': setActive(0); setViewport(panViewport(viewport, -viewport.start, total)); break;
      case 'last': setActive(total - 1); setViewport(panViewport(viewport, total - viewport.end, total)); break;
      case 'clear': setActive(null); break;
    }
  };
  const apply = (result: ChartGestureResult, event?: PointerEvent<SVGSVGElement>) => {
    gesture.current = result.state;
    if (result.capture) event?.currentTarget.setPointerCapture?.(event.pointerId);
    if (result.viewport) setViewport(result.viewport);
    if (result.priceRange !== undefined) setPriceRange(result.priceRange);
    if (result.hover) {
      if (result.hover.bar !== undefined) setActive(result.hover.bar);
      plot?.setPointerPrice(result.hover.price);
    }
  };
  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    const point = toChart(event.clientX, event.clientY);
    if (!point) return;
    apply(reduceChartGesture({ type: 'down', pointerId: event.pointerId, touch: event.pointerType === 'touch', point, view: view() }, gesture.current), event);
  };
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const point = toChart(event.clientX, event.clientY);
    if (!point) return;
    plot?.setPointerBelow(point.y >= frame.plotHeight && point.y < plotBottom);
    apply(reduceChartGesture({ type: 'move', pointerId: event.pointerId, point, view: view() }, gesture.current));
  };
  const endDrag = (event: PointerEvent<SVGSVGElement>) => {
    apply(reduceChartGesture(event.type === 'pointerup' ? { type: 'up', pointerId: event.pointerId, time: event.timeStamp } : { type: 'cancel', pointerId: event.pointerId }, gesture.current));
  };
  // The wheel zooms, so the page must not scroll under the pointer: React's onWheel is passive, so this listener is
  // attached natively with passive false, reading the latest values through a ref.
  const onWheel = useRef<(event: globalThis.WheelEvent) => void>(() => {});
  onWheel.current = (event) => {
    const point = toChart(event.clientX, event.clientY);
    if (!point) return;
    const result = reduceChartGesture({ type: 'wheel', point, deltaY: event.deltaY, view: view() }, gesture.current);
    if (result.preventDefault) event.preventDefault();
    apply(result);
  };
  const svg = useRef<SVGSVGElement | null>(null);
  useEffect(() => {
    const node = svg.current;
    if (!node) return;
    const listener = (event: globalThis.WheelEvent) => onWheel.current(event);
    node.addEventListener('wheel', listener, { passive: false });
    return () => node.removeEventListener('wheel', listener);
  }, []);
  return (
    <svg
      ref={(node) => { svg.current = node; if (plot) plot.svgRef.current = node; }}
      className={className}
      data-part="plot"
      viewBox={`0 0 ${frame.width} ${totalHeight}`}
      role="group"
      aria-label={label}
      aria-describedby={readoutId}
      tabIndex={0}
      style={{ touchAction: 'pan-y' }}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={(event) => { if (!isChartGestureActive(gesture.current)) { plot?.setPointerPrice(null); plot?.setPointerBelow(false); if (event.pointerType === 'mouse') setActive(null); } }}
    >
      <defs>
        <clipPath id={`${readoutId}-clip`}><rect x={0} y={0} width={frame.width} height={totalHeight} /></clipPath>
        <clipPath id={`${readoutId}-plot`}><rect x={0} y={0} width={frame.plotWidth} height={totalHeight} /></clipPath>
        {/* Price-scaled marks (studies, the volume profile) stop at the volume pane, even where a fixed range or a band
            goes past the prices in view. */}
        <clipPath id={`${readoutId}-price`}><rect x={0} y={0} width={frame.plotWidth} height={frame.volumeTop} /></clipPath>
        {/* The plot area without the gutters, for marks a host places anywhere (drawings). */}
        <clipPath id={`${readoutId}-plotarea`}><rect x={0} y={0} width={frame.plotWidth} height={frame.plotHeight} /></clipPath>
      </defs>
      <g clipPath={`url(#${readoutId}-clip)`}>
        {/* The price labels take the finger for themselves, so a drag there moves the price instead of the page. */}
        <rect data-part="price-gutter" x={frame.plotWidth} y={0} width={Math.max(0, frame.width - frame.plotWidth)} height={frame.plotHeight} fill="transparent" style={{ touchAction: 'none' }} />
        {children}
      </g>
    </svg>
  );
}

/** Horizontal lines at the price ticks. */
function Grid({ className, ticks = 6 }: { className?: string; ticks?: number }) {
  const { frame, readoutId } = useChart('Grid');
  return (
    <g className={className} data-part="grid" clipPath={`url(#${readoutId}-price)`} aria-hidden="true">
      {priceTicks(frame.priceMin, frame.priceMax, ticks).map((t) => <line key={t} x1={0} x2={frame.plotWidth} y1={frame.y(t)} y2={frame.y(t)} />)}
    </g>
  );
}

const changeOf = (bar: CandleBar): Change => (bar.close > bar.open ? 'up' : bar.close < bar.open ? 'down' : 'flat');

/**
 * The bars in one of six styles. Each candle is a `<g data-change>` holding a wick line and a body rect (or the OHLC
 * ticks); line and area draw one path through the closes. Only bars in the viewport are drawn.
 */
function Candles({ className, style = 'candle' }: { className?: string; style?: CandleStyle }) {
  const { bars, frame, readoutId } = useChart('Candles');
  const setScaleBars = useContext(PlotRef)?.setScaleBars;
  // Inside a Series.Root the candles say whether the series is selected; without one nothing is added.
  const selectedState = useContext(SeriesContext)?.selected ? 'selected' : undefined;
  // The length is a dependency too, so bars a host pushes onto the same array are transformed before they are drawn.
  const source = useMemo(() => (style === 'heikin-ashi' ? heikinAshi(bars) : bars), [bars, bars.length, style]);
  useEffect(() => {
    if (!setScaleBars || style !== 'heikin-ashi') return;
    setScaleBars(source);
    return () => setScaleBars(null);
  }, [setScaleBars, source, style]);
  // Price-scaled, so it stops at the volume pane: a price range a person moved can put bars below the pane.
  const clip = `url(#${readoutId}-price)`;
  const { first, last, x, y, barWidth } = frame;
  if (last < first) return null;
  if (style === 'line' || style === 'area') {
    let d = '';
    for (let i = first; i <= last; i++) d += `${i === first ? 'M' : 'L'}${x(i).toFixed(2)},${y(source[i].close).toFixed(2)}`;
    const area = style === 'area' ? `${d}L${x(last).toFixed(2)},${frame.priceBottom}L${x(first).toFixed(2)},${frame.priceBottom}Z` : null;
    return (
      <g className={className} data-part="candles" data-style={style} data-state={selectedState} clipPath={clip} aria-hidden="true">
        {area && <path data-part="area" d={area} />}
        <path data-part="line" d={d} fill="none" />
      </g>
    );
  }
  const body = Math.max(1, barWidth * 0.7);
  const nodes: ReactNode[] = [];
  for (let i = first; i <= last; i++) {
    const bar = source[i];
    const cx = x(i);
    const change = changeOf(bar);
    if (style === 'ohlc') {
      nodes.push(
        <g key={bar.timestamp} data-change={change}>
          <line x1={cx} x2={cx} y1={y(bar.high)} y2={y(bar.low)} />
          <line x1={cx - body / 2} x2={cx} y1={y(bar.open)} y2={y(bar.open)} />
          <line x1={cx} x2={cx + body / 2} y1={y(bar.close)} y2={y(bar.close)} />
        </g>,
      );
      continue;
    }
    const top = y(Math.max(bar.open, bar.close));
    const bottom = y(Math.min(bar.open, bar.close));
    nodes.push(
      <g key={bar.timestamp} data-change={change} data-hollow={style === 'hollow' && change === 'up' ? '' : undefined}>
        <line data-part="wick" x1={cx} x2={cx} y1={y(bar.high)} y2={y(bar.low)} />
        <rect data-part="body" x={cx - body / 2} y={top} width={body} height={Math.max(1, bottom - top)} />
      </g>,
    );
  }
  return <g className={className} data-part="candles" data-style={style} data-state={selectedState} clipPath={clip} aria-hidden="true">{nodes}</g>;
}

/** Volume bars in the pane under the prices, coloured by the bar's direction. */
function Volume({ className }: { className?: string }) {
  const { bars, frame, readoutId } = useChart('Volume');
  const { first, last, x, barWidth, volumeY, volumeBottom, volumeTop } = frame;
  if (last < first || volumeBottom === volumeTop) return null;
  const width = Math.max(1, barWidth * 0.7);
  const nodes: ReactNode[] = [];
  for (let i = first; i <= last; i++) {
    const bar = bars[i];
    const top = volumeY(bar.volume);
    nodes.push(<rect key={bar.timestamp} data-change={changeOf(bar)} x={x(i) - width / 2} y={top} width={width} height={Math.max(0, volumeBottom - top)} />);
  }
  return <g className={className} data-part="volume" clipPath={`url(#${readoutId}-plot)`} aria-hidden="true">{nodes}</g>;
}

/** Price labels at the ticks, in the gutter right of the bars. */
function PriceAxis({ className, ticks = 6 }: { className?: string; ticks?: number }) {
  const { frame } = useChart('PriceAxis');
  const values = priceTicks(frame.priceMin, frame.priceMax, ticks);
  const places = tickDecimals(values);
  return (
    <g className={className} data-part="price-axis" aria-hidden="true" style={{ pointerEvents: 'none' }}>
      {values.map((t) => <text key={t} x={frame.plotWidth + 6} y={frame.y(t) + 4} textAnchor="start">{t.toFixed(places)}</text>)}
    </g>
  );
}

export interface TimeAxisProps {
  className?: string;
  /** Prints a bar's time. Default: HH:MM in UTC, with the date when the day changes. */
  format?: (timestamp: number, previous: number | null) => string;
  /** About how many labels. Default 6, or one per 110 pixels of plot when that is fewer, so narrow charts do not overlap. */
  labels?: number;
}

/** Time labels in the gutter under the panes, spaced in whole bars. */
function TimeAxis({ className, format = formatBarTime, labels: wanted }: TimeAxisProps) {
  const { bars, frame, totalHeight } = useChart('TimeAxis');
  if (frame.last < frame.first) return null;
  const labels = wanted ?? Math.max(2, Math.min(6, Math.floor(frame.plotWidth / 110)));
  const step = Math.max(1, Math.round((frame.last - frame.first + 1) / labels));
  const nodes: ReactNode[] = [];
  let previous: number | null = null;
  for (let i = Math.ceil(frame.first / step) * step; i <= frame.last; i += step) {
    const t = bars[i].timestamp;
    nodes.push(<text key={t} x={frame.x(i)} y={totalHeight - 4} textAnchor="middle">{format(t, previous)}</text>);
    previous = t;
  }
  return <g className={className} data-part="time-axis" aria-hidden="true">{nodes}</g>;
}

/** A vertical line on the crosshair bar and a horizontal one at the pointer price (or the close from the keyboard). */
function Crosshair({ className }: { className?: string }) {
  const { bars, frame, active, pointerPrice, pointerBelow, decimals } = useChart('Crosshair');
  if (active === null || !bars[active]) return null;
  const price = pointerPrice ?? bars[active].close;
  const cx = frame.x(active);
  const cy = frame.y(price);
  return (
    <g className={className} data-part="crosshair" aria-hidden="true" style={{ pointerEvents: 'none' }}>
      <line x1={cx} x2={cx} y1={0} y2={frame.plotHeight} />
      {/* Below the first band (a pointer over another panel) the price on this scale means nothing, so only the bar line shows. */}
      {!pointerBelow && cy >= 0 && cy <= frame.plotHeight && <line x1={0} x2={frame.plotWidth} y1={cy} y2={cy} />}
      {!pointerBelow && cy >= 0 && cy <= frame.plotHeight && <text data-part="crosshair-price" x={frame.plotWidth + 6} y={cy + 4} textAnchor="start">{price.toFixed(decimals)}</text>}
    </g>
  );
}

/** The crosshair bar in words, announced politely. The host may pass its own wording. */
function Readout({ className, format }: { className?: string; format?: (bar: CandleBar, index: number) => string }) {
  const { bars, active, readoutId, decimals } = useChart('Readout');
  const bar = active === null ? undefined : bars[active];
  const f = (n: number) => n.toFixed(decimals);
  const text = !bar ? '' : format ? format(bar, active!) : `${new Date(bar.timestamp).toISOString().slice(0, 16).replace('T', ' ')} UTC, open ${f(bar.open)}, high ${f(bar.high)}, low ${f(bar.low)}, close ${f(bar.close)}, volume ${bar.volume}`;
  return <output id={readoutId} className={className} aria-live="polite" data-change={bar ? changeOf(bar) : undefined}>{text}</output>;
}

/**
 * A button that puts the view back where the chart opened: the last 120 bars, the newest bar at the right, the price
 * following the bars again. It is the way
 * back from a view lost by panning or zooming, and it works by touch, with no keyboard. It leaves drawings and studies
 * alone. It is disabled while the view already is the opening one.
 */
function Reset({ className, icon, label, hideLabel, children }: NameProps & { className?: string; children?: ReactNode }) {
  const { bars, frame, viewport, setViewport, setPriceRange, setActive } = useChart('Reset');
  const face = buttonFace('Reset view', { icon, label, hideLabel, children });
  const home = lastBars(bars.length, 120);
  const atHome = viewport.start === home.start && viewport.end === home.end && !frame.manualPrice;
  return (
    <button type="button" className={className} data-part="chart-reset" aria-label={face['aria-label']} disabled={atHome} onClick={() => { setViewport(home); setPriceRange(null); setActive(null); }}>
      {face.content}
    </button>
  );
}

/**
 * A button that gives the price back to the bars after it was moved by hand, and leaves the time alone. It is disabled
 * while the price already follows the bars.
 */
function Autoscale({ className, icon, label, hideLabel, children }: NameProps & { className?: string; children?: ReactNode }) {
  const { frame, setPriceRange } = useChart('Autoscale');
  const face = buttonFace('Auto price', { icon, label, hideLabel, children });
  return (
    <button type="button" className={className} data-part="chart-autoscale" aria-label={face['aria-label']} disabled={!frame.manualPrice} onClick={() => setPriceRange(null)}>
      {face.content}
    </button>
  );
}

/** The visible bars as a table: the text equivalent of the plot. */
function Table({ className, caption = 'Bars in view' }: { className?: string; caption?: string }) {
  const { bars, frame, active, decimals } = useChart('Table');
  const rows: ReactNode[] = [];
  for (let i = frame.first; i <= frame.last; i++) {
    const bar = bars[i];
    rows.push(
      <tr key={bar.timestamp} data-change={changeOf(bar)} aria-current={i === active ? 'true' : undefined}>
        <td data-mt-numeric>{new Date(bar.timestamp).toISOString().slice(0, 16).replace('T', ' ')}</td>
        {[bar.open, bar.high, bar.low, bar.close].map((v, k) => <td key={k} data-mt-numeric>{v.toFixed(decimals)}</td>)}
        <td data-mt-numeric>{bar.volume}</td>
      </tr>,
    );
  }
  return (
    <table className={className}>
      <caption>{caption}</caption>
      <thead><tr>{['Time (UTC)', 'Open', 'High', 'Low', 'Close', 'Volume'].map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
      <tbody>{rows}</tbody>
    </table>
  );
}

export { Root, Plot, Grid, Candles, Volume, PriceAxis, TimeAxis, Crosshair, Readout, Reset, Autoscale, Table };

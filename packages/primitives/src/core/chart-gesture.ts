/**
 * The chart's pointer and wheel gestures as plain data in, plain data out: press and drag to pan, a drag on the price
 * labels, the wheel, a two-finger pinch and the double tap that gives the price back to the bars. The host reads
 * coordinates off its DOM events, passes them in with the frame, viewport and bar count of the moment, and applies the
 * change the result names. Nothing here touches a DOM, so the rules run and test without one.
 */
import { panViewport, zoomPriceRange, zoomViewport, type ChartFrame, type ChartViewport, type PriceSpan } from './chart-scale.js';

export interface ChartPoint {
  x: number;
  y: number;
}

/** What the chart looks like at the moment of an event: the host reads it from its current render. */
export interface ChartGestureView {
  frame: ChartFrame;
  viewport: ChartViewport;
  /** Number of bars in the series. */
  total: number;
  /** Lowest and highest price of all the bars, or null for none; what a fixed price range is kept near. */
  dataSpan: PriceSpan | null;
  /** How far down the pointer still picks a bar: the bottom of the last panel. Default `frame.plotHeight` (one panel). The price is still the first panel's. */
  hoverBottom?: number;
}

interface DragState {
  id: number;
  x: number;
  y: number;
  viewport: ChartViewport;
  touch: boolean;
  decided: boolean;
  vertical: boolean;
  price: { range: PriceSpan; perPixel: number; moved: boolean } | null;
}

/** A pinch keeps the frame, viewport and range it began with, so it is measured against where the fingers started. */
interface PinchState {
  ids: [number, number];
  frame: ChartFrame;
  viewport: ChartViewport;
  range: PriceSpan;
  mid: ChartPoint;
  dx: number;
  dy: number;
}

export interface ChartGestureState {
  /** Fingers down now, in the order they landed. */
  touches: ReadonlyArray<{ id: number } & ChartPoint>;
  drag: DragState | null;
  pinch: PinchState | null;
  lastTap: { time: number; x: number; y: number } | null;
}

export const INITIAL_CHART_GESTURE: ChartGestureState = { touches: [], drag: null, pinch: null, lastTap: null };

export type ChartGestureEvent =
  /** A primary-button press. `touch` is whether the pointer is a finger. */
  | { type: 'down'; pointerId: number; touch: boolean; point: ChartPoint; view: ChartGestureView }
  | { type: 'move'; pointerId: number; point: ChartPoint; view: ChartGestureView }
  /** `time` is the event timestamp in milliseconds; it times the double tap. */
  | { type: 'up'; pointerId: number; time: number }
  | { type: 'cancel'; pointerId: number }
  | { type: 'wheel'; point: ChartPoint; deltaY: number; view: ChartGestureView };

export interface ChartGestureResult {
  state: ChartGestureState;
  /** A new viewport to apply, if any. */
  viewport?: ChartViewport;
  /** A price range to fix, or null to give the price back to the bars; absent means leave it. */
  priceRange?: PriceSpan | null;
  /** The pointer is hovering the plot: the bar under it (absent leaves the crosshair bar) and its price (null when not over the price pane). */
  hover?: { bar?: number; price: number | null };
  /** Take the pointer, so the drag continues outside the chart. */
  capture?: boolean;
  /** The host should stop the browser's own handling (page scroll). */
  preventDefault?: boolean;
}

const same = (state: ChartGestureState): ChartGestureResult => ({ state });

const inGutter = (frame: ChartFrame, point: ChartPoint) => point.x >= frame.plotWidth && point.y >= 0 && point.y < frame.plotHeight;
const heldRange = (frame: ChartFrame): PriceSpan => [frame.priceMin, frame.priceMax];

/** Whether a one-pointer drag (a pan or a price-label drag) is in progress. A two-finger pinch is separate: read `state.pinch`. The Plot keeps the hover price while a drag runs, as before the reducer moved to core. */
export function isChartGestureActive(state: ChartGestureState): boolean {
  return state.drag !== null;
}

export function reduceChartGesture(event: ChartGestureEvent, state: ChartGestureState): ChartGestureResult {
  switch (event.type) {
    case 'down': return press(event, state);
    case 'move': return move(event, state);
    case 'up': case 'cancel': return release(event, state);
    case 'wheel': return wheel(event, state);
  }
}

function press(event: Extract<ChartGestureEvent, { type: 'down' }>, state: ChartGestureState): ChartGestureResult {
  const { pointerId, touch, point, view } = event;
  const { frame, viewport } = view;
  const touches = !touch ? state.touches
    : state.touches.some((t) => t.id === pointerId) ? state.touches.map((t) => (t.id === pointerId ? { id: pointerId, ...point } : t))
    : [...state.touches, { id: pointerId, ...point }];
  if (touch && touches.length === 2) {
    // The second finger turns the drag into a pinch.
    const [a, b] = touches;
    return {
      state: {
        ...state, touches, drag: null,
        pinch: {
          ids: [a.id, b.id], frame, viewport, range: heldRange(frame),
          mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
          dx: Math.abs(a.x - b.x), dy: Math.abs(a.y - b.y),
        },
      },
      capture: true,
    };
  }
  // A press on the price labels moves the price range instead of the time.
  const price = inGutter(frame, point) && frame.priceBottom > frame.priceTop
    ? { range: heldRange(frame), perPixel: (frame.priceMax - frame.priceMin) / (frame.priceBottom - frame.priceTop), moved: false }
    : null;
  return {
    state: { ...state, touches, drag: { id: pointerId, x: point.x, y: point.y, viewport, touch, decided: false, vertical: false, price } },
    capture: true,
  };
}

function move(event: Extract<ChartGestureEvent, { type: 'move' }>, state: ChartGestureState): ChartGestureResult {
  const { pointerId, point, view } = event;
  const { frame, total, hoverBottom = frame.plotHeight } = view;
  const touches = state.touches.some((t) => t.id === pointerId) ? state.touches.map((t) => (t.id === pointerId ? { id: pointerId, ...point } : t)) : state.touches;
  state = touches === state.touches ? state : { ...state, touches };
  const pinched = state.pinch;
  if (pinched) return pinched.ids.includes(pointerId) ? { state, ...movePinch(pinched, state.touches, view) } : same(state);
  const held = state.drag;
  if (held && held.id === pointerId && held.price) {
    const moved = held.price.moved || Math.abs(point.y - held.y) > 4;
    const next = moved === held.price.moved ? state : { ...state, drag: { ...held, price: { ...held.price, moved } } };
    if (!moved) return same(next);
    // Dragging the labels down brings higher prices into view, as if the price scale were grabbed.
    const shift = (point.y - held.y) * held.price.perPixel;
    return { state: next, priceRange: [held.price.range[0] + shift, held.price.range[1] + shift] };
  }
  if (held && held.id === pointerId) {
    // A finger drifts sideways while it scrolls the page, so a touch drag waits for 8 px, then pans only if it reads as
    // horizontal. A mostly vertical drag never pans.
    let drag = held;
    if (held.touch && !held.decided) {
      if (Math.hypot(point.x - held.x, point.y - held.y) <= 8) return same(state);
      drag = { ...held, decided: true, vertical: Math.abs(point.y - held.y) > Math.abs(point.x - held.x) };
      state = { ...state, drag };
    }
    if (drag.vertical) return same(state);
    return { state, viewport: panViewport(drag.viewport, -(point.x - drag.x) / frame.barWidth, total) };
  }
  if (total === 0 || frame.last < frame.first) return same(state);
  // The gutters show labels, not bars: a pointer there would pick a bar that is not drawn.
  if (point.x < 0 || point.x >= frame.plotWidth || point.y < 0 || point.y >= hoverBottom) return { state, hover: { price: null } };
  return {
    state,
    hover: {
      bar: Math.min(frame.last, Math.max(frame.first, Math.round(frame.indexAt(point.x)))),
      price: point.y >= frame.priceTop && point.y <= frame.priceBottom ? frame.priceAt(point.y) : null,
    },
  };
}

function movePinch(p: PinchState, touches: ChartGestureState['touches'], view: ChartGestureView): Omit<ChartGestureResult, 'state'> {
  const a = touches.find((t) => t.id === p.ids[0]);
  const b = touches.find((t) => t.id === p.ids[1]);
  if (!a || !b) return {};
  const { total, dataSpan } = view;
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  // Fingers spread sideways zoom the time, fingers spread up and down zoom the price. Two fingers that start close
  // together on one axis leave that axis alone, so a sideways pinch never fixes the price range by accident.
  const factorX = p.dx >= 24 ? p.dx / Math.max(dx, 1) : 1;
  let next = zoomViewport(p.viewport, factorX, p.frame.indexAt(p.mid.x), total);
  const barWidth = p.frame.plotWidth / (next.end - next.start);
  next = panViewport(next, -(mid.x - p.mid.x) / barWidth, total);
  if (p.dy < 40) return { viewport: next };
  const factorY = p.dy / Math.max(dy, 1);
  const zoomed = zoomPriceRange(p.range, factorY, p.frame.priceAt(p.mid.y), dataSpan);
  const perPixel = (zoomed[1] - zoomed[0]) / (p.frame.priceBottom - p.frame.priceTop);
  const shift = (mid.y - p.mid.y) * perPixel;
  return { viewport: next, priceRange: [zoomed[0] + shift, zoomed[1] + shift] };
}

function release(event: Extract<ChartGestureEvent, { type: 'up' | 'cancel' }>, state: ChartGestureState): ChartGestureResult {
  const touches = state.touches.filter((t) => t.id !== event.pointerId);
  state = { ...state, touches };
  if (state.pinch?.ids.includes(event.pointerId)) return same({ ...state, pinch: null, drag: null }); // the finger left behind must not jump the chart
  const held = state.drag;
  if (held?.id !== event.pointerId) return same(state);
  state = { ...state, drag: null };
  // A quick second tap on the price labels gives the price back to the bars.
  if (held.price && !held.price.moved && event.type === 'up') {
    const before = state.lastTap;
    if (before && event.time - before.time < 400 && Math.hypot(held.x - before.x, held.y - before.y) < 24) {
      return { state: { ...state, lastTap: null }, priceRange: null };
    }
    return same({ ...state, lastTap: { time: event.time, x: held.x, y: held.y } });
  }
  return same(state);
}

function wheel(event: Extract<ChartGestureEvent, { type: 'wheel' }>, state: ChartGestureState): ChartGestureResult {
  const { point, deltaY, view } = event;
  const { frame, viewport, total, dataSpan } = view;
  if (deltaY === 0 || total === 0) return same(state);
  // Over the price labels the wheel zooms the price instead of the time.
  if (inGutter(frame, point)) {
    return {
      state,
      preventDefault: true,
      priceRange: zoomPriceRange(heldRange(frame), deltaY > 0 ? 1.1 : 0.9, frame.priceAt(Math.min(frame.priceBottom, Math.max(frame.priceTop, point.y))), dataSpan),
    };
  }
  // Only a wheel that zooms is kept from the page: over an empty chart, or at the zoom limit, the page scrolls.
  const next = zoomViewport(viewport, deltaY > 0 ? 1.1 : 0.9, frame.indexAt(point.x), total);
  // At the zoom limit the span stays the same but the anchor can still shift the start: that is not a zoom.
  if (Math.abs((next.end - next.start) - (viewport.end - viewport.start)) < 1e-9) return same(state);
  return { state, preventDefault: true, viewport: next };
}

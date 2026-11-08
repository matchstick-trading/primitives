import { indexOfTime, timeOfIndex, type CandleBar, type ChartFrame } from './chart-scale.js';

/**
 * The model, geometry and keys of chart drawings as plain functions. A drawing is a tool plus anchors, and an anchor
 * is a time and a price, not a pixel. That keeps a drawing on its place when the chart pans, zooms or gets new bars:
 * the pixels are worked out fresh from the frame each time. Nothing here throws on bad input; a drawing it cannot
 * read has no geometry and is never hit.
 */

export type DrawingTool =
  | 'trend-line'
  | 'ray'
  | 'extended-line'
  | 'horizontal-line'
  | 'vertical-line'
  | 'rectangle'
  | 'fib-retracement'
  | 'price-range'
  | 'text';

/**
 * How an anchor moves. 'free' (the default, and what an absent value means) moves in both directions. 'price' holds
 * the price: a drag or nudge moves only the time. 'time' holds the time: it moves only the price. 'bar' keeps the time
 * on a bar, moving in whole bars; the price stays a plain number. A value this library does not know reads as 'free'.
 */
export type AttachMode = 'free' | 'price' | 'time' | 'bar';

export interface DrawingAnchor {
  /** Unix milliseconds; may sit between bars or beyond the last one. */
  timestamp: number;
  price: number;
  /** How the anchor moves. Absent means 'free'. */
  attach?: AttachMode;
}

export interface Drawing {
  id: string;
  tool: DrawingTool;
  anchors: DrawingAnchor[];
  /** The words of a text drawing. */
  text?: string;
  /** A locked drawing can be selected but not moved or deleted from the keyboard. */
  locked?: boolean;
}

export type SnapMode = 'off' | 'magnet';

/** Every attach mode, in the order a select lists them. */
export const ATTACH_MODES: readonly AttachMode[] = ['free', 'price', 'time', 'bar'];

/** Plain-English names, for a select and the text list. */
export const ATTACH_LABELS: Readonly<Record<AttachMode, string>> = {
  free: 'Free',
  price: 'Price held',
  time: 'Time held',
  bar: 'Whole bars',
};

/** The anchor's attach mode; anything that is not a known mode reads as 'free'. */
export function attachOf(anchor: Pick<DrawingAnchor, 'attach'> | null | undefined): AttachMode {
  const mode = anchor?.attach;
  return mode === 'price' || mode === 'time' || mode === 'bar' ? mode : 'free';
}

/** The time of the bar nearest the timestamp. With no bars the timestamp comes back as it was. */
export function barTime(bars: readonly CandleBar[], timestamp: number): number {
  if (!bars || bars.length === 0 || !Number.isFinite(timestamp)) return timestamp;
  return timeOfIndex(bars, Math.round(indexOfTime(bars, timestamp)));
}

/**
 * Where a timestamp sits, counted from the last bar: 0 is the last bar, -1 the one before it, and a positive number is
 * past the data. Fractional when the time falls between bars. Null with no bars.
 */
export function barsFromLast(bars: readonly CandleBar[], timestamp: number): number | null {
  if (!bars || bars.length === 0 || !Number.isFinite(timestamp)) return null;
  return indexOfTime(bars, timestamp) - (bars.length - 1);
}

/** The same place counted from the first bar, starting at 1 (bar 1 is the first bar). Null with no bars. */
export function barsFromFirst(bars: readonly CandleBar[], timestamp: number): number | null {
  if (!bars || bars.length === 0 || !Number.isFinite(timestamp)) return null;
  return indexOfTime(bars, timestamp) + 1;
}

/** The timestamp of the bar `count` bars from the last one (0 is the last bar, -1 the one before it). Null with no bars or a count that is not a whole number. */
export function timeOfBarFromLast(bars: readonly CandleBar[], count: number): number | null {
  if (!bars || bars.length === 0 || !Number.isInteger(count)) return null;
  const at = timeOfIndex(bars, bars.length - 1 + count);
  // Beyond the range a Date can hold, there is no time to show.
  return Number.isFinite(at) && Math.abs(at) <= 8.64e15 ? at : null;
}

/** Every tool, in the order a toolbar lists them. */
export const DRAWING_TOOLS: readonly DrawingTool[] = [
  'trend-line', 'ray', 'extended-line', 'horizontal-line', 'vertical-line', 'rectangle', 'fib-retracement', 'price-range', 'text',
];

/** Plain-English names, for toolbar buttons and the text list. */
export const DRAWING_TOOL_LABELS: Readonly<Record<DrawingTool, string>> = {
  'trend-line': 'Trend line',
  'ray': 'Ray',
  'extended-line': 'Extended line',
  'horizontal-line': 'Horizontal line',
  'vertical-line': 'Vertical line',
  'rectangle': 'Rectangle',
  'fib-retracement': 'Fib retracement',
  'price-range': 'Price range',
  'text': 'Text note',
};

/** The fib levels, as shares of the move: 0 sits on the second anchor and 1 on the first. */
export const FIB_RATIOS: readonly number[] = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

/** How far, in pixels, the magnet reaches to a bar's open, high, low or close. */
export const MAGNET_REACH = 12;

/** A rough width of one text character in viewBox pixels, used only to size the click area of a text note. */
export const TEXT_CHAR_WIDTH = 7;
const TEXT_HEIGHT = 14;

/** How many anchors a tool needs: one for horizontal and vertical lines and text, two for the rest. */
export function anchorCount(tool: DrawingTool): 1 | 2 {
  return tool === 'horizontal-line' || tool === 'vertical-line' || tool === 'text' ? 1 : 2;
}

export interface DrawingSegment { x1: number; y1: number; x2: number; y2: number }
export interface DrawingBox { x: number; y: number; width: number; height: number }
export interface DrawingHandle { index: number; x: number; y: number }
export interface DrawingLevel { ratio: number; price: number; y: number; x1: number; x2: number }
export interface DrawingRange {
  /** Second anchor price minus the first. */
  change: number;
  /** Change as a percent of the first price; null when the first price is 0. */
  percent: number | null;
  /** Whole bars between the anchors. */
  bars: number;
}

/** What to draw for one drawing, in viewBox pixels. Parts that do not apply to the tool are empty or null. */
export interface DrawingGeometry {
  segments: DrawingSegment[];
  boxes: DrawingBox[];
  levels: DrawingLevel[];
  handles: DrawingHandle[];
  label: { x: number; y: number; text: string } | null;
  range: DrawingRange | null;
}

const isNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const validAnchor = (a: DrawingAnchor | undefined): a is DrawingAnchor => !!a && isNumber(a.timestamp) && isNumber(a.price);

const empty = (): DrawingGeometry => ({ segments: [], boxes: [], levels: [], handles: [], label: null, range: null });

/** The line through (x1,y1) and (x2,y2) between parameters t0 and t1, cut to the frame (Liang-Barsky). */
function clipLine(x1: number, y1: number, x2: number, y2: number, t0: number, t1: number, width: number, height: number): DrawingSegment | null {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let lo = t0;
  let hi = t1;
  const edges: [number, number][] = [[-dx, x1], [dx, width - x1], [-dy, y1], [dy, height - y1]];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > hi) return null;
      if (r > lo) lo = r;
    } else {
      if (r < lo) return null;
      if (r < hi) hi = r;
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  return { x1: x1 + lo * dx, y1: y1 + lo * dy, x2: x1 + hi * dx, y2: y1 + hi * dy };
}

/**
 * Where a drawing goes on screen. A ray runs from the first anchor through the second to the frame edge, an extended
 * line runs both ways to the edges, a rectangle and a price range are boxes, and a fib retracement has seven level
 * lines between the anchors plus the line joining them. Handles are the anchors in pixels.
 */
export function drawingGeometry(drawing: Drawing, bars: readonly CandleBar[], frame: ChartFrame): DrawingGeometry {
  const out = empty();
  if (!drawing || !Array.isArray(drawing.anchors)) return out;
  const need = anchorCount(drawing.tool);
  if (drawing.anchors.length < need || !drawing.anchors.slice(0, need).every(validAnchor)) return out;
  const index = drawing.anchors.slice(0, need).map((a) => indexOfTime(bars, a.timestamp));
  const px = drawing.anchors.slice(0, need).map((a, i) => ({ x: frame.x(index[i]), y: frame.y(a.price) }));
  if (!px.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) return out;
  out.handles = px.map((p, i) => ({ index: i, x: p.x, y: p.y }));
  const [a, b] = px;
  const width = frame.plotWidth;
  const height = frame.plotHeight;

  switch (drawing.tool) {
    case 'horizontal-line':
      out.segments.push({ x1: 0, y1: a.y, x2: width, y2: a.y });
      break;
    case 'vertical-line':
      out.segments.push({ x1: a.x, y1: 0, x2: a.x, y2: height });
      break;
    case 'text':
      out.label = { x: a.x, y: a.y, text: typeof drawing.text === 'string' ? drawing.text : '' };
      break;
    case 'trend-line':
      out.segments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      break;
    case 'ray':
    case 'extended-line': {
      if (a.x === b.x && a.y === b.y) {
        out.segments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
        break;
      }
      const cut = clipLine(a.x, a.y, b.x, b.y, drawing.tool === 'ray' ? 0 : -Infinity, Infinity, width, height);
      if (cut) out.segments.push(cut);
      break;
    }
    case 'rectangle':
    case 'price-range': {
      out.boxes.push({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) });
      if (drawing.tool === 'price-range') {
        const first = drawing.anchors[0].price;
        const change = drawing.anchors[1].price - first;
        out.range = { change, percent: first === 0 ? null : (change / Math.abs(first)) * 100, bars: Math.round(Math.abs(index[1] - index[0])) };
      }
      break;
    }
    case 'fib-retracement': {
      const x1 = Math.min(a.x, b.x);
      const x2 = Math.max(a.x, b.x);
      const from = drawing.anchors[0].price;
      const to = drawing.anchors[1].price;
      out.segments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      for (const ratio of FIB_RATIOS) {
        const price = to + (from - to) * ratio;
        out.levels.push({ ratio, price, y: frame.y(price), x1, x2 });
      }
      break;
    }
    default:
      return empty();
  }
  return out;
}

/** The prices a set of drawings needs on screen, as [low, high] pairs for Chart.Root's `include`. */
export function drawingPriceRanges(drawings: readonly Drawing[]): [number, number][] {
  const out: [number, number][] = [];
  for (const d of drawings ?? []) {
    const prices = (d?.anchors ?? []).filter(validAnchor).map((a) => a.price);
    if (prices.length > 0) out.push([Math.min(...prices), Math.max(...prices)]);
  }
  return out;
}

export interface DrawingHit {
  id: string;
  /** The anchor index of a handle that was hit, or 'body'. */
  handle: number | 'body';
}

function distanceToSegment(px: number, py: number, s: DrawingSegment): number {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, ((px - s.x1) * dx + (py - s.y1) * dy) / lengthSquared));
  return Math.hypot(px - (s.x1 + t * dx), py - (s.y1 + t * dy));
}

/**
 * The drawing under a point, in viewBox pixels. The last drawing wins, so what was drawn on top is picked first. An
 * anchor handle beats the body of the same drawing. `handleTolerancePx` is the grab radius of a handle (a finger needs
 * more than a mouse); it defaults to the line tolerance. Rectangles and price ranges count inside as well as on the edge.
 */
export function hitTest(drawings: readonly Drawing[], bars: readonly CandleBar[], frame: ChartFrame, point: { x: number; y: number }, tolerancePx = 6, handleTolerancePx = tolerancePx): DrawingHit | null {
  if (!point || !isNumber(point.x) || !isNumber(point.y) || !Array.isArray(drawings)) return null;
  const tol = isNumber(tolerancePx) ? Math.max(0, tolerancePx) : 6;
  const handleTol = isNumber(handleTolerancePx) ? Math.max(0, handleTolerancePx) : tol;
  for (let i = drawings.length - 1; i >= 0; i--) {
    const drawing = drawings[i];
    const g = drawingGeometry(drawing, bars, frame);
    // The nearest handle inside the grab radius wins, so a wide touch radius never picks the first of two close anchors.
    let nearest: { index: number; distance: number } | null = null;
    for (const h of g.handles) {
      const distance = Math.hypot(point.x - h.x, point.y - h.y);
      if (distance <= handleTol && (!nearest || distance < nearest.distance)) nearest = { index: h.index, distance };
    }
    if (nearest) return { id: drawing.id, handle: nearest.index };
    const onLine = g.segments.some((s) => distanceToSegment(point.x, point.y, s) <= tol)
      || g.levels.some((l) => distanceToSegment(point.x, point.y, { x1: l.x1, y1: l.y, x2: l.x2, y2: l.y }) <= tol);
    const inBox = g.boxes.some((b) => point.x >= b.x - tol && point.x <= b.x + b.width + tol && point.y >= b.y - tol && point.y <= b.y + b.height + tol);
    const onLabel = g.label !== null
      && point.x >= g.label.x - tol && point.x <= g.label.x + Math.max(1, g.label.text.length) * TEXT_CHAR_WIDTH + tol
      && point.y >= g.label.y - TEXT_HEIGHT - tol && point.y <= g.label.y + tol;
    if (onLine || inBox || onLabel) return { id: drawing.id, handle: 'body' };
  }
  return null;
}

/**
 * A pointer position as an anchor. 'off' keeps the time and price under the pointer. 'magnet' always puts the time on
 * the nearest bar, and puts the price on that bar's open, high, low or close when one is within 12 pixels up or down.
 * Null for a point that is not a number.
 */
export function snapToBar(point: { x: number; y: number }, bars: readonly CandleBar[], frame: ChartFrame, mode: SnapMode = 'off'): DrawingAnchor | null {
  if (!point || !isNumber(point.x) || !isNumber(point.y)) return null;
  const index = frame.indexAt(point.x);
  const free = frame.priceAt(point.y);
  if (mode !== 'magnet' || bars.length === 0) return { timestamp: timeOfIndex(bars, index), price: free };
  const bar = bars[Math.min(bars.length - 1, Math.max(0, Math.round(index)))];
  let price = free;
  let best = MAGNET_REACH;
  for (const candidate of [bar.open, bar.high, bar.low, bar.close]) {
    if (!isNumber(candidate)) continue;
    const gap = Math.abs(frame.y(candidate) - point.y);
    if (gap <= best) {
      best = gap;
      price = candidate;
    }
  }
  return { timestamp: bar.timestamp, price };
}

/** A copy of the drawing moved by whole or fractional bars and by a price. A locked or unreadable drawing comes back as it was. */
export function moveDrawing(drawing: Drawing, deltaIndex: number, deltaPrice: number, bars: readonly CandleBar[]): Drawing {
  if (!drawing || drawing.locked || !Array.isArray(drawing.anchors)) return drawing;
  const di = isNumber(deltaIndex) ? deltaIndex : 0;
  const dp = isNumber(deltaPrice) ? deltaPrice : 0;
  return {
    ...drawing,
    // With no bars there is no interval to move by, so times stay as they were. A held coordinate stays; 'bar' moves in whole bars.
    anchors: drawing.anchors.map((a) => {
      if (!validAnchor(a)) return a;
      const mode = attachOf(a);
      const time = bars.length === 0 || mode === 'time'
        ? a.timestamp
        : mode === 'bar' ? timeOfIndex(bars, Math.round(indexOfTime(bars, a.timestamp) + di)) : timeOfIndex(bars, indexOfTime(bars, a.timestamp) + di);
      return { ...a, timestamp: time, price: mode === 'price' ? a.price : a.price + dp };
    }),
  };
}

/**
 * A copy of the drawing with one anchor moved to a new place. The anchor keeps its attach mode and what that holds:
 * 'price' keeps its price, 'time' keeps its time, and 'bar' puts the time on the nearest bar (pass the `bars`). An
 * index that is not an anchor, or a locked drawing, changes nothing.
 */
export function moveAnchor(drawing: Drawing, anchorIndex: number, to: DrawingAnchor, bars: readonly CandleBar[] = []): Drawing {
  if (!drawing || drawing.locked || !Array.isArray(drawing.anchors) || !validAnchor(to)) return drawing;
  if (!Number.isInteger(anchorIndex) || anchorIndex < 0 || anchorIndex >= drawing.anchors.length) return drawing;
  return {
    ...drawing,
    anchors: drawing.anchors.map((a, i) => {
      if (i !== anchorIndex) return a;
      const mode = attachOf(a);
      return { ...a, timestamp: mode === 'time' ? a.timestamp : mode === 'bar' ? barTime(bars, to.timestamp) : to.timestamp, price: mode === 'price' ? a.price : to.price };
    }),
  };
}

/**
 * A copy of the drawing with typed values: each given anchor's time and/or price replaced, and the words of a text
 * drawing. A locked drawing, an unreadable one, an anchor index that does not exist or a value that is not a finite
 * number changes nothing, so the whole edit is refused rather than half applied.
 */
export function editDrawing(drawing: Drawing, edit: { anchors?: readonly (Partial<DrawingAnchor> | undefined)[]; text?: string }): Drawing {
  if (!drawing || drawing.locked || !Array.isArray(drawing.anchors)) return drawing;
  const given = edit.anchors ?? [];
  if (given.length > drawing.anchors.length) return drawing;
  // An attach value that is not one of the four modes refuses the whole edit. 'free' is stored as no key at all.
  if (given.some((g) => g?.attach !== undefined && !ATTACH_MODES.includes(g.attach))) return drawing;
  const anchors = drawing.anchors.map((a, i) => {
    const { attach: held, ...rest } = a;
    const attach = given[i]?.attach ?? held;
    return { ...rest, timestamp: given[i]?.timestamp ?? a.timestamp, price: given[i]?.price ?? a.price, ...(attach && attach !== 'free' ? { attach } : {}) };
  });
  if (!anchors.every(validAnchor)) return drawing;
  return { ...drawing, anchors, ...(drawing.tool === 'text' && typeof edit.text === 'string' ? { text: edit.text } : {}) };
}

/** An id not used by any drawing yet: drawing-1, drawing-2 and so on. */
export function nextDrawingId(drawings: readonly Drawing[]): string {
  let highest = 0;
  for (const d of drawings ?? []) {
    const match = /^drawing-(\d+)$/.exec(d?.id ?? '');
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `drawing-${highest + 1}`;
}

export type DrawingKeyAction =
  | { kind: 'remove' }
  | { kind: 'escape' }
  /** dx is bars (left is -1) and dy is price steps (up is +1), each times `scale` (1, or 10 with Shift). */
  | { kind: 'nudge'; dx: -1 | 0 | 1; dy: -1 | 0 | 1; scale: 1 | 10 };

/**
 * Drawing keys: Delete and Backspace remove the selection, Escape cancels the drawing in progress (else the tool, else
 * the selection), and the arrows nudge the selection by one bar or 1% of the visible price range, ten times that with
 * Shift. Tab is never taken. Whether a key applies (is anything selected?) is for the caller to decide.
 */
export function resolveDrawingKey(event: { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): DrawingKeyAction | null {
  if (!event || event.altKey || event.ctrlKey || event.metaKey) return null;
  const scale = event.shiftKey ? 10 : 1;
  switch (event.key) {
    case 'Delete': case 'Backspace': return { kind: 'remove' };
    case 'Escape': return { kind: 'escape' };
    case 'ArrowLeft': return { kind: 'nudge', dx: -1, dy: 0, scale };
    case 'ArrowRight': return { kind: 'nudge', dx: 1, dy: 0, scale };
    case 'ArrowUp': return { kind: 'nudge', dx: 0, dy: 1, scale };
    case 'ArrowDown': return { kind: 'nudge', dx: 0, dy: -1, scale };
    default: return null;
  }
}

/** The bars and price a nudge moves, given the visible price range. */
export function nudgeAmount(action: Extract<DrawingKeyAction, { kind: 'nudge' }>, frame: Pick<ChartFrame, 'priceMin' | 'priceMax'>): { bars: number; price: number } {
  const range = frame.priceMax - frame.priceMin;
  return { bars: action.dx * action.scale, price: Number.isFinite(range) ? action.dy * action.scale * range * 0.01 : 0 };
}

const pad = (n: number) => String(n).padStart(2, '0');
const clock = (t: number) => {
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? '?' : `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};
const day = (t: number) => {
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

/**
 * A drawing in words, for the text list, for example "Trend line from 101.20 at 14:05 to 103.80 at 15:20". Times are
 * UTC, with the date added when the anchors fall on different days. `formatTime` replaces the default.
 */
function describeBase(drawing: Drawing, decimals: number, formatTime?: (timestamp: number) => string): string {
  const name = DRAWING_TOOL_LABELS[drawing?.tool] ?? 'Drawing';
  const anchors = Array.isArray(drawing?.anchors) ? drawing.anchors.filter(validAnchor) : [];
  const places = Number.isInteger(decimals) && decimals >= 0 && decimals <= 20 ? decimals : 2;
  const days = new Set(anchors.map((a) => day(a.timestamp)));
  const time = (t: number) => (formatTime ? formatTime(t) : days.size > 1 ? `${day(t).slice(5)} ${clock(t)}` : clock(t));
  const price = (n: number) => n.toFixed(places);
  const need = anchorCount(drawing?.tool);
  if (anchors.length < need) return `${name}, incomplete`;
  const [a, b] = anchors;
  switch (drawing.tool) {
    case 'horizontal-line': return `${name} at ${price(a.price)}`;
    case 'vertical-line': return `${name} at ${time(a.timestamp)}`;
    case 'text': return `${name} "${drawing.text ?? ''}" at ${price(a.price)}, ${time(a.timestamp)}`;
    default: {
      const span = `${name} from ${price(a.price)} at ${time(a.timestamp)} to ${price(b.price)} at ${time(b.timestamp)}`;
      if (drawing.tool !== 'price-range') return span;
      const change = b.price - a.price;
      const percent = a.price === 0 ? '' : `, ${change >= 0 ? '+' : ''}${((change / Math.abs(a.price)) * 100).toFixed(2)}%`;
      return `${span}, change ${change >= 0 ? '+' : ''}${price(change)}${percent}`;
    }
  }
}

/** One point in words: the price, then the time, for example "100.40, 19:03". Times are UTC unless `formatTime` is given. */
export function describeAnchor(anchor: DrawingAnchor, decimals = 2, formatTime?: (timestamp: number) => string): string {
  const places = Number.isInteger(decimals) && decimals >= 0 && decimals <= 20 ? decimals : 2;
  return `${anchor.price.toFixed(places)}, ${formatTime ? formatTime(anchor.timestamp) : clock(anchor.timestamp)}`;
}

/**
 * A drawing in words, for the text list. When an anchor is not free the words end with how it moves, for example
 * "Trend line from 101.20 at 14:05 to 103.80 at 15:20 (first point: price held)".
 */
export function describeDrawing(drawing: Drawing, decimals = 2, formatTime?: (timestamp: number) => string): string {
  const base = describeBase(drawing, decimals, formatTime);
  const anchors = Array.isArray(drawing?.anchors) ? drawing.anchors.slice(0, anchorCount(drawing?.tool)) : [];
  const notes = anchors.map((a) => attachOf(a)).map((mode, i) => (mode === 'free' ? '' : `${anchors.length > 1 ? `${i === 0 ? 'first' : 'second'} point: ` : ''}${ATTACH_LABELS[mode].toLowerCase()}`)).filter(Boolean);
  return notes.length === 0 ? base : `${base} (${notes.join('; ')})`;
}

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MutableRefObject, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { buttonFace, type NameProps } from './accessible-name.js';
import { primitiveAttributes } from './attributes.js';
import { useChart } from './ChartParts.js';
import { SelectionContext } from './selection-context.js';
import * as ToolbarPart from './ToolbarParts.js';
import type { CandleBar, ChartFrame } from './core/chart-scale.js';
import { barField, barNote, fromPriceField, fromTimeField, parseBarField, toTimeField } from './core/drawing-fields.js';
import {
  ATTACH_LABELS, ATTACH_MODES, DRAWING_TOOLS, DRAWING_TOOL_LABELS, anchorCount, attachOf, barTime, barsFromLast, describeAnchor, describeDrawing, drawingGeometry,
  editDrawing, hitTest, moveAnchor, moveDrawing, nextDrawingId, nudgeAmount, resolveDrawingKey, snapToBar, timeOfBarFromLast,
  type AttachMode, type Drawing, type DrawingAnchor, type DrawingTool, type SnapMode,
} from './core/drawings.js';

/**
 * Drawings as parts: Root, Layer, Toolbar, List, Remove, Undo. Headless: parts draw SVG and add `data-part`, `data-tool`,
 * `data-selected` and `data-draft`; the host gives them colour. Drawings are anchored to a time and a price, so they
 * stay put when the chart pans, zooms or gets new bars.
 *
 * Root only holds state, with no element of its own, so put it above both the Chart and the Toolbar and List. Layer
 * goes inside Chart.Plot. It takes no tab stop of its own: it listens for keys on the plot's own tab stop and only
 * answers when a drawing is selected or a tool is in use, so the chart's keys work as before the rest of the time.
 */

/** A drawing being placed: the anchors set so far and where the pointer is now. */
interface Draft {
  tool: DrawingTool;
  anchors: DrawingAnchor[];
  preview: DrawingAnchor | null;
}

interface DrawingsContext {
  drawings: readonly Drawing[];
  setDrawings: (next: Drawing[]) => void;
  tool: DrawingTool | null;
  setTool: (tool: DrawingTool | null) => void;
  selected: string | null;
  setSelected: (id: string | null) => void;
  snap: SnapMode;
  draft: Draft | null;
  setDraft: (draft: Draft | null) => void;
  remove: (id: string) => void;
  /** Lock or unlock one drawing. A locked drawing keeps its place: no drag, nudge, typed edit or removal. */
  setLocked: (id: string, locked: boolean) => void;
  /** Remove every drawing that is not locked. Undo puts them back. */
  removeAll: () => void;
  /** What the last removal took out, or null once it expired or was undone. */
  removed: readonly Drawing[] | null;
  /** Put the last removal back where it was. */
  /** Puts the last removal back and says so in the live region. `describe` prints a drawing (default two decimals, UTC time); `focusRow` moves focus to the restored row of a List. */
  undo: (options?: { describe?: (drawing: Drawing) => string; focusRow?: boolean }) => void;
  /** How long a removal can be undone, in milliseconds; 0 means until the next removal. */
  undoWindow: number;
  /** The bars of the chart the Layer sits in (empty until a Layer mounts); the Edit form counts bars from them. */
  bars: readonly CandleBar[];
  setBars: (bars: readonly CandleBar[]) => void;
  /** Say something in the polite live region of Drawings.Undo, for example "Updated Trend line ...". */
  announce: (text: string) => void;
  /** The last thing announced, or null. */
  status: string | null;
  /** The chart's plot element once a Layer mounts: where Escape in the toolbar sends focus. */
  plotRef: MutableRefObject<SVGSVGElement | null>;
  /** The Drawings.Undo region once it mounts, so a list that lost its last row can put focus on its Undo button. */
  undoRegion: MutableRefObject<HTMLElement | null>;
  /** Set by the Undo button: the List then focuses the restored row once it is back. */
  focusRowNext: MutableRefObject<boolean>;
  /** Set by a button that is about to remove drawings while focused: the Undo button takes focus once it shows. */
  focusUndoNext: MutableRefObject<boolean>;
}
const Context = createContext<DrawingsContext | null>(null);

/** The drawings state of the Drawings.Root above. */
export function useDrawings(part = 'part'): DrawingsContext {
  const context = useContext(Context);
  if (!context) throw new Error(`Drawings.${part} needs a Drawings.Root above it.`);
  return context;
}

export interface DrawingsRootProps {
  /** Controlled drawings; without it Root keeps its own list. */
  drawings?: readonly Drawing[];
  onDrawingsChange?: (drawings: Drawing[]) => void;
  /** Controlled tool in use, or null for none. */
  tool?: DrawingTool | null;
  onToolChange?: (tool: DrawingTool | null) => void;
  /** Controlled selected drawing id, or null. */
  selected?: string | null;
  onSelectedChange?: (id: string | null) => void;
  /** 'magnet' puts new points on the nearest bar and its open, high, low or close. Default 'off'. */
  snap?: SnapMode;
  /** How long the last removal can be undone, in milliseconds. 0 keeps it until the next removal. Default 10 000. */
  undoWindow?: number;
  children?: ReactNode;
}

/** State for the other parts. Each of drawings, tool and selection is controlled when given, and kept here when not. */
function Root({ drawings, onDrawingsChange, tool, onToolChange, selected, onSelectedChange, snap = 'off', undoWindow = 10_000, children }: DrawingsRootProps) {
  const [innerDrawings, setInnerDrawings] = useState<readonly Drawing[]>([]);
  const [innerTool, setInnerTool] = useState<DrawingTool | null>(null);
  const [innerSelected, setInnerSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  // Bar numbers only need the times, so a new array with the same length and ends is the same chart.
  const [bars, setBarsState] = useState<readonly CandleBar[]>([]);
  const setBars = useCallback((next: readonly CandleBar[]) => {
    setBarsState((prev) => (prev.length === next.length && prev[0]?.timestamp === next[0]?.timestamp && prev[prev.length - 1]?.timestamp === next[next.length - 1]?.timestamp ? prev : next));
  }, []);
  const [status, setStatus] = useState<string | null>(null);
  const plotRef = useRef<SVGSVGElement | null>(null);
  const undoRegion = useRef<HTMLElement | null>(null);
  const focusUndoNext = useRef(false);
  const focusRowNext = useRef(false);
  const list = drawings ?? innerDrawings;
  const activeTool = tool !== undefined ? tool : innerTool;
  // With a Selection.Root above, the selection lives there and a selected drawing is { kind: 'drawing' }; `selected` is then ignored.
  const sel = useContext(SelectionContext);
  const selNow = sel?.selection;
  const activeSelected = sel ? (selNow && selNow.kind === 'drawing' ? selNow.id : null) : selected !== undefined ? selected : innerSelected;
  const selSelect = sel?.select;
  const selCurrent = sel?.current;
  const selSetName = sel?.setName;

  // The array this Root last handed out, so a list it did not make (a symbol switch) can be told from its own.
  const emitted = useRef<readonly Drawing[] | null>(null);
  const setDrawings = useCallback((next: Drawing[]) => {
    emitted.current = next;
    if (drawings === undefined) setInnerDrawings(next);
    onDrawingsChange?.(next);
  }, [drawings, onDrawingsChange]);
  const setTool = useCallback((next: DrawingTool | null) => {
    if (tool === undefined) setInnerTool(next);
    onToolChange?.(next);
  }, [tool, onToolChange]);
  const setSelected = useCallback((next: string | null) => {
    if (selSelect && selCurrent) {
      // Putting a drawing away must not take a selected series or study with it.
      if (next !== null) {
        // Name it first, so the live region says the drawing in words rather than its id.
        const known = list.find((d) => d.id === next);
        if (known && selSetName) selSetName('drawing', next, describeDrawing(known, 2));
        selSelect({ kind: 'drawing', id: next });
      }
      else if (selCurrent()?.kind === 'drawing') selSelect(null);
    } else if (selected === undefined) setInnerSelected(next);
    onSelectedChange?.(next);
  }, [selected, onSelectedChange, selSelect, selCurrent, selSetName, list]);
  // The live region names the selected drawing in words.
  const selectedDrawing = activeSelected !== null ? list.find((d) => d.id === activeSelected) : undefined;
  useEffect(() => {
    if (selSetName && selectedDrawing) selSetName('drawing', selectedDrawing.id, describeDrawing(selectedDrawing, 2));
  }, [selSetName, selectedDrawing]);
  // The last removal, with where each drawing sat, so Undo can put it back. Only the last one is kept.
  const [lastRemoval, setLastRemoval] = useState<{ items: { drawing: Drawing; index: number }[] } | null>(null);
  useEffect(() => {
    if (!lastRemoval || !(undoWindow > 0)) return;
    const timer = setTimeout(() => setLastRemoval(null), undoWindow);
    return () => clearTimeout(timer);
  }, [lastRemoval, undoWindow]);
  // A pending Undo belongs to the list the removal made. When the host hands back another list (a symbol switch, or one
  // that refused the removal), putting the drawing back would add it to a list it never came from. A later list the Root
  // made itself, such as a new drawing that reuses a removed id, is the Root's own and keeps the Undo. The test is the array
  // itself, not its ids: a new empty array after a removal is a different list even though its content is equal. A host that
  // copies the array it was given (same drawings, same order) is the one exception.
  useEffect(() => {
    if (!lastRemoval || emitted.current === null) return;
    const mine = emitted.current;
    const copy = list.length > 0 && list.length === mine.length && list.every((d, i) => d === mine[i]);
    if (list !== mine && !copy) setLastRemoval(null);
  }, [list, lastRemoval]);
  const removeWhere = useCallback((gone: (d: Drawing) => boolean) => {
    const items = list.flatMap((drawing, index) => (gone(drawing) ? [{ drawing, index }] : []));
    if (items.length === 0) return;
    setDrawings(list.filter((d) => !gone(d)));
    if (activeSelected !== null && items.some((i) => i.drawing.id === activeSelected)) setSelected(null);
    setLastRemoval({ items });
    setStatus(null);
  }, [list, setDrawings, activeSelected, setSelected]);
  const remove = useCallback((id: string) => removeWhere((d) => d.id === id && !d.locked), [removeWhere]);
  const removeAll = useCallback(() => removeWhere((d) => !d.locked), [removeWhere]);
  const setLocked = useCallback((id: string, locked: boolean) => {
    setDrawings(list.map((d) => {
      if (d.id !== id) return d;
      const { locked: _was, ...rest } = d;
      return locked ? { ...rest, locked: true } : rest;
    }));
  }, [list, setDrawings]);
  const undo = useCallback((options?: { describe?: (drawing: Drawing) => string; focusRow?: boolean }) => {
    if (!lastRemoval) return;
    const next = [...list];
    let restored: string | null = null;
    // Ascending, so each index is still right after the ones before it went back in.
    for (const { drawing, index } of lastRemoval.items) {
      // A drawing added since may have taken the id; the restored one then gets a fresh id.
      const back = next.some((d) => d.id === drawing.id) ? { ...drawing, id: nextDrawingId(next) } : drawing;
      next.splice(Math.min(index, next.length), 0, back);
      restored = back.id;
    }
    setDrawings(next);
    if (lastRemoval.items.length === 1 && restored !== null) setSelected(restored);
    setLastRemoval(null);
    const describe = options?.describe ?? ((d: Drawing) => describeDrawing(d, 2));
    const items = lastRemoval.items;
    // The live region says what came back, so the silent return of a row is heard.
    setStatus(items.length === 1 ? `Restored ${describe(items[0].drawing)}.` : `Restored ${items.length} drawings.`);
    focusRowNext.current = !!options?.focusRow && items.length === 1;
  }, [lastRemoval, list, setDrawings, setSelected]);
  const removed = useMemo(() => (lastRemoval ? lastRemoval.items.map((i) => i.drawing) : null), [lastRemoval]);

  // A focused Remove button may be gone after the removal (the selection it acted on is cleared): Undo takes focus instead.
  useEffect(() => {
    if (!lastRemoval || !focusUndoNext.current) return;
    focusUndoNext.current = false;
    undoRegion.current?.querySelector<HTMLElement>("[data-part='drawing-undo-button']")?.focus();
  }, [lastRemoval]);
  // A half-placed drawing belongs to the tool that began it.
  useEffect(() => {
    setDraft((current) => (current && current.tool !== activeTool ? null : current));
  }, [activeTool]);

  const context = useMemo<DrawingsContext>(() => ({
    drawings: list, setDrawings, tool: activeTool, setTool, selected: activeSelected, setSelected, snap, draft, setDraft, remove, setLocked, removeAll, removed, undo, undoWindow, bars, setBars,
    announce: setStatus, status, plotRef, undoRegion, focusUndoNext, focusRowNext,
  }), [list, setDrawings, activeTool, setTool, activeSelected, setSelected, snap, draft, remove, setLocked, removeAll, removed, undo, undoWindow, bars, setBars, status, plotRef, undoRegion, focusUndoNext, focusRowNext]);
  return <Context.Provider value={context}>{children}</Context.Provider>;
}

/** What a drag in progress holds on to: the drawing as it was, so each move is measured from the start. */
interface Drag {
  pointerId: number;
  handle: number | 'body';
  start: Drawing;
  index: number;
  price: number;
  /** The chart frame at the press. The axis rescales to fit a moved drawing, so a drag reads pixels through this one. */
  frame: ChartFrame;
  /** Where the press was, in chart pixels and on screen. A move is measured from here, so a host that reflows during the drag cannot make the drawing jump. */
  press: { x: number; y: number; clientX: number; clientY: number };
}

/** How far from an anchor handle, in pixels, a touch still grabs it. */
const TOUCH_HANDLE_PX = 22;

/** A pointer travel, in pixels, past which a press-and-release counts as a drag rather than a click. */
const DRAG_PIXELS = 4;

/**
 * Draws every drawing and the handles of the selected one. Put it inside Chart.Plot, after the candles.
 *
 * With a tool in use it adds a transparent `drawing-capture` rect over the plot: press to set the first point, move
 * to preview, then release after a drag or click again to set the second. One-point tools place on the press. A new
 * drawing is selected and the tool is put away. With no tool, pressing a drawing selects it and dragging moves it,
 * or moves one anchor when a handle is grabbed; pressing anywhere else is left to the plot, which pans.
 *
 * From the keyboard, with a tool in use and the chart focused: Enter places a point at the crosshair (the bar the arrow keys
 * moved to, at the crosshair price, which from the keyboard is that bar's close), Enter again places the second point of a
 * two-point tool, and Escape drops the half-placed drawing. Each step is announced in Drawings.Undo's live region.
 *
 * `newText` is the words a new text note gets. `formatTime` prints times in those announcements (default HH:MM in UTC). The
 * layer is hidden from assistive technology: the List is its text.
 */
function Layer({ className, newText = 'Note', formatTime }: { className?: string; newText?: string; formatTime?: (timestamp: number) => string }) {
  const ctx = useDrawings('Layer');
  const chart = useChart('Drawings.Layer');
  const { bars, frame, toChart, decimals, readoutId } = chart;
  const groupRef = useRef<SVGGElement | null>(null);
  const live = useRef<{ ctx: DrawingsContext; chart: ReturnType<typeof useChart>; place: () => void }>({ ctx, chart, place: () => {} });
  // Set after `commit` and `placeAtCrosshair` below, so the key handler always reaches the latest ones.
  // The Edit form sits outside the chart, so the Layer hands it the bars to count from.
  const { setBars, plotRef } = ctx;
  // A host may fill the same array in place, so the layer publishes a copy and watches the length and last bar too.
  const barCount = bars.length;
  const lastBarTime = bars[barCount - 1]?.timestamp;
  useEffect(() => { setBars(bars.slice()); return () => setBars([]); }, [bars, barCount, lastBarTime, setBars]);
  const gesture = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  // A Selection.Layer asks before it reads a press as a tap on clear chart: a drawing or an armed tool owns the press.
  const selectionGuard = useContext(SelectionContext)?.guard;
  useEffect(() => {
    if (!selectionGuard) return;
    const guard = {
      owns: (clientX: number, clientY: number, pointerType: string) => {
        const { ctx: c, chart: ch } = live.current;
        if (c.tool !== null) return true;
        const point = ch.toChart(clientX, clientY);
        return !!point && hitTest(c.drawings, ch.bars, ch.frame, point, 6, pointerType === 'touch' ? TOUCH_HANDLE_PX : 6) !== null;
      },
      busy: () => live.current.ctx.tool !== null || live.current.ctx.draft !== null,
    };
    selectionGuard.current = guard;
    return () => { if (selectionGuard.current === guard) selectionGuard.current = null; };
  }, [selectionGuard]);
  // True after an arrow key moved the crosshair while a drawing was half placed: the preview then follows the crosshair.
  const keyboardMove = useRef(false);
  // The drawing (and anchor, or 'body') a pointer is moving now: it reads as active, and its anchor is marked.
  const [moving, setMoving] = useState<{ id: string; handle: number | 'body' } | null>(null);

  // Pointer and key handling for existing drawings runs on the plot's svg itself, ahead of the plot's own handlers,
  // and only stops the event when it used it. That is how the chart keeps panning and moving its crosshair otherwise.
  useEffect(() => {
    const svg = groupRef.current?.ownerSVGElement;
    if (!svg) return;
    plotRef.current = svg;
    const touchActionBefore = svg.style.touchAction;
    let drag: Drag | null = null;
    // A tap on clear chart deselects; a touch or pen tap on an unselected drawing (select) selects it, only on release.
    let tap: { pointerId: number; x: number; y: number; at: number; select?: string } | null = null;

    const down = new Set<number>();
    const onDown = (event: PointerEvent) => {
      const { ctx: c, chart: ch } = live.current;
      // A second finger joining means a pinch, not a tap: nothing pending may deselect.
      if (event.isPrimary) down.clear();
      down.add(event.pointerId);
      if (down.size > 1) tap = null;
      if (c.tool !== null || event.button !== 0) return;
      const point = ch.toChart(event.clientX, event.clientY);
      if (!point) return;
      // Drawings are clipped to the plot area, so a press in a gutter cannot pick one up.
      if (point.x < 0 || point.x >= ch.frame.plotWidth || point.y < 0 || point.y >= ch.frame.plotHeight) return;
      // A finger needs a bigger target than a mouse: handles grab within 22 px by touch, 6 px otherwise.
      const hit = hitTest(c.drawings, ch.bars, ch.frame, point, 6, event.pointerType === 'touch' ? TOUCH_HANDLE_PX : 6);
      if (!hit) {
        // A tap on clear chart puts the selection away. A drag that starts here is the chart panning, so it keeps it.
        // A press on a selectable study line is the Selection.Layer's: it selects the study instead.
        if ((event.target as Element | null)?.closest?.("[data-part='study-hit']")) return;
        if (c.selected !== null && down.size === 1) tap = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, at: event.timeStamp };
        return;
      }
      // A finger or pen on an unselected drawing may be the start of a page scroll (the plot is pan-y until something is selected),
      // and the browser decides that after the press. So nothing is taken or changed now: a tap selects it on release.
      if (event.pointerType !== 'mouse' && c.selected !== hit.id) {
        if (down.size === 1) tap = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, at: event.timeStamp, select: hit.id };
        return;
      }
      event.stopPropagation();
      c.setSelected(hit.id);
      const start = c.drawings.find((d) => d.id === hit.id);
      if (!start || start.locked) return;
      drag = { pointerId: event.pointerId, handle: hit.handle, start, index: ch.frame.indexAt(point.x), price: ch.frame.priceAt(point.y), frame: ch.frame, press: { ...point, clientX: event.clientX, clientY: event.clientY } };
      svg.setPointerCapture?.(event.pointerId);
      setMoving({ id: hit.id, handle: hit.handle });
    };
    const onMove = (event: PointerEvent) => {
      keyboardMove.current = false;
      // Once the pointer has gone past the tap slop it is a pan, even if it comes back before release.
      if (tap && tap.pointerId === event.pointerId && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 6) tap = null;
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.stopPropagation();
      const { ctx: c, chart: ch } = live.current;
      // Locked (or removed) while held, for example by a second finger on Lock: the drag ends and the drawing stays put.
      const current = c.drawings.find((d) => d.id === drag!.start.id);
      if (!current || current.locked) { drag = null; setMoving(null); return; }
      const point = { x: drag.press.x + (event.clientX - drag.press.clientX), y: drag.press.y + (event.clientY - drag.press.clientY) };
      let next: Drawing;
      if (drag.handle === 'body') {
        const shift = drag.frame.indexAt(point.x) - drag.index;
        next = moveDrawing(drag.start, c.snap === 'magnet' ? Math.round(shift) : shift, drag.frame.priceAt(point.y) - drag.price, ch.bars);
      } else {
        const anchor = snapToBar(point, ch.bars, drag.frame, c.snap);
        if (!anchor) return;
        next = moveAnchor(drag.start, drag.handle, anchor, ch.bars);
      }
      c.setDrawings(c.drawings.map((d) => (d.id === next.id ? next : d)));
    };
    const onUp = (event: PointerEvent) => {
      down.delete(event.pointerId);
      if (tap && tap.pointerId === event.pointerId) {
        const t = tap;
        tap = null;
        if (event.type === 'pointerup' && Math.hypot(event.clientX - t.x, event.clientY - t.y) <= 6 && event.timeStamp - t.at < 600) live.current.ctx.setSelected(t.select ?? null);
      }
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.stopPropagation();
      // The browser took the gesture (a scroll or a pinch): nothing it moved was meant, so the drawing goes back.
      if (event.type === 'pointercancel') {
        const { ctx: c } = live.current;
        const d = drag.start;
        if (c.drawings.some((x) => x.id === d.id)) c.setDrawings(c.drawings.map((x) => (x.id === d.id ? d : x)));
      }
      drag = null;
      setMoving(null);
    };
    const onKey = (event: KeyboardEvent) => {
      const { ctx: c, chart: ch } = live.current;
      // Ctrl or Cmd + Z puts the last removal back while it can still be undone.
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'z' && c.removed) {
        event.preventDefault();
        event.stopPropagation();
        c.undo();
        return;
      }
      // Enter places a point at the crosshair while a tool is in use.
      if (event.key === 'Enter' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && c.tool !== null) {
        event.preventDefault();
        event.stopPropagation();
        live.current.place();
        return;
      }
      if (c.draft && !event.altKey && !event.ctrlKey && !event.metaKey && /^(Arrow(Left|Right)|Home|End)$/.test(event.key)) keyboardMove.current = true;
      const key = resolveDrawingKey(event);
      if (!key) return;
      let handled = false;
      if (key.kind === 'escape') {
        if (c.draft) { c.announce(`${DRAWING_TOOL_LABELS[c.draft.tool]}: cancelled.`); c.setDraft(null); handled = true; }
        else if (c.tool !== null) { c.setTool(null); handled = true; }
        else if (c.selected !== null) { c.setSelected(null); handled = true; }
      } else if (!c.draft && c.tool === null) {
        const current = c.drawings.find((d) => d.id === c.selected);
        if (current) {
          handled = true;
          if (!current.locked) {
            if (key.kind === 'remove') c.remove(current.id);
            else {
              const step = nudgeAmount(key, ch.frame);
              const moved = moveDrawing(current, step.bars, step.price, ch.bars);
              c.setDrawings(c.drawings.map((d) => (d.id === moved.id ? moved : d)));
            }
          }
        }
      }
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
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
      svg.style.touchAction = touchActionBefore;
      if (plotRef.current === svg) plotRef.current = null;
    };
  }, [plotRef]);

  // The chart lets a vertical swipe scroll the page (touch-action pan-y), and the Layer keeps that while idle. While a tool is
  // armed, a drawing is selected, or one is being placed or dragged, a vertical touch drag moves or sizes a drawing and the browser
  // would cancel it to scroll, so the plot keeps the gesture (none). The browser reads touch-action at touchstart, so it follows state.
  const keepsTouch = ctx.tool !== null || ctx.selected !== null || ctx.draft !== null || moving !== null;
  useEffect(() => {
    const svg = groupRef.current?.ownerSVGElement;
    if (svg) svg.style.touchAction = keepsTouch ? 'none' : 'pan-y';
  }, [keepsTouch]);

  const anchorAt = (event: ReactPointerEvent<SVGRectElement>) => {
    const point = toChart(event.clientX, event.clientY);
    return point ? { point, anchor: snapToBar(point, bars, frame, ctx.snap) } : null;
  };
  const commit = (tool: DrawingTool, anchors: DrawingAnchor[]): Drawing => {
    const drawing: Drawing = { id: nextDrawingId(ctx.drawings), tool, anchors, ...(tool === 'text' ? { text: newText } : {}) };
    ctx.setDrawings([...ctx.drawings, drawing]);
    ctx.setDraft(null);
    ctx.setSelected(drawing.id);
    ctx.setTool(null);
    return drawing;
  };
  /** The anchor under the crosshair: the active bar (the last one before the crosshair has been moved) at the crosshair price. */
  const crosshairAnchor = (): DrawingAnchor | null => {
    const index = chart.active !== null && bars[chart.active] ? chart.active : frame.last;
    const bar = bars[index];
    if (!bar) return null;
    const price = chart.pointerPrice ?? bar.close;
    const snapped = snapToBar({ x: frame.x(index), y: frame.y(price) }, bars, frame, ctx.snap);
    return { timestamp: bar.timestamp, price: ctx.snap === 'magnet' && snapped ? snapped.price : price };
  };
  const placeAtCrosshair = () => {
    const tool = ctx.tool;
    const anchor = crosshairAnchor();
    if (tool === null || !anchor) return;
    const name = DRAWING_TOOL_LABELS[tool];
    if (chart.active === null) chart.setActive(Math.min(bars.length - 1, Math.max(0, frame.last)));
    const point = describeAnchor(anchor, decimals, formatTime);
    if (anchorCount(tool) === 1) {
      const drawing = commit(tool, [anchor]);
      ctx.announce(`${name}: placed at ${point}. Added ${describeDrawing(drawing, decimals, formatTime)}.`);
      return;
    }
    if (!ctx.draft) {
      ctx.setDraft({ tool, anchors: [anchor], preview: anchor });
      ctx.announce(`${name}: first point at ${point}. Move the crosshair, then press Enter for the second point.`);
      return;
    }
    const first = ctx.draft.anchors[0];
    if (first.timestamp === anchor.timestamp && first.price === anchor.price) {
      ctx.announce(`${name}: the second point is the same as the first. Move the crosshair, then press Enter.`);
      return;
    }
    const drawing = commit(tool, [first, anchor]);
    ctx.announce(`${name}: second point at ${point}. Added ${describeDrawing(drawing, decimals, formatTime)}.`);
  };
  live.current = { ctx, chart, place: placeAtCrosshair };
  // With a drawing half placed, an arrow key moves its preview to the crosshair, as a pointer would.
  useEffect(() => {
    if (!keyboardMove.current) return;
    keyboardMove.current = false;
    const { ctx: c, chart: ch } = live.current;
    if (!c.draft || ch.active === null) return;
    const bar = ch.bars[ch.active];
    if (bar) c.setDraft({ ...c.draft, preview: { timestamp: bar.timestamp, price: ch.pointerPrice ?? bar.close } });
  }, [chart.active]);
  const onCaptureDown = (event: ReactPointerEvent<SVGRectElement>) => {
    event.stopPropagation(); // the plot must not start a pan
    if (event.button !== 0 || ctx.tool === null) return;
    const at = anchorAt(event);
    if (!at?.anchor) return;
    const tool = ctx.tool;
    if (anchorCount(tool) === 1) { commit(tool, [at.anchor]); return; }
    if (!ctx.draft) {
      ctx.setDraft({ tool, anchors: [at.anchor], preview: at.anchor });
      gesture.current = { pointerId: event.pointerId, x: at.point.x, y: at.point.y };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      return;
    }
    const first = ctx.draft.anchors[0];
    if (first.timestamp === at.anchor.timestamp && first.price === at.anchor.price) return; // a zero-size drawing
    commit(tool, [first, at.anchor]);
  };
  const onCaptureMove = (event: ReactPointerEvent<SVGRectElement>) => {
    if (!ctx.draft) return;
    const at = anchorAt(event);
    if (at?.anchor) ctx.setDraft({ ...ctx.draft, preview: at.anchor });
  };
  const onCaptureUp = (event: ReactPointerEvent<SVGRectElement>) => {
    event.stopPropagation();
    const held = gesture.current;
    if (!held || held.pointerId !== event.pointerId) return;
    gesture.current = null;
    const at = anchorAt(event);
    if (!at?.anchor || !ctx.draft || !ctx.tool) return;
    if (Math.hypot(at.point.x - held.x, at.point.y - held.y) < DRAG_PIXELS) return; // a click: wait for the second one
    commit(ctx.tool, [ctx.draft.anchors[0], at.anchor]);
  };

  const draftDrawing: Drawing | null = ctx.draft && ctx.draft.preview
    ? { id: 'draft', tool: ctx.draft.tool, anchors: [ctx.draft.anchors[0], ctx.draft.preview] }
    : null;
  const fmt = (n: number) => n.toFixed(decimals);
  const signed = (n: number) => `${n >= 0 ? '+' : ''}${fmt(n)}`;

  // The preview is drawn outside the list, so no drawing id (even "draft") can share its key.
  const renderDrawing = (drawing: Drawing, isDraft: boolean) => {
    const g = drawingGeometry(drawing, bars, frame);
    const isSelected = !isDraft && drawing.id === ctx.selected;
    const isMoving = !isDraft && moving?.id === drawing.id;
    // passive: nothing is happening to it; active: being drawn or moved; selected: picked, with its anchors showing.
    const state = isDraft || isMoving ? 'active' : isSelected ? 'selected' : 'passive';
    return (
      <g
        key={isDraft ? undefined : drawing.id}
        data-mt=""
        data-part="drawing"
        data-tool={drawing.tool}
        data-state={state}
        data-selected={isSelected ? '' : undefined}
        data-draft={isDraft ? '' : undefined}
        data-locked={drawing.locked ? '' : undefined}
      >
        {g.boxes.map((b, i) => <rect key={`box${i}`} data-part="drawing-box" x={b.x} y={b.y} width={b.width} height={b.height} />)}
        {g.segments.map((s, i) => <line key={`line${i}`} data-part="drawing-line" x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />)}
        {g.levels.map((l) => (
          <g key={l.ratio} data-part="drawing-level" data-ratio={l.ratio}>
            <line x1={l.x1} y1={l.y} x2={l.x2} y2={l.y} />
            <text x={l.x2} y={l.y - 3} textAnchor="end">{`${l.ratio} (${fmt(l.price)})`}</text>
          </g>
        ))}
        {g.label && <text data-part="drawing-text" x={g.label.x} y={g.label.y}>{g.label.text}</text>}
        {g.range && g.boxes[0] && (
          <text data-part="drawing-range" data-change={g.range.change > 0 ? 'up' : g.range.change < 0 ? 'down' : 'flat'} x={g.boxes[0].x + g.boxes[0].width / 2} y={g.boxes[0].y - 4} textAnchor="middle">
            {`${signed(g.range.change)}${g.range.percent === null ? '' : ` (${g.range.percent >= 0 ? '+' : ''}${g.range.percent.toFixed(2)}%)`}, ${g.range.bars} ${g.range.bars === 1 ? 'bar' : 'bars'}`}
          </text>
        )}
        {isSelected && drawing.locked && g.handles[0] && (
          <g data-part="drawing-lock-mark" transform={`translate(${g.handles[0].x + 8} ${g.handles[0].y - 20})`}>
            <path d="M3 7V5a3 3 0 0 1 6 0v2" fill="none" />
            <rect x="1" y="7" width="10" height="8" rx="1.5" />
          </g>
        )}
        {isSelected && !drawing.locked && g.handles.map((h) => <circle key={h.index} data-part="drawing-handle" data-handle={h.index} data-dragging={isMoving && moving?.handle === h.index ? '' : undefined} cx={h.x} cy={h.y} r={5} />)}
      </g>
    );
  };

  return (
    <g ref={groupRef} className={className} data-part="drawings" clipPath={`url(#${readoutId}-plotarea)`} aria-hidden="true">
      {ctx.drawings.map((drawing) => renderDrawing(drawing, false))}
      {draftDrawing && renderDrawing(draftDrawing, true)}
      {ctx.tool !== null && (
        <rect
          data-part="drawing-capture"
          data-tool={ctx.tool}
          x={0}
          y={0}
          width={frame.plotWidth}
          height={frame.plotHeight}
          fill="transparent"
          onPointerDown={onCaptureDown}
          onPointerMove={onCaptureMove}
          onPointerUp={onCaptureUp}
          onPointerCancel={() => { gesture.current = null; }}
        />
      )}
    </g>
  );
}

export interface DrawingsToolbarProps {
  className?: string;
  'aria-label'?: string;
  /** Which tools to offer, in order. Default all nine. */
  tools?: readonly DrawingTool[];
  /**
   * A graphic for each tool, drawn before its words and hidden from assistive technology: an object by tool, or a
   * function of the tool. No icons ship with the package. With `hideLabels` the icon is all that shows.
   */
  icon?: Partial<Record<DrawingTool, ReactNode>> | ((tool: DrawingTool) => ReactNode);
  /** Each tool's words (its accessible name), by tool. Default: "Trend line", "Ray" and so on. */
  labels?: Partial<Record<DrawingTool, string>>;
  /** Show only the icons; the labels become each button's `aria-label`. Needs `icon`. Default false. */
  hideLabels?: boolean;
}

/**
 * One button per tool, built on Toolbar: one tab stop, the arrow keys, Home and End move between the buttons, and Tab
 * leaves. A pressed button is the tool in use; pressing it again puts the tool away. Escape sends focus to the chart.
 * Every button has its tool in words, even when an icon is all that shows.
 */
function Toolbar({ className, 'aria-label': label = 'Drawing tools', tools = DRAWING_TOOLS, icon, labels, hideLabels = false }: DrawingsToolbarProps) {
  const { tool, setTool, plotRef } = useDrawings('Toolbar');
  const iconOf = (name: DrawingTool): ReactNode => (typeof icon === 'function' ? icon(name) : icon?.[name]);
  return (
    <ToolbarPart.Root className={className} aria-label={label} data-part="drawing-toolbar" returnFocusTo={() => plotRef.current}>
      {tools.map((name) => (
        <ToolbarPart.Button
          key={name}
          data-part="drawing-tool"
          data-tool={name}
          pressed={tool === name}
          icon={iconOf(name)}
          label={labels?.[name] ?? DRAWING_TOOL_LABELS[name]}
          hideLabel={hideLabels}
          onClick={() => {
            if (tool !== name && !plotRef.current) console.warn('Drawings.Toolbar: a tool is on but no Drawings.Layer is mounted, so clicks on the chart will draw nothing. Put <Drawings.Layer /> inside Chart.Plot.');
            setTool(tool === name ? null : name);
          }}
        />
      ))}
    </ToolbarPart.Root>
  );
}

export interface DrawingsListProps {
  className?: string;
  'aria-label'?: string;
  /** Decimals for printed prices. Default 2. */
  decimals?: number;
  /** Prints a time. Default HH:MM in UTC, with the date when a drawing spans days. */
  formatTime?: (timestamp: number) => string;
  /** Shown when there are no drawings. */
  empty?: string;
}

/**
 * The drawings in words, with a button to select and a button to remove each. The selected one has aria-current.
 * Delete or Backspace on a drawing's line removes it, as on the chart, and so does its Remove button. Focus moves to the
 * next line; after the last line is removed it goes to the Undo button when Drawings.Undo is showing it, else to the empty
 * list (the "No drawings" line), never to the top of the page.
 */
function List({ className, 'aria-label': label = 'Drawings', decimals = 2, formatTime, empty = 'No drawings' }: DrawingsListProps) {
  const { drawings, selected, setSelected, remove, setLocked, undoRegion, focusRowNext } = useDrawings('List');
  const listRef = useRef<HTMLUListElement | null>(null);
  const emptyRef = useRef<HTMLParagraphElement | null>(null);
  // Set when a removal here took the last row: the row's buttons are gone by the next render, so focus is placed then.
  const lostFocus = useRef(false);
  useEffect(() => {
    if (!lostFocus.current || drawings.length > 0) return;
    lostFocus.current = false;
    // The Undo button if it is showing (it is the likely next move), else the empty list, so focus never falls to the page.
    (undoRegion.current?.querySelector<HTMLElement>("[data-part='drawing-undo-button']") ?? emptyRef.current)?.focus();
  }, [drawings.length, undoRegion]);
  // After the Undo button put a row back, focus goes to that row (the Undo button is gone), so it lands on something visible.
  useEffect(() => {
    if (!focusRowNext.current || selected === null) return;
    const row = listRef.current?.querySelector<HTMLElement>("li[aria-current='true'] [data-part='drawing-select']");
    if (!row) return;
    focusRowNext.current = false;
    row.focus();
  }, [drawings, selected, focusRowNext]);
  /** Remove a row, first moving focus to the next row (or the one before) so it does not fall to the top of the page. */
  const removeRow = (drawing: Drawing, index: number) => {
    if (drawing.locked) return;
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>("[data-part='drawing-select']");
    const neighbour = buttons?.[index + 1] ?? buttons?.[index - 1];
    if (neighbour) neighbour.focus();
    else lostFocus.current = true;
    remove(drawing.id);
  };
  const onSelectKey = (event: ReactKeyboardEvent<HTMLButtonElement>, drawing: Drawing, index: number) => {
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    event.preventDefault();
    removeRow(drawing, index);
  };
  if (drawings.length === 0) return <p ref={emptyRef} tabIndex={-1} className={className} data-part="drawing-list" data-empty="">{empty}</p>;
  return (
    <ul ref={listRef} className={className} aria-label={label} data-part="drawing-list" {...primitiveAttributes({})}>
      {drawings.map((drawing, index) => {
        const text = describeDrawing(drawing, decimals, formatTime);
        return (
          <li key={drawing.id} data-tool={drawing.tool} data-selected={drawing.id === selected ? '' : undefined} data-locked={drawing.locked ? '' : undefined} aria-current={drawing.id === selected ? 'true' : undefined}>
            <button type="button" data-part="drawing-select" data-mt="" data-touch-target="" onClick={() => setSelected(drawing.id)} onKeyDown={(event) => onSelectKey(event, drawing, index)}>{text}</button>
            <button type="button" data-part="drawing-lock-toggle" data-mt="" data-touch-target="" aria-pressed={!!drawing.locked} aria-label={`Lock ${text}`} onClick={() => setLocked(drawing.id, !drawing.locked)}>Lock</button>
            <button type="button" data-part="drawing-remove" data-mt="" data-touch-target="" aria-label={`Remove ${text}`} disabled={drawing.locked} onClick={() => removeRow(drawing, index)}>Remove</button>
          </li>
        );
      })}
    </ul>
  );
}

export interface DrawingsRemoveProps extends NameProps {
  className?: string;
  /** Remove every drawing that is not locked, not only the selected one. */
  all?: boolean;
  /** The button's words. Default "Remove", or "Remove all" with `all`. */
  children?: ReactNode;
}

/**
 * A button that removes the selected drawing, or with `all` every drawing that is not locked. It acts only on a
 * selection that already exists, never on what was under a finger when it was pressed, and the removal can be undone
 * (see Undo). With nothing to remove it is `aria-disabled` rather than disabled, so keyboard focus stays on it.
 */
function Remove({ className, all = false, icon, label, hideLabel, children }: DrawingsRemoveProps) {
  const { drawings, selected, remove, removeAll, focusUndoNext } = useDrawings('Remove');
  const face = buttonFace(all ? 'Remove all' : 'Remove', { icon, label, hideLabel, children });
  const target = all ? drawings.some((d) => !d.locked) : drawings.some((d) => d.id === selected && !d.locked);
  return (
    <button
      type="button"
      className={className}
      data-part={all ? 'drawing-remove-all' : 'drawing-remove-selected'}
      data-mt=""
      data-touch-target=""
      aria-label={face['aria-label']}
      aria-disabled={target ? undefined : true}
      onClick={(event) => { if (!target) return; focusUndoNext.current = document.activeElement === event.currentTarget; if (all) removeAll(); else if (selected !== null) remove(selected); }}
    >
      {face.content}
    </button>
  );
}

export interface DrawingsUndoProps extends NameProps {
  className?: string;
  /** Decimals for printed prices. Default 2. */
  decimals?: number;
  formatTime?: (timestamp: number) => string;
}

/**
 * Says what the last removal took out and offers Undo for as long as the Root's undoWindow lasts (10 seconds by
 * default). The region is always in the page and announced politely, so a screen reader hears each removal as it
 * happens. It is also where the other drawing announcements land (a point placed from the keyboard, an applied Edit), in
 * a `data-part='drawing-status'` line, so one live region carries everything. Ctrl or Cmd + Z does the same from the chart. Only the last removal can be undone. Undo says what it restored in the same region. Focus moves to the
 * restored row of Drawings.List when one is showing, else to the region (which then holds that sentence), so the button going away does not drop it to the top of the page.
 */
function Undo({ className, decimals = 2, formatTime, icon, label, hideLabel }: DrawingsUndoProps) {
  const { removed, undo, undoWindow, status, undoRegion } = useDrawings('Undo');
  const face = buttonFace('Undo', { icon, label, hideLabel });
  const region = useRef<HTMLDivElement | null>(null);
  const buttonHadFocus = useRef(false);
  const runs = useRef(0);
  // One number per removal, so the timer line starts over even when the same drawing is removed twice.
  const run = useMemo(() => ++runs.current, [removed]);
  const text = !removed ? '' : removed.length === 1 ? `Removed ${describeDrawing(removed[0], decimals, formatTime)}.` : `Removed ${removed.length} drawings.`;
  // When the window runs out under a focused Undo button, focus stays in the controls instead of dropping to the page.
  useEffect(() => {
    if (removed === null && buttonHadFocus.current) {
      buttonHadFocus.current = false;
      region.current?.focus();
    }
  }, [removed]);
  return (
    <div ref={(node) => { region.current = node; undoRegion.current = node; }} tabIndex={-1} className={className} role="status" aria-live="polite" data-part="drawing-undo" data-empty={removed || status ? undefined : ''}>
      {removed && <span data-part="drawing-undo-text">{text}</span>}
      {status && <span data-part="drawing-status">{status}</span>}
      {removed && (
        <button
          type="button"
          data-part="drawing-undo-button"
          data-mt=""
          data-touch-target=""
          onFocus={() => { buttonHadFocus.current = true; }}
          onBlur={(event) => { if (event.currentTarget.isConnected) buttonHadFocus.current = false; }}
          aria-label={face['aria-label']}
          onClick={() => { buttonHadFocus.current = false; undo({ describe: (d) => describeDrawing(d, decimals, formatTime), focusRow: true }); region.current?.focus(); }}
        >
          {face.content}
        </button>
      )}
      {/* The time left, as a line that drains over the window. A new removal is a new element, so it starts again. */}
      {removed && undoWindow > 0 && <span key={run} aria-hidden="true" data-part="drawing-undo-timer" style={{ ['--mt-undo-window' as string]: `${undoWindow}ms` }} />}
    </div>
  );
}

export interface DrawingsLockProps extends NameProps {
  className?: string;
  /** The button's words. Default "Lock". The state is carried by aria-pressed, so the words do not change. */
  children?: ReactNode;
}

/**
 * A toggle for the selected drawing's lock. Pressed means locked: it cannot be dragged, nudged, edited by typing or
 * removed until it is unlocked. With nothing selected it is `aria-disabled` and does nothing.
 */
function Lock({ className, icon, label, hideLabel, children }: DrawingsLockProps) {
  const { drawings, selected, setLocked } = useDrawings('Lock');
  const face = buttonFace('Lock', { icon, label, hideLabel, children });
  const drawing = drawings.find((d) => d.id === selected);
  return (
    <button
      type="button"
      className={className}
      data-part="drawing-lock"
      data-mt=""
      data-touch-target=""
      aria-label={face['aria-label']}
      aria-pressed={drawing ? !!drawing.locked : false}
      aria-disabled={drawing ? undefined : true}
      onClick={() => { if (drawing) setLocked(drawing.id, !drawing.locked); }}
    >
      {face.content}
    </button>
  );
}

export interface DrawingsEditProps extends NameProps {
  className?: string;
  /** Decimals shown in the price fields. Default 2. */
  decimals?: number;
  /** Prints a time in the "Updated ..." announcement. Default HH:MM in UTC. */
  formatTime?: (timestamp: number) => string;
  /** The toggle button's words. Default "Edit". */
  children?: ReactNode;
}

/**
 * Type exact values for the selected drawing: a price and/or a time (UTC) for each anchor, and the words of a text
 * note. A closed "Edit" button opens a small form with only the fields that tool has (a horizontal line has just a
 * price). Enter applies, Escape closes without applying, a bad value is named next to its field and nothing is half
 * applied and "Updated ..." is announced in Drawings.Undo's live region. This is also the way to place a line at an exact
 * price without a pointer. A locked drawing cannot be edited.
 */
function Edit({ className, decimals: rawDecimals = 2, formatTime, icon, label, hideLabel, children }: DrawingsEditProps) {
  const decimals = Number.isFinite(rawDecimals) ? Math.min(20, Math.max(0, Math.round(rawDecimals))) : 2; // toFixed throws outside 0 to 100
  const { drawings, selected, setDrawings, bars, announce } = useDrawings('Edit');
  const face = buttonFace('Edit', { icon, label, hideLabel, children });
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement | null>(null);
  const baseId = useId();
  const drawing = drawings.find((d) => d.id === selected);
  const canEdit = !!drawing && !drawing.locked;
  useEffect(() => { if (open && !canEdit) setOpen(false); }, [open, canEdit]);
  const hint = !drawing ? 'Select a drawing to edit it.' : drawing.locked ? 'Unlock this drawing to edit it.' : undefined;
  const close = () => { setOpen(false); toggle.current?.focus(); };
  return (
    <div className={className} data-part="drawing-edit" data-open={open && canEdit ? '' : undefined} onKeyDown={(event) => { if (event.key === 'Escape' && open) { event.stopPropagation(); close(); } }}>
      <button
        ref={toggle}
        type="button"
        data-part="drawing-edit-toggle"
        data-mt=""
        data-touch-target=""
        aria-expanded={open && canEdit}
        aria-controls={`${baseId}-form`}
        aria-disabled={canEdit ? undefined : true}
        aria-describedby={hint ? `${baseId}-hint` : undefined}
        aria-label={face['aria-label']}
        onClick={() => { if (canEdit) setOpen((o) => !o); }}
      >
        {face.content}
      </button>
      {hint && <span id={`${baseId}-hint`} data-part="drawing-edit-hint" hidden>{hint}</span>}
      {open && drawing && canEdit && (
        <EditForm
          key={`${drawing.id}:${JSON.stringify(drawing.anchors)}:${drawing.text ?? ''}`}
          id={`${baseId}-form`}
          drawing={drawing}
          decimals={decimals}
          bars={bars}
          onApply={(next) => { setDrawings(drawings.map((d) => (d.id === next.id ? next : d))); announce(`Updated ${describeDrawing(next, decimals, formatTime)}.`); close(); }}
          onCancel={close}
        />
      )}
    </div>
  );
}

function EditForm({ id, drawing, decimals, bars, onApply, onCancel }: { id: string; drawing: Drawing; decimals: number; bars: readonly CandleBar[]; onApply: (next: Drawing) => void; onCancel: () => void }) {
  const count = anchorCount(drawing.tool);
  const showPrice = drawing.tool !== 'vertical-line';
  const showTime = drawing.tool !== 'horizontal-line';
  // A horizontal line holds its price and a vertical line its time by tool, so only the other tools pick an attach mode.
  const showAttach = drawing.tool !== 'horizontal-line' && drawing.tool !== 'vertical-line';
  const showBar = showTime && bars.length > 0;
  // The fields show rounded values (price to `decimals`, time to the second). A field the person did not touch keeps the
  // drawing's exact value, so applying a change to one field never rounds the others.
  const [shownPrices] = useState(() => drawing.anchors.slice(0, count).map((a) => a.price.toFixed(decimals)));
  const [shownTimes] = useState(() => drawing.anchors.slice(0, count).map((a) => toTimeField(a.timestamp)));
  const [shownBars] = useState(() => drawing.anchors.slice(0, count).map((a) => barField(barsFromLast(bars, a.timestamp))));
  const [shownAttach] = useState(() => drawing.anchors.slice(0, count).map((a) => attachOf(a)));
  const [prices, setPrices] = useState(shownPrices);
  const [times, setTimes] = useState(shownTimes);
  const [barText, setBarText] = useState(shownBars);
  const [attach, setAttach] = useState<AttachMode[]>(shownAttach);
  // Time and Bar are two views of one value: the one typed last is the one applied, and the other follows it on screen.
  const [lastTyped, setLastTyped] = useState<('time' | 'bar')[]>(() => shownAttach.map(() => 'time'));
  const typed = (i: number, kind: 'time' | 'bar') => setLastTyped(lastTyped.map((v, j) => (j === i ? kind : v)));
  // When bars arrive while the form is open, a count that follows a time is recounted against the new series, so the Bar
  // and Time fields keep describing one position. A count the person typed is left as typed.
  useEffect(() => {
    if (bars.length === 0) return;
    setBarText((current) => current.map((v, j) => {
      const at = lastTyped[j] === 'time' ? fromTimeField(times[j]) : NaN;
      return Number.isFinite(at) ? barField(barsFromLast(bars, at)) : v;
    }));
    // A count typed and not yet applied keeps its number; the Time beside it moves to that count on the new series.
    setTimes((current) => current.map((v, j) => {
      const n = lastTyped[j] === 'bar' ? parseBarField(barText[j]) : null;
      const at = n === null ? null : timeOfBarFromLast(bars, n);
      return at === null ? v : toTimeField(at);
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars]);
  const onTime = (i: number, value: string) => {
    setTimes(times.map((v, j) => (j === i ? value : v)));
    const at = fromTimeField(value);
    if (bars.length > 0 && Number.isFinite(at)) setBarText(barText.map((v, j) => (j === i ? barField(barsFromLast(bars, at)) : v)));
    typed(i, 'time');
  };
  const onBar = (i: number, value: string) => {
    setBarText(barText.map((v, j) => (j === i ? value : v)));
    const n = parseBarField(value);
    const at = n === null ? null : timeOfBarFromLast(bars, n);
    if (at !== null && Number.isFinite(at)) setTimes(times.map((v, j) => (j === i ? toTimeField(at) : v)));
    typed(i, 'bar');
  };
  const [text, setText] = useState(drawing.text ?? '');
  const [error, setError] = useState<{ field: string; message: string } | null>(null);
  const form = useRef<HTMLFormElement | null>(null);
  // Opening the form in a full-screen frame on a phone can leave it below the fold: bring it (and Apply, Cancel) into view.
  useEffect(() => {
    const el = form.current;
    if (!el || typeof el.scrollIntoView !== 'function') return;
    const still = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'nearest', behavior: still ? 'auto' : 'smooth' });
  }, []);
  const name = DRAWING_TOOL_LABELS[drawing.tool];
  const label = (what: string, i: number) => (count === 1 ? what : `${i === 0 ? 'First' : 'Second'} ${what.toLowerCase()}`);
  const submit = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    for (let i = 0; i < count; i += 1) {
      if (showPrice && prices[i] !== shownPrices[i] && !Number.isFinite(fromPriceField(prices[i]))) return fail(`price-${i}`, `${label('Price', i)}: enter a number such as 101.25.`);
      if (showBar && lastTyped[i] === 'bar' && barText[i] !== shownBars[i] && parseBarField(barText[i]) === null) return fail(`bar-${i}`, `${label('Bar', i)}: enter a whole number such as -12 (0 is the last bar).`);
      if (showBar && lastTyped[i] === 'bar' && barText[i] !== shownBars[i] && timeOfBarFromLast(bars, parseBarField(barText[i]) as number) === null) return fail(`bar-${i}`, `${label('Bar', i)}: that is too far from the chart. Try a smaller number.`);
      if (showTime && !(showBar && lastTyped[i] === 'bar' && barText[i] !== shownBars[i]) && times[i] !== shownTimes[i] && !Number.isFinite(fromTimeField(times[i]))) return fail(`time-${i}`, `${label('Time', i)}: enter a date and time.`);
    }
    const next = editDrawing(drawing, {
      anchors: Array.from({ length: count }, (_, i) => {
        // A typed bar number is exact (a bar's own time); a typed time is read to the second. Whole-bar anchors sit on a bar.
        const byBar = showBar && lastTyped[i] === 'bar' && barText[i] !== shownBars[i];
        const typedTime = byBar ? timeOfBarFromLast(bars, parseBarField(barText[i]) as number) : showTime && times[i] !== shownTimes[i] ? fromTimeField(times[i]) : undefined;
        const mode = showAttach ? attach[i] : shownAttach[i];
        const timestamp = mode === 'bar' && (typedTime !== undefined || mode !== shownAttach[i]) ? barTime(bars, typedTime ?? drawing.anchors[i].timestamp) : typedTime;
        return {
          ...(showPrice && prices[i] !== shownPrices[i] ? { price: fromPriceField(prices[i]) } : {}),
          ...(timestamp !== undefined && timestamp !== null ? { timestamp } : {}),
          ...(showAttach && attach[i] !== shownAttach[i] ? { attach: attach[i] } : {}),
        };
      }),
      text,
    });
    if (next === drawing) return fail('', 'That value cannot be used.');
    onApply(next);
  };
  const fail = (field: string, message: string) => {
    setError({ field, message });
    if (field) form.current?.querySelector<HTMLInputElement>(`[data-field='${field}']`)?.focus();
  };
  return (
    <form
      ref={form}
      id={id}
      role="group"
      aria-label={`Edit ${name}`}
      data-part="drawing-edit-form"
      noValidate
      onSubmit={submit}
    >
      {drawing.anchors.slice(0, count).map((_, i) => (
        <fieldset key={i} data-part="drawing-edit-anchor" data-anchor={i}>
          {count > 1 && <legend>{i === 0 ? 'First point' : 'Second point'}</legend>}
          {showPrice && (
            <label>
              <span>Price</span>
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                data-mt="" data-touch-target=""
                data-field={`price-${i}`}
                value={prices[i]}
                aria-invalid={error?.field === `price-${i}` || undefined}
                aria-describedby={error?.field === `price-${i}` ? `${id}-error` : undefined}
                onChange={(e) => setPrices(prices.map((v, j) => (j === i ? e.target.value : v)))}
              />
            </label>
          )}
          {showTime && (
            <label>
              <span>Time (UTC)</span>
              <input
                type="datetime-local"
                step={1}
                data-mt="" data-touch-target=""
                data-field={`time-${i}`}
                value={times[i]}
                aria-invalid={error?.field === `time-${i}` || undefined}
                aria-describedby={error?.field === `time-${i}` ? `${id}-error` : undefined}
                onChange={(e) => onTime(i, e.target.value)}
              />
            </label>
          )}
          {showBar && (
            <label>
              <span>Bar (from last)</span>
              <input
                type="text"
                autoComplete="off"
                data-mt="" data-touch-target=""
                data-field={`bar-${i}`}
                value={barText[i]}
                aria-invalid={error?.field === `bar-${i}` || undefined}
                aria-describedby={`${id}-bar-note-${i}${error?.field === `bar-${i}` ? ` ${id}-error` : ''}`}
                onChange={(e) => onBar(i, e.target.value)}
              />
              <small id={`${id}-bar-note-${i}`} data-part="drawing-edit-bar-note">{barNote(bars, lastTyped[i] === 'bar' ? parseBarField(barText[i]) : null, fromTimeField(times[i]))}</small>
            </label>
          )}
          {showAttach && (
            <label>
              <span>Attach</span>
              <select data-mt="" data-touch-target="" data-field={`attach-${i}`} value={attach[i]} onChange={(e) => setAttach(attach.map((v, j) => (j === i ? (e.target.value as AttachMode) : v)))}>
                {ATTACH_MODES.map((mode) => <option key={mode} value={mode}>{ATTACH_LABELS[mode]}</option>)}
              </select>
            </label>
          )}
        </fieldset>
      ))}
      {drawing.tool === 'text' && (
        <label>
          <span>Words</span>
          <input type="text" data-mt="" data-touch-target="" data-field="text" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
      )}
      <p id={`${id}-error`} role="alert" data-part="drawing-edit-error" hidden={!error}>{error?.message}</p>
      <div data-part="drawing-edit-actions">
        <button type="submit" data-part="drawing-edit-apply" data-mt="" data-touch-target="">Apply</button>
        <button type="button" data-part="drawing-edit-cancel" data-mt="" data-touch-target="" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export { Root, Layer, Toolbar, List, Remove, Undo, Lock, Edit };

import { createContext, useCallback, useContext, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { clampFraction, fractionFromPointer, isActiveScrubPointer, isPrimaryScrubPointer, reduceScrubGesture, resolveScrubKey, type ScrubGestureEvent } from './core/scrubber-gesture.js';

/**
 * Scrubber as parts: Root, Track, Thumb, Mark. Headless: the parts render the elements the evidence
 * ruler always did, add `data-state` / `data-disabled`, and work in fractions of the track. The host owns what a
 * fraction means (a place in its session), the copy, and the look.
 *
 * Root renders no DOM. It owns the preview while a pointer is down, so `useScrubber()` gives a readout the live
 * fraction; nothing is committed until release, and then exactly once through `onCommit`.
 */
interface ScrubberContext {
  /** Where the thumb is drawn: the preview while dragging, else the committed fraction. */
  fraction: number;
  committedFraction: number;
  dragging: boolean;
  loading: boolean;
  trackHandlers: {
    onPointerDown: (event: PointerEvent<HTMLElement>) => void;
    onPointerMove: (event: PointerEvent<HTMLElement>) => void;
    onPointerUp: (event: PointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
  };
  onThumbKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

const Context = createContext<ScrubberContext | null>(null);

/** The live scrub state, for a readout that must follow the preview. Throws a plain message outside a `Scrubber.Root`. */
export function useScrubber(): Pick<ScrubberContext, 'fraction' | 'committedFraction' | 'dragging' | 'loading'> {
  const context = useContext(Context);
  if (!context) throw new Error('useScrubber needs a Scrubber.Root above it: there is no scrub state to read.');
  const { fraction, committedFraction, dragging, loading } = context;
  return { fraction, committedFraction, dragging, loading };
}

export interface ScrubberRootProps {
  /** Where the host's cursor sits on the track, 0 to 1. */
  fraction: number;
  /** Another navigation is running: a new scrub does not start, keys do nothing, and a release does not commit. */
  loading?: boolean;
  onBeginScrub?: () => void;
  onEndScrub?: () => void;
  /** A release (or Home, End, PageUp, PageDown) resolved to this fraction. Called once per gesture. */
  onCommit: (fraction: number) => void;
  /** An arrow key: step one event in this direction. The host decides what "one event" is. */
  onStep: (direction: -1 | 1) => void;
  children?: ReactNode;
}

function Root({ fraction: committedInput, loading = false, onBeginScrub, onEndScrub, onCommit, onStep, children }: ScrubberRootProps) {
  const committedFraction = committedInput;
  const [dragFraction, setDragFraction] = useState<number | null>(null);
  // Which pointer owns the drag: a ref, because the very next pointer event of the same gesture must read it
  // before any state update has been applied.
  const activePointerId = useRef<number | null>(null);
  const live = useRef({ dragFraction, loading, onBeginScrub, onEndScrub, onCommit, onStep, committedFraction });
  live.current = { dragFraction, loading, onBeginScrub, onEndScrub, onCommit, onStep, committedFraction };

  const apply = useCallback((event: ScrubGestureEvent) => {
    const now = live.current;
    const result = reduceScrubGesture(event, now.dragFraction);
    // The ref is updated here as well as at render, so two events in one frame still see the latest preview.
    live.current = { ...now, dragFraction: result.dragFraction };
    setDragFraction(result.dragFraction);
    if (result.begin) now.onBeginScrub?.();
    if (result.end) now.onEndScrub?.();
    if (result.commit !== null) now.onCommit(result.commit);
  }, []);

  const fractionAt = (event: PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return fractionFromPointer(event.clientX, rect.left, rect.width);
  };

  const trackHandlers = useMemo<ScrubberContext['trackHandlers']>(() => ({
    onPointerDown(event) {
      if (live.current.loading) return;
      // Gate before capturing: a right-click must reach the browser's own menu, and a second finger must not start a scrub.
      if (!isPrimaryScrubPointer(event)) return;
      // Without this, a press after a text selection starts a native drag and the browser cancels the pointer.
      event.preventDefault();
      // preventDefault also stops the browser focusing what was pressed, so a press on the thumb focuses it here.
      const pressed = event.target instanceof Element ? event.target.closest<HTMLElement>('[tabindex]') : null;
      if (pressed && event.currentTarget.contains(pressed)) pressed.focus({ preventScroll: true });
      activePointerId.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
      apply({ type: 'down', fraction: fractionAt(event) });
    },
    onPointerMove(event) {
      if (!isActiveScrubPointer(event.pointerId, activePointerId.current)) return;
      apply({ type: 'move', fraction: fractionAt(event) });
    },
    onPointerUp(event) {
      if (!isActiveScrubPointer(event.pointerId, activePointerId.current)) return;
      activePointerId.current = null;
      // The release's own coordinate, read the same way as a move; the last move may lag it.
      apply({ type: 'up', fraction: fractionAt(event), loading: live.current.loading });
      event.currentTarget.releasePointerCapture(event.pointerId);
    },
    onPointerCancel(event) {
      if (!isActiveScrubPointer(event.pointerId, activePointerId.current)) return;
      activePointerId.current = null;
      apply({ type: 'cancel' });
    },
  }), [apply]);

  const onThumbKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    const now = live.current;
    if (now.loading) return;
    const action = resolveScrubKey(event.key, now.committedFraction);
    if (!action) return;
    event.preventDefault();
    if (action.type === 'step') {
      // A host may also listen for arrows on the window; letting this bubble would step twice.
      event.stopPropagation();
      now.onStep(action.direction);
    } else {
      now.onCommit(action.fraction);
    }
  }, []);

  const dragging = dragFraction !== null;
  const context = useMemo<ScrubberContext>(() => ({
    fraction: dragFraction ?? committedFraction,
    committedFraction,
    dragging,
    loading,
    trackHandlers,
    onThumbKeyDown,
  }), [dragFraction, committedFraction, dragging, loading, trackHandlers, onThumbKeyDown]);
  return <Context.Provider value={context}>{children}</Context.Provider>;
}

function useContextOrThrow(part: string): ScrubberContext {
  const context = useContext(Context);
  if (!context) throw new Error(`Scrubber.${part} needs a Scrubber.Root above it.`);
  return context;
}

/** The pressable area. Pointer handlers live here; marks and the thumb go inside it. */
function Track({ className, children }: { className?: string; children?: ReactNode }) {
  const { trackHandlers, dragging, loading } = useContextOrThrow('Track');
  return (
    <div className={className} {...trackHandlers} data-part="scrubber-track" data-state={dragging ? 'dragging' : 'idle'} data-disabled={loading ? '' : undefined}>
      {children}
    </div>
  );
}

export interface ScrubberThumbProps {
  className?: string;
  /** Accessible name. */
  label?: string;
  /** What the position means in words (the host's readout); announced with the value. */
  valueText?: string;
  /** Ids of elements that describe the thumb, such as the first few gap marks. */
  describedBy?: string;
}

const percent = (fraction: number) => `${(clampFraction(fraction) * 100).toFixed(3)}%`;

/** The one tab stop: `role="slider"`, positioned at the live fraction. Arrows step, Home/End/PageUp/PageDown jump. */
function Thumb({ className, label = 'Session position', valueText, describedBy }: ScrubberThumbProps) {
  const { fraction, loading, onThumbKeyDown } = useContextOrThrow('Thumb');
  return (
    <div
      className={className}
      data-part="scrubber-thumb"
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-describedby={describedBy}
      aria-disabled={loading || undefined}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clampFraction(fraction) * 100)}
      aria-valuetext={valueText}
      style={{ left: percent(fraction) }}
      onKeyDown={onThumbKeyDown}
    />
  );
}

export interface ScrubberMarkProps {
  /** Left edge on the track, 0 to 1. */
  at: number;
  /** Width on the track, 0 to 1; leave out for a point. */
  span?: number;
  /** Accessible name; the mark is an image, not a control, and never a tab stop. */
  label: string;
  /** What kind of mark: lets a host style gaps and checkpoints apart. */
  kind?: string;
  title?: string;
  /** `-1` makes the mark focusable by pointer but never a tab stop; leave out for a plain image. */
  tabIndex?: -1;
  id?: string;
  className?: string;
}

/** A position on the track that informs but cannot be activated (a declared gap, a verified checkpoint). */
function Mark({ at, span, label, kind, title, tabIndex, id, className }: ScrubberMarkProps) {
  const style: CSSProperties = span === undefined ? { left: percent(at) } : { left: percent(at), width: percent(Math.max(0, span)) };
  return <span id={id} className={className} data-part="scrubber-mark" data-kind={kind} style={style} role="img" tabIndex={tabIndex} title={title} aria-label={label} />;
}

export { Root, Track, Thumb, Mark };

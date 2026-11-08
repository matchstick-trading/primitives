import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

/**
 * Cursor: the one owner of "where in the session are we". Every view (Transport, Scrubber,
 * Ladder, DiffTable) reads this one value instead of keeping its own copy, so linked panels cannot disagree
 * about time. Renders no DOM.
 *
 * The value is the engine's own cursor shape, sequence and timestamp as bigint: an exact integer, never a
 * float. (A wire form with decimal strings belongs at the contract boundary, not in this React state.)
 *
 * Controlled (`value` + `onValueChange`) or uncontrolled (`defaultValue`), the same three-prop pattern the
 * headless libraries use. A controlled Root never changes the value itself: `setValue` only calls
 * `onValueChange`, and the host decides.
 */
export type CursorValue =
  | { readonly position: 'initial' }
  | { readonly position: 'event'; readonly sequence: bigint; readonly timestamp: bigint };

export type CursorState = 'idle' | 'playing' | 'seeking';
export type CursorBoundary = 'start' | 'end' | null;

export const CURSOR_START: CursorValue = { position: 'initial' };

/** True when both are the same place in the session. */
export function sameCursor(a: CursorValue, b: CursorValue): boolean {
  if (a.position === 'initial' || b.position === 'initial') return a.position === b.position;
  return a.sequence === b.sequence && a.timestamp === b.timestamp;
}

export interface CursorRootProps {
  value?: CursorValue;
  defaultValue?: CursorValue;
  onValueChange?: (value: CursorValue) => void;
  /** What the host is doing with the cursor. Exposed as `data-state` to every view that asks for attributes. */
  state?: CursorState;
  /** Set when the cursor is at the start or end of the session. */
  boundary?: CursorBoundary;
  children?: ReactNode;
}

interface CursorContext {
  value: CursorValue;
  setValue: (value: CursorValue) => void;
  state: CursorState;
  boundary: CursorBoundary;
}

const Context = createContext<CursorContext | null>(null);

function Root({ value, defaultValue = CURSOR_START, onValueChange, state = 'idle', boundary = null, children }: CursorRootProps) {
  const controlled = value !== undefined;
  const [inner, setInner] = useState<CursorValue>(defaultValue);
  const current = controlled ? value : inner;
  // The latest callback and mode, read at call time, so `setValue` keeps one identity for the life of the Root.
  const live = useRef({ controlled, onValueChange, current });
  live.current = { controlled, onValueChange, current };
  const setValue = useCallback((next: CursorValue) => {
    const { controlled: isControlled, onValueChange: notify, current: now } = live.current;
    if (sameCursor(now, next)) return;
    if (!isControlled) setInner(next);
    notify?.(next);
  }, []);
  const context = useMemo(() => ({ value: current, setValue, state, boundary }), [current, setValue, state, boundary]);
  return <Context.Provider value={context}>{children}</Context.Provider>;
}

/** Reads the shared cursor. Throws a plain message when there is no `Cursor.Root` above, rather than guessing a position. */
export function useCursor(): CursorContext & { attributes: { 'data-state': CursorState; 'data-boundary'?: 'start' | 'end' } } {
  const context = useContext(Context);
  if (!context) throw new Error('useCursor needs a Cursor.Root above it: there is no shared cursor to read.');
  const attributes = context.boundary
    ? { 'data-state': context.state, 'data-boundary': context.boundary }
    : { 'data-state': context.state };
  return { ...context, attributes };
}

export { Root };

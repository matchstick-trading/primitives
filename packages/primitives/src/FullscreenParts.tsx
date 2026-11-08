import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';
import { buttonFace, type NameProps } from './accessible-name.js';
import { FULLSCREEN_LABEL, FULLSCREEN_MESSAGE, resolveFullscreenEscape } from './core/fullscreen.js';
import { useNameCheck } from './ToolbarParts.js';

/**
 * Full screen as parts: Frame and Toggle. Headless: parts add `data-part` and `data-mt`; the host gives them looks.
 *
 * Frame is a wrapper div: put the chart, its controls and the Toggle inside it. Toggle is a button that expands the Frame to
 * the whole screen. Where the browser has the Fullscreen API (including the `webkit` prefix on iPad Safari) the Frame goes
 * full screen natively. Where it does not (iPhone Safari) or the browser refuses, the Frame fills the page instead:
 * `position: fixed` over everything, the page behind it inert and not scrolling, both put back on exit. So the button
 * always works.
 */

/** What a part inside a Frame can read and do. */
export interface FullscreenState {
  /** True while the Frame is expanded. */
  fullscreen: boolean;
  /** How: the browser's own full screen, or the in-page fallback. null when not expanded. */
  mode: 'native' | 'fallback' | null;
  enter: () => void;
  exit: () => void;
  toggle: () => void;
}
const Context = createContext<(FullscreenState & { frame: RefObject<HTMLDivElement | null>; toggleRef: RefObject<HTMLButtonElement | null> }) | null>(null);

/** The Frame's state, for a host that changes its layout when expanded (a taller chart). Throws outside a Frame. */
export function useFullscreen(): FullscreenState {
  const context = useContext(Context);
  if (!context) throw new Error('useFullscreen must be used inside Fullscreen.Frame.');
  const { fullscreen, mode, enter, exit, toggle } = context;
  return { fullscreen, mode, enter, exit, toggle };
}

type DataAttributes = { [attribute: `data-${string}`]: string | number | boolean | undefined };

export interface FullscreenFrameProps extends DataAttributes {
  className?: string;
  style?: CSSProperties;
  /** Controlled: whether the Frame is expanded. Leave it out and the Frame keeps its own state. */
  fullscreen?: boolean;
  /** Called with the new state when the user, the Escape key or the browser's own UI changes it. */
  onFullscreenChange?: (fullscreen: boolean) => void;
  children?: ReactNode;
}

const NATIVE_EVENTS = ['fullscreenchange', 'webkitfullscreenchange'] as const;

type FullscreenElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
type FullscreenDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void };

function nativeElement(doc: Document): Element | null {
  const d = doc as FullscreenDocument;
  return d.fullscreenElement ?? d.webkitFullscreenElement ?? null;
}

/** Ask the browser to take the element full screen. null when it has no such API; else a promise that rejects if refused. */
function requestNative(element: HTMLElement): Promise<void> | null {
  const el = element as FullscreenElement;
  try {
    if (typeof el.requestFullscreen === 'function') return Promise.resolve(el.requestFullscreen());
    if (typeof el.webkitRequestFullscreen === 'function') return Promise.resolve(el.webkitRequestFullscreen());
  } catch (error) {
    return Promise.reject(error);
  }
  return null;
}

function exitNative(doc: Document): void {
  const d = doc as FullscreenDocument;
  try {
    const done = typeof d.exitFullscreen === 'function' ? d.exitFullscreen() : d.webkitExitFullscreen?.();
    Promise.resolve(done).catch(() => {});
  } catch { /* not in full screen any more */ }
}

/** Put `inert` on everything beside the frame and its ancestors, so focus and taps stay in the frame. Returns the undo. */
function inertPageBehind(frame: HTMLElement): () => void {
  const marked: Element[] = [];
  for (let node: HTMLElement | null = frame; node && node !== document.body; node = node.parentElement) {
    for (const sibling of Array.from(node.parentElement?.children ?? [])) {
      if (sibling === node || sibling.hasAttribute('inert')) continue;
      sibling.setAttribute('inert', '');
      marked.push(sibling);
    }
  }
  return () => { for (const el of marked) el.removeAttribute('inert'); };
}

/** Stop the page scrolling under the frame; the undo puts the styles and the scroll position back. */
function lockScroll(): () => void {
  const html = document.documentElement;
  const body = document.body;
  const saved = { html: html.style.overflow, body: body.style.overflow, x: window.scrollX, y: window.scrollY };
  html.style.overflow = 'hidden';
  body.style.overflow = 'hidden';
  return () => {
    html.style.overflow = saved.html;
    body.style.overflow = saved.body;
    window.scrollTo(saved.x, saved.y);
  };
}

const HIDDEN: CSSProperties = { position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 };

/** The in-page look: over everything, inside the safe areas, painted from tokens (override on the Frame or a parent). */
const FALLBACK_STYLE: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 'var(--mt-fullscreen-z, 2147483000)' as unknown as number,
  boxSizing: 'border-box',
  overflow: 'auto',
  background: 'var(--mt-fullscreen-bg, var(--mt-surface, #12151c))',
  color: 'var(--mt-fullscreen-fg, #e8eaef)',
  paddingTop: 'env(safe-area-inset-top)',
  paddingRight: 'env(safe-area-inset-right)',
  paddingBottom: 'env(safe-area-inset-bottom)',
  paddingLeft: 'env(safe-area-inset-left)',
};
/** The browser's own full screen paints black unless the Frame fills it and brings its own background. */
const NATIVE_STYLE: CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  height: '100%',
  overflow: 'auto',
  background: 'var(--mt-fullscreen-bg, var(--mt-surface, #12151c))',
  color: 'var(--mt-fullscreen-fg, #e8eaef)',
};

/**
 * The wrapper. `data-fullscreen` is present while expanded and `data-mode` says how. Escape leaves full screen: see
 * `resolveFullscreenEscape` for the order when the chart has something to clear first.
 */
function Frame({ className, style, fullscreen, onFullscreenChange, children, ...rest }: FullscreenFrameProps) {
  const frame = useRef<HTMLDivElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const [inner, setInner] = useState(false);
  const [mode, setMode] = useState<'native' | 'fallback' | null>(null);
  const [message, setMessage] = useState('');
  const expanded = fullscreen ?? inner;

  // The latest values for handlers that outlive a render (browser events, a promise settling).
  const live = useRef({ expanded, mode, onFullscreenChange, controlled: fullscreen !== undefined });
  live.current = { expanded, mode, onFullscreenChange, controlled: fullscreen !== undefined };

  const commit = useCallback((next: boolean) => {
    if (live.current.expanded === next) return;
    live.current.expanded = next; // a second call in the same tick sees this one
    if (!live.current.controlled) setInner(next);
    live.current.onFullscreenChange?.(next);
  }, []);

  const setModeNow = useCallback((next: 'native' | 'fallback' | null) => { live.current.mode = next; setMode(next); }, []);

  /** Take native full screen if the browser can; else, or if it refuses, fall back to the in-page state. */
  const begin = useCallback(() => {
    const element = frame.current;
    if (!element) return;
    const request = requestNative(element);
    if (!request) { setModeNow('fallback'); return; }
    setModeNow('native');
    request.then(
      () => { if (!live.current.expanded || live.current.mode !== 'native') exitNative(document); }, // collapsed while the request was in flight
      () => { if (live.current.expanded && live.current.mode === 'native') setModeNow('fallback'); },
    );
  }, [setModeNow]);

  const enter = useCallback(() => {
    if (live.current.expanded) return;
    commit(true);
    begin(); // synchronous, so the browser still sees the click that asked for it
  }, [commit, begin]);

  const exit = useCallback(() => {
    if (!live.current.expanded) return;
    commit(false);
    if (nativeElement(document) === frame.current) exitNative(document);
    setModeNow(null);
  }, [commit, setModeNow]);

  const toggle = useCallback(() => { if (live.current.expanded) exit(); else enter(); }, [enter, exit]);

  // A controlled `fullscreen` that changed from outside: bring the DOM in step. (A user gesture is not available here, so a
  // browser may refuse native full screen; the fallback covers that.)
  useEffect(() => {
    if (expanded && mode === null) begin();
    if (!expanded && mode !== null) {
      if (nativeElement(document) === frame.current) exitNative(document);
      setModeNow(null);
    }
  }, [expanded, mode, begin, setModeNow]);

  // The browser's own UI left full screen (swipe, its Esc, a system gesture): follow it.
  useEffect(() => {
    const onChange = () => {
      const active = nativeElement(document) === frame.current;
      if (!active && live.current.mode === 'native' && live.current.expanded) { commit(false); setModeNow(null); }
      if (active && !live.current.expanded) exitNative(document); // entered after the state had already moved on
    };
    for (const name of NATIVE_EVENTS) document.addEventListener(name, onChange);
    return () => { for (const name of NATIVE_EVENTS) document.removeEventListener(name, onChange); };
  }, [commit, setModeNow]);

  // In-page mode: lock scroll and make the page behind inert. Both undone on exit and on unmount.
  const fallback = expanded && mode === 'fallback';
  useEffect(() => {
    const element = frame.current;
    if (!fallback || !element) return;
    const unlock = lockScroll();
    const uninert = inertPageBehind(element);
    return () => { uninert(); unlock(); };
  }, [fallback]);

  // Escape, in both modes (a browser's own full screen usually takes the key first, and then this never sees it). A part
  // that handles Escape itself (menu, Edit form, the toolbar, the chart with a selection) stops the key before it reaches here.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      event.preventDefault();
      exit();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [expanded, exit]);

  // Say it, and send focus home on the way out.
  const was = useRef(false);
  useEffect(() => {
    if (was.current === expanded) return;
    was.current = expanded;
    setMessage(expanded ? FULLSCREEN_MESSAGE.entered : FULLSCREEN_MESSAGE.exited);
    if (!expanded) toggleRef.current?.focus({ preventScroll: true });
  }, [expanded]);

  // Unmounted while expanded: leave the browser's full screen. (The effects above undo the in-page mode.)
  useEffect(() => () => {
    if (live.current.mode === 'native' && nativeElement(document) === frame.current) exitNative(document);
  }, []);

  // The chart swallows Escape when it has something to clear, and also when it has not. So decide here, before it does.
  // The signals are the parts' own documented attributes: the crosshair, `data-selected` (a drawing), `data-state='selected'`
  // (the series, a study), `data-draft` (a half-placed drawing) and the armed tool's `aria-pressed`.
  const onKeyDownCapture = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!expanded || event.key !== 'Escape' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target as Element;
    const plot = target.closest?.("[data-part='plot']") ?? null;
    const drawingBusy = event.currentTarget.querySelector("[data-part='drawing-tool'][aria-pressed='true'], [data-part='drawing'][data-draft]") !== null;
    const plotHasMark = plot?.querySelector("[data-part='crosshair'], [data-selected], [data-state='selected']") != null;
    if (resolveFullscreenEscape({ inPlot: plot !== null, plotHasMark, drawingBusy }) !== 'exit') return;
    if (!plot) return; // outside the chart the document listener (or the part itself) handles it
    event.preventDefault();
    event.stopPropagation();
    exit();
  };

  const context = useMemo(() => ({ fullscreen: expanded, mode: expanded ? mode : null, enter, exit, toggle, frame, toggleRef }), [expanded, mode, enter, exit, toggle]);
  const look = expanded ? (mode === 'fallback' ? FALLBACK_STYLE : NATIVE_STYLE) : undefined;
  return (
    <Context.Provider value={context}>
      <div
        ref={frame}
        data-mt=""
        data-part="fullscreen-frame"
        {...rest}
        className={className}
        style={look ? { ...look, ...style } : style}
        data-fullscreen={expanded ? '' : undefined}
        data-mode={expanded ? (mode ?? undefined) : undefined}
        onKeyDownCapture={onKeyDownCapture}
      >
        {children}
        <span role="status" aria-live="polite" data-part="fullscreen-status" style={HIDDEN}>{message}</span>
      </div>
    </Context.Provider>
  );
}

export interface FullscreenToggleProps extends NameProps, DataAttributes {
  className?: string;
  /** The name while collapsed, the action it does. Default "Full screen". */
  label?: string;
  /** The name while expanded. Default "Exit full screen". */
  exitLabel?: string;
  /** Visible text, in place of the label. */
  children?: ReactNode;
  disabled?: boolean;
}

/** A button with `aria-pressed` that enters and leaves full screen. Put it inside Fullscreen.Frame. */
function Toggle({ icon, label, exitLabel, hideLabel, children, className, disabled, ...rest }: FullscreenToggleProps) {
  const context = useContext(Context);
  if (!context) throw new Error('Fullscreen.Toggle must be used inside Fullscreen.Frame.');
  const { fullscreen, toggle, toggleRef } = context;
  const name = fullscreen ? (exitLabel ?? FULLSCREEN_LABEL.exit) : (label ?? FULLSCREEN_LABEL.enter);
  const face = buttonFace(name, { icon, label: name, hideLabel, children });
  useNameCheck(toggleRef, 'Fullscreen.Toggle');
  return (
    <button
      data-mt=""
      data-part="fullscreen-toggle"
      data-touch-target=""
      {...rest}
      ref={toggleRef}
      type="button"
      className={className}
      disabled={disabled}
      aria-label={face['aria-label']}
      aria-pressed={fullscreen}
      onClick={toggle}
    >
      {face.content}
    </button>
  );
}

export { Frame, Toggle };

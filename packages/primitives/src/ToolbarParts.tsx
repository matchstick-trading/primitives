import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';
import { buttonFace, type NameProps } from './accessible-name.js';

/**
 * A toolbar as parts: Root, Button and Separator. Headless: parts add `data-part` and `data-mt`; the host gives them looks.
 *
 * The toolbar is ONE tab stop (roving tabindex). Inside it the arrow keys along its orientation move between the items,
 * Home and End jump to the ends, and Escape sends focus to `returnFocusTo` (the chart, for a drawing toolbar). An item
 * is a Toolbar.Button (a plain button, or a toggle with `pressed`) or a Menu.Trigger.
 */

type Orientation = 'horizontal' | 'vertical';

interface ToolbarContext {
  orientation: Orientation;
  stop: string | null;
  setStop: (id: string) => void;
  register: (id: string, element: HTMLElement) => void;
  unregister: (id: string) => void;
  /** Ask the root to re-check which item is the tab stop (an item became enabled or disabled). */
  refresh: () => void;
}
const Context = createContext<ToolbarContext | null>(null);

/** The toolbar a part sits in, or null outside one. Menu.Trigger uses it to join the roving tab stop. */
export function useToolbarContext(): ToolbarContext | null {
  return useContext(Context);
}

/** Makes `element` an item of the toolbar above it, if any; returns the tabIndex and focus handler to put on it. */
export function useToolbarItem(element: RefObject<HTMLElement | null>, disabled?: boolean): { tabIndex: 0 | -1 | undefined; onFocus: (() => void) | undefined } {
  const toolbar = useContext(Context);
  const id = useId();
  const register = toolbar?.register;
  const unregister = toolbar?.unregister;
  useEffect(() => {
    if (!register || !unregister || !element.current) return;
    register(id, element.current);
    return () => unregister(id);
  }, [register, unregister, id, element]);
  // A disabled item cannot be the tab stop: tell the root when that changes, since the root may not re-render on its own.
  const refresh = toolbar?.refresh;
  useEffect(() => { refresh?.(); }, [refresh, disabled]);
  const setStop = toolbar?.setStop;
  const onFocus = useCallback(() => setStop?.(id), [setStop, id]);
  if (!toolbar) return { tabIndex: undefined, onFocus: undefined };
  return { tabIndex: toolbar.stop === id ? 0 : -1, onFocus };
}

type DataAttributes = { [attribute: `data-${string}`]: string | number | boolean | undefined };

export interface ToolbarRootProps extends DataAttributes {
  className?: string;
  /** Names the toolbar. Default "Toolbar"; give it the real name ("Drawing tools"). */
  'aria-label'?: string;
  /** Which arrow keys move between items. Default 'horizontal' (Left and Right); 'vertical' uses Up and Down. */
  orientation?: Orientation;
  /**
   * Where Escape sends focus: an element ref, or a function that returns the element (it is read when Escape is pressed,
   * so the chart need not exist yet). Without it Escape does nothing here.
   */
  returnFocusTo?: RefObject<HTMLElement | SVGElement | null> | (() => HTMLElement | SVGElement | null);
  children?: ReactNode;
}

/** role="toolbar" with one tab stop. Put Toolbar.Button and Menu.Trigger inside it, in any wrapper. */
function Root({ className, 'aria-label': label = 'Toolbar', orientation = 'horizontal', returnFocusTo, children, ...rest }: ToolbarRootProps) {
  const items = useRef(new Map<string, HTMLElement>());
  const [stop, setStop] = useState<string | null>(null);
  const [, setVersion] = useState(0);
  const register = useCallback((id: string, element: HTMLElement) => { items.current.set(id, element); setVersion((v) => v + 1); }, []);
  const unregister = useCallback((id: string) => { items.current.delete(id); setVersion((v) => v + 1); }, []);

  /** The enabled items in document order. */
  const ordered = () => [...items.current.entries()]
    .filter(([, el]) => el.isConnected && !(el as HTMLButtonElement).disabled)
    .sort(([, a], [, b]) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));

  // One item must always be the tab stop: when none is (first render, or the one that was removed), a pressed item is the
  // stop, else the first. This runs after every render because an item can change `pressed` or `disabled` without telling us.
  useEffect(() => {
    const list = ordered();
    if (list.length === 0 || (stop !== null && list.some(([id]) => id === stop))) return;
    const pressed = list.find(([, el]) => el.getAttribute('aria-pressed') === 'true');
    setStop((pressed ?? list[0])[0]);
  });

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const list = ordered();
    const at = list.findIndex(([, el]) => el === event.target);
    if (at < 0) return; // a key inside an open menu belongs to the menu
    if (event.key === 'Escape') {
      const target = typeof returnFocusTo === 'function' ? returnFocusTo() : returnFocusTo?.current;
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      target.focus();
      return;
    }
    // A horizontal toolbar mirrors in right-to-left text, as Menu does: the arrow that points ahead visually moves ahead.
    const rtl = orientation !== 'vertical' && getComputedStyle(event.currentTarget).direction === 'rtl';
    const forward = orientation === 'vertical' ? 'ArrowDown' : rtl ? 'ArrowLeft' : 'ArrowRight';
    const back = orientation === 'vertical' ? 'ArrowUp' : rtl ? 'ArrowRight' : 'ArrowLeft';
    let next: number;
    switch (event.key) {
      case forward: next = (at + 1) % list.length; break;
      case back: next = (at - 1 + list.length) % list.length; break;
      case 'Home': next = 0; break;
      case 'End': next = list.length - 1; break;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation(); // arrows, Home and End are also transport shortcuts on a replay page
    setStop(list[next][0]);
    list[next][1].focus();
  };

  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const context = useMemo<ToolbarContext>(() => ({ orientation, stop, setStop, register, unregister, refresh }), [orientation, stop, register, unregister, refresh]);
  return (
    <Context.Provider value={context}>
      <div data-mt="" data-part="toolbar" {...rest} className={className} role="toolbar" aria-label={label} aria-orientation={orientation} onKeyDown={onKeyDown}>
        {children}
      </div>
    </Context.Provider>
  );
}

export interface ToolbarButtonProps extends NameProps, DataAttributes, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  /** Makes the button a toggle: `aria-pressed` is this value. Leave it out for a plain button. */
  pressed?: boolean;
}

/**
 * A button in the toolbar. Visible words are `children`, else `label`. With only an icon, set `hideLabel` and `label`:
 * the label becomes the accessible name. A button with no words at all gets no name, and warns in the console.
 */
function Button({ pressed, icon, label, hideLabel, children, className, onClick, ...rest }: ToolbarButtonProps) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const item = useToolbarItem(ref, rest.disabled);
  const face = buttonFace(undefined, { icon, label, hideLabel, children, ariaLabel: rest['aria-label'] });
  useNameCheck(ref, 'Toolbar.Button');
  return (
    <button
      data-mt=""
      data-part="toolbar-button"
      data-touch-target=""
      {...rest}
      ref={ref}
      type="button"
      className={className}
      aria-label={face['aria-label']}
      aria-pressed={pressed}
      tabIndex={item.tabIndex}
      onFocus={(event) => { item.onFocus?.(); rest.onFocus?.(event); }}
      onClick={onClick}
    >
      {face.content}
    </button>
  );
}

/** A thin divider between groups of items. */
function Separator({ className }: { className?: string }) {
  return <div className={className} data-mt="" data-part="toolbar-separator" role="separator" />;
}

/** Warns once, in the console, when a control has no accessible name (no text and no aria-label). */
export function useNameCheck(ref: RefObject<HTMLElement | null>, part: string): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const named = (el.textContent ?? '').trim() !== '' || (el.getAttribute('aria-label') ?? '').trim() !== '' || el.hasAttribute('aria-labelledby');
    if (!named) console.warn(`${part} has no accessible name: give it children, or a label with hideLabel when it shows only an icon.`);
  }, [ref, part]);
}

export { Root, Button, Separator };

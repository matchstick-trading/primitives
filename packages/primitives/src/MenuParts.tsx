import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MutableRefObject, type ReactNode } from 'react';
import { buttonFace, type NameProps } from './accessible-name.js';
import { useNameCheck, useToolbarContext, useToolbarItem } from './ToolbarParts.js';

/**
 * Menu and Submenu as parts. A Trigger button opens a List (role="menu") of Items; a Submenu is an item that opens
 * another List. Headless: parts add `data-part`, `data-mt` and `data-state` (open or closed); the host gives them looks.
 *
 * Everything works by tap or click: nothing opens on hover. From the keyboard: Enter, Space or ArrowDown on the trigger
 * opens it (ArrowUp opens on the last item); inside, ArrowUp and ArrowDown move (wrapping), Home and End jump, typing
 * letters jumps to the item that starts with them, Enter or Space picks, Escape closes and puts focus back on the trigger,
 * Tab closes and moves on. ArrowRight on a submenu trigger opens it and ArrowLeft inside it closes it. A click or tap
 * outside closes. Picking an item closes the whole menu and returns focus to its trigger.
 */

interface MenuContext {
  open: boolean;
  /** Open and focus the first or last item, or close. */
  show: (focus: 'first' | 'last') => void;
  hide: (returnFocus: boolean) => void;
  /** Close this menu and every menu above it. */
  hideAll: (returnFocus: boolean) => void;
  triggerId: string;
  listId: string;
  triggerRef: MutableRefObject<HTMLButtonElement | null>;
  focusOnOpen: MutableRefObject<'first' | 'last'>;
  submenu: boolean;
}
const Context = createContext<MenuContext | null>(null);

function useMenu(part: string): MenuContext {
  const context = useContext(Context);
  if (!context) throw new Error(`${part} needs a Menu.Root (or Submenu.Root) above it.`);
  return context;
}

export interface MenuRootProps {
  className?: string;
  /** Controlled open state. Without it the menu keeps its own. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
}

function useMenuState(parent: MenuContext | null, { open, onOpenChange }: Pick<MenuRootProps, 'open' | 'onOpenChange'>) {
  const [inner, setInner] = useState(false);
  const isOpen = open !== undefined ? open : inner;
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const focusOnOpen = useRef<'first' | 'last'>('first');
  const triggerId = useId();
  const listId = useId();
  const set = useCallback((next: boolean) => {
    if (open === undefined) setInner(next);
    onOpenChange?.(next);
  }, [open, onOpenChange]);
  const show = useCallback((focus: 'first' | 'last') => { focusOnOpen.current = focus; set(true); }, [set]);
  const hide = useCallback((returnFocus: boolean) => {
    set(false);
    if (returnFocus) triggerRef.current?.focus();
  }, [set]);
  const hideAll = useCallback((returnFocus: boolean) => {
    if (parent) parent.hideAll(returnFocus);
    else hide(returnFocus);
  }, [parent, hide]);
  return useMemo<MenuContext>(() => ({ open: isOpen, show, hide, hideAll, triggerId, listId, triggerRef, focusOnOpen, submenu: parent !== null }), [isOpen, show, hide, hideAll, triggerId, listId, parent]);
}

/** Holds the open state and the wrapper element the List is placed against. */
function Root({ className, open, onOpenChange, children }: MenuRootProps) {
  const context = useMenuState(null, { open, onOpenChange });
  const element = useRef<HTMLDivElement | null>(null);
  // A press outside the menu, anywhere in the page, closes it.
  useEffect(() => {
    if (!context.open) return;
    const onDown = (event: PointerEvent) => { if (!element.current?.contains(event.target as Node)) context.hide(false); };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [context]);
  return (
    <Context.Provider value={context}>
      <div
        ref={element}
        className={className}
        data-mt=""
        data-part="menu"
        data-state={context.open ? 'open' : 'closed'}
        // Focus leaving for another control (Tab, or a script) closes the menu; a null target is the window losing focus.
        onBlur={(event) => { if (context.open && event.relatedTarget && !element.current?.contains(event.relatedTarget as Node)) context.hide(false); }}
      >
        {children}
      </div>
    </Context.Provider>
  );
}

export interface MenuTriggerProps extends NameProps {
  className?: string;
  children?: ReactNode;
}

/** The button that opens the menu: `aria-haspopup="menu"` and `aria-expanded`. Inside a Toolbar it is one of its items. */
function Trigger({ className, icon, label, hideLabel, children }: MenuTriggerProps) {
  const menu = useMenu('Menu.Trigger');
  const toolbar = useToolbarContext();
  const item = useToolbarItem(menu.triggerRef);
  const face = buttonFace(undefined, { icon, label, hideLabel, children });
  useNameCheck(menu.triggerRef, 'Menu.Trigger');
  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    // In a vertical toolbar Up and Down move between items, so the menu opens to the side instead.
    const vertical = toolbar?.orientation === 'vertical';
    const open = vertical ? event.key === 'ArrowRight' : event.key === 'ArrowDown';
    if (!open && !(!vertical && event.key === 'ArrowUp')) return;
    event.preventDefault();
    event.stopPropagation();
    menu.show(event.key === 'ArrowUp' ? 'last' : 'first');
  };
  return (
    <button
      ref={menu.triggerRef}
      id={menu.triggerId}
      type="button"
      className={className}
      data-mt=""
      data-part="menu-trigger"
      data-touch-target=""
      data-state={menu.open ? 'open' : 'closed'}
      aria-haspopup="menu"
      aria-expanded={menu.open}
      aria-controls={menu.open ? menu.listId : undefined}
      aria-label={face['aria-label']}
      tabIndex={item.tabIndex}
      onFocus={item.onFocus}
      onKeyDown={onKeyDown}
      onClick={() => (menu.open ? menu.hide(false) : menu.show('first'))}
    >
      {face.content}
    </button>
  );
}

/** The items of a list: its own menuitems, not those of a submenu inside it. Disabled ones are skipped. */
function itemsOf(list: HTMLElement): HTMLButtonElement[] {
  return [...list.querySelectorAll<HTMLButtonElement>("[role='menuitem'], [role='menuitemradio']")].filter((el) => el.closest("[role='menu']") === list && !el.disabled);
}

export interface MenuListProps {
  className?: string;
  /** Names the list. Default: the trigger's name. */
  'aria-label'?: string;
  children?: ReactNode;
}

/** The open list, role="menu". It is not in the page while closed. */
function List({ className, 'aria-label': label, children }: MenuListProps) {
  const menu = useMenu('Menu.List');
  const ref = useRef<HTMLDivElement | null>(null);
  const typed = useRef({ text: '', timer: 0 });
  // Opening puts focus on an item. Arrow keys, a tap and Enter all arrive here.
  useEffect(() => {
    if (!menu.open) return;
    const items = itemsOf(ref.current!);
    (menu.focusOnOpen.current === 'last' ? items[items.length - 1] : items[0])?.focus();
  }, [menu.open, menu.focusOnOpen]);
  useEffect(() => () => window.clearTimeout(typed.current.timer), []);
  if (!menu.open) return null;
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const list = ref.current;
    // Keys from inside a submenu are handled by that submenu's list.
    if (!list || (event.target as HTMLElement).closest("[role='menu']") !== list) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const items = itemsOf(list);
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const go = (index: number) => { event.preventDefault(); event.stopPropagation(); items[index]?.focus(); };
    switch (event.key) {
      case 'ArrowDown': return go(items.length === 0 ? 0 : (at + 1) % items.length);
      case 'ArrowUp': return go(items.length === 0 ? 0 : (at - 1 + items.length) % items.length);
      case 'Home': return go(0);
      case 'End': return go(items.length - 1);
      case 'Escape':
        event.preventDefault();
        event.stopPropagation(); // the toolbar or page behind must not also react
        return menu.hide(true);
      case 'ArrowLeft': case 'ArrowRight': {
        // A submenu closes with the arrow that points back toward its parent: Left in left-to-right text, Right in right-to-left.
        const closing = getComputedStyle(list).direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
        if (!menu.submenu || event.key !== closing) return;
        event.preventDefault();
        event.stopPropagation();
        return menu.hide(true);
      }
      case 'Tab':
        return menu.hideAll(true); // focus goes back to the trigger first, so Tab then moves on from there
      default:
    }
    // Typeahead: letters build a prefix (reset after a short pause); one letter repeated steps through items that share it.
    if (event.key.length === 1 && event.key !== ' ') {
      event.preventDefault();
      window.clearTimeout(typed.current.timer);
      typed.current.text += event.key.toLowerCase();
      typed.current.timer = window.setTimeout(() => { typed.current.text = ''; }, 600);
      const word = typed.current.text;
      const name = (el: HTMLElement) => {
        const label = el.getAttribute('aria-label');
        if (label !== null) return label.trim().toLowerCase();
        const copy = el.cloneNode(true) as HTMLElement; // an icon is aria-hidden: its text is not the item's name
        copy.querySelectorAll('[aria-hidden="true"]').forEach((hidden) => hidden.remove());
        return (copy.textContent ?? '').trim().toLowerCase();
      };
      const repeated = word.length > 1 && [...word].every((c) => c === word[0]);
      const prefix = repeated ? word[0] : word;
      const order = [...items.slice(at + 1), ...items.slice(0, at + 1)];
      (order.find((el) => name(el).startsWith(prefix)) ?? order.find((el) => name(el).startsWith(word)))?.focus();
    }
  };
  return (
    <div
      ref={ref}
      id={menu.listId}
      className={className}
      data-mt=""
      data-part={menu.submenu ? 'submenu-list' : 'menu-list'}
      role="menu"
      aria-labelledby={label ? undefined : menu.triggerId}
      aria-label={label}
      aria-orientation="vertical"
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
}

export interface MenuItemProps extends NameProps {
  className?: string;
  disabled?: boolean;
  /** Runs when the item is picked, by click, tap, Enter or Space. */
  onSelect?: () => void;
  /** Keep the menu open after picking. Default: picking closes the whole menu. */
  keepOpen?: boolean;
  children?: ReactNode;
}

/** One choice. A menuitem button; the roving focus is handled by the list, so it is not a tab stop. */
function Item({ className, disabled, onSelect, keepOpen, icon, label, hideLabel, children }: MenuItemProps) {
  const menu = useMenu('Menu.Item');
  const ref = useRef<HTMLButtonElement | null>(null);
  const face = buttonFace(undefined, { icon, label, hideLabel, children });
  useNameCheck(ref, 'Menu.Item');
  return (
    <button
      ref={ref}
      type="button"
      className={className}
      data-mt=""
      data-part="menu-item"
      data-touch-target=""
      role="menuitem"
      tabIndex={-1}
      disabled={disabled}
      aria-label={face['aria-label']}
      onClick={() => { onSelect?.(); if (!keepOpen) menu.hideAll(true); }}
    >
      {face.content}
    </button>
  );
}

export interface MenuRadioItemProps extends MenuItemProps {
  /** Whether this is the chosen one of its group. */
  checked: boolean;
}

/** A choice among several: `aria-checked` says which is on. Picking it runs onSelect and closes the menu. */
function RadioItem({ className, checked, disabled, onSelect, keepOpen, icon, label, hideLabel, children }: MenuRadioItemProps) {
  const menu = useMenu('Menu.RadioItem');
  const ref = useRef<HTMLButtonElement | null>(null);
  const face = buttonFace(undefined, { icon, label, hideLabel, children });
  useNameCheck(ref, 'Menu.RadioItem');
  return (
    <button
      ref={ref}
      type="button"
      className={className}
      data-mt=""
      data-part="menu-radio-item"
      data-touch-target=""
      role="menuitemradio"
      aria-checked={checked}
      tabIndex={-1}
      disabled={disabled}
      aria-label={face['aria-label']}
      onClick={() => { onSelect?.(); if (!keepOpen) menu.hideAll(true); }}
    >
      {face.content}
    </button>
  );
}

/** A thin divider between groups of items. */
function Separator({ className }: { className?: string }) {
  return <div className={className} data-mt="" data-part="menu-separator" role="separator" />;
}

/** A menu inside a menu: put Submenu.Trigger and Submenu.List inside it, among the items of the parent List. */
function SubmenuRoot({ className, open, onOpenChange, children }: MenuRootProps) {
  const parent = useMenu('Submenu.Root');
  const context = useMenuState(parent, { open, onOpenChange });
  const element = useRef<HTMLDivElement | null>(null);
  return (
    <Context.Provider value={context}>
      <div
        ref={element}
        className={className}
        data-mt=""
        data-part="submenu"
        data-state={context.open ? 'open' : 'closed'}
        // Focus moving to a sibling item of the parent closes the submenu.
        onBlur={(event) => { if (context.open && event.relatedTarget && !element.current?.contains(event.relatedTarget as Node)) context.hide(false); }}
      >
        {children}
      </div>
    </Context.Provider>
  );
}

/** The item that opens a submenu: a menuitem with `aria-haspopup` and `aria-expanded`. ArrowRight (ArrowLeft in right-to-left text) opens it. */
function SubmenuTrigger({ className, icon, label, hideLabel, children }: MenuTriggerProps) {
  const menu = useMenu('Submenu.Trigger');
  const face = buttonFace(undefined, { icon, label, hideLabel, children });
  useNameCheck(menu.triggerRef, 'Submenu.Trigger');
  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    if (event.key !== (rtl ? 'ArrowLeft' : 'ArrowRight')) return;
    event.preventDefault();
    event.stopPropagation();
    menu.show('first');
  };
  return (
    <button
      ref={menu.triggerRef}
      id={menu.triggerId}
      type="button"
      className={className}
      data-mt=""
      data-part="submenu-trigger"
      data-touch-target=""
      data-state={menu.open ? 'open' : 'closed'}
      role="menuitem"
      aria-haspopup="menu"
      aria-expanded={menu.open}
      aria-controls={menu.open ? menu.listId : undefined}
      aria-label={face['aria-label']}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onClick={() => (menu.open ? menu.hide(false) : menu.show('first'))}
    >
      {face.content}
    </button>
  );
}

export { Root, Trigger, List, Item, RadioItem, Separator, SubmenuRoot, SubmenuTrigger };

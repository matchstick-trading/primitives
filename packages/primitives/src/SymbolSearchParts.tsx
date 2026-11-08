import { createContext, useCallback, useContext, useId, useMemo, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react';
import { buildSymbolIndex, nextSymbolIndex, resolveSymbolKey, searchSymbols, type Instrument, type SymbolMatch } from './core/symbol-search.js';

/**
 * SymbolSearch as parts: Root, Input, List, Option, Count. Headless; a combobox over a list the host
 * supplies. The host owns the instruments (and what a venue or a contract roll means); the parts own matching,
 * keys and what a screen reader hears. Typing never throws, whatever the characters.
 *
 * Keys in the input: ArrowDown/ArrowUp move through the rows (they stop at the ends), Enter picks the highlighted
 * row, Escape closes the list and a second Escape clears the text. The best match is highlighted as you type, so
 * Enter alone takes it. The count is announced politely; each row says why it matched (symbol, alias or name).
 */
interface SearchContext {
  query: string;
  setQuery: (text: string) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  rows: SymbolMatch[];
  more: boolean;
  active: number;
  setActive: (index: number) => void;
  pick: (index: number) => void;
  listId: string;
  countId: string;
  optionId: (index: number) => string;
}
const Context = createContext<SearchContext | null>(null);

function useSearch(part: string): SearchContext {
  const context = useContext(Context);
  if (!context) throw new Error(`SymbolSearch.${part} needs a SymbolSearch.Root above it.`);
  return context;
}

export interface SymbolSearchRootProps {
  instruments: readonly Instrument[];
  /** Rows shown, 1 to 200; default 20. */
  limit?: number;
  venue?: string;
  kind?: string;
  /** True when the instrument list is synthetic; sets `data-synthetic` on the root. */
  synthetic?: boolean;
  onPick?: (instrument: Instrument) => void;
  className?: string;
  children?: ReactNode;
}

function Root({ instruments, limit = 20, venue, kind, synthetic, onPick, className, children }: SymbolSearchRootProps) {
  const index = useMemo(() => buildSymbolIndex(instruments), [instruments]);
  const [query, setQueryState] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const id = useId();
  const shown = Math.min(200, Math.max(1, Math.floor(limit) || 20));
  const found = useMemo(() => searchSymbols(index, query, { limit: shown + 1, venue, kind }), [index, query, shown, venue, kind]);
  const rows = found.slice(0, shown);
  const more = found.length > shown;
  const setQuery = useCallback((text: string) => {
    setQueryState(text);
    setOpen(text.trim() !== '');
    setActive(text.trim() === '' ? -1 : 0); // the best match is highlighted, so Enter alone takes it
  }, []);
  const pick = useCallback((i: number) => {
    const row = rows[i];
    if (!row) return;
    setQueryState(row.instrument.symbol);
    setOpen(false);
    setActive(-1);
    onPick?.(row.instrument);
  }, [rows, onPick]);
  const context = useMemo<SearchContext>(() => ({
    query, setQuery, open, setOpen, rows, more, active: active >= rows.length ? rows.length - 1 : active, setActive, pick,
    listId: `${id}-list`, countId: `${id}-count`, optionId: (i) => `${id}-opt-${i}`,
  }), [query, setQuery, open, rows, more, active, pick, id]);
  return (
    <Context.Provider value={context}>
      <div className={className} data-synthetic={synthetic ? '' : undefined}>{children}</div>
    </Context.Provider>
  );
}

/** The text box. One tab stop; it owns the keys. */
function Input({ className, label = 'Search instruments', placeholder }: { className?: string; label?: string; placeholder?: string }) {
  const { query, setQuery, open, setOpen, rows, active, setActive, pick, listId, countId, optionId } = useSearch('Input');
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const action = resolveSymbolKey(event.nativeEvent, { open, hasText: query !== '' });
    if (!action) return;
    if (action === 'pick' && rows.length === 0) return;
    event.preventDefault();
    event.stopPropagation(); // these keys are not the page's transport shortcuts while the box has focus
    if (action === 'next' || action === 'previous') {
      if (!open && query.trim() !== '') setOpen(true);
      setActive(nextSymbolIndex(rows.length, active, action));
    } else if (action === 'pick') pick(Math.max(0, active));
    else if (action === 'close') setOpen(false);
    else setQuery('');
  };
  return (
    <input
      className={className}
      type="text"
      role="combobox"
      aria-label={label}
      aria-autocomplete="list"
      aria-expanded={open && rows.length > 0}
      aria-controls={listId}
      aria-describedby={countId}
      aria-activedescendant={open && active >= 0 && active < rows.length ? optionId(active) : undefined}
      autoComplete="off"
      autoCapitalize="characters"
      spellCheck={false}
      placeholder={placeholder}
      value={query}
      onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
      onBlur={() => setOpen(false)}
      onKeyDown={onKeyDown}
    />
  );
}

/** The result list, given the rows to draw. Hidden while closed or empty. */
function List({ className, children }: { className?: string; children: (rows: SymbolMatch[]) => ReactNode }) {
  const { rows, open, listId } = useSearch('List');
  return (
    <ul id={listId} className={className} role="listbox" aria-label="Matching instruments" hidden={!open || rows.length === 0}>
      {open ? children(rows) : null}
    </ul>
  );
}

/** One row. `data-matched` says why it is here; `data-venue` keeps the same symbol on two venues apart. */
function Option({ row, index, className, children }: { row: SymbolMatch; index: number; className?: string; children?: ReactNode }) {
  const { active, pick, optionId } = useSearch('Option');
  const { instrument } = row;
  return (
    <li
      id={optionId(index)}
      className={className}
      role="option"
      aria-selected={index === active}
      data-matched={row.matchedOn}
      data-venue={instrument.venue}
      onMouseDown={(event) => event.preventDefault()} // keep focus in the box
      onClick={() => pick(index)}
    >
      {children ?? (
        <>
          <span data-mt-numeric="">{instrument.symbol}</span> <span>{instrument.venue}</span>
          {instrument.name && <> <span>{instrument.name}</span></>}
          {row.matchedOn !== 'symbol' && <> <span>(matched {row.matchedOn})</span></>}
        </>
      )}
    </li>
  );
}

/** The count, announced politely: "3 results", "No instrument matches". Nothing while the box is empty. */
function Count({ className }: { className?: string }) {
  const { query, rows, more, countId } = useSearch('Count');
  const text = query.trim() === '' ? ''
    : rows.length === 0 ? `No instrument matches “${query.trim()}”.`
      : `${rows.length}${more ? '+' : ''} ${rows.length === 1 && !more ? 'result' : 'results'}${more ? ', first rows shown' : ''}.`;
  return <output id={countId} className={className} aria-live="polite">{text}</output>;
}

export { Root, Input, List, Option, Count };

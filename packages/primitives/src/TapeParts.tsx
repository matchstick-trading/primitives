import { createContext, useContext, useEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';
import { TAPE_SIDE_LABEL, holdTape, newestFirst, nextTapeIndex, readTape, resolveTapeKey, tapeSummary, type TapeIssue, type TapeRow, type TapeTrade } from './core/tape.js';

/**
 * Tape as parts: Root, Table, Header, Row, Time, Price, Size, Side, Summary, Status. Headless: the parts are real
 * table elements and add `data-tape-side` (buy in the bid colour with ▲, sell in the ask colour with ▼) and `data-paused`; the host
 * chooses the columns.
 *
 * Newest first. While the pointer or focus is on the tape the rows hold their place and new trades are counted, not
 * inserted, so a row never moves under a finger. Keys: arrows move between rows, Home is the newest row and End the
 * oldest, Enter or Space picks the row. The Summary part is one polite line on a timer, never one announcement per
 * trade. A row that breaks a rule is listed by Status and is not drawn.
 */
interface TapeContext {
  issues: TapeIssue[];
  paused: boolean;
  waiting: number;
  summary: string;
  activeId: string | null;
  firstId: string | null;
  setActive: (id: string) => void;
}
const Context = createContext<TapeContext | null>(null);

function useTape(part: string): TapeContext {
  const context = useContext(Context);
  if (!context) throw new Error(`Tape.${part} needs a Tape.Root above it.`);
  return context;
}

export interface TapeRootProps {
  /** The trades, oldest first. Anything that breaks a rule is reported by `Tape.Status` and left out. */
  trades: readonly TapeTrade[];
  /** How many of the newest rows to show. Default 50. */
  limit?: number;
  /** How often the summary line may change, in milliseconds. Default 5000. */
  summaryEveryMs?: number;
  /** Enter or Space on a focused row. */
  onSelect?: (row: TapeRow) => void;
  className?: string;
  /** The parts, given the rows to show (newest first, held while the pointer or focus is on the tape). */
  children: (rows: TapeRow[]) => ReactNode;
}

function Root({ trades, limit = 50, summaryEveryMs = 5000, onSelect, className, children }: TapeRootProps) {
  const read = useMemo(() => readTape(trades), [trades]);
  const [pointer, setPointer] = useState(false);
  const [focus, setFocus] = useState(false);
  const [held, setHeld] = useState<string[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  const live = useMemo(() => newestFirst(read.rows).slice(0, Math.max(0, limit)), [read.rows, limit]);
  const paused = pointer || focus;
  const holding = paused && held ? holdTape(held, read.rows) : null;
  const shown = holding ? holding.rows : live;
  const waiting = holding ? holding.waiting : 0;
  const summary = useMemo(() => tapeSummary(read.rows), [read.rows]);
  const firstId = shown.length ? shown[0].id : null;
  // If the row last focused has left the shown rows, the tab stop goes back to the newest row.
  const stopId = activeId !== null && shown.some((r) => r.id === activeId) ? activeId : null;

  const freeze = () => setHeld((current) => current ?? live.map((r) => r.id));
  const release = (next: boolean) => { if (!next) setHeld(null); };

  const focusRow = (id: string) => {
    setActiveId(id);
    for (const tr of root.current?.querySelectorAll<HTMLElement>('tr[data-tape-row]') ?? []) {
      if (tr.dataset.tapeRow === id) { tr.focus(); return; }
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const action = resolveTapeKey(event.nativeEvent);
    if (!action) return;
    const onRow = (event.target as HTMLElement).closest('tr[data-tape-row]') as HTMLElement | null;
    if (!onRow) return;
    if (action.type === 'select') {
      if (event.target !== onRow) return; // a control inside the row keeps its own Enter and Space
      const row = shown.find((r) => r.id === onRow.dataset.tapeRow);
      if (!row || !onSelect) return;
      event.preventDefault();
      onSelect(row);
      return;
    }
    event.preventDefault();
    event.stopPropagation(); // these keys are also page shortcuts
    const index = shown.findIndex((r) => r.id === onRow.dataset.tapeRow);
    const to = nextTapeIndex(shown.length, index, action.to);
    if (to >= 0) focusRow(shown[to].id);
  };

  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setFocus(false);
    release(pointer);
  };

  // A focused row that the host's window drops leaves the page without a blur event, so let go of the hold here.
  useEffect(() => {
    if (focus && root.current && !root.current.contains(document.activeElement)) {
      setFocus(false);
      if (!pointer) setHeld(null);
    }
  }, [shown, focus, pointer]);

  // The summary changes on a timer, and not at all while someone is reading rows.
  const latest = useRef(summary);
  latest.current = summary;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const [announced, setAnnounced] = useState(summary);
  useEffect(() => {
    const id = setInterval(() => { if (!pausedRef.current) setAnnounced(latest.current); }, Math.max(1000, summaryEveryMs));
    return () => clearInterval(id);
  }, [summaryEveryMs]);

  const context = useMemo<TapeContext>(
    () => ({ issues: read.issues, paused, waiting, summary: announced, activeId: stopId, firstId, setActive: setActiveId }),
    [read.issues, paused, waiting, announced, stopId, firstId],
  );
  return (
    <Context.Provider value={context}>
      <div
        ref={root}
        className={className}
        data-mt=""
        data-paused={paused ? '' : undefined}
        onPointerEnter={() => { setPointer(true); freeze(); }}
        onPointerLeave={() => { setPointer(false); release(focus); }}
        onFocus={() => { setFocus(true); freeze(); }}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
      >
        {children(shown)}
      </div>
    </Context.Provider>
  );
}

/** The table. Give it a caption through `caption`; the rows go inside `tbody`. */
function Table({ caption, className, captionClassName, children }: { caption: string; className?: string; captionClassName?: string; children: ReactNode }) {
  return (
    <table className={className}>
      <caption className={captionClassName}>{caption}</caption>
      {children}
    </table>
  );
}

/** The header row. Put the `<th scope="col">` cells inside. */
function Header({ className, children }: { className?: string; children: ReactNode }) {
  return <thead><tr className={className}>{children}</tr></thead>;
}

/** One trade. A single tab stop for the tape: the active row, or the newest. Holding the pointer does not move it. */
function Row({ row, selected, className, children }: { row: TapeRow; selected?: boolean; className?: string; children: ReactNode }) {
  const { activeId, firstId, setActive } = useTape('Row');
  const stop = activeId === null ? row.id === firstId : row.id === activeId;
  return (
    <tr
      className={className}
      data-tape-row={row.id}
      aria-selected={selected === undefined ? undefined : selected}
      tabIndex={stop ? 0 : -1}
      onFocus={() => setActive(row.id)}
    >
      {children}
    </tr>
  );
}

/** The time as recorded, UTC. */
function Time({ row, className }: { row: TapeRow; className?: string }) {
  return <th scope="row" className={className} data-mt-numeric=""><time dateTime={row.t}>{row.time}</time></th>;
}

function Price({ row, className }: { row: TapeRow; className?: string }) {
  return <td className={className} data-mt-numeric="">{row.price}</td>;
}

function Size({ row, className }: { row: TapeRow; className?: string }) {
  return <td className={className} data-mt-numeric="">{row.size}</td>;
}

/** The side in words; tokens.css adds the mark so it never rests on colour alone. An unknown side has no colour. */
function Side({ row, className, label }: { row: TapeRow; className?: string; label?: string }) {
  return <td className={className} data-mt="" data-tape-side={row.side === 'unknown' ? undefined : row.side} title={row.side === 'unknown' ? 'The feed did not say which side was the aggressor' : undefined}>{label ?? TAPE_SIDE_LABEL[row.side]}</td>;
}

/** The polite live line: a summary of the tape on a timer. Render it once, outside the table. */
function Summary({ className }: { className?: string }) {
  const { summary } = useTape('Summary');
  return <p className={className} role="status" aria-live="polite" aria-atomic="true">{summary}</p>;
}

/** What the tape is doing that the rows do not say: paused with N new waiting, and rows left out for breaking a rule. */
function Status({ className, children }: { className?: string; children?: (state: { paused: boolean; waiting: number; issues: TapeIssue[] }) => ReactNode }) {
  const { paused, waiting, issues } = useTape('Status');
  if (children) return <div className={className}>{children({ paused, waiting, issues })}</div>;
  const parts: string[] = [];
  if (paused) parts.push(waiting > 0 ? `Paused. ${waiting} new ${waiting === 1 ? 'trade' : 'trades'} waiting.` : 'Paused while you read.');
  if (issues.length) parts.push(`${issues.length} ${issues.length === 1 ? 'row' : 'rows'} left out: ${issues.slice(0, 3).map((i) => `row ${i.index + 1}, ${i.message}`).join('; ')}${issues.length > 3 ? '; …' : ''}.`);
  if (!parts.length) return null;
  return <p className={className} data-paused={paused ? '' : undefined}>{parts.join(' ')}</p>;
}

export { Root, Table, Header, Row, Time, Price, Size, Side, Summary, Status };

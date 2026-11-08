import { createContext, useCallback, useContext, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { primitiveAttributes } from './attributes.js';
import { DIFF_CHANGE_LABEL, diffRowId, holdDiffOrder, nextDiffIndex, nextDiffSort, resolveDiffKey, signedDelta, sortDiffRows, type DiffChange, type DiffSort, type DiffTableRow } from './core/diff-table.js';

/**
 * DiffTable as parts: Root, Header, Row, Price, QtyA, QtyB, Delta, ChangeMark. Headless: the parts
 * are real table elements and add `data-side`, `data-diff` and `data-sorted`; the host chooses the columns.
 *
 * Rows hold their order while the pointer is over the table. Keys: arrows, Home and End move between rows, Enter or
 * Space picks the row, `a` and `b` ask the host to focus the A or B cursor control (the pair itself stays with the
 * host's Cursor), `s` cycles the sort. Values are exact decimal strings and are printed as given.
 */
interface DiffContext {
  activeId: string | null;
  firstId: string | null;
  setActive: (id: string) => void;
}
const Context = createContext<DiffContext | null>(null);

function useDiff(part: string): DiffContext {
  const context = useContext(Context);
  if (!context) throw new Error(`DiffTable.${part} needs a DiffTable.Root above it.`);
  return context;
}

export interface DiffTableRootProps {
  rows: readonly DiffTableRow[];
  /** Controlled sort; leave out for an uncontrolled table that starts as `book`. */
  sort?: DiffSort;
  onSortChange?: (sort: DiffSort) => void;
  /** Enter or Space on a focused row. */
  onSelect?: (row: DiffTableRow) => void;
  /** The `a` or `b` key: focus that cursor control. */
  onFocusCursor?: (which: 'a' | 'b') => void;
  className?: string;
  caption?: string;
  captionClassName?: string;
  /** The parts, given the rows in the order to show them (sorted, and held while the pointer is over the table). */
  children: (rows: DiffTableRow[]) => ReactNode;
}

function Root({ rows, sort, onSortChange, onSelect, onFocusCursor, className, caption, captionClassName, children }: DiffTableRootProps) {
  const [innerSort, setInnerSort] = useState<DiffSort>('book');
  const controlled = sort !== undefined;
  const current = controlled ? sort : innerSort;
  const [held, setHeld] = useState<string[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const table = useRef<HTMLTableElement>(null);

  const sorted = useMemo(() => sortDiffRows(rows, current), [rows, current]);
  const shown = useMemo(() => (held ? holdDiffOrder(held, sorted) : sorted), [held, sorted]);
  const firstId = shown.length ? diffRowId(shown[0]) : null;

  const changeSort = useCallback(() => {
    const next = nextDiffSort(current);
    if (!controlled) setInnerSort(next);
    setHeld(null); // asking for a new order is the one time the rows may move under the pointer
    onSortChange?.(next);
  }, [current, controlled, onSortChange]);

  const focusRow = (id: string) => {
    setActiveId(id);
    for (const tr of table.current?.querySelectorAll<HTMLElement>('tbody tr[data-diff-row]') ?? []) {
      if (tr.dataset.diffRow === id) { tr.focus(); return; }
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    const action = resolveDiffKey(event.nativeEvent);
    if (!action) return;
    const onRow = (event.target as HTMLElement).closest('tr[data-diff-row]') as HTMLElement | null;
    if (action.type === 'select') {
      if (event.target !== onRow || !onRow) return; // Enter and Space on the pick button are the button's own
      const row = shown.find((r) => diffRowId(r) === onRow.dataset.diffRow);
      if (!row || !onSelect) return;
      event.preventDefault();
      onSelect(row);
      return;
    }
    if (action.type === 'move' && !onRow) return;
    event.preventDefault();
    event.stopPropagation(); // these letters and arrows are also page shortcuts
    if (action.type === 'move') {
      const index = shown.findIndex((r) => diffRowId(r) === onRow?.dataset.diffRow);
      const to = nextDiffIndex(shown.length, index, action.to);
      if (to >= 0) focusRow(diffRowId(shown[to]));
    } else if (action.type === 'cursor') onFocusCursor?.(action.which);
    else changeSort();
  };

  const context = useMemo<DiffContext>(() => ({ activeId, firstId, setActive: setActiveId }), [activeId, firstId]);
  return (
    <Context.Provider value={context}>
      <table
        ref={table}
        className={className}
        data-mt=""
        data-sorted={current}
        onPointerEnter={() => setHeld(sorted.map(diffRowId))}
        onPointerLeave={() => setHeld(null)}
        onKeyDown={onKeyDown}
      >
        {caption && <caption className={captionClassName}>{caption}</caption>}
        {children(shown)}
      </table>
    </Context.Provider>
  );
}

/** The header row. Put the `<th scope="col">` cells inside. */
function Header({ className, children }: { className?: string; children: ReactNode }) {
  return <thead><tr className={className}>{children}</tr></thead>;
}

/** One level. A single tab stop for the table: the active row, or the first. The pointer does not move it. */
function Row({ row, selected, className, children }: { row: DiffTableRow; selected?: boolean; className?: string; children: ReactNode }) {
  const { activeId, firstId, setActive } = useDiff('Row');
  const id = diffRowId(row);
  const stop = activeId === null ? id === firstId : id === activeId;
  const { 'data-mt': _scope, ...state } = primitiveAttributes({ side: row.side });
  return (
    <tr
      className={className}
      {...state}
      data-diff={row.change === 'unchanged' ? undefined : row.change}
      data-diff-row={id}
      aria-selected={selected === undefined ? undefined : selected}
      tabIndex={stop ? 0 : -1}
      onFocus={() => setActive(id)}
    >
      {children}
    </tr>
  );
}

/** The row header cell: the price as recorded. Pass children to put a control inside. */
function Price({ row, className, children }: { row: DiffTableRow; className?: string; children?: ReactNode }) {
  return <th scope="row" className={className} data-mt-numeric="">{children ?? row.price}</th>;
}

function QtyA({ row, className }: { row: DiffTableRow; className?: string }) {
  return <td className={className} data-mt-numeric="">{row.qtyA}</td>;
}

function QtyB({ row, className }: { row: DiffTableRow; className?: string }) {
  return <td className={className} data-mt-numeric="">{row.qtyB}</td>;
}

/** qtyB minus qtyA with its sign shown. */
function Delta({ row, className }: { row: DiffTableRow; className?: string }) {
  return <td className={className} data-mt-numeric="">{signedDelta(row.delta)}</td>;
}

/** The change in words; tokens.css adds the mark (+, −, ±) so it never rests on colour alone. */
function ChangeMark({ change, className, label }: { change: DiffChange; className?: string; label?: string }) {
  const attributes = primitiveAttributes(change === 'unchanged' ? {} : { diff: change });
  return <span className={className} {...attributes}>{label ?? DIFF_CHANGE_LABEL[change]}</span>;
}

export { Root, Header, Row, Price, QtyA, QtyB, Delta, ChangeMark };

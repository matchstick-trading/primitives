/**
 * The rules of the diff table as plain functions. Prices, sizes and deltas arrive and stay exact
 * decimal strings; they are only compared, never turned into numbers.
 */

export type DiffChange = 'added' | 'removed' | 'modified' | 'unchanged';
export type DiffSort = 'book' | 'delta' | 'price';

export interface DiffTableRow {
  side: 'bid' | 'ask';
  /** Exact decimal string, as recorded. */
  price: string;
  qtyA: string;
  qtyB: string;
  /** Signed exact decimal string: qtyB minus qtyA. */
  delta: string;
  change: DiffChange;
}

/** The id of a row, the same `side:price` the ladder rows and the depth levels use. */
export const diffRowId = (row: Pick<DiffTableRow, 'side' | 'price'>): string => `${row.side}:${row.price}`;

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

function scaled(value: string, places: number): bigint {
  const match = DECIMAL.exec(value);
  if (!match) throw new Error(`Not an exact decimal: ${value}`);
  const [, sign, whole, fraction = ''] = match;
  const magnitude = BigInt(whole + fraction.padEnd(places, '0'));
  return sign ? -magnitude : magnitude;
}

/** Orders two exact decimal strings, signed or not, without a float in between. */
export function compareExact(left: string, right: string): number {
  const places = Math.max(left.split('.')[1]?.length ?? 0, right.split('.')[1]?.length ?? 0);
  const a = scaled(left, places);
  const b = scaled(right, places);
  return a < b ? -1 : a > b ? 1 : 0;
}

const magnitude = (value: string): string => (value.startsWith('-') ? value.slice(1) : value);

/** The next sort in the cycle: as the book gives them, largest change first, highest price first. */
export const nextDiffSort = (sort: DiffSort): DiffSort => (sort === 'book' ? 'delta' : sort === 'delta' ? 'price' : 'book');

/** A stable sort: rows that compare equal keep the order they came in. */
export function sortDiffRows(rows: readonly DiffTableRow[], sort: DiffSort): DiffTableRow[] {
  if (sort === 'book') return [...rows];
  const compare = sort === 'delta'
    ? (a: DiffTableRow, b: DiffTableRow) => compareExact(magnitude(b.delta), magnitude(a.delta))
    : (a: DiffTableRow, b: DiffTableRow) => compareExact(b.price, a.price);
  return rows.map((row, index) => ({ row, index })).sort((a, b) => compare(a.row, b.row) || a.index - b.index).map((e) => e.row);
}

/**
 * Rows hold their order while the pointer is over the table (a row that moves under the pointer is a row clicked by
 * mistake). Rows already shown keep their place and take their new values; rows that are new join at the end; rows
 * that are gone leave.
 */
export function holdDiffOrder(held: readonly string[], next: readonly DiffTableRow[]): DiffTableRow[] {
  const byId = new Map(next.map((row) => [diffRowId(row), row]));
  const kept = held.flatMap((id) => { const row = byId.get(id); return row ? [row] : []; });
  const known = new Set(held);
  return kept.concat(next.filter((row) => !known.has(diffRowId(row))));
}

export type DiffMove = 'next' | 'prev' | 'first' | 'last';
export type DiffKeyAction =
  | { type: 'move'; to: DiffMove }
  | { type: 'cursor'; which: 'a' | 'b' }
  | { type: 'sort' }
  | { type: 'select' };

interface KeyLike { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }

/** Arrow keys, Home and End move between rows; `a` and `b` ask for the A or B cursor control; `s` cycles the sort. */
export function resolveDiffKey(event: KeyLike): DiffKeyAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  switch (event.key) {
    case 'ArrowDown': return { type: 'move', to: 'next' };
    case 'ArrowUp': return { type: 'move', to: 'prev' };
    case 'Home': return { type: 'move', to: 'first' };
    case 'End': return { type: 'move', to: 'last' };
    case 'a': return { type: 'cursor', which: 'a' };
    case 'b': return { type: 'cursor', which: 'b' };
    case 's': return { type: 'sort' };
    case 'Enter':
    case ' ': return { type: 'select' };
    default: return null;
  }
}

/** The row index a move lands on; the ends stop (no wrap). With no current row, next and first land on 0. */
export function nextDiffIndex(count: number, current: number, to: DiffMove): number {
  if (count === 0) return -1;
  if (to === 'first') return 0;
  if (to === 'last') return count - 1;
  if (current < 0) return to === 'next' ? 0 : count - 1;
  return Math.min(count - 1, Math.max(0, current + (to === 'next' ? 1 : -1)));
}

/** A delta with its sign shown: `+5`, `−3` (a true minus), `0`. */
export const signedDelta = (delta: string): string => (delta.startsWith('-') || delta === '0' ? delta.replace('-', '−') : `+${delta}`);

export const DIFF_CHANGE_LABEL: Record<DiffChange, string> = { added: 'Added', removed: 'Removed', modified: 'Changed', unchanged: 'Same' };

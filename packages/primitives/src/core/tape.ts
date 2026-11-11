/**
 * The rules of the trade tape as plain functions. A trade is a time, a price, a size and a side. Price and size arrive and
 * stay exact decimal strings and are printed as given; time is an ISO-8601 UTC instant. A row that breaks a rule is
 * reported with its place in the input and is never drawn. Nothing here repairs a row, reads a clock or touches a page.
 */

export type TapeSide = 'buy' | 'sell' | 'unknown';

/** One trade as the host records it. `side` is the aggressor when the feed says so; `unknown` when it does not. */
export interface TapeTrade {
  /** A stable id from the feed, such as a sequence number. Leave it out and the row's place in the list is used (`#` is added if another row's id already uses that text), which changes if the host drops old rows. */
  id?: string;
  /** ISO-8601 UTC, for example `2026-01-05T14:30:05.123Z`. Rows come oldest first and never go back in time. */
  t: string;
  /** Exact decimal string, above zero. */
  price: string;
  /** Exact decimal string, above zero. */
  size: string;
  side: TapeSide;
}

/** A trade that passed the rules, with the id it keeps while the host adds rows after it. */
export interface TapeRow extends TapeTrade {
  /** The trade's `id`, or its place in the input as text (with `#` added if a given id already uses that text). */
  id: string;
  /** `14:30:05.123`: the UTC clock time, as recorded. */
  time: string;
}

export interface TapeIssue {
  /** The row's place in the input. */
  index: number;
  message: string;
}

export interface TapeRead {
  /** Valid rows, oldest first, as given. */
  rows: TapeRow[];
  issues: TapeIssue[];
}

export const TAPE_SIDE_LABEL: Record<TapeSide, string> = { buy: 'Buy', sell: 'Sell', unknown: 'Unknown' };

const ISO_UTC = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(\.\d+)?Z$/;
const POSITIVE_DECIMAL = /^\d+(?:\.\d+)?$/;

function isIsoUtc(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = ISO_UTC.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

function isPositiveDecimal(value: unknown): value is string {
  return typeof value === 'string' && POSITIVE_DECIMAL.test(value) && /[1-9]/.test(value);
}

/** Order two valid ISO-8601 UTC instants at the precision written, so fractions past milliseconds still count. */
function compareInstants(a: string, b: string): number {
  const [aMain, aFrac = ''] = a.slice(0, -1).split('.');
  const [bMain, bFrac = ''] = b.slice(0, -1).split('.');
  if (aMain !== bMain) return aMain < bMain ? -1 : 1;
  const width = Math.max(aFrac.length, bFrac.length);
  const x = aFrac.padEnd(width, '0');
  const y = bFrac.padEnd(width, '0');
  return x === y ? 0 : x < y ? -1 : 1;
}

/** The clock part of an ISO-8601 UTC instant, fraction kept as recorded: `14:30:05.123`. */
export const tapeTime = (t: string): string => t.slice(11, -1);

/**
 * Check the trades at the boundary. Every problem is returned in one pass. A row earlier than the row before it is
 * reported and left out; rows at the same instant are fine (one order can fill in several prints).
 */
export function readTape(input: unknown): TapeRead {
  const rows: TapeRow[] = [];
  const issues: TapeIssue[] = [];
  if (!Array.isArray(input)) return { rows, issues: [{ index: -1, message: 'expected a list of trades' }] };
  let last: string | null = null;
  const seen = new Set<string>();
  // Known limit: a feed that mixes id-less trades with ids equal to their list places gets a '#' on the id-less row's id
  // when the id arrives later, so a held row's id can change then. Feed ids always win; a feed should give ids to all or none.
  // Ids the feed gave: a row without one takes its place in the list as text, unless a given id already uses that text.
  const given = new Set<string>();
  for (const item of input) { const g = (item as { id?: unknown } | null)?.id; if (typeof g === 'string' && g !== '') given.add(g); }
  input.forEach((item: unknown, index) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) { issues.push({ index, message: 'expected a trade object' }); return; }
    const { id, t, price, size, side } = item as Record<string, unknown>;
    const problems: string[] = [];
    if (!isIsoUtc(t)) problems.push('t must be an ISO-8601 UTC time ending in Z');
    if (!isPositiveDecimal(price)) problems.push('price must be an exact decimal string above zero');
    if (!isPositiveDecimal(size)) problems.push('size must be an exact decimal string above zero');
    if (side !== 'buy' && side !== 'sell' && side !== 'unknown') problems.push('side must be "buy", "sell" or "unknown"');
    if (id !== undefined && (typeof id !== 'string' || id === '')) problems.push('id must be a non-empty string when given');
    if (problems.length) { issues.push({ index, message: problems.join('; ') }); return; }
    if (last !== null && compareInstants(t as string, last) < 0) { issues.push({ index, message: 'earlier than the row before it' }); return; }
    let rowId = typeof id === 'string' ? id : String(index);
    if (typeof id !== 'string') while (given.has(rowId) || seen.has(rowId)) rowId += '#';
    if (seen.has(rowId)) { issues.push({ index, message: `id "${rowId}" is already used` }); return; }
    seen.add(rowId);
    last = t as string;
    rows.push({ id: rowId, t: t as string, price: price as string, size: size as string, side: side as TapeSide, time: tapeTime(t as string) });
  });
  return { rows, issues };
}

/** Newest first, the order a tape is read in. The input is not changed. */
export const newestFirst = (rows: readonly TapeRow[]): TapeRow[] => [...rows].reverse();

/**
 * While the pointer or focus is on the tape, rows hold their place: the rows shown at that moment stay, in order, and
 * rows that arrived since are counted, not inserted. `held` is newest first, the order the tape shows. Ids that have left the host's window leave the list.
 */
export function holdTape(held: readonly string[], rows: readonly TapeRow[]): { rows: TapeRow[]; waiting: number } {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const kept = held.flatMap((id) => { const row = byId.get(id); return row ? [row] : []; });
  // Rows come oldest first, so what arrived since is whatever sits after the newest row that was held. A rolling window
  // drops the oldest rows first, so if the newest held row is gone, every row now in the window is newer.
  const newest = held.length ? rows.findIndex((row) => row.id === held[0]) : -1;
  return { rows: kept, waiting: newest >= 0 ? rows.length - 1 - newest : rows.length };
}

/**
 * One sentence for a polite live region: how many trades, how the sides split, the last print. It is a summary of the
 * rows given (oldest first), not a line per trade; the caller decides how often to refresh it.
 */
export function tapeSummary(rows: readonly TapeRow[]): string {
  if (rows.length === 0) return 'No trades yet.';
  const count = { buy: 0, sell: 0, unknown: 0 };
  for (const row of rows) count[row.side] += 1;
  const last = rows[rows.length - 1];
  const parts = [`${count.buy} buy`, `${count.sell} sell`];
  if (count.unknown) parts.push(`${count.unknown} side unknown`);
  return `${rows.length} ${rows.length === 1 ? 'trade' : 'trades'}: ${parts.join(', ')}. Last: ${last.side === 'unknown' ? 'side unknown,' : last.side} ${last.size} at ${last.price}, ${last.time} UTC.`;
}

export type TapeMove = 'next' | 'prev' | 'first' | 'last';
export type TapeKeyAction = { type: 'move'; to: TapeMove } | { type: 'select' };

interface KeyLike { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }

/** Arrow keys move between rows, Home is the newest row, End the oldest; Enter or Space picks the row. Nothing places an order. */
export function resolveTapeKey(event: KeyLike): TapeKeyAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  switch (event.key) {
    case 'ArrowDown': return { type: 'move', to: 'next' };
    case 'ArrowUp': return { type: 'move', to: 'prev' };
    case 'Home': return { type: 'move', to: 'first' };
    case 'End': return { type: 'move', to: 'last' };
    case 'Enter':
    case ' ': return { type: 'select' };
    default: return null;
  }
}

/** The row index a move lands on; the ends stop. With no current row, next and first land on 0. */
export function nextTapeIndex(count: number, current: number, to: TapeMove): number {
  if (count === 0) return -1;
  if (to === 'first') return 0;
  if (to === 'last') return count - 1;
  if (current < 0) return to === 'next' ? 0 : count - 1;
  return Math.min(count - 1, Math.max(0, current + (to === 'next' ? 1 : -1)));
}

/**
 * Reads a file of trades (time, price, size, side) into the rows the Tape and the chart's trade markers take. This is the
 * `readTradesCsv` proposed in #467, built on what `examples/csv-to-tape.mjs` did by hand: it splits the file itself,
 * keeps each row's line number in the file so a problem is named by line, and hands the rows to `readTape` for the
 * rules (an exact positive price and size, a UTC time, rows in time order). Nothing is repaired and nothing throws.
 *
 * It reads the same shapes as `parseBarsCsv`: comma, semicolon or tab delimiters, quoted cells, a decimal comma in a semicolon
 * or tab file, and a thousands comma (`4,725.50`) in a file that writes decimals with points. A price or size is kept as
 * the exact text it was written as, with only the thousands commas removed or the decimal comma turned into a point.
 * Times are read as UTC: an ISO time ending in Z is kept as written (to the last fraction digit); other forms
 * (a date and time, a Unix time) are read as UTC to the millisecond. A newest-first file is put in time order.
 */

import { pickDelimiter, readTime, splitLine, splitRecords } from './csv-bars.js';
import { readTape, type TapeRow, type TapeSide } from './tape.js';

export interface TradesCsvIssue {
  /** The 1-based line in the file. 0 for the file as a whole. */
  line: number;
  message: string;
}

export interface TradesCsvOptions {
  /** More data rows than this are refused, so a wrong file can't freeze the page. Default 500,000. */
  maxRows?: number;
}

export interface TradesCsvResult {
  /** Valid trades, oldest first. */
  rows: TapeRow[];
  issues: TradesCsvIssue[];
  /** `sorted`: the file was newest first (or out of order) and was put in time order. */
  notes: Array<'sorted'>;
}

type Column = 'time' | 'price' | 'size' | 'side';
const NAMES: Record<Column, string[]> = {
  time: ['time', 'timestamp', 'datetime', 'date time', 'ts', 'unix', 't'],
  price: ['price', 'px', 'trade price', 'fill price', 'entry price'],
  size: ['size', 'qty', 'quantity', 'amount', 'volume', 'contracts', 'lots', 'shares'],
  side: ['side', 'direction', 'action', 'type'],
};
const norm = (cell: string) => cell.replace(/^﻿/, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const SIDES: Record<string, TapeSide> = Object.assign(Object.create(null) as Record<string, TapeSide>, { buy: 'buy', b: 'buy', bought: 'buy', long: 'buy', sell: 'sell', s: 'sell', sold: 'sell', short: 'sell', unknown: 'unknown', u: 'unknown', '': 'unknown' });

const GROUPED = /^\d{1,3}(,\d{3})+(\.\d+)?$/;
const POINT_DECIMAL = /^(?:(?:\d+|\d{1,3}(?:,\d{3})+)\.\d*|\.\d+)$/; // 4725.5, 1,200.5, .25 and 10. all show the file writes points
const COMMA_DECIMAL = /^\d*,\d+$/;

/** Orders two ISO-8601 UTC instants at the precision written (a fraction past milliseconds still counts). */
function compareInstants(a: string, b: string): number {
  const [aMain, aFrac = ''] = a.slice(0, -1).split('.');
  const [bMain, bFrac = ''] = b.slice(0, -1).split('.');
  if (aMain !== bMain) return aMain! < bMain! ? -1 : 1;
  const width = Math.max(aFrac.length, bFrac.length);
  const x = aFrac.padEnd(width, '0');
  const y = bFrac.padEnd(width, '0');
  return x === y ? 0 : x < y ? -1 : 1;
}

/** An exact decimal string from a written price or size, or null when it is not a plain positive number. */
function readDecimal(cell: string, decimalComma: boolean): string | null {
  const text = decimalComma ? cell.replace(',', '.') : GROUPED.test(cell) ? cell.replace(/,/g, '') : cell;
  if (!/^(\d+\.?\d*|\.\d+)$/.test(text)) return null;
  // `.25` and `10.` are written numbers; the tape wants digits on both sides of a point, so spell them out (text only, no float).
  return text.replace(/^\./, '0.').replace(/\.$/, '');
}

export function readTradesCsv(text: string, options: TradesCsvOptions | null = {}): TradesCsvResult {
  const maxRows = options?.maxRows ?? 500_000;
  const issues: TradesCsvIssue[] = [];
  const notes: Array<'sorted'> = [];
  const fail = (message: string): TradesCsvResult => ({ rows: [], issues: [{ line: 0, message }], notes });
  if (typeof text !== 'string') return fail('The input is not text.');
  const lines = splitRecords(text);
  const firstLine = lines.findIndex((l) => l.text.trim() !== '');
  if (firstLine < 0) return fail('The file is empty.');

  const delimiter = pickDelimiter(lines[firstLine]!.text);
  const header = splitLine(lines[firstLine]!.text, delimiter).map(norm);
  const col = {} as Record<Column, number>;
  const taken = new Set<number>();
  for (const field of ['time', 'price', 'size', 'side'] as const) {
    let found = -1;
    for (const alias of NAMES[field]) {
      found = header.findIndex((h, i) => h === alias && !taken.has(i));
      if (found >= 0) break;
    }
    col[field] = found;
    if (found >= 0) taken.add(found);
  }
  const missing = (['time', 'price', 'size'] as const).filter((f) => col[f] < 0);
  if (missing.length > 0) return { rows: [], issues: [{ line: lines[firstLine]!.line, message: `No column for ${missing.join(', ')}. The header row needs time, price and size (and side).` }], notes };

  // A semicolon or tab file may write decimals with a comma; unless a price or size in it already has a decimal point.
  const records = lines.slice(firstLine + 1).filter((l) => l.text.trim() !== '');
  let decimalComma = delimiter !== ',';
  const cellsOf = records.map((r) => splitLine(r.text, delimiter));
  // Only a row that will be read (a real time and a known side) says how the file writes decimals; a row refused for those says nothing.
  const readable = (cells: string[]) => {
    const raw = cells[col.time] ?? '';
    const ms = ISO_Z.test(raw) ? Date.parse(raw.replace(/\.\d+Z$/, 'Z')) : readTime(raw);
    if (ms === null || Number.isNaN(ms) || (ISO_Z.test(raw) && new Date(ms).toISOString().slice(0, 19) !== raw.slice(0, 19))) return false;
    return col.side < 0 || (cells[col.side] ?? '').trim().toLowerCase() in SIDES;
  };
  if (decimalComma && cellsOf.some((cells) => readable(cells) && [col.price, col.size].some((c) => POINT_DECIMAL.test(cells[c] ?? '')))) decimalComma = false;
  const fileUsesComma = delimiter !== ',';

  const parsed: Array<{ line: number; trade: { t: string; price: string; size: string; side: TapeSide }; ms: number }> = [];
  records.forEach((record, i) => {
    if (i >= maxRows) { if (i === maxRows) issues.push({ line: 0, message: `The file has more than ${maxRows.toLocaleString('en-US')} rows; only the first ${maxRows.toLocaleString('en-US')} were read.` }); return; }
    const cells = cellsOf[i]!;
    const line = record.line;
    // The file writes points, so a comma that is not a thousands group (0,5) is a decimal comma: refuse it rather than read it as 5 or 05.
    if (fileUsesComma && !decimalComma && [cells[col.price], cells[col.size]].some((c) => c !== undefined && COMMA_DECIMAL.test(c) && !GROUPED.test(c))) {
      issues.push({ line, message: 'This row writes a price or size with a decimal comma, but earlier rows use decimal points. Use one convention for the whole file.' });
      return;
    }
    const rawTime = cells[col.time] ?? '';
    // An ISO time ending in Z is kept as written (checked to the second, so a fraction can't round across midnight); other forms are read to the millisecond.
    const exact = ISO_Z.test(rawTime);
    const ms = exact ? Date.parse(rawTime.replace(/\.\d+Z$/, 'Z')) : readTime(rawTime);
    const t = ms === null || Number.isNaN(ms) ? null : exact ? rawTime : new Date(ms).toISOString();
    const price = readDecimal(cells[col.price] ?? '', decimalComma);
    const size = readDecimal(cells[col.size] ?? '', decimalComma);
    const sideText = col.side >= 0 ? (cells[col.side] ?? '').trim().toLowerCase() : '';
    const side = SIDES[sideText];
    const problems: string[] = [];
    if (t === null || ms === null || Number.isNaN(ms)) problems.push('the time is not a UTC date-time or a Unix time');
    else if (exact && new Date(ms).toISOString().slice(0, 19) !== rawTime.slice(0, 19)) problems.push('the date does not exist'); // Date.parse rolls Feb 30 into March
    if (price === null) problems.push('the price is not a number');
    else if (!/[1-9]/.test(price)) problems.push('the price must be above zero');
    if (size === null) problems.push('the size is not a number');
    else if (!/[1-9]/.test(size)) problems.push('the size must be above zero');
    if (side === undefined) problems.push(`the side "${cells[col.side] ?? ''}" is not buy, sell or unknown`);
    if (problems.length > 0) { issues.push({ line, message: `${problems.join('; ').replace(/^./, (c) => c.toUpperCase())}.` }); return; }
    parsed.push({ line, trade: { t: t!, price: price!, size: size!, side: side! }, ms: ms! });
  });

  // A newest-first file is read oldest first; the rules in readTape then handle any remaining out-of-order row by line.
  if (parsed.length > 1 && compareInstants(parsed[0]!.trade.t, parsed[parsed.length - 1]!.trade.t) > 0) { parsed.reverse(); notes.push('sorted'); }

  const read = readTape(parsed.map((p) => p.trade));
  for (const issue of read.issues) issues.push({ line: issue.index >= 0 ? parsed[issue.index]!.line : 0, message: `${issue.message.replace(/^./, (c) => c.toUpperCase())}.` });
  issues.sort((a, b) => a.line - b.line);
  return { rows: read.rows, issues, notes };
}

/** One plain sentence or two about a read, for a status line. */
export function describeTradesCsv(result: TradesCsvResult, fileName = 'the file'): string {
  const { rows, issues, notes } = result;
  if (rows.length === 0) return `No trades loaded from ${fileName}. ${issues[0]?.message ?? 'No rows could be read.'}`;
  const parts = [`Loaded ${rows.length.toLocaleString('en-US')} trade${rows.length === 1 ? '' : 's'} from ${fileName}.`];
  const bad = issues.filter((i) => i.line > 0);
  if (bad.length > 0) {
    const shown = bad.slice(0, 3).map((e) => `line ${e.line}: ${e.message.replace(/\.$/, '').replace(/^\w/, (c) => c.toLowerCase())}`).join('; ');
    parts.push(`Skipped ${bad.length.toLocaleString('en-US')} row${bad.length === 1 ? '' : 's'} (${shown}${bad.length > 3 ? '; …' : ''}).`);
  }
  for (const e of issues.filter((i) => i.line === 0)) parts.push(e.message);
  if (notes.includes('sorted')) parts.push('The rows were newest first, so they were put in time order.');
  return parts.join(' ');
}

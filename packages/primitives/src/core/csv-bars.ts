/**
 * Turns a CSV file the user drops in into chart bars, so a chart can show the user's own data with no feed behind
 * it. It reads the common shapes: a header row with names in any case and order (Date, Open, High, Low, Close,
 * Adj Close, Volume, ...), separate Date and Time columns, a header-less file in time-open-high-low-close-volume
 * order, comma, semicolon or tab delimiters, and decimal commas in semicolon or tab files.
 *
 * Times are read as UTC: an ISO date or date-time (an explicit offset is honoured), or a Unix time. A Unix time is read
 * in the first unit that puts it before the year 2100: seconds, then milliseconds, then microseconds; anything later is
 * refused. So a millisecond time in the first seven weeks of 1970 would be misread as seconds. Day-first or month-first dates like 02/01/2024 are refused rather than guessed. A row that doesn't
 * make sense (a missing number, a high below the close, a repeated time) is reported by line, never fixed; the rest
 * of the file still loads. Nothing here throws.
 */

import type { CandleBar } from './chart-scale.js';

export interface CsvBarsError {
  /** The 1-based line in the file. 0 for the file as a whole. */
  line: number;
  message: string;
}

/** `sorted`: the file was newest first. `no-volume`: no volume column, so volume is 0. `no-header`: read by position. */
export type CsvBarsNote = 'sorted' | 'no-volume' | 'no-header';

/** A column besides time and the prices that holds only numbers (an indicator, a spread), read beside the bars. */
export interface CsvExtraColumn {
  /** The header text as written. */
  header: string;
  /** One entry per kept bar, in time order: a number, or `null` when the cell said nothing (empty, `-`, `NA`, `NaN`, `null`). */
  values: Array<number | null>;
}

export interface CsvBarsResult {
  bars: CandleBar[];
  errors: CsvBarsError[];
  notes: CsvBarsNote[];
  /** Only when `extraColumns` was asked for. */
  extras?: CsvExtraColumn[];
  /** Only when `extraColumns` was asked for: headers of columns left out because a cell was not a number or a "no value" word. */
  skippedColumns?: string[];
  /** How many bars had a time written without a zone (so `utcOffsetMinutes` applied to them). */
  zoneless?: number;
}

export interface CsvBarsOptions {
  /** More data rows than this are refused, so a wrong file can't freeze the page. Default 500,000. */
  maxRows?: number;
  /**
   * Minutes east of UTC for times written without a zone (a time with an explicit offset or `Z`, and a Unix time, keep
   * their own meaning). Default 0: UTC. For a file in New York winter time, pass -300. A fixed offset only; a file that
   * crosses a daylight-saving change needs the zone written on each row.
   */
  utcOffsetMinutes?: number;
  /** Also read every other all-number column as a series beside the bars. Default false. */
  extraColumns?: boolean;
}

type Field = 'time' | 'date' | 'clock' | 'open' | 'high' | 'low' | 'close' | 'volume';

const NAMES: Record<Field, string[]> = {
  time: ['timestamp', 'datetime', 'date time', 'open time', 'time', 'unix', 'ts'],
  date: ['date', 'datum', 'day'],
  clock: ['time'],
  open: ['open', 'o', 'open price'],
  high: ['high', 'h', 'max', 'high price'],
  low: ['low', 'l', 'min', 'low price'],
  close: ['close', 'c', 'last', 'close price'],
  volume: ['volume', 'vol', 'v'],
};

const normalizeName = (cell: string) => cell.replace(/^﻿/, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function splitLine(line: string, delimiter: string): string[] {
  if (!line.includes('"')) return line.split(delimiter).map((c) => c.trim());
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { cells.push(cell.trim()); cell = ''; }
    else cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

/** Splits the file into records at line breaks outside quotes, keeping each record's 1-based starting line. */
function splitRecords(text: string): Array<{ text: string; line: number }> {
  if (!text.includes('"')) return text.split(/\r\n|\n|\r/).map((t, i) => ({ text: t, line: i + 1 }));
  const records: Array<{ text: string; line: number }> = [];
  let start = 0;
  let line = 1;
  let startLine = 1;
  let quoted = false;
  for (let i = 0; i <= text.length; i++) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted; // an escaped "" flips twice
    else if (i === text.length || ((ch === '\n' || ch === '\r') && !quoted)) {
      records.push({ text: text.slice(start, i), line: startLine });
      if (ch === '\r' && text[i + 1] === '\n') i++;
      start = i + 1;
      startLine = ++line;
    } else if (ch === '\n' || (ch === '\r' && text[i + 1] !== '\n')) line++;
  }
  return records;
}

/**
 * The delimiter that splits the first row the most. A semicolon or tab wins a near tie with the comma, because in
 * those files every number can carry a decimal comma: `1704205800;1,1;2,2;0,5;1,5;10,0` has as many commas as fields.
 */
function pickDelimiter(line: string): string {
  const count = (d: string) => line.split(d).length - 1;
  const commas = count(',');
  const other = [';', '\t'].map((d) => [d, count(d)] as const).reduce((best, c) => (c[1] > best[1] ? c : best));
  return other[1] > 0 && other[1] + 1 >= commas ? other[0] : ',';
}

function readNumber(cell: string | undefined, decimalComma: boolean): number | null {
  if (cell === undefined || cell === '') return null;
  const text = decimalComma ? cell.replace(',', '.') : cell;
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null; // 1e999
}

const YEAR_2100 = Date.UTC(2100, 0, 1);

/** Unix seconds, milliseconds or microseconds: the first unit that lands before 2100 (see the file comment). */
function fromEpoch(n: number): number | null {
  for (const ms of [n * 1000, n, n / 1000]) if (ms < YEAR_2100) return Math.round(ms);
  return null;
}

const ISO = /^(\d{4})[-/]?(\d{2})[-/]?(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;
const CLOCK = /^(\d{1,2}):?(\d{2})(?::?(\d{2}))?$/;

/** A time written without a zone: no Z or offset after a clock time (a Unix time has none to give). */
function zoneless(cell: string | undefined): boolean {
  const c = (cell ?? '').trim();
  if (/^\d+(\.\d+)?$/.test(c) && c.length !== 8) return false;
  return !/[T ]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?\s*(Z|[+-]\d{2}(:?\d{2})?)$/i.test(c);
}

function readTime(cell: string | undefined, clock?: string, naiveOffsetMinutes = 0): number | null {
  if (!cell) return null;
  if (/^\d+(\.\d+)?$/.test(cell) && cell.length !== 8) return fromEpoch(Number(cell));
  const m = ISO.exec(clock ? `${cell} ${clock.replace(CLOCK, (_, h, mi, s) => `${h}:${mi}${s ? `:${s}` : ''}`)}` : cell);
  if (!m) return null;
  const [, y, mo, d, h = '0', mi = '0', s = '0', frac = '', zone] = m;
  const month = Number(mo) - 1;
  if (month < 0 || month > 11 || Number(d) < 1 || Number(d) > 31 || Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) return null;
  let t = Date.UTC(Number(y), month, Number(d), Number(h), Number(mi), Number(s), Math.round(Number(`0${frac}`) * 1000));
  if (new Date(t).getUTCDate() !== Number(d)) return null; // 2024-02-30
  if (zone && zone.toUpperCase() !== 'Z') {
    const sign = zone[0] === '-' ? -1 : 1;
    const digits = zone.slice(1).replace(':', '');
    const [zh, zm] = [Number(digits.slice(0, 2)), Number(digits.slice(2))];
    if (zh > 23 || zm > 59) return null; // +99:99
    t -= sign * (zh * 60 + zm) * 60_000;
  } else if (!zone) t -= naiveOffsetMinutes * 60_000;
  return t;
}

function mapColumns(header: string[]): Partial<Record<Field, number>> {
  const names = header.map(normalizeName);
  const find = (aliases: string[], taken: Set<number>) => {
    for (const alias of aliases) {
      const i = names.findIndex((n, idx) => n === alias && !taken.has(idx));
      if (i >= 0) return i;
    }
    return -1;
  };
  const taken = new Set<number>();
  const map: Partial<Record<Field, number>> = {};
  for (const field of ['open', 'high', 'low', 'close'] as const) {
    const i = find(NAMES[field], taken);
    if (i >= 0) { map[field] = i; taken.add(i); }
  }
  // An exact name first, so `Volume USD, Volume` charts Volume; then any other vol... column.
  let vol = find(NAMES.volume, taken);
  if (vol < 0) vol = names.findIndex((n, idx) => !taken.has(idx) && n.startsWith('vol'));
  if (vol >= 0) { map.volume = vol; taken.add(vol); }
  const date = find(NAMES.date, taken);
  const clock = date >= 0 ? find(NAMES.clock, taken) : -1;
  if (date >= 0 && clock >= 0) { map.date = date; map.clock = clock; }
  else {
    // A full timestamp beats a date-only column, so intraday rows keep their times.
    const time = find(NAMES.time, taken);
    if (time >= 0 || date >= 0) map.time = time >= 0 ? time : date;
  }
  return map;
}

export function parseBarsCsv(text: string, options: CsvBarsOptions = {}): CsvBarsResult {
  const maxRows = options.maxRows ?? 500_000;
  const errors: CsvBarsError[] = [];
  const notes: CsvBarsNote[] = [];
  const lines = splitRecords(text);
  const firstLine = lines.findIndex((l) => l.text.trim() !== '');
  if (firstLine < 0) return { bars: [], errors: [{ line: 0, message: 'The file is empty.' }], notes };

  const delimiter = pickDelimiter(lines[firstLine]!.text);
  const decimalComma = delimiter !== ',';
  const first = splitLine(lines[firstLine]!.text, delimiter);
  // No header when the first row is already a bar: a time (ISO or Unix) and four prices.
  const offset = Number.isFinite(options.utcOffsetMinutes) ? (options.utcOffsetMinutes as number) : 0;
  const headerless = first.length >= 5 && readTime(first[0]) !== null && first.slice(1, 5).every((c) => readNumber(c, decimalComma) !== null);
  let map: Partial<Record<Field, number>>;
  if (headerless) {
    map = { time: 0, open: 1, high: 2, low: 3, close: 4, volume: first.length > 5 ? 5 : undefined };
    notes.push('no-header');
  } else {
    map = mapColumns(first);
    const missing: string[] = (['open', 'high', 'low', 'close'] as const).filter((f) => map[f] === undefined);
    if (map.time === undefined && map.date === undefined) missing.unshift('time');
    if (missing.length > 0) {
      return { bars: [], errors: [{ line: lines[firstLine]!.line, message: `No column for ${missing.join(', ')}. The header row needs time (or date), open, high, low and close.` }], notes };
    }
  }
  if (map.volume === undefined) notes.push('no-volume');

  let naive = 0;
  const rows: Array<{ bar: CandleBar; line: number; cells: string[] }> = [];
  const start = headerless ? firstLine : firstLine + 1;
  let dataRows = 0;
  for (let i = start; i < lines.length; i++) {
    const { text: raw, line } = lines[i]!;
    if (raw.trim() === '') continue;
    if (++dataRows > maxRows) {
      errors.push({ line: 0, message: `The file has more than ${maxRows.toLocaleString('en-US')} rows; only the first ${maxRows.toLocaleString('en-US')} were read.` });
      break;
    }
    const cells = splitLine(raw, delimiter);
    // With separate Date and Time columns, a row without its time is refused rather than read as midnight.
    const timestamp = map.date !== undefined
      ? (cells[map.clock!] ? readTime(cells[map.date], cells[map.clock!], offset) : null)
      : readTime(cells[map.time!], undefined, offset);
    if (timestamp === null) {
      errors.push({ line, message: 'The time is not a date in year-month-day order or a Unix time.' });
      continue;
    }
    if (map.date !== undefined || zoneless(cells[map.time!])) naive++;
    const [open, high, low, close] = (['open', 'high', 'low', 'close'] as const).map((f) => readNumber(cells[map[f]!], decimalComma));
    const volume = map.volume === undefined ? 0 : readNumber(cells[map.volume], decimalComma);
    if (open === null || high === null || low === null || close === null || volume === null) {
      errors.push({ line, message: 'A price or the volume is not a number.' });
      continue;
    }
    if (high < Math.max(open, close, low) || low > Math.min(open, close)) {
      errors.push({ line, message: 'The high is below another price, or the low is above one.' });
      continue;
    }
    if (volume < 0) {
      errors.push({ line, message: 'The volume is negative.' });
      continue;
    }
    rows.push({ bar: { timestamp, open, high, low, close, volume }, line, cells });
  }

  const descending = rows.length > 1 && rows[0]!.bar.timestamp > rows[rows.length - 1]!.bar.timestamp;
  if (descending) notes.push('sorted');
  // Stable by line, so the first of two rows with the same time is the one kept.
  rows.sort((a, b) => a.bar.timestamp - b.bar.timestamp || a.line - b.line);
  const bars: CandleBar[] = [];
  const kept: typeof rows = [];
  for (let i = 0; i < rows.length; i++) {
    if (i > 0 && rows[i]!.bar.timestamp === rows[i - 1]!.bar.timestamp) {
      errors.push({ line: rows[i]!.line, message: 'This time is already in the file on an earlier line.' });
      continue;
    }
    bars.push(rows[i]!.bar);
    kept.push(rows[i]!);
  }
  if (!descending && rows.some((r, i) => i > 0 && r.line < rows[i - 1]!.line)) notes.push('sorted');
  errors.sort((a, b) => a.line - b.line);
  const result: CsvBarsResult = { bars, errors, notes };
  result.zoneless = naive;
  if (options.extraColumns && !headerless) {
    const skipped: string[] = [];
    result.extras = readExtraColumns(first, map, kept, decimalComma, skipped);
    result.skippedColumns = skipped;
  }
  return result;
}

const NO_VALUE = /^(-|--|na|n\/a|nan|null|none)$/i;

/** Every column the bars did not use whose cells are all numbers or "no value" words (an all-"no value" column is kept); a column with any other text is left out. */
function readExtraColumns(header: string[], map: Partial<Record<Field, number>>, rows: Array<{ cells: string[] }>, decimalComma: boolean, skipped: string[]): CsvExtraColumn[] {
  const used = new Set(Object.values(map).filter((i): i is number => i !== undefined));
  const out: CsvExtraColumn[] = [];
  header.forEach((name, col) => {
    if (used.has(col) || name.trim() === '') return;
    const values: Array<number | null> = [];
    for (const row of rows) {
      const cell = (row.cells[col] ?? '').trim();
      if (cell === '' || NO_VALUE.test(cell)) { values.push(null); continue; }
      const n = readNumber(cell, decimalComma);
      if (n === null) { skipped.push(name.trim()); return; } // text in the column: not a series, and the notes say so
      values.push(n);
    }
    if (values.length > 0) out.push({ header: name, values }); // a named column that is all "no value" stays, as unknown, rather than vanishing
  });
  return out;
}

/** One plain sentence or two about a parse, for a status line: how many bars loaded and what was skipped. */
export function describeBarsCsv(result: CsvBarsResult, fileName = 'the file'): string {
  const { bars, errors, notes } = result;
  const fileWide = errors.find((e) => e.line === 0 && bars.length === 0) ?? (bars.length === 0 ? errors[0] : undefined);
  if (bars.length === 0) return `No bars loaded from ${fileName}. ${fileWide?.message ?? 'No rows could be read.'}`;
  const parts = [`Loaded ${bars.length.toLocaleString('en-US')} bar${bars.length === 1 ? '' : 's'} from ${fileName}.`];
  const rows = errors.filter((e) => e.line > 0);
  if (rows.length > 0) {
    const shown = rows.slice(0, 3).map((e) => `line ${e.line}: ${e.message.replace(/\.$/, '').replace(/^\w/, (c) => c.toLowerCase())}`).join('; ');
    parts.push(`Skipped ${rows.length.toLocaleString('en-US')} row${rows.length === 1 ? '' : 's'} (${shown}${rows.length > 3 ? '; …' : ''}).`);
  }
  for (const e of errors.filter((e) => e.line === 0)) parts.push(e.message);
  if (notes.includes('sorted')) parts.push('The rows were out of time order, so they were sorted.');
  if (notes.includes('no-volume')) parts.push('There is no volume column, so volume shows as 0.');
  return parts.join(' ');
}

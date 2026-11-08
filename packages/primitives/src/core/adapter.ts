// An adapter turns something a person has (a file, later a feed) into what the parts draw: bars, any series beside
// them, and the problems it found, named by line. It is a plain function over its input: it reads, never repairs,
// never throws, and never writes a zero where the source said nothing. `csvAdapter` is the first; a host can write
// its own to the same shape and check the result with `seriesSetSchema`.

import { parseBarsCsv, type CsvBarsError, type CsvBarsNote, type CsvBarsOptions } from './csv-bars.js';
import type { CandleBar } from './chart-scale.js';
import type { DataSeries, SeriesPoint, SeriesSet } from './series.js';

/** A problem found while reading. `line` is 1-based in the source; 0 means the source as a whole. */
export type AdapterIssue = CsvBarsError;

export interface AdapterResult {
  /** Who read it, shown beside the data so a person can tell where it came from. */
  adapter: { name: string; version: string };
  bars: CandleBar[];
  /** Series beside the bars, on the bars' timestamps. */
  series: DataSeries[];
  errors: AdapterIssue[];
  /** Things that were assumed or changed on the way in, in words a status line can show. */
  notes: string[];
}

/** The shape every adapter has: a name, a version and a `read` that never throws. */
export interface DataAdapter<Input, Options = undefined> {
  name: string;
  version: string;
  read(input: Input, options?: Options): AdapterResult;
}

export type CsvAdapterOptions = Pick<CsvBarsOptions, 'maxRows' | 'utcOffsetMinutes'>;

const NOTES: Record<CsvBarsNote, string> = {
  sorted: 'The rows were out of time order, so they were sorted.',
  'no-volume': 'There is no volume column, so volume is 0.',
  'no-header': 'There was no header row, so the columns were read as time, open, high, low, close, volume.',
};

/** A header turned into an id: lower case, words joined by a dash, and a number added when two would collide. */
function idFromHeader(header: string, taken: Set<string>): string {
  const base = header.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'column';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

/**
 * Reads a CSV of bars and any all-number columns beside them. Times without a zone are UTC unless `utcOffsetMinutes`
 * says otherwise, and the note says which was used. An extra column's empty cell (or `-`, `NA`, `NaN`, `null`) is an
 * `unknown` point, because the file does not say why it is empty; a `0` is the value 0. A column with any other text in
 * it is not a series and is named in the notes.
 */
export const csvAdapter: DataAdapter<string, CsvAdapterOptions> = {
  name: 'csv',
  version: '1',
  read(text, options = {}) {
    const given = options.utcOffsetMinutes;
    if (given !== undefined && !(Number.isInteger(given) && given >= -720 && given <= 840)) {
      return { adapter: { name: 'csv', version: '1' }, bars: [], series: [], errors: [{ line: 0, message: `utcOffsetMinutes must be a whole number of minutes from -720 to 840, not ${String(given)}, so nothing was read.` }], notes: [] };
    }
    const parsed = parseBarsCsv(text, { ...options, extraColumns: true });
    const offset = Number.isFinite(options.utcOffsetMinutes) ? (options.utcOffsetMinutes as number) : 0;
    const notes: string[] = parsed.notes.map((n) => NOTES[n]);
    if (parsed.bars.length > 0 && (parsed.zoneless ?? 0) > 0) notes.push(offset === 0 ? 'Times with no zone were read as UTC.' : `Times with no zone were read as UTC${offset > 0 ? '+' : '-'}${Math.floor(Math.abs(offset) / 60)}:${String(Math.abs(offset) % 60).padStart(2, '0')}.`);
    for (const h of parsed.skippedColumns ?? []) notes.push(`Column "${h}" has a cell that is not a number or a no-value word (blank, -, NA, NaN, null), so it was left out and is not a series.`);
    const taken = new Set<string>(['bars']);
    const series: DataSeries[] = (parsed.extras ?? []).map((col) => {
      const points: SeriesPoint[] = parsed.bars.map((bar, i) => {
        const t = new Date(bar.timestamp).toISOString();
        const v = col.values[i];
        return typeof v === 'number' ? { t, kind: 'value', v } : { t, kind: 'unknown' };
      });
      return { id: idFromHeader(col.header, taken), label: col.header, points };
    });
    return { adapter: { name: 'csv', version: '1' }, bars: parsed.bars, series, errors: parsed.errors, notes };
  },
};

/**
 * The result as one set, with the bars' close as the primary series (`bars`), so `report` can say where another
 * series has no point or a different kind of gap. The bars must be in time order (every adapter's are).
 */
export function toSeriesSet(result: AdapterResult): SeriesSet {
  const bars: DataSeries = {
    id: 'bars',
    label: 'Close',
    points: result.bars.map((b) => ({ t: new Date(b.timestamp).toISOString(), kind: 'value', v: b.close }) as SeriesPoint),
  };
  return { schemaVersion: '0', alignment: { mode: 'exact', primary: 'bars' }, series: [bars, ...result.series] };
}

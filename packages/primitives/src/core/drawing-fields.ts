import { barsFromFirst, timeOfBarFromLast } from './drawings.js';
import type { CandleBar } from './chart-scale.js';

// Text field conversions for the drawing edit form: pure string and number rules, so they work without React.
export const toTimeField = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 19);
export const fromTimeField = (value: string) => (value.trim() === '' ? NaN : Date.parse(`${value.trim()}Z`));
/** The Bar field's words: a whole number when the time is on a bar, two decimals when it falls between bars. */
export const barField = (n: number | null) => (n === null ? '' : Number.isInteger(Math.round(n * 1e6) / 1e6) ? String(Math.round(n * 1e6) / 1e6) : n.toFixed(2));
/** A whole number, with an optional minus sign, or null. */
export const parseBarField = (value: string): number | null => (/^\s*-?\d+\s*$/.test(value) ? Number(value.trim()) : null);
/** The secondary count, from the first bar: "bar 188 of 200 from the first". */
export function barNote(bars: readonly CandleBar[], typedBar: number | null, time: number): string {
  const at = typedBar !== null ? timeOfBarFromLast(bars, typedBar) : time;
  const n = at === null ? null : barsFromFirst(bars, at);
  return n === null || !Number.isFinite(n) ? '' : `Bar ${barField(n)} of ${bars.length} from the first`;
}
export const fromPriceField = (value: string) => (value.trim() === '' ? NaN : Number(value.trim()));

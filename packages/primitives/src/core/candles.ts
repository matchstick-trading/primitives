import { barInterval, type CandleBar } from './chart-scale.js';

/** Heikin Ashi bars from ordinary ones: each bar averages its own prices and the previous Heikin Ashi bar. */
export function heikinAshi(bars: readonly CandleBar[]): CandleBar[] {
  const out: CandleBar[] = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const close = (b.open + b.high + b.low + b.close) / 4;
    const open = i === 0 ? (b.open + b.close) / 2 : (out[i - 1].open + out[i - 1].close) / 2;
    out.push({ timestamp: b.timestamp, open, close, high: Math.max(b.high, open, close), low: Math.min(b.low, open, close), volume: b.volume });
  }
  return out;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** The default time-axis label: HH:MM in UTC, with the month and day when the day changes from the previous label. */
export const formatBarTime = (t: number, previous: number | null) => {
  const d = new Date(t);
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  const sameDay = previous !== null && new Date(previous).toISOString().slice(0, 10) === d.toISOString().slice(0, 10);
  return sameDay ? time : `${d.toISOString().slice(5, 10)} ${time}`;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** A date label for daily and longer bars: "Nov 9", with the year added when it differs from the previous label's ("Jan 4 2027"). UTC. */
export const formatBarDate = (t: number, previous: number | null) => {
  const d = new Date(t);
  const label = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return previous !== null && new Date(previous).getUTCFullYear() !== d.getUTCFullYear() ? `${label} ${d.getUTCFullYear()}` : label;
};

const DAY_MS = 86_400_000;
/** True when the bars are a day or more apart (the typical gap, so weekends and holidays do not decide it). */
export function barsAreDaily(bars: readonly { timestamp: number }[]): boolean {
  if (bars.length < 2) return false;
  // The typical gap is remembered per series by barInterval, so asking on every render does not sort the series again.
  return barInterval(bars as readonly CandleBar[]) >= DAY_MS * 0.8;
}

import type { CandleBar } from './chart-scale.js';

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

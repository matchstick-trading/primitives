// Made-up data. Replace `bars` and `trades` with your own: the shapes are all the chart needs.

export interface Bar { timestamp: number; open: number; high: number; low: number; close: number; volume: number }
export interface Trade { time: number; side: 'buy' | 'sell'; price: number }

export const bars: Bar[] = Array.from({ length: 120 }, (_, i) => {
  const base = 100 + Math.sin(i / 9) * 3 + i * 0.02;
  return {
    timestamp: Date.UTC(2026, 0, 7, 14, i),
    open: base,
    high: base + 0.4,
    low: base - 0.4,
    close: base + (i % 2 ? 0.2 : -0.2),
    volume: 100 + (i % 7) * 20,
  };
});

// A bot's trades, as a list of time, side and price. Here: four made-up trades on bar closes.
export const trades: Trade[] = [
  { time: bars[12].timestamp, side: 'buy', price: bars[12].close },
  { time: bars[40].timestamp, side: 'sell', price: bars[40].close },
  { time: bars[71].timestamp, side: 'buy', price: bars[71].close },
  { time: bars[100].timestamp, side: 'sell', price: bars[100].close },
];

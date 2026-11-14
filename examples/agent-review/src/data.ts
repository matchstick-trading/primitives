// Made-up data. Replace `bars` and `proposals` with your own: the shapes are all the example needs.

export interface Bar { timestamp: number; open: number; high: number; low: number; close: number; volume: number }

// One thing an agent suggests. `accepted` is the review: null = not reviewed yet, true = accepted, false = rejected.
// This shape lives in this example only; Primitives does not define it.
export interface Proposal {
  id: string;
  time: number; // the timestamp of a bar, in milliseconds
  side: 'buy' | 'sell';
  price: number;
  size: number;
  note: string; // the agent's reason, in its own words
  accepted: boolean | null;
}

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

const at = (i: number, side: 'buy' | 'sell', size: number, note: string): Proposal => ({
  id: `p${i}`, time: bars[i].timestamp, side, price: bars[i].close, size, note, accepted: null,
});

// Six made-up proposals from a made-up agent. Nothing here is sent anywhere: this example places no orders.
export const proposals: Proposal[] = [
  at(12, 'buy', 2, 'Price dipped to the low of the last 10 bars and volume is rising.'),
  at(26, 'sell', 2, 'Up 2% since the buy and the last three bars lost momentum.'),
  at(40, 'sell', 1, 'Price is near the top of its range; a small short as a hedge.'),
  at(58, 'buy', 3, 'Second dip to the same level. Three times the size because the range held.'),
  at(84, 'sell', 3, 'Closing the position before the last 30 minutes.'),
  at(101, 'buy', 1, 'Rebound after a quiet stretch; small size.'),
];

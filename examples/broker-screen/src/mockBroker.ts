// A made-up stand-in for an API-only broker back end. A real one would be a WebSocket or a REST poll behind the
// same two callbacks: swap this file, keep the screen. Nothing here is real market data.

export interface Tick { timestamp: number; price: number; size: number; side: 'buy' | 'sell' }
export interface BookLevel { price: string; size: string }
export interface Book { bids: BookLevel[]; asks: BookLevel[] }

// A small fixed-seed random generator, so every run draws the same session.
function random(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

// What a REST history call would return: made-up bars that end where the live feed starts (5000).
export function mockHistory(now: number, count: number, intervalMs: number) {
  const next = random(7);
  const closes: number[] = [5000];
  for (let i = 1; i < count; i++) closes.unshift(closes[0] - Math.round((next() - 0.5) * 8) * 0.25);
  const end = Math.floor(now / intervalMs) * intervalMs;
  return closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1];
    return { timestamp: end - (count - i) * intervalMs, open, high: Math.max(open, close) + 0.5, low: Math.min(open, close) - 0.5, close, volume: 20 + Math.floor(next() * 30) };
  });
}

export function startMockBroker(onTick: (tick: Tick) => void, onBook: (book: Book) => void, everyMs = 300) {
  const next = random(42);
  let price = 5000;
  const timer = setInterval(() => {
    const step = Math.round((next() - 0.5) * 8) * 0.25;
    price = Math.max(1, price + step);
    onTick({ timestamp: Date.now(), price, size: 1 + Math.floor(next() * 9), side: step >= 0 ? 'buy' : 'sell' });
    const level = (i: number, sign: 1 | -1): BookLevel => ({ price: (price + sign * 0.25 * i).toFixed(2), size: String(2 + Math.floor(next() * 14)) });
    onBook({
      bids: Array.from({ length: 12 }, (_, i) => level(i + 1, -1)),
      asks: Array.from({ length: 12 }, (_, i) => level(i + 1, 1)),
    });
  }, everyMs);
  return () => clearInterval(timer);
}

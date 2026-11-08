// Core without React: indicator series on synthetic bars. Run: node examples/studies.mjs
import { sma, ema, rsi } from '@matchstick-trading/primitives/core';

const bars = Array.from({ length: 30 }, (_, i) => {
  const close = 100 + Math.sin(i / 3) * 5 + i * 0.2;
  return { timestamp: 1700000000000 + i * 60000, open: close - 0.4, high: close + 1, low: close - 1, close, volume: 1000 + i * 10 };
});

const last = (series) => series[series.length - 1];
console.log('sma(10):', last(sma(bars, 10)));
console.log('ema(10):', last(ema(bars, 10)));
console.log('rsi(14):', last(rsi(bars, 14)));

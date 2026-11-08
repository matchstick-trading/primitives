// Core without React: parse a bars CSV, then compute the chart frame a renderer would draw.
// Synthetic data only. Run: node examples/csv-to-chart-frame.mjs
import { parseBarsCsv, describeBarsCsv, chartFrame, lastBars } from '@matchstick-trading/primitives/core';

const csv = [
  'timestamp,open,high,low,close,volume',
  '1700000000000,100,102,99,101,1200',
  '1700000060000,101,103,100,102,900',
  '1700000120000,102,102.5,98,99,1500',
  '1700000180000,99,101,98.5,100.5,700',
].join('\n');

const result = parseBarsCsv(csv);
console.log(describeBarsCsv(result, 'synthetic.csv'));

const frame = chartFrame(result.bars, lastBars(result.bars.length, 4), { width: 600, height: 300 });
console.log('visible bars:', frame.first, 'to', frame.last, 'price', frame.priceMin, 'to', frame.priceMax);

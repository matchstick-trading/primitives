// Your trades CSV on the Tape: read a file of trades, check every row, and say which line is wrong.
// Synthetic data only (examples/synthetic-trades.csv, one bad line on purpose).
// Run: node examples/csv-to-tape.mjs [path-to-trades.csv]
// Columns, in this order: time (ISO-8601 UTC, ending in Z), price, size, side (buy, sell or unknown).
import { readFileSync } from 'node:fs';
import { readTape, tapeSummary, newestFirst } from '@matchstick-trading/primitives/core';

const file = process.argv[2] ?? new URL('./synthetic-trades.csv', import.meta.url);
const lines = readFileSync(file, 'utf8').split(/\r?\n/);

// Keep each row's line number in the file (1-based), so a problem can be named by line.
const rows = [];
lines.forEach((text, i) => {
  if (i === 0 || text.trim() === '') return; // header and blank lines
  const [t, price, size, side] = text.split(',').map((cell) => cell.trim());
  rows.push({ line: i + 1, trade: { t, price, size, side } });
});

// readTape checks the trades and reports every problem by its place in the list; it never repairs a row.
const { rows: tape, issues } = readTape(rows.map((r) => r.trade));

for (const issue of issues) {
  const line = issue.index >= 0 ? rows[issue.index].line : 0;
  console.log(`Line ${line}: left out. ${issue.message}.`);
}
console.log(tapeSummary(tape));
for (const row of newestFirst(tape)) console.log(`${row.time}  ${row.side.padEnd(7)} ${row.size} @ ${row.price}`);

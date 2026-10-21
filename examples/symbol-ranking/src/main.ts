import { rank, type Instrument } from './rank';

// Made-up instruments. None of these are real companies or tickers.
const INSTRUMENTS: Instrument[] = [
  { symbol: 'ACME', name: 'Acme Robotics', aliases: ['ACM'] },
  { symbol: 'ACMEW', name: 'Acme Robotics Warrants' },
  { symbol: 'ACX', name: 'Apex Copper Mining' },
  { symbol: 'BLU', name: 'Blue Lake Utilities', aliases: ['BLUE'] },
  { symbol: 'BLUF', name: 'Bluff Point Energy' },
  { symbol: 'NRTH', name: 'North Ridge Rail' },
  { symbol: 'RDG', name: 'Ridge Data Group' },
  { symbol: 'ZEN', name: 'Zenith Water' },
];

const input = document.querySelector<HTMLInputElement>('#q')!;
const list = document.querySelector<HTMLOListElement>('#results')!;

function render() {
  const results = rank(INSTRUMENTS, input.value);
  list.replaceChildren(...results.map((r) => {
    const li = document.createElement('li');
    li.textContent = `${r.symbol}  ${r.name}`;
    return li;
  }));
  if (input.value.trim() && results.length === 0) list.append(Object.assign(document.createElement('li'), { textContent: 'No match' }));
}

input.addEventListener('input', render);
document.querySelectorAll<HTMLButtonElement>('[data-try]').forEach((b) =>
  b.addEventListener('click', () => { input.value = b.dataset.try!; render(); input.focus(); }));

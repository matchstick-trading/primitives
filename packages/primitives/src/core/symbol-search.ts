/**
 * The matching rules of the symbol search as plain functions. The host owns the instrument list;
 * this owns matching. Ideas, not code, come from the old symbol trie (a character trie, no licence on record): it
 * is replaced here by sorted arrays and binary search, and by no regular expression at all, so no typed character
 * can make `searchSymbols` throw.
 *
 * Order of results: an exact symbol, then a symbol that starts with the text, then an exact alias, then an alias or a
 * name word that starts with the text. When more than one word is typed, each must start a different word of the symbol, name
 * or aliases; those matches rank with the word matches. Inside a group: the shorter symbol, then A to Z, then venue, then list order.
 * Typo tolerance is deliberately not here: in a ticker box a typo can pick the wrong instrument.
 */
export interface Instrument {
  /** Unique within the list. */
  id: string;
  symbol: string;
  venue: string;
  name?: string;
  aliases?: readonly string[];
  kind?: string;
  /** YYYY-MM-DD, for contracts that expire. */
  expires?: string;
}

export type MatchedOn = 'symbol' | 'alias' | 'name';
export type MatchHow = 'exact' | 'prefix' | 'word';

export interface SymbolMatch {
  instrument: Instrument;
  matchedOn: MatchedOn;
  how: MatchHow;
  /** 0 is best. */
  rank: number;
}

export interface SearchOptions {
  /** At most this many rows; default 20, clamped to 1..200. */
  limit?: number;
  venue?: string;
  kind?: string;
}

interface Entry {
  instrument: Instrument;
  order: number;
  symbolKey: string;
  venueKey: string;
  kindKey: string;
  /** Every word of the symbol, name and aliases, built when a multi-word query first needs it. */
  parts?: Part[];
}
interface Part { word: string; on: MatchedOn }
interface Keyed { key: string; entry: Entry; on: MatchedOn }

export interface SymbolIndex {
  /** Records kept. */
  readonly size: number;
  /** Records dropped because id, symbol or venue was not a non-empty string, or the id repeated. */
  readonly skipped: number;
  /** @internal */ readonly entries: readonly Entry[];
  /** @internal */ readonly bySymbol: readonly Keyed[];
  /** @internal */ words: Keyed[] | null;
  /** @internal */ tails: Keyed[] | null;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;
const MAX_QUERY = 64;

/** Upper case, Unicode-composed, spaces collapsed. Total: it accepts any string, including lone surrogates. */
export function normalizeSymbolText(text: unknown): string {
  return fold(text).slice(0, MAX_QUERY);
}

function fold(text: unknown): string {
  if (typeof text !== 'string') return '';
  let s = text;
  try { s = s.normalize('NFKC'); } catch { /* keep the text as typed */ }
  return s.toUpperCase().replace(/\s+/g, ' ').trim();
}

/** The words of a value, each cut to the query length: split first, so a word past the 64th character is still found. */
const wordsOf = (value: unknown): string[] => (text(value) ? fold(value).split(' ').filter(Boolean).map((w) => w.slice(0, MAX_QUERY)) : []);

const text = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

const byKey = (a: Keyed, b: Keyed) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.entry.order - b.entry.order);

/** Indexes the symbols now; names and aliases on the first search that needs them. Never throws. */
export function buildSymbolIndex(instruments: readonly Instrument[]): SymbolIndex {
  const entries: Entry[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const instrument of instruments ?? []) {
    if (!instrument || !text(instrument.id) || !text(instrument.symbol) || !text(instrument.venue) || seen.has(instrument.id)) { skipped++; continue; }
    seen.add(instrument.id);
    entries.push({ instrument, order: entries.length, symbolKey: normalizeSymbolText(instrument.symbol), venueKey: normalizeSymbolText(instrument.venue), kindKey: normalizeSymbolText(instrument.kind) });
  }
  const bySymbol = entries.map((entry): Keyed => ({ key: entry.symbolKey, entry, on: 'symbol' })).sort(byKey);
  return { size: entries.length, skipped, entries, bySymbol, words: null, tails: null };
}

function wordIndex(index: SymbolIndex): Keyed[] {
  if (index.words) return index.words;
  const words: Keyed[] = [];
  for (const entry of index.entries) {
    const { name, aliases } = entry.instrument;
    for (const w of wordsOf(name)) words.push({ key: w, entry, on: 'name' });
    if (Array.isArray(aliases)) for (const alias of aliases) if (text(alias)) words.push({ key: normalizeSymbolText(alias), entry, on: 'alias' });
  }
  return (index.words = words.sort(byKey));
}

function entryParts(entry: Entry): Part[] {
  if (entry.parts) return entry.parts;
  const { symbol, name, aliases } = entry.instrument;
  const parts: Part[] = wordsOf(symbol).map((word): Part => ({ word, on: 'symbol' })); // a symbol can hold spaces
  for (const w of wordsOf(name)) parts.push({ word: w, on: 'name' });
  if (Array.isArray(aliases)) for (const alias of aliases) for (const w of wordsOf(alias)) parts.push({ word: w, on: 'alias' });
  return (entry.parts = parts);
}

/**
 * The second and later words of symbols and aliases, for queries of more than one word; built on first use. The
 * symbol index and the word index already start at every name word and at the first word of each symbol and alias,
 * so only these are missing, and in most lists there are few of them.
 */
function tailIndex(index: SymbolIndex): Keyed[] {
  if (index.tails) return index.tails;
  const tails: Keyed[] = [];
  for (const entry of index.entries) {
    const { symbol, aliases } = entry.instrument;
    for (const w of wordsOf(symbol).slice(1)) tails.push({ key: w, entry, on: 'symbol' });
    if (Array.isArray(aliases)) for (const alias of aliases) for (const w of wordsOf(alias).slice(1)) tails.push({ key: w, entry, on: 'alias' });
  }
  return (index.tails = tails.sort(byKey));
}

/** First position whose key is >= `prefix`. */
function lowerBound(list: readonly Keyed[], prefix: string): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (list[mid].key < prefix) lo = mid + 1; else hi = mid;
  }
  return lo;
}

function compare(a: SymbolMatch, b: SymbolMatch): number {
  return a.rank - b.rank
    || a.instrument.symbol.length - b.instrument.symbol.length
    || (a.instrument.symbol < b.instrument.symbol ? -1 : a.instrument.symbol > b.instrument.symbol ? 1 : 0)
    || (a.instrument.venue < b.instrument.venue ? -1 : a.instrument.venue > b.instrument.venue ? 1 : 0);
}

/** Ranked rows for `query`, at most `limit`. An empty or odd query gives no rows; it never throws. */
export function searchSymbols(index: SymbolIndex, query: string, options: SearchOptions = {}): SymbolMatch[] {
  try {
    const q = normalizeSymbolText(query);
    if (q === '') return [];
    const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(Number.isFinite(options.limit) ? (options.limit as number) : DEFAULT_LIMIT)));
    const venue = options.venue ? normalizeSymbolText(options.venue) : null;
    const kind = options.kind ? normalizeSymbolText(options.kind) : null;
    // The best `limit` rows so far, in order. A word index can hold tens of thousands of hits for one letter,
    // so keep a short sorted list instead of collecting and sorting them all.
    const top: Array<{ match: SymbolMatch; order: number }> = [];
    const before = (match: SymbolMatch, order: number, other: { match: SymbolMatch; order: number }) => (compare(match, other.match) || order - other.order) < 0; // last tie-break: list order
    const consider = (hit: Keyed, how: MatchHow, rank: number) => {
      const { instrument, order, venueKey, kindKey } = hit.entry;
      if (venue && venueKey !== venue) return;
      if (kind && kindKey !== kind) return;
      const match: SymbolMatch = { instrument, matchedOn: hit.on, how, rank };
      const at = top.findIndex((t) => t.order === order);
      if (at >= 0) {
        if (top[at].match.rank <= rank) return; // already here with an equal or better match
        top.splice(at, 1);
      } else if (top.length >= limit && before(match, order, top[top.length - 1]) === false) return;
      let i = top.length;
      while (i > 0 && before(match, order, top[i - 1])) i--;
      top.splice(i, 0, { match, order });
      if (top.length > limit) top.pop();
    };
    // Symbols: the sorted run that starts with q; the exact ones sort first inside it.
    for (let i = lowerBound(index.bySymbol, q); i < index.bySymbol.length && index.bySymbol[i].key.startsWith(q); i++) {
      const hit = index.bySymbol[i];
      consider(hit, hit.key === q ? 'exact' : 'prefix', hit.key === q ? 0 : 1);
    }
    // Aliases and name words rank below every symbol match, so a full list of symbol matches needs no further look
    // (and the name index is built on the first search that needs it, not at indexing time).
    if (top.length < limit || top[top.length - 1].match.rank > 1) {
      const words = wordIndex(index);
      for (let i = lowerBound(words, q); i < words.length && words[i].key.startsWith(q); i++) {
        const hit = words[i];
        if (hit.on === 'alias') consider(hit, hit.key === q ? 'exact' : 'prefix', hit.key === q ? 2 : 3);
        else consider(hit, 'word', 3);
      }
    }
    // More than one word typed ("apple inc", "dec 2026"): every word must start a different word of the symbol, name
    // or aliases, so "dec dec" needs two DECs. The longest word picks the candidates; the rest are checked on each.
    // Ranked with the word matches.
    if (q.includes(' ') && (top.length < limit || top[top.length - 1].match.rank > 2)) {
      // Longest first: two typed words that fit the same word are prefixes of each other, so the longer one is the
      // pickier and claims a word first; then a greedy pass finds a fit whenever one exists.
      const tokens = q.split(' ').filter(Boolean).sort((a, b) => b.length - a.length);
      const driver = tokens[0];
      const done = new Set<number>();
      let taken = new Uint8Array(16);
      const check = (entry: Entry) => {
        if (done.has(entry.order)) return;
        done.add(entry.order);
        const words = entryParts(entry);
        if (words.length > taken.length) taken = new Uint8Array(words.length); else taken.fill(0, 0, words.length);
        let onSymbol = false;
        let onName = false;
        for (const t of tokens) {
          let k = 0;
          while (k < words.length && (taken[k] === 1 || !words[k].word.startsWith(t))) k++;
          if (k === words.length) return;
          taken[k] = 1;
          if (words[k].on === 'symbol') onSymbol = true; else if (words[k].on === 'name') onName = true;
        }
        consider({ key: q, entry, on: onSymbol ? 'symbol' : onName ? 'name' : 'alias' }, 'word', 3);
      };
      // Candidates: every entry with a word that starts with the driver (a symbol, a name word, an alias, or a later word of a symbol or alias).
      for (const list of [index.bySymbol, wordIndex(index), tailIndex(index)]) {
        for (let i = lowerBound(list, driver); i < list.length && list[i].key.startsWith(driver); i++) check(list[i].entry);
      }
    }
    return top.map((t) => t.match);
  } catch {
    return []; // the contract of this function: a result list, never an exception
  }
}

/** Resolves the key a user pressed in the search box. */
export type SymbolKeyAction = 'next' | 'previous' | 'pick' | 'close' | 'clear';
interface KeyLike { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; isComposing?: boolean }

/** ArrowDown/Up move, Enter picks, Escape closes the list and a second Escape clears the text. Not while composing text (IME). */
export function resolveSymbolKey(event: KeyLike, state: { open: boolean; hasText: boolean }): SymbolKeyAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return null;
  switch (event.key) {
    case 'ArrowDown': return 'next';
    case 'ArrowUp': return 'previous';
    case 'Enter': return state.open ? 'pick' : null;
    case 'Escape': return state.open ? 'close' : state.hasText ? 'clear' : null;
    default: return null;
  }
}

/** The row index a move lands on; the ends stop (no wrap). With no row active, next lands on 0 and previous on the last. */
export function nextSymbolIndex(count: number, current: number, action: 'next' | 'previous'): number {
  if (count === 0) return -1;
  if (current < 0 || current >= count) return action === 'next' ? 0 : count - 1;
  return Math.min(count - 1, Math.max(0, current + (action === 'next' ? 1 : -1)));
}
